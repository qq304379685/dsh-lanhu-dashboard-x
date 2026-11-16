import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 浏览器代登录：启动一个独立 profile 的 Chrome/Edge 打开蓝湖登录页，
 * 用户在里面正常登录（短信/滑块/扫码都随意），登录成功后通过 CDP 读回 lanhuapp.com 的 Cookie。
 * 这样既不用逆向验证码，也不依赖系统浏览器的加密 Cookie。
 */

/** 可用的 Chromium 内核浏览器路径（按优先级） */
const BROWSER_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe'
]

/** 登录页地址 */
// 登录入口用工作台首页：未登录时蓝湖自己会把人带到 sso 登录页，
// 直接开 /sso/#/login 这个 hash 路由在蓝湖前端里并不存在（白屏）。
export const LOGIN_URL = 'https://lanhuapp.com/dashboard/'

/** 轮询间隔与总超时（毫秒） */
const POLL_MS = 1500
const TIMEOUT_MS = 5 * 60 * 1000
/** 固定调试端口：同一个 profile 反复打开时复用同一个浏览器实例 */
const CDP_PORT = 19222

/**
 * 找出本机可用的浏览器可执行文件
 * @returns {string} 浏览器路径，找不到返回空串
 */
export function findBrowser() {
  for (const item of BROWSER_CANDIDATES) {
    try {
      if (existsSync(item)) return item
    } catch (error) {
      // 忽略单个路径的探测失败
    }
  }
  return ''
}

/**
 * 等待 CDP 端口就绪
 * @param {string} endpoint CDP base url
 * @param {number} timeoutMs 超时毫秒
 * @returns {Promise<string>} browser ws debugger url
 */
async function waitForCdp(endpoint, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(endpoint + '/json/version', { signal: AbortSignal.timeout(1500) })
      if (res.ok) {
        const data = await res.json()
        if (data.webSocketDebuggerUrl) return data.webSocketDebuggerUrl
      }
    } catch (error) {
      // 端口还没起来，继续等
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error('浏览器调试端口未就绪')
}

/**
 * 列出所有页面 target
 * @param {string} endpoint CDP base url
 * @returns {Promise<Array<object>>} target 列表
 */
async function listTargets(endpoint) {
  const res = await fetch(endpoint + '/json/list', { signal: AbortSignal.timeout(2000) })
  if (!res.ok) return []
  const data = await res.json()
  return Array.isArray(data) ? data.filter((item) => item.type === 'page') : []
}

/**
 * 通过 CDP 读取浏览器里所有 Cookie
 * @param {string} wsUrl 页面 target 的 ws 地址
 * @returns {Promise<Array<object>>} CDP Cookie 数组
 */
function readCookies(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true
      try {
        ws.close()
      } catch (closeError) {
        // 忽略关闭异常
      }
      if (error) reject(error)
      else resolve(value)
    }
    const timer = setTimeout(() => finish(new Error('读取 Cookie 超时')), 5000)
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method: 'Network.getAllCookies', params: {} }))
    }
    ws.onmessage = (event) => {
      clearTimeout(timer)
      try {
        const payload = JSON.parse(String(event.data))
        if (payload.id === 1) {
          if (payload.error) finish(new Error(payload.error.message || 'CDP 返回错误'))
          else finish(null, (payload.result && payload.result.cookies) || [])
        }
      } catch (error) {
        finish(error)
      }
    }
    ws.onerror = () => {
      clearTimeout(timer)
      finish(new Error('CDP 连接失败'))
    }
  })
}

/**
 * 在已打开的浏览器里新开一个标签页
 * @param {string} browserWs 浏览器级 ws 地址
 * @param {string} url 目标地址
 * @returns {Promise<void>}
 */
function openTarget(browserWs, url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(browserWs)
    let settled = false
    const timer = setTimeout(() => finish(new Error('打开标签页超时')), 5000)
    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        ws.close()
      } catch (closeError) {
        // 忽略关闭异常
      }
      if (error) reject(error)
      else resolve()
    }
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url: url } }))
    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data))
        if (payload.id === 1) finish(payload.error ? new Error(payload.error.message) : null)
      } catch (error) {
        finish(error)
      }
    }
    ws.onerror = () => finish(new Error('浏览器连接失败'))
  })
}

/**
 * 从 CDP Cookie 列表里筛出蓝湖域下的 Cookie 拼成请求头
 * @param {Array<object>} cookies CDP Cookie 数组
 * @returns {{cookie:string, names:string[]}} Cookie 请求头与名称列表
 */
export function pickLanhuCookies(cookies) {
  const picked = []
  const names = []
  for (const item of cookies) {
    const domain = String((item && item.domain) || '')
    if (domain.indexOf('lanhuapp.com') === -1) continue
    if (!item.name) continue
    picked.push(item.name + '=' + item.value)
    names.push(item.name)
  }
  return { cookie: picked.join('; '), names: names }
}

/**
 * 读取指定 CDP 端口下浏览器里的蓝湖 Cookie（供调试与联调使用）
 * @param {string} endpoint CDP base url，如 http://127.0.0.1:9301
 * @returns {Promise<{cookie:string, names:string[]}>} Cookie 请求头与名称列表
 */
export async function readCookiesForEndpoint(endpoint) {
  await waitForCdp(endpoint, 8000)
  const targets = await listTargets(endpoint)
  if (!targets.length) return { cookie: '', names: [] }
  const page = targets.find((item) => String(item.url || '').indexOf('lanhuapp.com') !== -1) || targets[0]
  const cookies = await readCookies(page.webSocketDebuggerUrl)
  return pickLanhuCookies(cookies)
}

/**
 * 创建浏览器代登录控制器
 * @param {object} options { dataDir, saveCookie, log }
 * @returns {object} { start, status, stop }
 */
export function createBrowserLogin(options) {
  const dataDir = options.dataDir
  const saveCookie = options.saveCookie
  let state = { state: 'idle', message: '', cookieCount: 0, browser: '', startedAt: 0 }
  let child = null
  let timer = null

  /**
   * 判断当前 Cookie 是否已拿到登录态（必须有 session）
   * @returns {Promise<boolean>} 是否完成
   */
  async function pollOnce(endpoint) {
    const targets = await listTargets(endpoint)
    if (!targets.length) return false
    const page = targets.find((item) => String(item.url || '').indexOf('lanhuapp.com') !== -1) || targets[0]
    if (!page.webSocketDebuggerUrl) return false
    const cookies = await readCookies(page.webSocketDebuggerUrl)
    const picked = pickLanhuCookies(cookies)
    if (!picked.names.length) return false
    const hasSession = picked.names.indexOf('session') !== -1
    if (!hasSession) return false
    await saveCookie(picked.cookie)
    state = {
      state: 'ok',
      message: '已登录，Cookie 已保存（' + picked.names.length + ' 项）',
      cookieCount: picked.names.length,
      browser: state.browser,
      startedAt: state.startedAt
    }
    return true
  }

  /**
   * 启动浏览器并开始轮询登录结果
   * @returns {Promise<object>} 启动结果
   */
  async function start() {
    if (state.state === 'waiting') return state
    const exe = findBrowser()
    if (!exe) throw new Error('本机没有找到 Chrome / Edge，无法使用浏览器登录')
    const profileDir = join(dataDir, 'browser-profile')
    const endpoint = 'http://127.0.0.1:' + CDP_PORT
    // 先看是否已有带调试端口的实例在跑：有就复用，只新开一个登录标签页
    let browserWs = ''
    try {
      browserWs = await waitForCdp(endpoint, 1200)
    } catch (probeError) {
      browserWs = ''
    }
    if (browserWs) {
      try {
        await openTarget(browserWs, LOGIN_URL)
      } catch (openError) {
        // 打不开标签页也继续，用户可能自己切到已有标签
      }
    } else {
      const args = [
        '--remote-debugging-port=' + CDP_PORT,
        '--user-data-dir=' + profileDir,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-features=Translate',
        '--window-size=1180,860',
        LOGIN_URL
      ]
      child = spawn(exe, args, { detached: true, stdio: 'ignore' })
      child.unref()
    }
    state = { state: 'waiting', message: '请在打开的浏览器窗口里完成登录…', cookieCount: 0, browser: exe, startedAt: Date.now(), endpoint: endpoint }
    const deadline = Date.now() + TIMEOUT_MS
    const loop = async () => {
      if (state.state !== 'waiting') return
      if (Date.now() > deadline) {
        state = { ...state, state: 'error', message: '等待登录超时，请重试' }
        return
      }
      try {
        await waitForCdp(endpoint, 5000)
        const done = await pollOnce(endpoint)
        if (done) return
        state = { ...state, message: '浏览器已打开，等待你完成登录…' }
      } catch (error) {
        const text = String((error && error.message) || '')
        state = {
          ...state,
          message: text.indexOf('调试端口') !== -1 ? '浏览器已在运行但没有调试端口，请关闭该浏览器窗口后重试' : '等待浏览器就绪…'
        }
      }
      timer = setTimeout(loop, POLL_MS)
    }
    void loop()
    return state
  }

  /**
   * 读取当前状态
   * @returns {object} 状态对象
   */
  function status() {
    return { ...state }
  }

  /**
   * 停止轮询（不关闭已打开的浏览器，用户可继续使用）
   * @returns {void}
   */
  function stop() {
    if (timer) clearTimeout(timer)
    timer = null
    if (state.state === 'waiting') state = { ...state, state: 'idle', message: '' }
  }

  return { start: start, status: status, stop: stop }
}
