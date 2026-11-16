/**
 * 蓝湖原型读取客户端
 *
 * 功能：管理蓝湖鉴权 Cookie，拉取「产品原型（Axure）」文档列表、索引 JSON、单页清单、
 *      页面 HTML 与扁平化静态资源，并做进程内缓存。
 * 作者：DSH
 * 日期：2026-11-15
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve, extname } from 'node:path'
import { homedir } from 'node:os'
import vm from 'node:vm'
import { publicEncrypt, constants as cryptoConstants } from 'node:crypto'

/** DSH profile 目录 */
const PROFILE_DIR = process.env.DSH_PROFILE_DIR || join(homedir(), '.dsh', 'profiles', 'desktop')
/** 本插件数据目录（Cookie、绑定关系） */
export const PLUGIN_DATA_DIR = join(PROFILE_DIR, 'data', 'dsh-lanhu-proto')
/** 蓝湖 Web 主站 */
const DEFAULT_BASE_URL = 'https://lanhuapp.com'
/** 蓝湖 Axure 扁平资源 CDN */
const CDN_ORIGIN = 'https://axure-file.lanhuapp.com'
/** 接口超时 */
const API_TIMEOUT_MS = 20000
/** 资源超时 */
const ASSET_TIMEOUT_MS = 30000
/** 接口缓存时长（文档列表会变，短一点） */
const API_CACHE_TTL = 60 * 1000
/** 元数据缓存时长（索引 JSON、单页清单几乎不变） */
const META_CACHE_TTL = 30 * 60 * 1000
/** 伪装成浏览器，避免 CDN 拒绝 */
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

/** 扩展名到 Content-Type */
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg'
}

/**
 * 根据文件扩展名推断 Content-Type
 * @param {string} path 资源路径
 * @returns {string} MIME 类型
 */
export function contentTypeOf(path) {
  const ext = extname(String(path || '').split('?')[0]).toLowerCase()
  return CONTENT_TYPES[ext] || 'application/octet-stream'
}

/**
 * 蓝湖调用异常
 */
export class LanhuError extends Error {
  /**
   * @param {string} message 人类可读信息
   * @param {string} code 机器可读错误码：AUTH / API / NETWORK / NOTFOUND
   */
  constructor(message, code) {
    super(message)
    this.name = 'LanhuError'
    this.code = code || 'API'
  }
}

/**
 * 解码蓝湖名称里的 HTML 实体（接口返回的团队/项目/文档名会带 &amp; 之类）
 * @param {string} text 原始文本
 * @returns {string} 解码后的文本
 */
function decodeEntities(text) {
  return String(text == null ? '' : text)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/** 简易 TTL 缓存：key -> { value, expireAt } */
const cache = new Map()

/**
 * 读缓存
 * @param {string} key 缓存键
 * @param {number} ttl 有效期毫秒
 * @returns {any} 命中返回值，未命中返回 undefined
 */
function cacheGet(key, ttl) {
  const hit = cache.get(key)
  if (!hit) return undefined
  if (Date.now() > hit.expireAt) {
    cache.delete(key)
    return undefined
  }
  return hit.value
}

/**
 * 写缓存
 * @param {string} key 缓存键
 * @param {any} value 值
 * @param {number} ttl 有效期毫秒
 */
function cacheSet(key, value, ttl) {
  cache.set(key, { value, expireAt: Date.now() + ttl })
}

/**
 * 按前缀清理缓存
 * @param {string} prefix 键前缀
 */
/** 蓝湖 SSO 登录用的 RSA 公钥（PKCS#1，取自 sso 前端 app.js） */
const LOGIN_RSA_PUBLIC_KEY =
  'MIIBCgKCAQEAuOPxjgRR1vm2WCmVFlBa8SsaFo4F1dHg3ArwdPt7sbmK/suiRT41' +
  '9bYL5ya40bxDUxUswmvh+9LePK9KGONC+3zHY//ggCh5ldiVIjCke+38EWOkq4h8' +
  'sCf/Nl21ZetdMsPyjgBgEoABTw3qj01u3/9DKIa7opc5+Euq5ORNVxk23LRE4hjP' +
  'AzjKgmRBFl+g2lmxVcfw6cW8tGIlmynaVO9a2i8ITES/zsXPxziODGu0gq0PZFOm' +
  '2gihnttAV4Fuqcnu1Bb48Me3U4YjBp5r3Q33rJRMVwZxtUCF+UFZsO7WpH4f4Jxz' +
  'I/bFoBsL0IEbxyI+jeootPrcbEk2fllbeQIDAQAB'

/**
 * 把蓝湖密码做 RSA 加密（前端用 jsencrypt，PKCS#1 v1.5）
 * @param {string} plain 明文密码
 * @returns {string} base64 密文
 */
function encryptLoginPassword(plain) {
  const body = String(LOGIN_RSA_PUBLIC_KEY).replace(/\s+/g, '')
  const chunks = body.match(/.{1,64}/g) || []
  const pem = '-----BEGIN RSA PUBLIC KEY-----\n' + chunks.join('\n') + '\n-----END RSA PUBLIC KEY-----'
  const encrypted = publicEncrypt({ key: pem, padding: cryptoConstants.RSA_PKCS1_PADDING }, Buffer.from(String(plain), 'utf8'))
  return encrypted.toString('base64')
}

function cacheClear(prefix) {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key)
  }
}

/**
 * 带超时的 fetch
 * @param {string} url 地址
 * @param {object} options fetch 选项
 * @param {number} timeoutMs 超时毫秒
 * @returns {Promise<Response>} 响应
 */
async function fetchWithTimeout(url, options, timeoutMs) {
  try {
    return await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    throw new LanhuError('请求蓝湖失败：' + (error && error.message ? error.message : String(error)), 'NETWORK')
  }
}

/**
 * 创建蓝湖客户端
 * @param {object} config 插件配置
 * @param {string} [config.baseUrl] 蓝湖主站地址
 * @param {string} [config.cookieFile] Cookie 文件路径（默认数据目录 cookie.txt）
 * @param {string} [config.defaultTeamId] 默认团队 id
 * @param {string} [config.defaultProjectId] 默认项目 id
 * @returns {object} 客户端实例
 */
export function createLanhu(config) {
  const conf = config || {}
  const baseUrl = String(conf.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
  const cookieFile = conf.cookieFile ? resolve(conf.cookieFile) : join(PLUGIN_DATA_DIR, 'cookie.txt')
  const bindingsFile = join(PLUGIN_DATA_DIR, 'bindings.json')
  const selectionFile = join(PLUGIN_DATA_DIR, 'selection.json')
  /** 上次选择的团队空间/项目（进程内缓存，避免每次读盘） */
  let selection = null
  /** 内存中的绑定关系：imageId -> { teamId, projectId, name, jsonUrl } */
  let bindings = null

  /**
   * 确保数据目录存在
   */
  async function ensureDir() {
    await mkdir(PLUGIN_DATA_DIR, { recursive: true })
  }

  /**
   * 读取 Cookie（每次实时读盘，便于面板改完立即生效）
   * @returns {Promise<string>} Cookie 串
   */
  async function readCookie() {
    try {
      const text = await readFile(cookieFile, 'utf8')
      return text.trim()
    } catch (error) {
      return ''
    }
  }

  /**
   * 写入 Cookie
   * @param {string} cookie 浏览器复制的 Cookie 串
   */
  async function saveCookie(cookie) {
    await ensureDir()
    await writeFile(cookieFile, String(cookie || '').trim(), 'utf8')
    cache.clear()
  }

  /**
   * Cookie 是否已配置（只看有无，不校验有效性）
   * @returns {Promise<boolean>} 是否已配置
   */
  async function hasCookie() {
    const cookie = await readCookie()
    return cookie.length > 0
  }

  /**
   * 用蓝湖账号密码登录，成功后把响应里的 Cookie 写入本地
   * @param {string} account 手机号 / 邮箱
   * @param {string} password 明文密码
   * @returns {Promise<{cookieCount:number}>} 登录结果
   */
  /**
   * 收集响应头里的 Set-Cookie，转成 name=value 列表
   * @param {Response} res fetch 响应
   * @returns {string[]} name=value 列表
   */
  function collectSetCookies(res) {
    const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
    return raw
      .map(function (item) {
        return String(item).split(';')[0].trim()
      })
      .filter(function (item) {
        return item.indexOf('=') > 0
      })
  }

  /**
   * 把响应的 Set-Cookie 合并进 Cookie 列表（同名覆盖，保留顺序）
   * @param {string[]} jar 目标 Cookie 列表
   * @param {Response} res fetch 响应
   * @returns {string[]} 合并后的列表
   */
  function mergeSetCookies(jar, res) {
    collectSetCookies(res).forEach(function (pair) {
      const name = pair.slice(0, pair.indexOf('='))
      for (let i = jar.length - 1; i >= 0; i -= 1) {
        if (jar[i].slice(0, jar[i].indexOf('=')) === name) jar.splice(i, 1)
      }
      jar.push(pair)
    })
    return jar
  }

  async function login(account, password) {
    const accountText = String(account || '').trim()
    const passwordText = String(password || '')
    if (!accountText || !passwordText) throw new LanhuError('请输入蓝湖账号和密码', 'API')
    const res = await fetchWithTimeout(
      baseUrl + '/api/passport/login',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json;charset=UTF-8',
          'user-from': 'web',
          origin: baseUrl,
          referer: baseUrl + '/sso/',
          'user-agent': USER_AGENT
        },
        body: JSON.stringify({ mobile_or_email: accountText, password: encryptLoginPassword(passwordText) })
      },
      API_TIMEOUT_MS
    )
    let payload = null
    try {
      payload = await res.json()
    } catch (error) {
      payload = null
    }
    if (!payload) throw new LanhuError('登录接口返回异常（HTTP ' + res.status + '）', 'API')
    if (payload.code === 2401 || payload.code === 1909) {
      throw new LanhuError('蓝湖要求人机验证，请先在浏览器登录一次再粘贴 Cookie', 'CAPTCHA')
    }
    const ok = payload.code === 0 || payload.code === '0' || payload.code === '00000'
    if (!ok) throw new LanhuError(payload.message || '登录失败（' + payload.code + '）', 'AUTH')
    return await completeLogin(res, payload)
  }

  /**
   * 用登录返回的 ticket 换 session 登录态 Cookie 并落盘（密码登录 / 短信登录共用）
   * @param {Response} res 登录接口响应，用于读取 Set-Cookie
   * @param {object} payload 登录接口返回的 JSON
   * @returns {Promise<{cookieCount:number}>} Cookie 数量
   */
  async function completeLogin(res, payload) {
    const jar = collectSetCookies(res)
    const data = (payload && payload.data) || {}
    if (!data.ticket) throw new LanhuError('登录成功但没拿到票据，请改用粘贴 Cookie 方式', 'AUTH')
    // 蓝湖 SSO 的登录接口只下发 ticket，必须再访问 /api/auth 由它 302 下发 session 登录态 Cookie
    const redirectUri = encodeURIComponent(baseUrl + '/web/')
    const authUrl =
      baseUrl +
      '/api/auth?request_from=web&sso_ticket=' +
      encodeURIComponent(data.ticket) +
      '&redirect_uri=' +
      redirectUri +
      '&action=' +
      encodeURIComponent(data.action || 'login') +
      '&action_type=' +
      encodeURIComponent(data.action_type || 'password')
    const authRes = await fetchWithTimeout(
      authUrl,
      {
        method: 'GET',
        redirect: 'manual',
        headers: {
          accept: 'text/html',
          cookie: jar.join('; '),
          'user-agent': USER_AGENT
        }
      },
      API_TIMEOUT_MS
    )
    if (authRes.status !== 302 && authRes.status !== 301 && authRes.status !== 200) {
      throw new LanhuError('换取登录态失败（HTTP ' + authRes.status + '）', 'AUTH')
    }
    mergeSetCookies(jar, authRes)
    if (!jar.length) throw new LanhuError('登录成功但没拿到 Cookie，请改用粘贴 Cookie 方式', 'AUTH')
    await saveCookie(jar.join('; '))
    cacheClear()
    return { cookieCount: jar.length }
  }

  /**
   * 解析蓝湖 SSO 接口的通用响应，风控/失败时抛错
   * @param {Response} res fetch 响应
   * @returns {Promise<object>} 响应 JSON
   */
  async function readPassportPayload(res) {
    let payload = null
    try {
      payload = await res.json()
    } catch (error) {
      payload = null
    }
    if (!payload) throw new LanhuError('蓝湖登录接口返回异常（HTTP ' + res.status + '）', 'API')
    if (payload.code === 2401 || payload.code === 1909 || payload.code === 1911) {
      throw new LanhuError('蓝湖要求图形/滑块验证，请在浏览器里登录一次再粘贴 Cookie', 'CAPTCHA')
    }
    const ok = payload.code === 0 || payload.code === '0' || payload.code === '00000'
    if (!ok) throw new LanhuError(payload.message || '操作失败（' + payload.code + '）', 'AUTH')
    return payload
  }

  /**
   * 发送短信登录验证码
   * @param {string} mobile 手机号
   * @returns {Promise<{sent:boolean}>} 发送结果
   */
  async function sendSmsCode(mobile) {
    const mobileText = String(mobile || '').trim()
    if (!/^\d{6,20}$/.test(mobileText)) throw new LanhuError('请输入正确的手机号', 'API')
    const res = await fetchWithTimeout(
      baseUrl + '/api/passport/send_verification_code_message',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json;charset=UTF-8',
          'user-from': 'web',
          origin: baseUrl,
          referer: baseUrl + '/sso/',
          'user-agent': USER_AGENT
        },
        body: JSON.stringify({ mobile: mobileText, scene: 'codelogin' })
      },
      API_TIMEOUT_MS
    )
    await readPassportPayload(res)
    return { sent: true }
  }

  /**
   * 短信验证码登录
   * @param {string} mobile 手机号
   * @param {string} code 短信验证码
   * @returns {Promise<{cookieCount:number}>} Cookie 数量
   */
  async function loginBySms(mobile, code) {
    const mobileText = String(mobile || '').trim()
    const codeText = String(code || '').trim()
    if (!mobileText) throw new LanhuError('请输入手机号', 'API')
    if (!codeText) throw new LanhuError('请输入短信验证码', 'API')
    const res = await fetchWithTimeout(
      baseUrl + '/api/passport/verify_sms_login',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json;charset=UTF-8',
          'user-from': 'web',
          origin: baseUrl,
          referer: baseUrl + '/sso/',
          'user-agent': USER_AGENT
        },
        body: JSON.stringify({ mobile: mobileText, code: codeText, scene: 'codelogin' })
      },
      API_TIMEOUT_MS
    )
    const payload = await readPassportPayload(res)
    return await completeLogin(res, payload)
  }

  /**
   * 读取绑定关系文件
   * @returns {Promise<object>} imageId -> 绑定信息
   */
  async function readBindings() {
    if (bindings) return bindings
    try {
      const text = await readFile(bindingsFile, 'utf8')
      bindings = JSON.parse(text)
    } catch (error) {
      bindings = {}
    }
    return bindings
  }

  /**
   * 写入绑定关系文件
   * @param {object} next 新的绑定表
   */
  async function writeBindings(next) {
    await ensureDir()
    bindings = next
    await writeFile(bindingsFile, JSON.stringify(next, null, 2), 'utf8')
  }

  /**
   * 记录一条绑定（文档 -> 团队/项目/索引地址）
   * @param {object} doc 文档对象
   */
  async function rememberBinding(doc) {
    if (!doc || !doc.imageId) return
    const table = await readBindings()
    const prev = table[doc.imageId] || {}
    table[doc.imageId] = {
      imageId: doc.imageId,
      name: doc.name || prev.name || '',
      teamId: doc.teamId || prev.teamId || '',
      projectId: doc.projectId || prev.projectId || '',
      jsonUrl: doc.jsonUrl || prev.jsonUrl || '',
      updatedAt: Date.now()
    }
    await writeBindings(table)
  }

  /**
   * 读取上次选择的团队空间/项目（只记这两个，供下次打开面板回填）
   * @returns {Promise<{teamId:string,teamName:string,projectId:string,projectName:string,updatedAt:number}|null>} 上次选择
   */
  async function readSelection() {
    if (selection) return selection
    try {
      const text = await readFile(selectionFile, 'utf8')
      const parsed = JSON.parse(text)
      selection = parsed && typeof parsed === 'object' && parsed.teamId ? parsed : null
    } catch (error) {
      selection = null
    }
    return selection
  }

  /**
   * 记录本次选择的团队空间/项目
   * @param {{teamId?:string,teamName?:string,projectId?:string,projectName?:string}} next 选择结果
   */
  async function saveSelection(next) {
    if (!next || !next.teamId) return
    try {
      await ensureDir()
      selection = {
        teamId: String(next.teamId),
        teamName: next.teamName || '',
        projectId: next.projectId || '',
        projectName: next.projectName || '',
        updatedAt: Date.now()
      }
      await writeFile(selectionFile, JSON.stringify(selection, null, 2), 'utf8')
    } catch (error) {
      // 记录失败不影响主流程
    }
  }

  /**
   * 调蓝湖 JSON 接口
   * @param {string} pathAndQuery 形如 /api/project/product_documents?team_id=xxx
   * @returns {Promise<any>} result 字段
   */
  async function apiGet(pathAndQuery) {
    const cookie = await readCookie()
    if (!cookie) throw new LanhuError('尚未配置蓝湖 Cookie，请在面板里粘贴后重试', 'AUTH')
    const res = await fetchWithTimeout(
      baseUrl + pathAndQuery,
      {
        headers: {
          cookie: cookie,
          accept: 'application/json, text/plain, */*',
          'user-agent': USER_AGENT,
          referer: baseUrl + '/'
        }
      },
      API_TIMEOUT_MS
    )
    const text = await res.text()
    if (!res.ok) {
      // 401/403 = 登录态失效；418 = 蓝湖风控拦截（阿里云人机验证）
      if (res.status === 401 || res.status === 403) {
        throw new LanhuError('蓝湖登录态已失效（HTTP ' + res.status + '），请点「浏览器登录」重新登录', 'AUTH')
      }
      if (res.status === 418) {
        throw new LanhuError('蓝湖风控拦截（HTTP 418），点「浏览器登录」在浏览器里登录一次即可', 'AUTH')
      }
      throw new LanhuError('蓝湖接口 HTTP ' + res.status, 'API')
    }
    // Cookie 失效时蓝湖会回落到登录页 HTML
    if (/^\s*</.test(text)) throw new LanhuError('蓝湖 Cookie 已失效（接口返回登录页），请重新粘贴', 'AUTH')
    let payload
    try {
      payload = JSON.parse(text)
    } catch (error) {
      throw new LanhuError('蓝湖接口返回非 JSON', 'API')
    }
    // 蓝湖接口有两种返回形态：带 code 的统一包裹、以及只给 result 的新接口（如 folder_projects）
    if (!payload || typeof payload !== 'object') throw new LanhuError('蓝湖接口返回非 JSON', 'API')
    if (payload.code !== undefined && payload.code !== '00000') {
      throw new LanhuError(
        '蓝湖接口返回异常：code=' + payload.code + ' msg=' + (payload.msg ? payload.msg : ''),
        'API'
      )
    }
    if (payload.result === undefined && payload.code !== '00000') {
      throw new LanhuError('蓝湖接口返回缺少 result 字段', 'API')
    }
    return payload.result
  }

  /**
   * 拉取项目下的原型文档列表（type=axure 即产品原型）
   * @param {object} [options] 查询选项
   * @param {string} [options.teamId] 团队 id
   * @param {string} [options.projectId] 项目 id
   * @param {boolean} [options.refresh] 是否跳过缓存
   * @returns {Promise<Array<object>>} 原型文档数组
   */
  async function listDocs(options) {
    const opts = options || {}
    const teamId = opts.teamId || conf.defaultTeamId
    const projectId = opts.projectId || conf.defaultProjectId
    if (!teamId || !projectId) throw new LanhuError('缺少 teamId / projectId', 'API')
    const key = 'docs:' + teamId + ':' + projectId
    if (!opts.refresh) {
      const hit = cacheGet(key, API_CACHE_TTL)
      if (hit) return hit
    }
    const result = await apiGet(
      '/api/project/product_documents?team_id=' +
        encodeURIComponent(teamId) +
        '&project_id=' +
        encodeURIComponent(projectId)
    )
    const resources = result && Array.isArray(result.resources) ? result.resources : []
    const docs = resources
      .filter(function (item) {
        return item && item.type === 'axure'
      })
      .map(function (item) {
        return {
          imageId: item.id,
          name: decodeEntities(item.name),
          latestVersion: item.latest_version,
          updateTime: item.update_time,
          teamId: teamId,
          projectId: projectId
        }
      })
    cacheSet(key, docs, API_CACHE_TTL)
    for (const doc of docs) await rememberBinding(doc)
    return docs
  }

  /**
   * 拉取当前账号可见的团队空间
   * @returns {Promise<Array<object>>} [{ id, name, memberNum }]
   */
  async function getTeams() {
    const key = 'teams'
    const hit = cacheGet(key, META_CACHE_TTL)
    if (hit) return hit
    const result = await apiGet('/api/account/user_teams')
    const list = (Array.isArray(result) ? result : []).map(function (item) {
      return { id: item.id, name: decodeEntities(item.name), memberNum: item.member_num || 0 }
    })
    cacheSet(key, list, META_CACHE_TTL)
    return list
  }

  /**
   * 拉取团队空间下的项目列表
   * @param {string} teamId 团队 id
   * @returns {Promise<Array<object>>} [{ id, name, teamId }]
   */
  async function getProjects(teamId) {
    if (!teamId) throw new LanhuError('缺少 teamId', 'API')
    const key = 'projects:' + teamId
    const hit = cacheGet(key, META_CACHE_TTL)
    if (hit) return hit
    const result = await apiGet(
      '/api/account/folder_projects?team_id=' +
        encodeURIComponent(teamId) +
        '&folder_id=0&pageNo=1&pageSize=9999&default_order=desc'
    )
    const info = result && Array.isArray(result.projects_info) ? result.projects_info : []
    const list = info.map(function (item) {
      return { id: item.id, name: decodeEntities(item.name), teamId: teamId }
    })
    cacheSet(key, list, META_CACHE_TTL)
    return list
  }

  /**
   * 按 id 或名称解析团队空间
   * @param {string} [ref] 团队 id / 名称，省略则用配置默认团队或第一个团队
   * @returns {Promise<object>} { id, name, memberNum }
   */
  async function resolveTeam(ref) {
    const teams = await getTeams()
    if (!teams.length) throw new LanhuError('当前账号没有任何蓝湖团队空间', 'NOTFOUND')
    const last = ref ? null : await readSelection()
    const value = String(ref || (last && last.teamId) || conf.defaultTeamId || '').trim()
    if (!value) return teams[0]
    const found =
      teams.find(function (team) {
        return team.id === value
      }) ||
      teams.find(function (team) {
        return team.name === value
      }) ||
      teams.find(function (team) {
        return team.name.indexOf(value) !== -1
      })
    if (!found) throw new LanhuError('找不到团队空间：' + value, 'NOTFOUND')
    return found
  }

  /**
   * 按 id 或名称解析团队下的项目
   * @param {string} teamId 团队 id
   * @param {string} [ref] 项目 id / 名称，省略则用配置默认项目（仅当团队是默认团队时）或第一个项目
   * @returns {Promise<object>} { id, name, teamId }
   */
  async function resolveProject(teamId, ref) {
    const projects = await getProjects(teamId)
    if (!projects.length) throw new LanhuError('该团队空间下没有项目', 'NOTFOUND')
    const last = ref ? null : await readSelection()
    const fallback = last && last.teamId === teamId
      ? last.projectId
      : teamId === conf.defaultTeamId ? conf.defaultProjectId : ''
    const value = String(ref || fallback || '').trim()
    if (!value) return projects[0]
    const found =
      projects.find(function (project) {
        return project.id === value
      }) ||
      projects.find(function (project) {
        return project.name === value
      }) ||
      projects.find(function (project) {
        return project.name.indexOf(value) !== -1
      })
    if (!found) throw new LanhuError('找不到项目：' + value, 'NOTFOUND')
    return found
  }

  /**
   * 解析文档的索引 JSON 地址（versions[0].json_url）
   * @param {object} doc 文档对象（含 imageId/teamId/projectId）
   * @returns {Promise<string>} 索引 JSON 地址
   */
  async function resolveJsonUrl(doc) {
    const key = 'jsonurl:' + doc.imageId
    const hit = cacheGet(key, META_CACHE_TTL)
    if (hit) return hit
    const result = await apiGet(
      '/api/project/image?team_id=' +
        encodeURIComponent(doc.teamId) +
        '&project_id=' +
        encodeURIComponent(doc.projectId) +
        '&image_id=' +
        encodeURIComponent(doc.imageId)
    )
    const version = result && Array.isArray(result.versions) ? result.versions[0] : null
    const jsonUrl = version && version.json_url
    if (!jsonUrl) throw new LanhuError('该文档没有原型数据（可能不是 Axure 原型或版本为空）', 'NOTFOUND')
    cacheSet(key, jsonUrl, META_CACHE_TTL)
    await rememberBinding({ ...doc, jsonUrl: jsonUrl })
    return jsonUrl
  }

  /**
   * 拉取文档索引 JSON（页面清单）
   * @param {string} jsonUrl 索引地址
   * @returns {Promise<object>} 索引对象
   */
  async function getIndex(jsonUrl) {
    const key = 'index:' + jsonUrl
    const hit = cacheGet(key, META_CACHE_TTL)
    if (hit) return hit
    const res = await fetchWithTimeout(jsonUrl, { headers: { 'user-agent': USER_AGENT } }, API_TIMEOUT_MS)
    if (!res.ok) throw new LanhuError('拉取索引 JSON 失败 HTTP ' + res.status, 'NETWORK')
    const data = await res.json()
    cacheSet(key, data, META_CACHE_TTL)
    return data
  }

  /**
   * 解析 Axure 的 document.js，取出页面树（含 Folder 分组）
   *
   * document.js 是 `$axure.loadDocument((function () { ... })())` 形式的压缩脚本，
   * 属性名与文本全部用短变量拼接；正则切片不可靠，这里在 vm 沙箱里执行它，
   * 只提供一个 $axure.loadDocument 钩子把文档对象接出来（沙箱内没有 require / process / 网络）。
   *
   * @param {string} text document.js 文本
   * @returns {Array<object>|null} 页面树根节点（含 name/type/page/url/children）
   */
  function parseDocumentSitemap(text) {
    if (!text || text.indexOf('loadDocument') === -1) return null
    let captured = null
    const sandbox = {
      $axure: {
        loadDocument: function (documentObject) {
          captured = documentObject || null
        }
      }
    }
    try {
      vm.createContext(sandbox)
      vm.runInContext(String(text), sandbox, { timeout: 5000 })
    } catch (error) {
      return null
    }
    const sitemap = captured && captured.sitemap
    if (!sitemap || !Array.isArray(sitemap.rootNodes)) return null
    return normalizeSitemapNodes(sitemap.rootNodes)
  }

  /**
   * 归一化页面树节点
   * @param {Array<object>} nodes 原始节点
   * @returns {Array<object>} 归一化节点
   */
  function normalizeSitemapNodes(nodes) {
    const output = []
    for (const node of nodes || []) {
      if (!node || !node.pageName) continue
      const children = normalizeSitemapNodes(node.children || node.nodes)
      const url = typeof node.url === 'string' ? node.url : ''
      output.push({
        name: node.pageName,
        type: node.type || (children.length > 0 ? 'Folder' : 'Wireframe'),
        page: url ? url.replace(/\.html$/, '') : '',
        url: url,
        children: children
      })
    }
    return output
  }

  /**
   * 拉取文档页面树（Folder 分组 + 页面），并生成带目录路径的扁平列表
   *
   * 树来自 data/document.js（Axure 自己的站点地图），比索引 JSON 里的 sitemap 完整：
   * 索引 JSON 的 sitemap 只保留了首页一个根节点，目录层级全丢。
   *
   * @param {string} jsonUrl 索引地址
   * @returns {Promise<{ tree: Array<object>, pages: Array<object> }>} 树与扁平列表
   */
  async function getPageTree(jsonUrl) {
    const key = 'tree:' + jsonUrl
    const hit = cacheGet(key, META_CACHE_TTL)
    if (hit) return hit
    const index = await getIndex(jsonUrl)
    const pageFiles = index && index.pages && typeof index.pages === 'object' ? index.pages : {}
    let tree = []
    try {
      const firstKey = Object.keys(pageFiles)[0]
      if (firstKey) {
        const manifest = await getManifest(jsonUrl, firstKey.replace(/\.html$/, ''))
        const scripts = manifest && manifest.scripts ? manifest.scripts : {}
        const documentKey = Object.keys(scripts).find(function (item) {
          return normalizeKey(item) === 'data/document.js'
        })
        if (documentKey && scripts[documentKey] && scripts[documentKey].sign_md5) {
          const asset = await fetchAsset(scripts[documentKey].sign_md5)
          tree = parseDocumentSitemap(asset.buffer.toString('utf8')) || []
        }
      }
    } catch (error) {
      tree = []
    }
    const pages = []
    const seen = new Set()
    const walk = function (nodes, trail) {
      for (const node of nodes || []) {
        const path = trail.concat(node.name)
        if (node.children && node.children.length > 0) {
          walk(node.children, path)
          continue
        }
        if (!node.url || !pageFiles[node.url] || seen.has(node.page)) continue
        seen.add(node.page)
        pages.push({
          name: node.page,
          displayName: node.name,
          path: path.join(' / '),
          folder: trail.join(' / '),
          url: node.url,
          htmlSrc: (pageFiles[node.url] && pageFiles[node.url].html && pageFiles[node.url].html.src) || node.url
        })
      }
    }
    walk(tree, [])
    // 树上没有、但索引 JSON 里存在的页面（已从站点地图移除的旧页）追加在后面，保证仍可打开
    Object.keys(pageFiles)
      .sort(function (a, b) {
        return a.localeCompare(b, 'zh-Hans-CN')
      })
      .forEach(function (fileKey) {
        const name = fileKey.replace(/\.html$/, '')
        if (seen.has(name)) return
        seen.add(name)
        pages.push({
          name: name,
          displayName: name,
          path: name,
          folder: '',
          url: fileKey,
          htmlSrc: (pageFiles[fileKey] && pageFiles[fileKey].html && pageFiles[fileKey].html.src) || fileKey
        })
      })
    const view = { tree: tree, pages: pages }
    cacheSet(key, view, META_CACHE_TTL)
    return view
  }

  /**
   * 列出文档的所有页面
   * @param {string} jsonUrl 索引地址
   * @returns {Promise<Array<object>>} 页面数组
   */
  async function listPages(jsonUrl) {
    const view = await getPageTree(jsonUrl)
    return view.pages
  }

  /**
   * 拉取单页清单（原始相对路径 -> 扁平 CDN 文件）
   * @param {string} jsonUrl 索引地址
   * @param {string} pageName 页面名
   * @returns {Promise<object>} 清单对象
   */
  async function getManifest(jsonUrl, pageName) {
    const key = 'manifest:' + jsonUrl + ':' + pageName
    const hit = cacheGet(key, META_CACHE_TTL)
    if (hit) return hit
    const index = await getIndex(jsonUrl)
    const pages = (index && index.pages) || {}
    const entry = pages[pageName + '.html'] || pages[pageName]
    if (!entry) throw new LanhuError('页面不存在：' + pageName, 'NOTFOUND')
    const mappingMd5 = entry.mapping_md5
    if (!mappingMd5) throw new LanhuError('页面 ' + pageName + ' 缺少路径清单', 'NOTFOUND')
    const url = /^https?:\/\//.test(mappingMd5) ? mappingMd5 : CDN_ORIGIN + '/' + mappingMd5
    const res = await fetchWithTimeout(url, { headers: { 'user-agent': USER_AGENT } }, API_TIMEOUT_MS)
    if (!res.ok) throw new LanhuError('拉取页面清单失败 HTTP ' + res.status, 'NETWORK')
    const data = await res.json()
    cacheSet(key, data, META_CACHE_TTL)
    return data
  }

  /**
   * 归一化资源键（去掉 ./ 前缀、查询串与 hash）
   * @param {string} path 原始路径
   * @returns {string} 归一化路径
   */
  function normalizeKey(path) {
    return String(path || '')
      .split('?')[0]
      .split('#')[0]
      .replace(/^\.\//, '')
      .replace(/^\/+/, '')
  }

  /**
   * 在清单里查某个原始相对路径对应的扁平 CDN 文件
   * @param {object} manifest 单页清单
   * @param {string} rawPath 原始相对路径
   * @returns {string} CDN 文件名或绝对 URL，找不到返回空串
   */
  function lookupAsset(manifest, rawPath) {
    const key = normalizeKey(rawPath)
    const buckets = [
      manifest && manifest.styles,
      manifest && manifest.scripts,
      manifest && manifest.images
    ]
    for (const bucket of buckets) {
      if (!bucket || typeof bucket !== 'object') continue
      for (const rawKey of Object.keys(bucket)) {
        if (normalizeKey(rawKey) === key) return (bucket[rawKey] && bucket[rawKey].sign_md5) || ''
      }
    }
    const extras = [manifest && manifest.html, manifest && manifest.dataJs]
    for (const extra of extras) {
      if (extra && extra.src && normalizeKey(extra.src) === key) return extra.sign_md5 || ''
    }
    return ''
  }

  /**
   * 拉取扁平 CDN 资源
   * @param {string} signMd5 清单里的扁平文件名或绝对 URL
   * @returns {Promise<{buffer: Buffer, contentType: string}>} 资源内容
   */
  async function fetchAsset(signMd5) {
    const url = /^https?:\/\//.test(signMd5) ? signMd5 : CDN_ORIGIN + '/' + signMd5
    const res = await fetchWithTimeout(url, { headers: { 'user-agent': USER_AGENT } }, ASSET_TIMEOUT_MS)
    if (!res.ok) throw new LanhuError('资源不存在 HTTP ' + res.status, 'NOTFOUND')
    const buffer = Buffer.from(await res.arrayBuffer())
    const headerType = res.headers.get('content-type') || ''
    return {
      buffer: buffer,
      contentType: headerType && headerType.indexOf('text/plain') === -1 ? headerType : contentTypeOf(signMd5)
    }
  }

  /**
   * 拉取页面 HTML 原文
   * @param {object} manifest 单页清单
   * @returns {Promise<string>} HTML 文本
   */
  async function getPageHtml(manifest) {
    const signMd5 = manifest && manifest.html ? manifest.html.sign_md5 : ''
    if (!signMd5) throw new LanhuError('页面清单缺少 html 信息', 'NOTFOUND')
    const asset = await fetchAsset(signMd5)
    return asset.buffer.toString('utf8')
  }

  /**
   * 按 imageId 或文档名解析文档
   * @param {string} ref 文档 id 或文档名
   * @returns {Promise<object>} 文档对象（含 jsonUrl）
   */
  async function resolveDoc(ref) {
    const table = await readBindings()
    const value = String(ref || '').trim()
    if (value && table[value]) {
      const bound = table[value]
      if (bound.jsonUrl) return bound
      return { ...bound, jsonUrl: await resolveJsonUrl(bound) }
    }
    // 未命中绑定：按「团队空间 → 项目 → 文档」逐层查找（结果会缓存，后续走绑定）
    const teams = await getTeams()
    for (const team of teams) {
      let projects = []
      try {
        projects = await getProjects(team.id)
      } catch (error) {
        continue
      }
      for (const project of projects) {
        let docs = []
        try {
          docs = await listDocs({ teamId: team.id, projectId: project.id })
        } catch (error) {
          continue
        }
        const found =
          docs.find(function (doc) {
            return doc.imageId === value
          }) ||
          docs.find(function (doc) {
            return doc.name === value
          }) ||
          docs.find(function (doc) {
            return value && doc.name.indexOf(value) !== -1
          })
        if (found) {
          const jsonUrl = await resolveJsonUrl(found)
          return { ...found, jsonUrl: jsonUrl }
        }
      }
    }
    throw new LanhuError('找不到原型文档：' + (value || '(空)'), 'NOTFOUND')
  }

  return {
    baseUrl: baseUrl,
    cookieFile: cookieFile,
    dataDir: PLUGIN_DATA_DIR,
    listDocs: listDocs,
    getTeams: getTeams,
    getProjects: getProjects,
    resolveTeam: resolveTeam,
    resolveProject: resolveProject,
    listPages: listPages,
    getPageTree: getPageTree,
    getIndex: getIndex,
    getManifest: getManifest,
    getPageHtml: getPageHtml,
    lookupAsset: lookupAsset,
    fetchAsset: fetchAsset,
    normalizeKey: normalizeKey,
    resolveJsonUrl: resolveJsonUrl,
    resolveDoc: resolveDoc,
    readCookie: readCookie,
    saveCookie: saveCookie,
    hasCookie: hasCookie,
    login: login,
    sendSmsCode: sendSmsCode,
    loginBySms: loginBySms,
    readBindings: readBindings,
    readSelection: readSelection,
    saveSelection: saveSelection,
    cacheClear: cacheClear
  }
}
