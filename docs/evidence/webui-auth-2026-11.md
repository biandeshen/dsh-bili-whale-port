<!-- Owner: src/web/server.ts, src/web/auth.ts, src/web/panel 路由, src/bot.ts(WebApp 装配), src/worlds/console/world.ts(pin) -->

# WebUI 写接口的认证现状与两条待拍板的加法

结论：**本机 7799 上现在能挡住的是"跨源脚本"，挡不住"不带 Origin 的程序化写"。** 框架里已经有一套真的
会话认证（访问密码），只是这份部署没开。加一层"页面首屏领凭据"能关掉盲 POST 这一类，但它挡不住同机进程，
所以它是防误触，不是安全边界——下面按这个口径写。

## 现状：四道闸，各挡什么

| 闸 | 位置 | 挡得住 | 挡不住 |
|---|---|---|---|
| 只绑回环 | 缺省 `127.0.0.1`（`src/web/server.ts:1022`，注释 `:659`），`web.host` 可改 | 局域网上的其他机器 | 本机任何进程 |
| Host 白名单 | `isAllowedHost`（`server.ts:850`）+ 中间件（`:1550`），非白名单回 421；WS 升级同一关（`:1418`） | DNS rebinding（外站页面把 Host 写成自己的名字） | 程序化客户端自己填 Host |
| 写请求同源闸门 | `isForeignOrigin`（`server.ts:805`）+ 中间件（`:1559`，非 GET 一律查），跨站回 403；WS 在 `:1426` | 浏览器里的跨站脚本、CSRF | **没有 Origin 头的请求**：`server.ts:806` 对缺 Origin 直接放行，`curl`/`fetch`（Node）/Python 都不发这个头 |
| 访问密码会话 | `src/web/auth.ts:39`（令牌=密码与 `data/web-auth.key` 盐的 HMAC）；闸在 `server.ts:1614`，未登录 GET 得登录页、其余 401 带 `x-cortico-auth`；WS 在 `:1433` | 盲 POST、CSRF（Cookie 是 HttpOnly + `SameSite=Strict`，`server.ts:1255`） | 同机进程：它能读 `<部署>/.env` 里的密码，也能读浏览器 Cookie 之外的任何字节 |

密码从 `web.password` 或密钥 `CORTICO_WEB_PASSWORD` 取（`src/bot.ts:1005`：`secret(...) || cfg.web.password`），
启动时读一次，改了重启生效；故意不进 WebUI 的配置表单（`docs/configuration.md:31`）。
监听非回环地址且没设密码时启动记一条 warn（`server.ts:1506`）——监听 `127.0.0.1` 时不会有这条提示。

`panels/<id>/set|approve|reject|resolve` 走的是通用面板路由 `POST /api/webui/providers/<page>/panels/<panel>/<method>`
（`server.ts:2340`，上一版契约包另有一条 `:2343`），处理器在 World 的 `invoke`
（`src/worlds/bili-account/definition.ts` 的 `policy/set`）。这条路由上没有路由级认证，只有上面四道闸；
`/api/extensions/install`（`:2087`）、`/api/config`（`:2408`）等写路由也一样，全在 `:1559` 那道闸之后。
2026-11-01 01:23 那次 `publish.draftMode` 被盲 POST 改成 `auto` 走的就是这一格：前三道闸全过，第四道没开。

## 一条容易看错的线索

`worlds.console.pin`（`src/worlds/console/config.ts:5`）**不是**接口认证。它只被用作消息正文里的标记串
`[console|PIN:xxxxxx]`（`src/worlds/console/world.ts:479`、`:491`）和环境提示词变量 `console.pin`（`:245`），
给 Persona 与操作员认"这条来自哪台控制台"用；HTTP 层没有任何地方读它。六位数字也不设到期、不出现在请求校验里。

## 方案 A：Origin/Host 已具备，缺的是"首屏发凭据"

要做的只有第二半：服务端在 `GET /` 生成一个进程内随机值随首页下发，写路由要求带回来。

| 改动 | 文件 | 规模 |
|---|---|---|
| 凭据表（随机值集合 + 过期） | `src/web/auth.ts` | 约 30 行 |
| 下发：`serveIndex` 里 `Set-Cookie`（HttpOnly、`SameSite=Strict`、Path=/） | `src/web/server.ts:2458` | 约 10 行 |
| 校验：插在 `:1559` 的同源闸门之后、`:1614` 的密码闸之前，非安全方法且无有效凭据回 403 | `src/web/server.ts` | 约 20 行 |
| 文档：公开路由表加"写请求要带首屏凭据"，并写清它挡不住同机进程 | `docs/webui.md` | 数行 |

风险与代价：

- **不是认证**。同机进程先 `GET /` 拿到 Cookie 再 POST 就通过；这一层关掉的是"没看过页面的盲写"，
  必须按防误触写明（这也是 `AGENTS.md` 要求的口径：不做"看起来安全但其实没用"的修法）。
- 改的是 `docs/webui.md` 列出的公开 HTTP 契约 → 按提交规则要 `!` 与 `BREAKING CHANGE:` 脚注，并给出下游前端的
  迁移办法（先 GET 首页、带 Cookie 重试）。
- 工具链里两处合法盲 POST 会立刻 403：`dsh-bili-whale-policy/scripts/start-cortico.mjs:26`（`/api/run/resume`）
  与 `scripts/c2-window.mjs:77`（`/api/run/shutdown`）。要一起改成"先取凭据再发"，那是另一张席的文件。
- 测试面：`tests/web/` 里 56 处 `method: 'POST'` 分布在 18 个文件，都要先领凭据（多数能收进各文件已有的
  `post()` 助手，但 `run.test.ts`、`api.test.ts`、`webui-pages.test.ts` 是散在各 `it` 里的裸 fetch）。
  新增用例：同源+有凭据 200、异源 403、无凭据 403 且配置/草稿状态未变（真起 server，仿 `tests/web/origin.test.ts`）。

约 1 个专业工作日（含测试改造），不是"今晚改 20 行"的量。

## 方案 B：只在部署目录落一个 token，WebUI 首屏注入

token 在服务启动时生成、写进部署目录（`data/`），首屏由服务端注入给页面。**比 A 更弱**：落盘就等于同机可读，
浏览器之外的客户端拿到它和拿到 A 的 Cookie 一样容易，而 A 至少不落盘。B 多出来的只有"重启后 token 不变"
这个可运维性，安全上没有收益。**不建议做 B。**

## 现在就能做、且不新增代码的一件事

给这份部署设访问密码：在 `<部署>/.env` 写 `CORTICO_WEB_PASSWORD=<非空>`（或 `config.json` 的 `web.password`），
重启。之后：未登录的所有写路由 401、WS 直接断、跨站 CSRF 因 `SameSite=Strict` 拿不到 Cookie——
这一格关的是"任何没登录的进程"，比 A 覆盖得宽，且不动代码。代价：

- 操作员每次要用登录页；令牌不设到期，改密码或登出才失效（`src/web/auth.ts` 头部注释写明）。
- 上面那两条工具链脚本要先 `POST /api/auth/login` 带密码才能 resume/shutdown（它们本来就能读同一份 `.env`）。
- 明文 HTTP 下密码与 Cookie 在途中可读；要公网用就放在终结 HTTPS 的反向代理后面（`docs/webui.md` 已写）。

## 待拍板

1. 是否给正式部署开 `CORTICO_WEB_PASSWORD`（今天可做，零代码）。
2. 是否接受"公开写路由需要首屏凭据"这一契约变更（含 `!`/`BREAKING CHANGE:` 与两份工具链脚本的同步改）。
3. `deployments/<部署>/config.json` 里若存在顶层 `extensions` 字段：框架不读它（`CoreConfig` 无此键，启用与否只看
   `worlds.<id>.enabled`），留着会被读成"扩展开了"。要不要清掉。
4. 手脚清单（`bili_capabilities`）之外，她还要不要读"这份部署的配置"的工具——目前只有 WebUI 页看得到。
