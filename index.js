/**
 * dsh-lanhu-proto 宿主侧入口
 *
 * 功能：注册蓝湖原型代理路由（页面 / 静态资源 / JSON 接口）与 3 个工具，
 *      让 DSH 面板与模型都能读取蓝湖「产品原型（Axure）」。
 * 作者：DSH
 * 日期：2026-11-15
 */
import { createLanhu, LanhuError } from './lib/lanhu.js'
import { createBrowserLogin } from './lib/browser.js'
import { handleView, writeJson } from './lib/proxy.js'

/** 插件名 */
export const name = 'lanhu-proto'
/** 依赖的 DSH 服务 */
export const inject = ['webServer', 'tools']

/** JSON 接口挂载前缀 */
const API_PREFIX = '/lanhu-proto/api'
/** 视图挂载前缀 */
const VIEW_PREFIX = '/lanhu-proto/view'

/** 控件类型词（Axure 原型数据里的噪声，抽取文案时过滤） */
const NOISE_WORDS = new Set([
  '矩形', '图片', '组合', '动态面板', '热区', '单击时', '文本', '段落', '按钮', '表格', '中继器',
  '占位符', '组', '形状', '线段', '水平线', '垂直线', '图标', '页眉', '标题', '状态1', '状态 1',
  '无填充', '居中', '左对齐', '右对齐', '自动', '默认', '悬停', '按下', '选中', '禁用', '链接',
  '文本框', '下拉列表', '复选框', '单选按钮', '树', '菜单', '内联框架', '标记', '流程形状',
  '矩形 1', '载入时', '鼠标移入时', '鼠标移出时'
])

/**
 * 读取请求体（限制 1MB）
 * @param {object} req 请求
 * @returns {Promise<any>} 解析后的 JSON
 */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 1024 * 1024) throw new LanhuError('请求体过大', 'API')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch (error) {
    throw new LanhuError('请求体不是合法 JSON', 'API')
  }
}

/**
 * 从页面数据（data.js）里抽取可读文案
 * @param {string} source data.js 文本
 * @param {number} limit 最多返回条数
 * @returns {Array<string>} 去重后的中文文案
 */
function extractTexts(source, limit) {
  const max = limit || 300
  const seen = new Set()
  const result = []
  const pattern = /"([^"\\]{2,80})"/g
  let match
  while ((match = pattern.exec(String(source || ''))) !== null) {
    const text = match[1].trim()
    if (text.length < 2) continue
    if (!/[\u4e00-\u9fa5]/.test(text)) continue
    if (NOISE_WORDS.has(text)) continue
    if (/^[\d\s._,:;%-]+$/.test(text)) continue
    if (/\.(js|css|html|png|jpg|svg)$/i.test(text)) continue
    if (seen.has(text)) continue
    seen.add(text)
    result.push(text)
    if (result.length >= max) break
  }
  return result
}

/**
 * 构造视图访问路径
 * @param {string} imageId 文档 id
 * @param {string} pageName 页面名
 * @returns {string} 面板/浏览器可访问的路径
 */
function viewPath(imageId, pageName) {
  return VIEW_PREFIX + '/' + encodeURIComponent(imageId) + '/' + encodeURIComponent(pageName) + '/'
}

/**
 * 插件主体
 * @param {object} ctx DSH 插件上下文
 * @param {object} config 插件配置
 */
export function apply(ctx, config) {
  const lanhu = createLanhu(config || {})
  // 浏览器代登录：打开独立浏览器窗口由用户登录，登录成功后宿主侧读回 Cookie
  const browserLogin = createBrowserLogin({
    dataDir: lanhu.dataDir,
    saveCookie: async function (cookie) {
      await lanhu.saveCookie(cookie)
      lanhu.cacheClear()
    }
  })

  /**
   * 处理 JSON 接口
   * @param {object} req 请求
   * @param {object} res 响应
   */
  async function handleApi(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1')
    const route = url.pathname.slice(API_PREFIX.length) || '/'
    try {
      if (route === '/status' && req.method === 'GET') {
        const hasCookie = await lanhu.hasCookie()
        const bindings = await lanhu.readBindings()
        writeJson(res, 200, {
          ok: true,
          hasCookie: hasCookie,
          cookieFile: lanhu.cookieFile,
          dataDir: lanhu.dataDir,
          defaults: {
            teamId: (config && config.defaultTeamId) || '',
            projectId: (config && config.defaultProjectId) || ''
          },
          bindings: Object.values(bindings),
          selection: await lanhu.readSelection()
        })
        return
      }
      if (route === '/cookie' && req.method === 'POST') {
        const body = await readJsonBody(req)
        await lanhu.saveCookie(body.cookie || '')
        writeJson(res, 200, { ok: true, hasCookie: await lanhu.hasCookie() })
        return
      }
      if (route === '/login' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const result = await lanhu.login(body.account, body.password)
        writeJson(res, 200, { ok: true, hasCookie: await lanhu.hasCookie(), cookieCount: result.cookieCount })
        return
      }
      if (route === '/browser/login' && req.method === 'POST') {
        const state = await browserLogin.start()
        writeJson(res, 200, { ok: true, state: state.state, message: state.message, browser: state.browser })
        return
      }
      if (route === '/browser/status' && req.method === 'GET') {
        const state = browserLogin.status()
        writeJson(res, 200, {
          ok: true,
          state: state.state,
          message: state.message,
          cookieCount: state.cookieCount,
          hasCookie: await lanhu.hasCookie()
        })
        return
      }
      if (route === '/sms/send' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const result = await lanhu.sendSmsCode(body.mobile)
        writeJson(res, 200, { ok: true, sent: result.sent })
        return
      }
      if (route === '/sms/login' && req.method === 'POST') {
        const body = await readJsonBody(req)
        const result = await lanhu.loginBySms(body.mobile, body.code)
        writeJson(res, 200, { ok: true, hasCookie: await lanhu.hasCookie(), cookieCount: result.cookieCount })
        return
      }
      if (route === '/teams' && req.method === 'GET') {
        const teams = await lanhu.getTeams()
        writeJson(res, 200, {
          ok: true,
          teams: teams,
          defaultTeamId: (config && config.defaultTeamId) || '',
          defaultProjectId: (config && config.defaultProjectId) || ''
        })
        return
      }
      if (route === '/projects' && req.method === 'GET') {
        const team = await lanhu.resolveTeam(url.searchParams.get('team'))
        const projects = await lanhu.getProjects(team.id)
        const prev = await lanhu.readSelection()
        const sameTeam = prev && prev.teamId === team.id
        await lanhu.saveSelection({
          teamId: team.id,
          teamName: team.name,
          projectId: sameTeam ? prev.projectId : '',
          projectName: sameTeam ? prev.projectName : ''
        })
        const defaultTeam = (config && config.defaultTeamId) || ''
        writeJson(res, 200, {
          ok: true,
          team: team,
          projects: projects,
          defaultProjectId: team.id === defaultTeam ? (config && config.defaultProjectId) || '' : ''
        })
        return
      }
      if (route === '/docs' && req.method === 'GET') {
        const refresh = url.searchParams.get('refresh') === '1'
        const team = await lanhu.resolveTeam(url.searchParams.get('team'))
        const projectRef = url.searchParams.get('project')
        const projects = projectRef
          ? [await lanhu.resolveProject(team.id, projectRef)]
          : await lanhu.getProjects(team.id)
        const docs = []
        for (const project of projects) {
          try {
            const list = await lanhu.listDocs({ teamId: team.id, projectId: project.id, refresh: refresh })
            for (const doc of list) {
              docs.push({ ...doc, teamName: team.name, projectName: project.name })
            }
          } catch (error) {
            if (projects.length === 1) throw error
          }
        }
        const picked = projects.length === 1 ? projects[0] : null
        if (picked) {
          await lanhu.saveSelection({ teamId: team.id, teamName: team.name, projectId: picked.id, projectName: picked.name })
        }
        writeJson(res, 200, { ok: true, team: team, projects: projects, docs: docs })
        return
      }
      if (route === '/pages' && req.method === 'GET') {
        const docRef = url.searchParams.get('doc') || ''
        const doc = await lanhu.resolveDoc(docRef)
        const view = await lanhu.getPageTree(doc.jsonUrl)
        writeJson(res, 200, {
          ok: true,
          doc: { imageId: doc.imageId, name: doc.name },
          pages: view.pages,
          tree: view.tree
        })
        return
      }
      if (route === '/page' && req.method === 'GET') {
        const docRef = url.searchParams.get('doc') || ''
        const pageName = url.searchParams.get('page') || ''
        const doc = await lanhu.resolveDoc(docRef)
        const manifest = await lanhu.getManifest(doc.jsonUrl, pageName)
        let texts = []
        try {
          const signMd5 = manifest && manifest.dataJs ? manifest.dataJs.sign_md5 : ''
          if (signMd5) {
            const dataJs = await lanhu.fetchAsset(signMd5)
            texts = extractTexts(dataJs.buffer.toString('utf8'), 300)
          }
        } catch (error) {
          texts = []
        }
        writeJson(res, 200, {
          ok: true,
          doc: { imageId: doc.imageId, name: doc.name },
          page: pageName,
          path: viewPath(doc.imageId, pageName),
          texts: texts,
          assets: {
            styles: Object.keys(manifest.styles || {}).length,
            scripts: Object.keys(manifest.scripts || {}).length,
            images: Object.keys(manifest.images || {}).length
          }
        })
        return
      }
      writeJson(res, 404, { ok: false, error: '未知接口：' + route })
    } catch (error) {
      const status = error && error.code === 'AUTH' ? 401 : error && error.code === 'NOTFOUND' ? 404 : 500
      writeJson(res, status, {
        ok: false,
        code: (error && error.code) || 'ERROR',
        error: (error && error.message) || String(error)
      })
    }
  }

  // 注册路由
  ctx.effect(function () {
    return [
      { kind: 'prefix', path: API_PREFIX, handler: handleApi },
      { kind: 'prefix', path: VIEW_PREFIX, handler: (req, res) => handleView(lanhu, req, res) }
    ].map(function (route) {
      return ctx.webServer.register(route)
    })
  }, 'lanhu-proto: routes')

  // 注册工具
  ctx.effect(function () {
    const disposers = []

    disposers.push(
      ctx.tools.register({
        name: 'lanhu_proto_docs',
        description:
          '列出蓝湖「产品原型（Axure）」文档。team 传团队空间名或 id（省略用插件配置的默认团队），project 传项目名或 id（省略则列出该团队全部项目的原型）；refresh=true 跳过缓存。',
        parameters: {
          type: 'object',
          properties: {
            team: { type: 'string', description: '团队空间名或 id，省略用默认团队' },
            project: { type: 'string', description: '项目名或 id，省略列出该团队全部项目的原型' },
            refresh: { type: 'boolean', description: '是否强制刷新缓存' }
          },
          additionalProperties: false
        },
        output: {
          schema: {
            type: 'object',
            properties: { summary: { type: 'string' }, docs: { type: 'array' } },
            additionalProperties: true
          },
          render: function (_args, value) {
            return [{ type: 'text', text: String((value && value.summary) || '') }]
          }
        },
        execute: async function (args) {
          const opts = args || {}
          const refresh = Boolean(opts.refresh)
          const team = await lanhu.resolveTeam(opts.team)
          const projects = opts.project
            ? [await lanhu.resolveProject(team.id, opts.project)]
            : await lanhu.getProjects(team.id)
          const docs = []
          for (const project of projects) {
            try {
              const list = await lanhu.listDocs({ teamId: team.id, projectId: project.id, refresh: refresh })
              for (const doc of list) {
                docs.push({ ...doc, teamName: team.name, projectName: project.name })
              }
            } catch (error) {
              if (projects.length === 1) throw error
            }
          }
          if (!docs.length) {
            return {
              summary:
                '团队「' + team.name + '」下（' +
                (projects.map(function (project) { return project.name }).join('、') || '无项目') +
                '）没有原型文档（type=axure）',
              docs: []
            }
          }
          const lines = docs.map(function (doc, index) {
            return index + 1 + '. [' + doc.projectName + '] ' + doc.name + '  id=' + doc.imageId
          })
          return {
            summary:
              '团队「' + team.name + '」共 ' + docs.length + ' 个原型文档：\n' + lines.join('\n') +
              '\n\n用 lanhu_proto_pages 传文档名或 id 查看页面清单。',
            team: team,
            docs: docs
          }
        }
      })
    )

    disposers.push(
      ctx.tools.register({
        name: 'lanhu_proto_teams',
        description: '列出当前蓝湖账号可见的团队空间及其项目（人/模型切换查看范围前先用它确认）。',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        output: {
          schema: {
            type: 'object',
            properties: { summary: { type: 'string' }, teams: { type: 'array' } },
            additionalProperties: true
          },
          render: function (_args, value) {
            return [{ type: 'text', text: String((value && value.summary) || '') }]
          }
        },
        execute: async function () {
          const teams = await lanhu.getTeams()
          const lines = []
          const detail = []
          for (const team of teams) {
            let projects = []
            try {
              projects = await lanhu.getProjects(team.id)
            } catch (error) {
              projects = []
            }
            detail.push({ ...team, projects: projects })
            lines.push(
              '- ' + team.name + '（team 参数：' + team.id + '）项目：' +
                (projects.map(function (project) { return project.name }).join('、') || '无')
            )
          }
          return {
            summary: '共 ' + teams.length + ' 个团队空间：\n' + lines.join('\n'),
            teams: detail
          }
        }
      })
    )

    disposers.push(
      ctx.tools.register({
        name: 'lanhu_proto_pages',
        description:
          '列出某个蓝湖原型文档下的全部页面，按 Axure 站点地图的目录（Folder）分组输出层级，用于定位要看哪一页。',
        parameters: {
          type: 'object',
          properties: {
            doc: { type: 'string', description: '原型文档名或 id' }
          },
          required: ['doc'],
          additionalProperties: false
        },
        output: {
          schema: {
            type: 'object',
            properties: { summary: { type: 'string' }, pages: { type: 'array' } },
            additionalProperties: true
          },
          render: function (_args, value) {
            return [{ type: 'text', text: String((value && value.summary) || '') }]
          }
        },
        execute: async function (args) {
          const doc = await lanhu.resolveDoc(args && args.doc)
          const view = await lanhu.getPageTree(doc.jsonUrl)
          const lines = []
          let folderCount = 0
          let pageCount = 0
          const walk = function (nodes, depth) {
            for (const node of nodes || []) {
              if (lines.length >= 400) return
              const pad = '    '.repeat(depth)
              if (node.children && node.children.length > 0) {
                folderCount += 1
                lines.push(pad + '[目录] ' + node.name + '/')
                walk(node.children, depth + 1)
              } else if (node.page) {
                pageCount += 1
                lines.push(pad + '- ' + node.name + '  （page 参数：' + node.page + '）')
              }
            }
          }
          walk(view.tree, 0)
          if (lines.length === 0) {
            view.pages.slice(0, 200).forEach(function (page) {
              lines.push('- ' + page.displayName + '  （page 参数：' + page.name + '）')
            })
            pageCount = view.pages.length
          }
          return {
            summary:
              '文档「' + doc.name + '」共 ' + pageCount + ' 页、' + folderCount + ' 个目录：\n' +
              lines.join('\n') +
              '\n\n用 lanhu_proto_page 传文档名 + page 参数读取页面内容。',
            pages: view.pages,
            tree: view.tree
          }
        }
      })
    )

    disposers.push(
      ctx.tools.register({
        name: 'lanhu_proto_page',
        description:
          '读取某个蓝湖原型页面的内容：返回页面访问路径（DSH 面板里可嵌入预览）、页面文案（从原型数据里抽取）与资源统计。',
        parameters: {
          type: 'object',
          properties: {
            doc: { type: 'string', description: '原型文档名或 id' },
            page: { type: 'string', description: '页面名（不加 .html）' }
          },
          required: ['doc', 'page'],
          additionalProperties: false
        },
        output: {
          schema: {
            type: 'object',
            properties: { summary: { type: 'string' }, path: { type: 'string' } },
            additionalProperties: true
          },
          render: function (_args, value) {
            return [{ type: 'text', text: String((value && value.summary) || '') }]
          }
        },
        execute: async function (args) {
          const doc = await lanhu.resolveDoc(args && args.doc)
          const pageName = String((args && args.page) || '')
          const manifest = await lanhu.getManifest(doc.jsonUrl, pageName)
          let texts = []
          try {
            const signMd5 = manifest && manifest.dataJs ? manifest.dataJs.sign_md5 : ''
            if (signMd5) {
              const dataJs = await lanhu.fetchAsset(signMd5)
              texts = extractTexts(dataJs.buffer.toString('utf8'), 200)
            }
          } catch (error) {
            texts = []
          }
          const path = viewPath(doc.imageId, pageName)
          return {
            summary:
              '文档「' + doc.name + '」页面「' + pageName + '」\n' +
              '预览路径：' + path + '（在 DSH 侧边栏「蓝湖原型」面板中打开）\n' +
              '资源：样式 ' + Object.keys(manifest.styles || {}).length +
              ' 个 / 脚本 ' + Object.keys(manifest.scripts || {}).length +
              ' 个 / 图片 ' + Object.keys(manifest.images || {}).length + ' 个\n' +
              '页面文案（自动抽取，可能含控件噪声）：\n' +
              (texts.length ? texts.slice(0, 120).join(' / ') : '（未抽取到）'),
            path: path,
            texts: texts
          }
        }
      })
    )

    return function () {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch (error) {
          /* 忽略卸载异常 */
        }
      }
    }
  }, 'lanhu-proto: tools')
}
