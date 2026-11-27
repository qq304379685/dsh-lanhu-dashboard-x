/**
 * 蓝湖原型面板 Client 半边。
 *
 * 注册两块 UI：左侧栏「蓝湖原型」入口，以及该入口选中后主区域渲染的原型浏览面板。
 * 页面正文走同源代理 /lanhu-proto/view/<docId>/<page>/ 内嵌 iframe，数据走 /lanhu-proto/api/*。
 */
window.__ModuleLoader__.load({
  id: 'dsh-lanhu-proto',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    /** locale 命名空间 */
    const NS = 'lanhu-proto'
    /** 左侧栏行 ID，同时作为主区域 key */
    const PANEL_ID = 'lanhu-proto'
    /** 左侧栏顺序（插件 0 / 定时 10 / 看板 20 / 技能中心 30 / 禅道 50） */
    const PANEL_ORDER = 55

    /** 右侧栏「打开蓝湖原型」的入口，apply 里拿到 sidebarRight 服务后注入；拿不到就是 null */
    let OPEN_RIGHT = null

    /** 中文字典 */
    const zh = {
      'entry.label': '蓝湖原型',
      'right.tab': '蓝湖原型',
      'right.quick': '在右侧栏打开蓝湖原型',
      'right.guideDesc': '浏览蓝湖原型文档页面',
      'panel.pagesToggle': '页面列表',
      'panel.title': '蓝湖原型',
      'panel.doc': '原型文档',
      'panel.refresh': '刷新',
      'panel.search': '搜索页面',
      'panel.cookie': 'Cookie',
      'panel.login': '登录',
      'panel.openTab': '新标签打开',
    'panel.fitWidth': '适宽',
    'panel.fitPage': '整页',
    'panel.zoomHint': 'Ctrl+滚轮也可缩放',
    'panel.zoom100': '原始',
      'panel.pages': '页面',
      'panel.team': '团队空间',
      'panel.project': '项目',
      'panel.docs': '原型文档',
      'panel.noteam': '无团队空间',
      'panel.noproject': '无项目',
      'panel.empty': '没有原型文档',
      'panel.nodoc': '请选择一个原型文档',
      'panel.pick': '从左侧选择页面查看原型',
      'cookie.title': '蓝湖 Cookie',
      'cookie.hint': '浏览器登录蓝湖后，从开发者工具复制请求头里的 Cookie（需包含 session 与 user_token），只保存在本机。',
      'cookie.placeholder': 'session=...; user_token=...',
      'cookie.save': '保存',
      'cookie.saving': '保存中…',
      'cookie.cancel': '取消',
      'cookie.saved': '已保存',
      'cookie.missing': '还没有配置蓝湖 Cookie',
      'login.title': '登录蓝湖',
      'login.hint': '用蓝湖账号密码登录，成功后的 Cookie 只保存在本机。',
      'login.account': '手机号 / 邮箱',
      'login.password': '密码',
      'login.submit': '登录',
      'login.busy': '登录中…',
      'login.useCookie': '改用粘贴 Cookie',
      'panel.browserLogin': '浏览器登录',
      'login.browserHint': '点下面的按钮会打开一个独立的浏览器窗口，你在里面正常登录蓝湖（密码 / 短信 / 扫码 / 滑块都可以），登录完成后插件会自动把 Cookie 读回来，不用手工复制。',
      'login.browserStart': '打开浏览器登录',
      'login.browserStarting': '正在打开浏览器…',
      'login.browserWaiting': '浏览器已打开，请在里面完成登录，完成后这里会自动继续',
      'login.browserOk': '登录成功',
      'login.browserError': '等待登录失败，请重试',
      'login.tabPassword': '账号密码',
      'login.tabSms': '短信验证码',
      'login.mobile': '手机号',
      'login.code': '短信验证码',
      'login.sendCode': '获取验证码',
      'login.resend': '秒后重发',
      'login.codeSent': '验证码已发送，请查看手机短信',
      'login.smsSubmit': '登录',
      'login.smsBusy': '登录中…',
      'login.smsHint': '用手机号接收短信验证码登录，成功后 Cookie 只保存在本机。',
      'state.loading': '加载中…',
      'state.retry': '重试',
      'state.pages': '{n} 页',
    }

    /** 英文字典 */
    const en = {
      'entry.label': 'Lanhu Proto',
      'right.tab': 'Lanhu Proto',
      'right.quick': 'Open Lanhu prototype in the right sidebar',
      'right.guideDesc': 'Browse Lanhu prototype pages',
      'panel.pagesToggle': 'Pages',
      'panel.title': 'Lanhu Prototype',
      'panel.doc': 'Document',
      'panel.refresh': 'Refresh',
      'panel.search': 'Search pages',
      'panel.cookie': 'Cookie',
      'panel.login': 'Sign in',
      'panel.openTab': 'Open in tab',
    'panel.fitWidth': 'Fit w',
    'panel.fitPage': 'Fit page',
    'panel.zoomHint': 'Ctrl+wheel also zooms',
    'panel.zoom100': '100%',
      'panel.pages': 'Pages',
      'panel.team': 'Team',
      'panel.project': 'Project',
      'panel.docs': 'Prototypes',
      'panel.noteam': 'No team',
      'panel.noproject': 'No project',
      'panel.empty': 'No prototype documents',
      'panel.nodoc': 'Select a document',
      'panel.pick': 'Pick a page on the left',
      'cookie.title': 'Lanhu cookie',
      'cookie.hint': 'Copy the Cookie header from a logged-in lanhuapp.com request (must include session and user_token). Stored locally only.',
      'cookie.placeholder': 'session=...; user_token=...',
      'cookie.save': 'Save',
      'cookie.saving': 'Saving…',
      'cookie.cancel': 'Cancel',
      'cookie.saved': 'Saved',
      'cookie.missing': 'Lanhu cookie is not configured yet',
      'login.title': 'Sign in to Lanhu',
      'login.hint': 'Sign in with your Lanhu account. The cookie is stored locally only.',
      'login.account': 'Phone / email',
      'login.password': 'Password',
      'login.submit': 'Sign in',
      'login.busy': 'Signing in…',
      'login.useCookie': 'Paste cookie instead',
      'panel.browserLogin': 'Browser sign-in',
      'login.browserHint': 'A separate browser window will open. Sign in to Lanhu there (password, SMS, QR or slider are all fine) and the plugin will read the cookie back automatically.',
      'login.browserStart': 'Open browser to sign in',
      'login.browserStarting': 'Opening browser…',
      'login.browserWaiting': 'Browser opened — finish signing in there, this page continues automatically',
      'login.browserOk': 'Signed in',
      'login.browserError': 'Sign-in wait failed, please retry',
      'login.tabPassword': 'Password',
      'login.tabSms': 'SMS code',
      'login.mobile': 'Phone number',
      'login.code': 'SMS code',
      'login.sendCode': 'Send code',
      'login.resend': 's to resend',
      'login.codeSent': 'Code sent, check your messages',
      'login.smsSubmit': 'Sign in',
      'login.smsBusy': 'Signing in…',
      'login.smsHint': 'Sign in with an SMS code. The cookie is stored locally only.',
      'state.loading': 'Loading…',
      'state.retry': 'Retry',
      'state.pages': '{n} pages',
    }

    /** 主题取色：全部走宿主设计变量，深浅色自动跟随 */
    const C = {
      text: 'var(--dsw-alias-label-primary)',
      sub: 'var(--dsw-alias-label-secondary)',
      dim: 'var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary))',
      line: 'var(--dsw-alias-border-l2)',
      layer1: 'var(--dsw-alias-bg-layer-1)',
      layer2: 'var(--dsw-alias-bg-layer-2)',
      brand: 'var(--dsw-alias-brand-primary, var(--color-blue-500))',
      danger: 'var(--dsw-alias-state-danger-primary, var(--color-red-500))',
    }

    /** 面板样式 */
    const PANEL_CSS = [
      '.lh-page{transition:background .12s ease,border-color .12s ease}',
      '.lh-page:hover{background:var(--dsw-alias-bg-layer-2,#f6f7f9)!important}',
      '.lh-page[data-on="1"]{background:color-mix(in srgb,var(--dsw-alias-brand-primary,#3b82f6) 12%,transparent)!important;color:var(--dsw-alias-label-primary,#111)!important;font-weight:600}',
      '.lh-btn{font:inherit;font-size:12.5px;line-height:1.6;padding:4px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-secondary,#666);cursor:pointer;transition:background .12s ease,color .12s ease}',
      '.lh-btn:hover{color:var(--dsw-alias-label-primary,#111);background:var(--dsw-alias-bg-layer-2,#f6f7f9)}',
      '.lh-input{font:inherit;font-size:12.5px;padding:5px 9px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111);outline:none;min-width:0}',
      '.lh-input:focus{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#3b82f6) 60%,transparent)}',
      '.lh-scroll{overflow:auto;scrollbar-width:thin}',
      '.lh-scroll::-webkit-scrollbar{width:8px;height:8px}',
      '.lh-scroll::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--dsw-alias-label-primary,#111) 18%,transparent);border-radius:4px}',
    ].join('\n')

    /**
     * 调同源接口
     * @param {string} path 接口路径（/lanhu-proto/api 之后的部分）
     * @param {object} [init] fetch 选项
     * @returns {Promise<any>} 响应体
     */
    async function api(path, init) {
      const response = await fetch('/lanhu-proto/api' + path, {
        headers: { 'content-type': 'application/json' },
        ...(init || {}),
      })
      const text = await response.text()
      let payload = null
      try {
        payload = text ? JSON.parse(text) : null
      } catch (error) {
        payload = null
      }
      if (!response.ok || !payload || payload.ok !== true) {
        const message = (payload && payload.error) || 'HTTP ' + response.status
        const failure = new Error(message)
        failure.code = payload && payload.code
        throw failure
      }
      return payload
    }

    /** 加载中 / 出错占位 */
    function State({ kind, message, onRetry, t }) {
      return h(
        'div',
        { style: { padding: 24, color: C.sub, fontSize: 13, display: 'grid', gap: 10, justifyItems: 'start' } },
        h('div', null, kind === 'loading' ? t('state.loading') : message),
        kind === 'error' && onRetry
          ? h('button', { type: 'button', className: 'lh-btn', onClick: onRetry }, t('state.retry'))
          : null,
      )
    }

    /** Cookie 设置抽屉 */
    function CookieDrawer({ t, onClose, onSaved }) {
      const [value, setValue] = useState('')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const save = async () => {
        setBusy(true)
        setError('')
        try {
          await api('/cookie', { method: 'POST', body: JSON.stringify({ cookie: value }) })
          onSaved()
        } catch (failure) {
          setError(failure.message)
        } finally {
          setBusy(false)
        }
      }
      return h(
        'div',
        {
          style: {
            position: 'absolute',
            inset: 0,
            background: 'rgba(15,23,42,.28)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 30,
          },
          onClick: onClose,
        },
        h(
          'div',
          {
            onClick: (event) => event.stopPropagation(),
            style: {
              width: 'min(620px, 92%)',
              background: C.layer1,
              border: '1px solid ' + C.line,
              borderRadius: 14,
              padding: 18,
              display: 'grid',
              gap: 12,
              boxShadow: '0 18px 48px rgba(15,23,42,.24)',
            },
          },
          h('div', { style: { fontSize: 14, fontWeight: 600, color: C.text } }, t('cookie.title')),
          h('div', { style: { fontSize: 12, color: C.sub, lineHeight: 1.65 } }, t('cookie.hint')),
          h('textarea', {
            className: 'lh-input lh-scroll',
            value: value,
            placeholder: t('cookie.placeholder'),
            spellCheck: false,
            onChange: (event) => setValue(event.target.value),
            style: { height: 132, resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontSize: 12 },
          }),
          error ? h('div', { style: { fontSize: 12, color: C.danger } }, error) : null,
          h(
            'div',
            { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
            h('button', { type: 'button', className: 'lh-btn', onClick: onClose }, t('cookie.cancel')),
            h(
              'button',
              {
                type: 'button',
                className: 'lh-btn',
                disabled: busy || value.trim().length === 0,
                onClick: save,
                style: { borderColor: C.brand, color: C.brand, fontWeight: 600 },
              },
              busy ? t('cookie.saving') : t('cookie.save'),
            ),
          ),
        ),
      )
    }

    /** 登录视图：点按钮打开独立浏览器窗口，用户在里面登录，宿主侧自动读回 Cookie */
    function LoginView({ t, message, onDone, onCookie }) {
      const [stage, setStage] = useState({ kind: 'idle', message: message || '' })

      // 等待浏览器登录期间，每 2 秒查一次宿主侧状态
      useEffect(() => {
        if (stage.kind !== 'waiting') return undefined
        const timer = setInterval(async () => {
          try {
            const info = await api('/browser/status')
            if (info.state === 'ok') {
              setStage({ kind: 'ok', message: info.message || t('login.browserOk') })
              onDone()
            } else if (info.state === 'error') {
              setStage({ kind: 'error', message: info.message || t('login.browserError') })
            } else if (info.state === 'waiting') {
              setStage({ kind: 'waiting', message: info.message || t('login.browserWaiting') })
            }
          } catch (failure) {
            // 轮询失败保持现状，等下一轮
          }
        }, 2000)
        return () => clearInterval(timer)
      }, [stage.kind, onDone, t])

      /** 打开浏览器登录窗口 */
      const openBrowser = async () => {
        setStage({ kind: 'starting', message: '' })
        try {
          const info = await api('/browser/login', { method: 'POST', body: '{}' })
          setStage({ kind: 'waiting', message: info.message || t('login.browserWaiting') })
        } catch (failure) {
          setStage({ kind: 'error', message: failure.message })
        }
      }

      const busy = stage.kind === 'starting' || stage.kind === 'waiting'
      return h(
        'div',
        { style: { height: '100%', display: 'grid', placeItems: 'center', padding: 24 } },
        h(
          'div',
          {
            style: {
              width: 'min(420px, 100%)',
              display: 'grid',
              gap: 12,
              padding: 20,
              border: '1px solid ' + C.line,
              borderRadius: 14,
              background: C.layer1,
            },
          },
          h('div', { style: { fontSize: 14, fontWeight: 600, color: C.text } }, t('login.title')),
          h('div', { style: { fontSize: 12, color: C.sub, lineHeight: 1.7 } }, t('login.browserHint')),
          h(
            'button',
            { type: 'button', className: 'lh-btn', disabled: busy, onClick: openBrowser, style: { justifySelf: 'start' } },
            busy ? t('login.browserStarting') : t('login.browserStart'),
          ),
          stage.message
            ? h(
                'div',
                { style: { fontSize: 12, color: stage.kind === 'error' ? C.danger : C.sub, lineHeight: 1.6 } },
                stage.message,
              )
            : null,
          h('button', { type: 'button', className: 'lh-btn', style: { justifySelf: 'start' }, onClick: onCookie }, t('login.useCookie')),
        ),
      )
    }

    /** 主面板 */
    /**
     * 原型浏览面板。
     * @param {{ t: Function, compact?: boolean }} props compact=true 时按右侧栏窄宽度排版（工具条换行、页面列表变抽屉）
     */
    function LanhuPanel({ t, compact = false }) {
      const [status, setStatus] = useState({ kind: 'loading' })
      const [teams, setTeams] = useState([])
      const [teamId, setTeamId] = useState('')
      const [projects, setProjects] = useState([])
      const [projectId, setProjectId] = useState('')
      const [docs, setDocs] = useState([])
      const [docId, setDocId] = useState('')
      const [pages, setPages] = useState([])
      const [tree, setTree] = useState([])
      const [collapsed, setCollapsed] = useState({})
      const [page, setPage] = useState('')
      const [pageState, setPageState] = useState({ kind: 'idle' })
      const [keyword, setKeyword] = useState('')
      const [cookieOpen, setCookieOpen] = useState(false)
      const [loginOpen, setLoginOpen] = useState(false)
      const [reloadSeed, setReloadSeed] = useState(0)
      /** compact（右侧栏）模式下的页面列表抽屉开关 */
      const [listOpen, setListOpen] = useState(false)
      /** 上次选择的团队空间/项目（由 /status 回填，优先于配置默认值） */
      const [remembered, setRemembered] = useState(null)
      const frameRef = useRef(null)
      const [scale, setScale] = useState(1)

      /** 向 iframe 内的原型页发送缩放指令（fit-width / fit-page / scale / zoom-by） */
      const postToFrame = useCallback((payload) => {
        const frame = frameRef.current
        if (frame && frame.contentWindow) {
          frame.contentWindow.postMessage(Object.assign({ source: 'lanhu-proto-host' }, payload), '*')
        }
      }, [])

      /** 接收原型页回报的缩放比例（页面加载完自适应后会回报一次） */
      useEffect(() => {
        function onMessage(event) {
          const data = event.data
          if (!data || data.source !== 'lanhu-proto' || data.type !== 'state') return
          setScale(Number(data.scale) || 1)
        }
        window.addEventListener('message', onMessage)
        return () => window.removeEventListener('message', onMessage)
      }, [])

      /** 拉状态 + 团队空间列表 */
      const loadScope = useCallback(async () => {
        setStatus({ kind: 'loading' })
        try {
          const state = await api('/status')
          setRemembered(state.selection || null)
          if (!state.hasCookie) {
            setStatus({ kind: 'login' })
            setTeams([])
            setDocs([])
            return
          }
          const payload = await api('/teams')
          const list = payload.teams || []
          setTeams(list)
          setStatus({ kind: 'ready', hasCookie: true })
          setTeamId((current) => {
            if (current && list.some((team) => team.id === current)) return current
            const lastTeam = state.selection && state.selection.teamId
            if (lastTeam && list.some((team) => team.id === lastTeam)) return lastTeam
            const preferred = payload.defaultTeamId
            if (preferred && list.some((team) => team.id === preferred)) return preferred
            return list[0]?.id || ''
          })
        } catch (failure) {
          if (failure.code === 'AUTH') {
            setStatus({ kind: 'login', message: failure.message })
          } else {
            setStatus({ kind: 'error', message: failure.message })
          }
        }
      }, [])

      useEffect(() => {
        void loadScope()
      }, [loadScope, reloadSeed])

      /** 团队空间切换后拉项目列表 */
      useEffect(() => {
        if (!teamId) {
          setProjects([])
          setProjectId('')
          return
        }
        let cancelled = false
        api('/projects?team=' + encodeURIComponent(teamId))
          .then((payload) => {
            if (cancelled) return
            const list = payload.projects || []
            setProjects(list)
            setProjectId((current) => {
              if (current && list.some((project) => project.id === current)) return current
              if (remembered && remembered.teamId === teamId && remembered.projectId &&
                list.some((project) => project.id === remembered.projectId)) {
                return remembered.projectId
              }
              const fallback = payload.defaultProjectId
              if (fallback && list.some((project) => project.id === fallback)) return fallback
              return list[0]?.id || ''
            })
          })
          .catch(() => {
            if (!cancelled) {
              setProjects([])
              setProjectId('')
            }
          })
        return () => {
          cancelled = true
        }
      }, [teamId, remembered])

      /** 项目切换后拉原型文档（刷新按钮会带 refresh=1 跳过缓存） */
      useEffect(() => {
        if (!teamId || !projectId) {
          setDocs([])
          setDocId('')
          return
        }
        let cancelled = false
        const suffix = reloadSeed > 0 ? '&refresh=1' : ''
        api('/docs?team=' + encodeURIComponent(teamId) + '&project=' + encodeURIComponent(projectId) + suffix)
          .then((payload) => {
            if (cancelled) return
            const list = payload.docs || []
            setDocs(list)
            setDocId((current) => {
              if (current && list.some((doc) => doc.imageId === current)) return current
              return list[0]?.imageId || ''
            })
          })
          .catch((failure) => {
            if (!cancelled) {
              setDocs([])
              if (failure.code === 'AUTH') {
                setStatus({ kind: 'login', message: failure.message })
              } else {
                setStatus({ kind: 'error', message: failure.message })
              }
            }
          })
        return () => {
          cancelled = true
        }
      }, [teamId, projectId, reloadSeed])

      /** 拉页面列表 */
      useEffect(() => {
        if (!docId) {
          setPages([])
          setTree([])
          setPage('')
          return
        }
        let cancelled = false
        setPageState({ kind: 'loading' })
        api('/pages?doc=' + encodeURIComponent(docId))
          .then((payload) => {
            if (cancelled) return
            setPages(payload.pages || [])
            setTree(payload.tree || [])
            setPageState({ kind: 'idle' })
            setPage((current) => {
              if (current && (payload.pages || []).some((item) => item.name === current)) return current
              return (payload.pages || [])[0]?.name || ''
            })
          })
          .catch((failure) => {
            if (cancelled) return
            // 登录态失效时直接切回登录视图，避免用户看到一堆裸报错
            if (failure.code === 'AUTH') {
              setPageState({ kind: 'idle' })
              setStatus({ kind: 'login', message: failure.message })
              return
            }
            setPageState({ kind: 'error', message: failure.message })
          })
        return () => {
          cancelled = true
        }
      }, [docId])

      /** 折叠 / 展开目录（key 为目录名路径） */
      const toggleFolder = useCallback((folderKey) => {
        setCollapsed((prev) => {
          const next = Object.assign({}, prev)
          next[folderKey] = !prev[folderKey]
          return next
        })
      }, [])

      /**
       * 把页面树展开成渲染行：目录行（可折叠、带子页数）+ 页面行（按层级缩进）
       * 搜索时按「自身或其后代命中」保留目录，并强制展开命中路径。
       */
      const rows = useMemo(() => {
        const key = keyword.trim().toLowerCase()
        const countPages = function (node) {
          const children = node.children || []
          if (children.length === 0) return node.page ? 1 : 0
          return children.reduce(function (sum, child) {
            return sum + countPages(child)
          }, 0)
        }
        const matches = function (node) {
          if (!key) return true
          if (String(node.name || '').toLowerCase().includes(key)) return true
          return (node.children || []).some(matches)
        }
        const output = []
        const walk = function (nodes, depth, trail) {
          for (const node of nodes || []) {
            if (!matches(node)) continue
            const children = node.children || []
            const path = trail.concat(node.name)
            if (children.length > 0) {
              const folderKey = path.join('/')
              const open = key ? true : !collapsed[folderKey]
              output.push({
                kind: 'folder',
                key: folderKey,
                name: node.name,
                depth: depth,
                total: countPages(node),
                open: open,
              })
              if (open) walk(children, depth + 1, path)
              continue
            }
            if (!node.page) continue
            output.push({ kind: 'page', depth: depth, item: { name: node.page, displayName: node.name } })
          }
        }
        if (tree.length > 0) {
          walk(tree, 0, [])
          return output
        }
        // 站点地图拿不到时退回扁平列表
        const flat = key
          ? pages.filter(function (item) {
              return (item.displayName || item.name).toLowerCase().includes(key)
            })
          : pages
        return flat.map(function (item) {
          return { kind: 'page', depth: 0, item: item }
        })
      }, [tree, pages, keyword, collapsed])

      const doc = docs.find((item) => item.imageId === docId) || null
      const frameSrc = docId && page ? '/lanhu-proto/view/' + encodeURIComponent(docId) + '/' + encodeURIComponent(page) + '/' : ''

      if (status.kind === 'loading') return h(State, { kind: 'loading', t })
      if (status.kind === 'login') {
        return h(
          'div',
          { style: { position: 'relative', height: '100%' } },
          h(LoginView, {
            t,
            message: status.message,
            onDone: () => {
              setCookieOpen(false)
              void loadScope()
            },
            onCookie: () => setCookieOpen(true),
          }),
          cookieOpen
            ? h(CookieDrawer, {
                t,
                onClose: () => setCookieOpen(false),
                onSaved: () => {
                  setCookieOpen(false)
                  setReloadSeed((n) => n + 1)
                },
              })
            : null,
        )
      }
      if (status.kind === 'error') {
        return h(State, { kind: 'error', message: status.message, onRetry: () => setReloadSeed((n) => n + 1), t })
      }

      return h(
        'div',
        { style: { position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } },
        // 顶部工具条
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              flexWrap: compact ? 'wrap' : 'nowrap',
              gap: compact ? 6 : 10,
              padding: compact ? '8px 10px' : '10px 14px',
              borderBottom: '1px solid ' + C.line,
              flex: 'none',
            },
          },
          compact
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'lh-btn',
                  title: t('panel.pagesToggle'),
                  onClick: () => setListOpen((open) => !open),
                  style: { flex: 'none' },
                },
                t('panel.pages') + ' · ' + String(pages.length),
              )
            : h('div', { style: { fontSize: 13.5, fontWeight: 600, color: C.text } }, t('panel.title')),
          h(
            'select',
            {
              className: 'lh-input',
              value: teamId,
              title: t('panel.team'),
              onChange: (event) => setTeamId(event.target.value),
              style: compact ? { flex: '1 1 88px', minWidth: 0, maxWidth: 118 } : { maxWidth: 170 },
            },
            teams.length === 0 ? h('option', { value: '' }, t('panel.noteam')) : null,
            teams.map((item) => h('option', { key: item.id, value: item.id }, item.name)),
          ),
          h(
            'select',
            {
              className: 'lh-input',
              value: projectId,
              title: t('panel.project'),
              onChange: (event) => setProjectId(event.target.value),
              style: compact ? { flex: '1 1 88px', minWidth: 0, maxWidth: 118 } : { maxWidth: 140 },
            },
            projects.length === 0 ? h('option', { value: '' }, t('panel.noproject')) : null,
            projects.map((item) => h('option', { key: item.id, value: item.id }, item.name)),
          ),
          h(
            'select',
            {
              className: 'lh-input',
              value: docId,
              title: t('panel.docs'),
              onChange: (event) => setDocId(event.target.value),
              style: compact ? { flex: '2 1 110px', minWidth: 0 } : { maxWidth: 200 },
            },
            docs.length === 0 ? h('option', { value: '' }, t('panel.empty')) : null,
            docs.map((item) => h('option', { key: item.imageId, value: item.imageId }, item.name)),
          ),
          frameSrc
            ? h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 4 } },
                compact ? null : h('button', { type: 'button', className: 'lh-btn', title: t('panel.fitWidth'), onClick: () => postToFrame({ type: 'fit-width' }) }, t('panel.fitWidth')),
                compact ? null : h('button', { type: 'button', className: 'lh-btn', title: t('panel.fitPage'), onClick: () => postToFrame({ type: 'fit-page' }) }, t('panel.fitPage')),
                h('button', { type: 'button', className: 'lh-btn', title: t('panel.zoomHint'), onClick: () => postToFrame({ type: 'zoom-by', factor: 1 / 1.15 }) }, '−'),
                h('span', { style: { fontSize: 12, color: C.sub, minWidth: 38, textAlign: 'center', fontVariantNumeric: 'tabular-nums' } }, Math.round(scale * 100) + '%'),
                h('button', { type: 'button', className: 'lh-btn', title: t('panel.zoomHint'), onClick: () => postToFrame({ type: 'zoom-by', factor: 1.15 }) }, '+'),
                compact ? null : h('button', { type: 'button', className: 'lh-btn', title: t('panel.zoom100'), onClick: () => postToFrame({ type: 'scale', scale: 1 }) }, t('panel.zoom100')),
              )
            : null,
          compact ? null : h('div', { style: { flex: 1 } }),
          h('button', { type: 'button', className: 'lh-btn', title: t('panel.refresh'), onClick: () => setReloadSeed((n) => n + 1) }, compact ? '⟳' : t('panel.refresh')),
          h('button', { type: 'button', className: 'lh-btn', title: t('panel.browserLogin'), onClick: () => setLoginOpen(true) }, compact ? t('panel.login') : t('panel.browserLogin')),
          h('button', { type: 'button', className: 'lh-btn', title: t('panel.cookie'), onClick: () => setCookieOpen(true) }, t('panel.cookie')),
          frameSrc
            ? h(
                'a',
                { className: 'lh-btn', href: frameSrc, target: '_blank', rel: 'noreferrer', title: t('panel.openTab'), style: { textDecoration: 'none' } },
                compact ? '↗' : t('panel.openTab'),
              )
            : null,
        ),
        // 未配置 Cookie 的引导
        status.hasCookie === false
          ? h(
              'div',
              { style: { padding: 24, display: 'grid', gap: 12, justifyItems: 'start', color: C.sub, fontSize: 13 } },
              h('div', null, t('cookie.missing')),
              h('button', { type: 'button', className: 'lh-btn', onClick: () => setCookieOpen(true) }, t('panel.cookie')),
            )
          : h(
              'div',
              { style: { display: 'flex', flex: 1, minHeight: 0, position: 'relative' } },
              // compact：页面列表浮层的遮罩，点一下就收起
              compact && listOpen
                ? h('div', {
                    onClick: () => setListOpen(false),
                    style: { position: 'absolute', inset: 0, background: 'rgba(15,23,42,.16)', zIndex: 15 },
                  })
                : null,
              // 左侧页面列表（compact 时是浮层抽屉，非 compact 时固定 240px）
              h(
                'div',
                {
                  style: compact
                    ? {
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: 0,
                        width: 'min(80%, 260px)',
                        zIndex: 20,
                        background: C.layer1,
                        borderRight: '1px solid ' + C.line,
                        boxShadow: '0 10px 28px rgba(15,23,42,.22)',
                        display: listOpen ? 'flex' : 'none',
                        flexDirection: 'column',
                        minHeight: 0,
                      }
                    : {
                        width: 240,
                        flex: 'none',
                        borderRight: '1px solid ' + C.line,
                        display: 'flex',
                        flexDirection: 'column',
                        minHeight: 0,
                      },
                },
                h(
                  'div',
                  { style: { padding: '8px 10px', display: 'grid', gap: 6, flex: 'none' } },
                  h('input', {
                    className: 'lh-input',
                    value: keyword,
                    placeholder: t('panel.search'),
                    onChange: (event) => setKeyword(event.target.value),
                  }),
                  h(
                    'div',
                    { style: { fontSize: 11.5, color: C.dim } },
                    t('state.pages').replace('{n}', String(pages.length)),
                  ),
                ),
                h(
                  'div',
                  { className: 'lh-scroll', style: { flex: 1, minHeight: 0, padding: '0 6px 10px' } },
                  pageState.kind === 'loading'
                    ? h('div', { style: { padding: 12, fontSize: 12.5, color: C.sub } }, t('state.loading'))
                    : pageState.kind === 'error'
                      ? h('div', { style: { padding: 12, fontSize: 12.5, color: C.danger } }, pageState.message)
                      : rows.map((row) => {
                          const pad = 6 + row.depth * 12
                          if (row.kind === 'folder') {
                            return h(
                              'div',
                              {
                                key: 'folder:' + row.key,
                                className: 'lh-page',
                                role: 'button',
                                tabIndex: 0,
                                onClick: () => toggleFolder(row.key),
                                onKeyDown: (event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    toggleFolder(row.key)
                                  }
                                },
                                style: {
                                  padding: '6px 9px 6px ' + pad + 'px',
                                  borderRadius: 8,
                                  fontSize: 12.5,
                                  color: C.text,
                                  cursor: 'pointer',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  whiteSpace: 'nowrap',
                                },
                                title: row.key,
                              },
                              h('span', { style: { flex: 'none', width: 10, color: C.dim } }, row.open ? '▾' : '▸'),
                              h('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, row.name),
                              h('span', { style: { marginLeft: 'auto', fontSize: 11, color: C.dim } }, String(row.total)),
                            )
                          }
                          const item = row.item
                          return h(
                            'div',
                            {
                              key: 'page:' + item.name,
                              className: 'lh-page',
                              role: 'button',
                              tabIndex: 0,
                              'data-on': page === item.name ? '1' : undefined,
                              onClick: () => {
                                setPage(item.name)
                                if (compact) setListOpen(false)
                              },
                              onKeyDown: (event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  setPage(item.name)
                                  if (compact) setListOpen(false)
                                }
                              },
                              style: {
                                padding: '6px 9px 6px ' + pad + 'px',
                                borderRadius: 8,
                                fontSize: 12.5,
                                color: C.sub,
                                cursor: 'pointer',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              },
                              title: item.displayName,
                            },
                            item.displayName,
                          )
                        }),
                ),
              ),
              // 右侧原型画布
              h(
                'div',
                { style: { flex: 1, minWidth: 0, minHeight: 0, background: C.layer2, position: 'relative' } },
                frameSrc
                  ? h('iframe', {
                      ref: frameRef,
                      key: frameSrc,
                      src: frameSrc,
                      title: doc ? doc.name + ' / ' + page : 'lanhu-proto',
                      style: { width: '100%', height: '100%', border: 'none', background: '#fff' },
                    })
                  : h(
                      'div',
                      {
                        style: {
                          position: 'absolute',
                          inset: 0,
                          display: 'grid',
                          placeItems: 'center',
                          color: C.sub,
                          fontSize: 13,
                        },
                      },
                      pages.length === 0 ? t('panel.nodoc') : t('panel.pick'),
                    ),
              ),
            ),
        loginOpen
          ? h(
              'div',
              { style: { position: 'absolute', inset: 0, background: 'rgba(15,23,42,.28)', zIndex: 40 } },
              h(LoginView, {
                t,
                onDone: () => {
                  setLoginOpen(false)
                  setReloadSeed((n) => n + 1)
                },
                onCookie: () => {
                  setLoginOpen(false)
                  setCookieOpen(true)
                },
              }),
            )
          : null,
        cookieOpen
          ? h(CookieDrawer, {
              t,
              onClose: () => setCookieOpen(false),
              onSaved: () => {
                setCookieOpen(false)
                setReloadSeed((n) => n + 1)
              },
            })
          : null,
      )
    }

    /** 左侧栏入口图标 */
    function LanhuIcon({ size }) {
      return h(
        'svg',
        {
          'data-dsh-panel-entry': PANEL_ID,
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('rect', { x: 1.75, y: 2.25, width: 12.5, height: 11.5, rx: 2 }),
        h('path', { d: 'M1.75 6h12.5' }),
        h('path', { d: 'M5.25 6v7.75' }),
        h('path', { d: 'M8.5 9h3.5v3.5H8.5z' }),
      )
    }

    /** 会话右上角的蓝湖快捷按钮：点一下在右侧栏打开蓝湖原型页 */
    function HeaderQuickAction({ t }) {
      const [hover, setHover] = useState(false)
      const label = t('right.quick')
      return h(
        'button',
        {
          type: 'button',
          title: label,
          'aria-label': label,
          onClick: () => {
            if (OPEN_RIGHT) {
              OPEN_RIGHT()
            }
          },
          onMouseEnter: () => setHover(true),
          onMouseLeave: () => setHover(false),
          style: {
            width: 28,
            height: 28,
            display: 'grid',
            placeItems: 'center',
            padding: 0,
            border: 'none',
            borderRadius: 6,
            background: hover ? 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,.06))' : 'transparent',
            color: hover ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
            cursor: 'pointer',
            flex: 'none',
          },
        },
        h(LanhuIcon, { size: 16 }),
      )
    }

    /** 右侧栏标签页正文：窄宽度，给面板开 compact 排版 */
    function RightPaneBody({ t }) {
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', height: '100%', flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden' } },
        h(LanhuPanel, { t, compact: true }),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          try {
            return ctx.locale.register(NS, { zh, en })
          } catch (error) {
            return () => {}
          }
        }, 'lanhu-proto: dictionaries')

        ctx.effect(() => {
          const style = document.createElement('style')
          style.setAttribute('data-dsh-lanhu-proto', '')
          style.textContent = PANEL_CSS
          document.head.appendChild(style)
          return () => style.remove()
        }, 'lanhu-proto: styles')

        const t = ctx.locale.bind(NS)

        ctx.effect(() => {
          const disposers = [
            ctx.slots.inject('sidebar.panellist', () =>
              ctx.slots.register(
                { name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ORDER, label: () => t('entry.label') },
                LanhuIcon,
              ),
            ),
            ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, () => h(LanhuPanel, { t }))),
          ]
          return () => {
            for (const dispose of disposers) dispose()
          }
        }, 'lanhu-proto: placement')

        // 右侧栏标签类型 + 会话右上角快捷按钮（参考禅道插件的接入方式）
        ctx.effect(() => {
          const disposers = []
          let openRight = null
          const release = () => {
            if (OPEN_RIGHT === openRight) {
              OPEN_RIGHT = null
            }
          }

          // sidebarRight / sidebarRightTabs 由 ui-sidebar-right 在自己的 apply 里 provide，
          // 本插件激活时它的 fiber 往往还没 active：一次性 ctx.get()（严格模式）只会拿到
          // undefined —— 页签类型压根不注册、右上角按钮点了也没反应。所以用 ctx.inject
          // 等服务就绪后再注册；老宿主没有这两个服务时回调不触发，左侧栏与主区域照常。
          disposers.push(
            ctx.inject(['sidebarRightTabs', 'sidebarRight'], (injected) => {
              const owned = []
              const tabRegistry = injected.get('sidebarRightTabs')
              const sidebarRight = injected.get('sidebarRight')

              if (sidebarRight && typeof sidebarRight.openTab === 'function') {
                openRight = () => {
                  try {
                    sidebarRight.openTab('lanhu')
                  } catch (error) {
                    /* 右侧栏不可用时忽略 */
                  }
                }
                OPEN_RIGHT = openRight
              }

              if (tabRegistry && typeof tabRegistry.register === 'function') {
                try {
                  owned.push(
                    tabRegistry.register({
                      id: 'dsh-lanhu-proto',
                      kind: 'lanhu',
                      multiple: false,
                      keepMounted: true,
                      title: () => t('right.tab'),
                      guide: [
                        {
                          id: 'lanhu',
                          order: 61,
                          title: () => t('right.tab'),
                          description: () => t('right.guideDesc'),
                          icon: LanhuIcon,
                        },
                      ],
                    }),
                  )
                  owned.push(
                    ctx.slots.inject('sidebar.right.pane.tab', () =>
                      ctx.slots.register({ name: 'sidebar.right.pane.tab', key: 'dsh-lanhu-proto', locale: NS }, () =>
                        h(RightPaneBody, { t }),
                      ),
                    ),
                  )
                } catch (error) {
                  // 标签类型被占用等情况下静默降级，不影响左侧栏与主区域
                }
              }

              return () => {
                for (const dispose of owned) {
                  try {
                    dispose()
                  } catch (error) {
                    /* 忽略 */
                  }
                }
                release()
              }
            }),
          )

          try {
            disposers.push(
              ctx.slots.inject('conversation.session.header.utilities', () =>
                ctx.slots.register(
                  { name: 'conversation.session.header.utilities', id: 'lanhu', order: 45, label: () => t('right.quick') },
                  () => h(HeaderQuickAction, { t }),
                ),
              ),
            )
          } catch (error) {
            // 该 DSH 版本没有这个槽位时不加右上角按钮
          }

          return () => {
            for (const dispose of disposers) {
              try {
                dispose()
              } catch (error) {
                /* 忽略 */
              }
            }
            release()
          }
        }, 'lanhu-proto: right pane + header action')
      },
    }
  },
})
