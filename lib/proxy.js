/**
 * 蓝湖原型「路径映射代理」
 *
 * 背景：蓝湖把 Axure 产物扁平化后放在 axure-file.lanhuapp.com，页面里的相对路径
 *      （files/<页面>/data.js、images/<页面>/u3.png）在扁平 CDN 上并不存在，
 *      原本靠蓝湖自己的 Service Worker 在浏览器里做映射；跨站嵌入时该映射失效。
 * 做法：把页面 HTML 拉下来，注入 <base> 指向本地视图前缀，其余相对请求由本代理
 *      按「单页清单」翻译成扁平 CDN 文件名再转发。
 * 作者：DSH
 * 日期：2026-11-15
 */
import { contentTypeOf } from './lanhu.js'

/** 代理挂载前缀（与 index.js 注册的路由保持一致） */
export const VIEW_PREFIX = '/lanhu-proto/view'

/**
 * 解析视图 URL
 * @param {string} pathname 原始 pathname
 * @returns {{ imageId: string, pageName: string, rest: string, trailing: boolean } | null} 解析结果
 */
export function parseViewPath(pathname) {
  const path = String(pathname || '').split('?')[0]
  if (!path.startsWith(VIEW_PREFIX + '/')) return null
  const segments = path.slice(VIEW_PREFIX.length + 1).split('/')
  if (segments.length < 2) return null
  const imageId = decodeURIComponent(segments[0])
  const pageName = decodeURIComponent(segments[1])
  const restSegments = segments.slice(2).filter(function (item) {
    return item !== ''
  })
  return {
    imageId: imageId,
    pageName: pageName,
    rest: restSegments.map(decodeURIComponent).join('/'),
    trailing: path.endsWith('/') || segments[segments.length - 1] === ''
  }
}

/**
 * 生成页面基地址（供 <base href> 使用）
 * @param {string} imageId 文档 id
 * @param {string} pageName 页面名
 * @returns {string} 以 / 结尾的基地址
 */
export function baseHrefOf(imageId, pageName) {
  return VIEW_PREFIX + '/' + encodeURIComponent(imageId) + '/' + encodeURIComponent(pageName) + '/'
}

/**
 * 缩放桥接脚本（注入到原型页 HTML 末尾）
 *
 * 蓝湖原型的画布是固定像素宽（常见 1440/1920），而面板 iframe 往往更窄，
 * 打开就横向溢出、右侧操作栏看不到。这里在页面内部用 documentElement.zoom 缩放：
 * 默认按 iframe 宽度自适应，同时接受父窗口的 fit-width / fit-page / scale / zoom-by 指令；
 * Ctrl+滚轮 也能直接缩放。缩放后布局重排，滚动条由浏览器自己算，不会出现 transform 溢出的空白。
 */
const SCALE_BRIDGE = [
  '<script>',
  '(function () {',
  '  var root = document.documentElement;',
  '  var current = 1;',
  '  function baseEl() { return document.getElementById("base") || document.getElementById("container_div") || document.body; }',
  '  function measure() {',
  '    var prev = root.style.zoom;',
  '    root.style.zoom = "";',
  '    var el = baseEl();',
  '    var w = Math.max(el.scrollWidth || 0, el.offsetWidth || 0, document.body.scrollWidth || 0);',
  '    var h = Math.max(el.scrollHeight || 0, el.offsetHeight || 0, document.body.scrollHeight || 0);',
  '    root.style.zoom = prev;',
  '    return { width: w, height: h };',
  '  }',
  '  function notify() {',
  '    var size = measure();',
  '    try { parent.postMessage({ source: "lanhu-proto", type: "state", scale: current, width: size.width, height: size.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight }, "*"); } catch (e) {}',
  '  }',
  '  function apply(scale) {',
  '    var next = Math.min(4, Math.max(0.1, Number(scale) || 1));',
  '    current = next;',
  '    root.style.zoom = String(next);',
  '    notify();',
  '  }',
  '  function fitWidth() { var m = measure(); if (m.width > 0) apply(Math.min(1, window.innerWidth / m.width)); }',
  '  function fitPage() { var m = measure(); if (m.width > 0) apply(Math.min(1, window.innerWidth / m.width, window.innerHeight / m.height)); }',
  '  window.addEventListener("message", function (event) {',
  '    var data = event.data;',
  '    if (!data || data.source !== "lanhu-proto-host") return;',
  '    if (data.type === "scale") apply(data.scale);',
  '    else if (data.type === "fit-width") fitWidth();',
  '    else if (data.type === "fit-page") fitPage();',
  '    else if (data.type === "zoom-by") apply(current * (Number(data.factor) || 1));',
  '    else if (data.type === "report") notify();',
  '  });',
  '  window.addEventListener("wheel", function (event) {',
  '    if (!event.ctrlKey) return;',
  '    event.preventDefault();',
  '    apply(current * (event.deltaY < 0 ? 1.1 : 1 / 1.1));',
  '  }, { passive: false });',
  '  window.addEventListener("resize", function () { notify(); });',
  '  window.addEventListener("load", function () { setTimeout(fitWidth, 120); });',
  '})();',
  '</script>',
].join('')

/**
 * 重写页面 HTML：注入 base、把根绝对路径改到代理前缀、移除 Service Worker 注册
 * @param {string} html 原始 HTML
 * @param {string} baseHref 基地址
 * @returns {string} 重写后的 HTML
 */
export function rewriteHtml(html, baseHref) {
  let output = String(html || '')
  // 1) 移除 Service Worker 注册（蓝湖 SW 在本地代理下无意义，且会抢请求）
  output = output.replace(/<script[\s\S]{0,4000}?serviceWorker[\s\S]{0,4000}?<\/script>/gi, '')
  // 2) 根绝对路径（/resources/...）改写成代理前缀 + 相对路径，避免落到 DSH 本体
  output = output.replace(/(\s(?:src|href|data-src)\s*=\s*["'])(\/[^"']*)(["'])/gi, function (
    match,
    head,
    target,
    tail
  ) {
    if (target.startsWith('//')) return match
    return head + baseHref.replace(/\/$/, '') + target + tail
  })
  // 3) 蓝湖扁平化产物把真实地址放在 data-src 上，靠蓝湖自己的加载器换回 src/href；
  //    脱离蓝湖应用后没人做这件事，这里直接换掉（<link> 用 href，其余用 src）
  output = output.replace(/<link([^>]*?)\sdata-src\s*=/gi, '<link$1 href=')
  output = output.replace(/\sdata-src\s*=/gi, ' src=')
  // 3.1) 蓝湖自家 CDN 上的加载器/样式在本地代理下无意义且会 404，整条移除
  output = output.replace(/<script[^>]*alistatic\.lanhuapp\.com[^>]*>\s*<\/script>/gi, '')
  output = output.replace(/<link[^>]*alistatic\.lanhuapp\.com[^>]*>/gi, '')
  // 4) 注入 <base>，让页面内相对路径全部落到代理前缀下；
  //    蓝湖靠自己的 axureStyle/加载器把 body 由 display:none 改为可见，脱离蓝湖后要自己放开
  output = output.replace(/<style[^>]*>[^<]*body[^<]*display:\s*none[^<]*<\/style>/gi, '')
  const baseTag =
    '<base href="' + baseHref + '">' +
    '<style>html,body{display:block !important;visibility:visible !important;opacity:1 !important;margin:0;padding:0;' +
    'background:#fff;overflow:auto}body>#base,body>#container_div{display:block !important}</style>'
  if (/<head[^>]*>/i.test(output)) {
    output = output.replace(/<head([^>]*)>/i, function (match, attrs) {
      return '<head' + attrs + '>' + baseTag
    })
  } else {
    output = baseTag + output
  }
  // 5) 注入缩放桥接脚本，让固定像素宽的原型画布自适应当前面板宽度（见 SCALE_BRIDGE 注释）
  if (/<\/body>/i.test(output)) {
    output = output.replace(/<\/body>/i, function () {
      return SCALE_BRIDGE + '</body>'
    })
  } else {
    output = output + SCALE_BRIDGE
  }
  return output
}

/**
 * 写 JSON 响应
 * @param {object} res HTTP 响应对象
 * @param {number} status 状态码
 * @param {any} body 响应体
 */
export function writeJson(res, status, body) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  })
  res.end(text)
}

/**
 * 判断一个「资源路径」其实是原型内部的页面跳转
 * @param {string} rest 页面前缀之后的路径（已解码）
 * @returns {string} 页面名（不含 .html），不是页面跳转则返回空串
 */
export function pageNavTargetOf(rest) {
  const path = String(rest || '').split('?')[0].split('#')[0]
  if (!/\.html$/i.test(path)) return ''
  const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.html$/i, '')
  return name
}

/**
 * 在页面清单里按名字找页（容忍 .html 后缀、下划线转义、大小写与编码差异）
 * @param {Array<object>} pages 页面数组
 * @param {string} target 目标页面名
 * @returns {object|null} 命中的页面
 */
export function matchPage(pages, target) {
  const norm = function (value) {
    return String(value || '')
      .replace(/\.html$/i, '')
      .replace(/[\s_]+/g, '')
      .toLowerCase()
  }
  const want = norm(target)
  const list = Array.isArray(pages) ? pages : []
  return (
    list.find(function (item) {
      return item.name === target || item.displayName === target
    }) ||
    list.find(function (item) {
      return norm(item.name) === want || norm(item.displayName) === want || norm(item.url) === want
    }) ||
    null
  )
}

/**
 * 处理视图请求（页面 HTML 或静态资源）
 * @param {object} lanhu 蓝湖客户端
 * @param {object} req 请求
 * @param {object} res 响应
 * @returns {Promise<void>} 无返回
 */
export async function handleView(lanhu, req, res) {
  const parsed = parseViewPath(req.url)
  if (!parsed) {
    writeJson(res, 400, { ok: false, error: '无效的原型地址' })
    return
  }
  try {
    const doc = await lanhu.resolveDoc(parsed.imageId)
    const jsonUrl = doc.jsonUrl
    const manifest = await lanhu.getManifest(jsonUrl, parsed.pageName)
    // 原型内部跳转：Axure 的点按链接是相对地址「<页面名>.html」，
    // 走资源分支会因为清单里没有而 404。这里识别出来，302 到对应页面的视图地址。
    const navTarget = pageNavTargetOf(parsed.rest)
    if (navTarget) {
      const pages = await lanhu.listPages(jsonUrl)
      const hit = matchPage(pages, navTarget)
      if (hit) {
        res.writeHead(302, { location: baseHrefOf(parsed.imageId, hit.name) })
        res.end()
        return
      }
      writeJson(res, 404, { ok: false, error: '原型里没有这一页：' + navTarget })
      return
    }
    // 资源请求
    if (parsed.rest) {
      const signMd5 = lanhu.lookupAsset(manifest, parsed.rest)
      if (!signMd5) {
        writeJson(res, 404, { ok: false, error: '清单中没有该资源：' + parsed.rest })
        return
      }
      const asset = await lanhu.fetchAsset(signMd5)
      res.writeHead(200, {
        'content-type': asset.contentType || contentTypeOf(parsed.rest),
        'cache-control': 'public, max-age=3600',
        'content-length': asset.buffer.length
      })
      res.end(asset.buffer)
      return
    }
    // 页面 HTML：没有结尾斜杠时先跳转，保证相对路径解析正确
    if (!parsed.trailing) {
      const location = req.url.split('?')[0] + '/'
      res.writeHead(302, { location: location })
      res.end()
      return
    }
    const html = await lanhu.getPageHtml(manifest)
    const rewritten = rewriteHtml(html, baseHrefOf(parsed.imageId, parsed.pageName))
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-cache'
    })
    res.end(rewritten)
  } catch (error) {
    const status = error && error.code === 'AUTH' ? 401 : error && error.code === 'NOTFOUND' ? 404 : 500
    writeJson(res, status, { ok: false, code: (error && error.code) || 'ERROR', error: (error && error.message) || String(error) })
  }
}
