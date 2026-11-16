# dsh-lanhu-proto

在 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）里直接查看**蓝湖「产品原型」（Axure）** 的插件——人在侧边栏面板里看，模型在对话里用工具看。

蓝湖没有公开 API，也没有官方 MCP。本插件通过蓝湖网页自身的内部接口读取原型文档清单与 Axure 产物，并在本地做**路径映射代理**，把蓝湖扁平化 CDN 上的资源还原成 Axure 需要的相对路径结构，从而能在 iframe 里正常渲染原型。

## 功能

- **侧边栏面板「蓝湖原型」**：团队空间 → 项目 → 原型文档 → 页面列表（按 Axure 站点地图的目录分组，可折叠、可搜索）
- **内嵌预览**：同源 iframe 渲染原型页，默认按面板宽度自适应缩放，支持适宽 / 整页 / 百分比 / 原始 100% / Ctrl+滚轮
- **原型内跳转可用**：页面里点菜单、按钮跳转时会自动映射到对应页面（Axure 的相对 `<页面名>.html` 链接不会 404）
- **浏览器代登录**：点「浏览器登录」会启动一个**独立 profile** 的 Chrome/Edge 打开蓝湖，你在里面正常登录（密码/短信/滑块都行），登录成功后插件自动取回 Cookie 并保存
- **给模型用的四个工具**：
  - `lanhu_proto_teams` —— 列出团队空间及其项目
  - `lanhu_proto_docs` —— 列出某个团队/项目下的原型文档
  - `lanhu_proto_pages` —— 列出某个原型文档的页面（按目录树输出，带 `page` 参数值）
  - `lanhu_proto_page` —— 读取某一页：返回可访问路径、页面文案、资源统计
- 记住上次选择的团队空间与项目（`selection.json`）

## 安装

### 前提

- 已安装 DSH（Desktop 或 `dsh web`），Node.js 18+（内置 `fetch` 与 `WebSocket`）
- 一个能打开蓝湖原型的蓝湖账号（需要在对应团队里有原型查看权限）
- 默认按 **Windows** 的浏览器路径查找 Chrome/Edge；macOS/Linux 请改 `lib/browser.js` 里的 `BROWSER_CANDIDATES`

### 步骤

1. 克隆到本地任意目录，例如 `C:\\Users\\you\\dsh-plugins\\dsh-lanhu-proto`：

   ```bash
   git clone https://github.com/qq304379685/dsh-lanhu-dashboard-x.git dsh-lanhu-proto
   ```

2. 在 DSH profile 的 `package.json`（Windows 一般是 `C:\\Users\\<你>\\.dsh\\profiles\\desktop\\package.json`）里：

   - 加一条依赖，用 `link:` 指到克隆目录：

     ```json
     "dependencies": {
       "dsh-lanhu-proto": "link:C:/Users/you/dsh-plugins/dsh-lanhu-proto"
     }
     ```

   - 把插件加进 `dsh.profile.bundles` 数组：

     ```json
     "dsh": {
       "profile": {
         "bundles": ["dsh-ops", "dsh-lanhu-proto"]
       }
     }
     ```

3. 在 profile 的 `node_modules` 目录下建一个目录联接（Windows 用 junction，不需要管理员权限）：

   ```bat
   mklink /J "C:\Users\you\.dsh\profiles\desktop\node_modules\dsh-lanhu-proto" "C:\Users\you\dsh-plugins\dsh-lanhu-proto"
   ```

4. **重启 DSH Desktop**（宿主侧插件不会热加载）。重启后侧边栏出现「蓝湖原型」入口。

## 配置

装配参数在 `cordis.patch.yml`：

```yaml
- insert:
    - id: lanhu-proto
      name: 'dsh-lanhu-proto'
      config:
        baseUrl: 'https://lanhuapp.com'
        cookieFile: ''            # 留空 = 用 profile 数据目录下的 cookie.txt
        defaultTeamId: ''         # 可选：默认团队空间 id
        defaultProjectId: ''      # 可选：默认项目 id
```

- 团队/项目 id 留空时，面板会取该账号下的第一个团队/项目；在面板里选过一次后会记住你的选择（存在 `selection.json`），下次打开直接落在上次的位置。
- 想固定某个团队/项目，把它们的 id 填进 `defaultTeamId` / `defaultProjectId`（id 可以从面板 URL 或 `lanhu_proto_teams` 工具输出里拿）。

## 使用

### 面板

1. 侧边栏点「蓝湖原型」
2. 首次使用点工具条的**「浏览器登录」**：会弹一个独立的浏览器窗口，在里面登录蓝湖；登录完成插件自动保存 Cookie（约 2 秒轮询，最长等 5 分钟）
   - 也可以点「Cookie」手动粘贴：从已登录的蓝湖网页里复制 `document.cookie` 的完整内容（需包含 `session`）
3. 选团队空间 → 项目 → 原型文档，左侧点页面即可预览

### 工具（模型侧）

```
lanhu_proto_pages({ doc: "示例原型" })
lanhu_proto_page({ doc: "示例原型", page: "首页" })
```

`lanhu_proto_page` 返回的 `path` 可以直接在浏览器打开，也可以给模型做页面文案参考。

## 数据存放

都在 DSH profile 的数据目录下：`<profile>/data/dsh-lanhu-proto/`

| 文件 | 说明 |
| --- | --- |
| `cookie.txt` | 蓝湖 Cookie（只在本机） |
| `bindings.json` | 原型文档 id → 索引 JSON 地址的缓存 |
| `selection.json` | 上次选择的团队空间 / 项目 |
| `browser-profile/` | 「浏览器登录」用的独立浏览器 profile |

**请不要把上述文件提交到仓库**（`.gitignore` 已排除）。

## 限制与注意事项

- 走的是蓝湖**网页内部接口**，不是官方 API；蓝湖改版可能导致失效，届时需要按新接口调整 `lib/lanhu.js`
- Cookie 会过期：接口返回 401/403 或 **418（蓝湖风控）** 时，面板会提示重新「浏览器登录」
- 图形验证码 / 滑块验证无法在插件里复刻（阿里云无痕验证），所以只提供「在真实浏览器里登录」这一条路
- 原型里的 Axure 交互只能跑到静态部分：页面跳转、折叠、动态面板可用；涉及蓝湖服务端的协作功能（评论、标注）不可用
- 本插件与蓝湖官方无关

## 目录结构

```
index.js            # 宿主侧：注册路由 /lanhu-proto/api、/lanhu-proto/view 与四个工具
client.js           # 面板 UI（侧边栏入口 + 主区域面板 + 缩放控件）
lib/lanhu.js        # 蓝湖接口客户端：登录、团队/项目/文档、页面清单、资源拉取、站点地图解析
lib/proxy.js        # 路径映射代理：HTML 重写、资源转发、原型内页面跳转
lib/browser.js      # 浏览器代登录（CDP 读 Cookie）
cordis.patch.yml    # 装配配置
icon.svg            # 侧边栏图标
```

## License

MIT
