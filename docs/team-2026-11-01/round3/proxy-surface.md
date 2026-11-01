owner: docs/team-2026-11-01/round3/proxy-surface.md — 「网络与代理」设置块规格（调研 + 设计），非代码所有方；实现落地时由对应配置模块接管本页。

# 代理设置：成熟做法调研与我们项目的实现规格

调研时间 2026-11。来源以官方文档/一手 changelog 为准（nodejs.org、code.visualstudio.com、git-scm.com、docs.npmjs.com、curl.se、undici 文档、chromium net/docs、support.mozilla.org、docs.docker.com）；本机环境事实（Steam 加速器假证书、7897、412、18910 网关）为已实测前提，不再验证。

---

## 1. 成熟做法对照表

| 软件 | 字段 | 语义 | 默认值 | 我们能否照抄 |
|---|---|---|---|---|
| Chrome / Edge（桌面） | 无自带设置 | 完全跟随系统代理（注册表 + WPAD/PAC），Windows 四态：无代理 / 自动检测(PAC) / 手动 / 脚本 | 跟随系统 | 借鉴其"四态"心智模型，不做 PAC（Node 无法执行 PAC） |
| Firefox `Network Settings` | 单选四态：Auto-detect / System proxy / Manual / No proxy + **Bypass** 文本框（逗号分隔，条目按后缀匹配）+ Manual 下 **per-scheme**（HTTP/SSL/FTP/SOCKS 各自 host:port，"Also used for FTP"，SOCKS v4/v5，"Proxy DNS when using SOCKS v5"） | 模式 + 绕过列表 + 按协议分派 | System proxy | **一个设置块的字段骨架来源**：模式单选 + 绕过列表 + 手动 URL |
| VS Code | `http.proxySupport`（enum `off`/`on`/`bypass`/`override`） | 控制代理是否**覆盖扩展自己发起请求的选项**；官方描述 override = "Enable proxy support for extensions, override request options"、bypass = "unconfigured request options"；issue 语境确认默认 `override` | `override` | 照抄"模式管辖范围"的思路；但我们用"作用域"表达（见 §2） |
| VS Code | `http.proxy` | 代理 URL，可内嵌 user:pass | 无 | 照抄字段，但凭据单独存 secret |
| VS Code | `http.noProxy` | 逗号分隔绕过主机 | 无 | 照抄，且我们预置不可删条目 |
| VS Code | `http.proxyAuthorization` | 单独传 Proxy-Authorization 头，不放在 URL 里 | 无 | 照抄（凭据与 URL 分离的先例） |
| VS Code | `http.proxyStrictSSL` | 是否校验代理侧证书 | `true` | **只保留 true，不提供开关**（见 §3） |
| VS Code | `http.systemCertificates` | 把操作系统证书库并入 Node TLS 信任根（Windows 用 win-ca 融合；企业场景另有 experimental V2） | `true` | 照抄思路 → Node 24 用 `--use-system-ca` |
| VS Code | `http.proxyFallback` | 代理失败时回落其他代理/直连 | 空（不回落） | 值得照抄：市场索引已有镜像回落，与此同构 |
| Git | `http.<url>.proxy` | **按 URL 前缀分别配代理**；`<url>` 为 URL 前缀，唯一通配是单个 `*`（匹配所有主机，等效禁用）；URL 末尾斜杠忽略；支持 socks4/5 | 继承 `http.proxy` | **直接照抄**——"只给 GitHub 走代理"的成熟先例，git 子进程内联注入即可 |
| npm | `proxy` / `https-proxy` / `noproxy` / `cafile` / `strict-ssl` | 分别管 http/https 代理、绕过列表、CA 文件、证书校验；**`noproxy` 默认值 = `NO_PROXY` 环境变量**；`strict-ssl` 默认 true | 均 null / true | 照抄；我们的"镜像源"另设 registry 字段 |
| pip | `proxy` + `PIP_NO_PROXY` | 代理 + 绕过列表（env 前缀 PIP_） | 无 | 仅作参考（本项目不用 pip） |
| curl | `--proxy` / `http_proxy`(仅小写，CGI 规则) / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY` | `NO_PROXY=*` 匹配全部；条目以 `.` 开头匹配子域；7.86.0 起支持 CIDR；代理 URL 带端口 | 无代理 | **绕过列表匹配语法照抄 curl/undici 约定** |
| Docker/podman | `~/.docker/config.json` `proxies.default{httpProxy,httpsProxy,noProxy}` + `override`/`system` 两态 | 显式覆盖 vs 继承宿主环境 | system | 照抄"override/system"心智 = 我们的"手动/跟随环境变量" |
| Chromium flags | `--proxy-server` / `--proxy-bypass-list="localhost;127.0.0.1;*.internal.com"`（分号或逗号） | 命令行级代理 + 绕过，`*.` 通配 | — | 通配写法与我们的域名列表一致 |

### Node 24 实现事实（已核实到版本，来源见文末）

- `--use-env-proxy` flag + `NODE_USE_ENV_PROXY=1`：**Node v24.5.0 加入**（SEMVER-MINOR，cli: add --use-env-proxy；同批 "http: support http proxy for fetch under NODE_USE_ENV_PROXY"；回移 v22.21.0）。本机 v24.16.0 两者可用。**只作用于基于 undici 的全局 `fetch`，不作用于 `node:http/https` 模块请求**（gh 等外部 CLI 走各自 env 逻辑）。它按 undici `EnvHttpProxyAgent` 语义读 `http_proxy/https_proxy/no_proxy`（小写优先，大写兜底；与 curl 的"小写只认 http_proxy"规则同族），**NO_PROXY 被遵守**。
- `undici`：`ProxyAgent`（支持 http/https/SOCKS5 代理）与 `EnvHttpProxyAgent` 是两种接线方式；`setGlobalDispatcher(new ProxyAgent(url))` 影响进程内**所有** fetch —— 这对我们是危险默认（会劫持回环网关），应优先 **per-request `{ dispatcher }`**（仅 GitHub/npm 两类 URL 挂 dispatcher），全局 dispatcher 最多仅在"全部出站"模式 + 启动时挂 EnvHttpProxyAgent。per-request dispatcher 可运行时切换、**不需要重启**。
- `NODE_EXTRA_CA_CERTS`：在进程 bootstrap 初始化 TLS root store 时读取，**必须启动前设置，运行中改不了**（改 CA 文件内容也要重启）。→ 页面上改完只能标记"下次启动生效"，或由 launcher 重启宿主。
- `--use-system-ca` / `NODE_USE_SYSTEM_CA=1`：Node 23.x 起（23.10 补中间证书），读取操作系统证书库并入信任根，Windows 可行——这是 VS Code `http.systemCertificates` 的官方等价物，同样是**启动前决定**。
- `node:tls` 默认只带 Mozilla bundle，**不读 Windows 证书库**——这就是我们 `UNABLE_TO_GET_ISSUER_CERT_LOCALLY` 的根因之一（Steamcommunity302 假根若装在用户库里，Node 根本看不见它）。

---

## 2. 给我们的设计：「网络与代理」设置块

前提硬约束（写死在代码里，配置改不动）：
`bilibili` 泳道与 `127.0.0.1/localhost/::1` 网关**永远直连**；B站域名在绕过列表中**不可删除**（预置、只读展示）。

| # | 字段（config key） | 控件 | 取值与校验 | 非法值兜底 | 生效时机 | 权限 |
|---|---|---|---|---|---|---|
| 1 | `net.proxyMode`：`off`（不代理，默认）/ `env`（跟随环境变量）/ `manual`（手动 URL） | 单选组，旁注各模式含义一行 | 严格枚举 | 回落 `off` + 黄条提示 | `manual` 的 per-request dispatcher 即时；`env` 需 launcher 设 `NODE_USE_ENV_PROXY=1` → **下次启动** | 她不可改，只读 |
| 2 | `net.proxyUrl` | 文本框（占位 `http://127.0.0.1:7897`） | 仅 manual 态必填；`new URL()` 可解析且 protocol∈{http:, https:, socks5:}、有 host+port；含 user:pass 时拆存 `net.proxyAuthHeader`（照抄 proxyAuthorization 思路） | 校验失败：保存禁用；运行时解析失败 → 该请求走直连并记 warn | dispatcher 路径即时；git/npm 子进程注入即时 | 她不可改 |
| 3 | `net.proxyScope`：`githubNpm`（默认，仅 GitHub+npm 类走代理）/ `all`（全部非硬豁免出站）/ `custom`（配合 4 的域名列表） | 单选 + custom 时显示列表编辑器 | 严格枚举；custom 列表逐项按 §curl 语法校验（`.` 前缀、`*.x`、裸域名、可带端口） | 回落 `githubNpm` | 即时 | 她不可改 |
| 4 | `net.noProxy` | 只读系统条目（`127.0.0.1`、`localhost`、`::1`、`*.bilibili.com`、`api.bilibili.com`、`hh.bilibili.com` 等）+ 可追加输入框 | 追加项同 curl/undici 语法；与系统条目冲突时忽略追加 | 非法条目丢弃并内联报错 | 即时（匹配器在请求层） | 追加项她可改；系统条目所有人不可删 |
| 5 | `net.trustSystemCa`：`on`（读 Windows 证书库）/ `off`（默认，仅内置 bundle） | 开关 + 风险说明（开启 = 同时信任加速器假根，MITM 面扩大） | 布尔 | 回落 off | **必须启动前** → launcher 设 `NODE_USE_SYSTEM_CA=1`，页面标注"重启后生效" | 她不可改 |
| 6 | `net.extraCaFile` | 路径选择器 + "导入"按钮（把指定 PEM 复制到应用私有 CA 目录再引用，防路径漂移） | 文件存在且 PEM 可解析；解析失败给 OpenSSL 报错原文 | 忽略该项，维持现 store | **下次启动**（NODE_EXTRA_CA_CERTS） | 她可"导入证书文件"（改内容不改配置路径）|
| 7 | `net.strictTls`（隐式，恒 true） | **不渲染开关**，只在证书错误态显示说明 | — | — | — | 无人可关 |
| 8 | `net.marketMirrorBase` + `net.npmRegistry` | 文本框（默认 jsDelivr 系镜像与 npmmirror） | https:// 开头 + HEAD 探活按钮 | 探活失败仅警示不阻塞（回落链兜底） | 即时 | 她可改 registry（低风险）|

UI 布局照 Firefox 骨架：模式单选（三态）→ 手动 URL → 作用域 → 绕过列表 → 证书区（系统库/额外 CA/校验强度说明）→ 每泳道"诊断"按钮（GitHub/npm 各一条真实 HEAD 探针，回环网关连通性探针）。

---

## 3. 硬边界（不可配置项 + 解释）

1. **B站与本地模型网关永不走代理**：B站出境 IP = 账号风控（412 已是边缘信号）；18910 网关被代理劫持 = 宿主失联。实现在请求出口处按**目标 host** 判定（先查绕过表再查作用域），`*.bilibili.com` 与回环地址的豁免在代码常量里、不读配置，配置注入攻击面为零。
2. **不提供"关闭证书校验"开关**：VS Code `proxyStrictSSL=false`、Chromium `--ignore-certificate-errors`、npm `strict-ssl=false` 都是企业软件里的既定逃生门，但对带 cookie/登录态的 B站工具链不可接受。唯一合法信任扩展 = 显式导入一个 CA 文件（§2.6）或信任系统库（§2.5，带风险文案）。
3. **错误三分类必须分开展示**（VS Code 用不同错误码/提示把证书问题与网络问题分开，是我们该抄的诊断体验）：
   - `证书不受信`：UNABLE_TO_GET_ISSUER_CERT_LOCALLY / SELF_SIGNED / depth-zero → 建议：导入 CA 或开系统库；
   - `代理不可达`：ECONNREFUSED / ECONNRESET / ETIMEDOUT 指向 proxyUrl → 建议：检查 7897 / 换镜像；
   - `站点侧拒绝`：HTTP 40x/412/429/403 → 明确"与代理无关"，412 单独映射"B站风控，勿试代理"。

---

## 4. 实现路径（Node 24，最小改动）

- **启动前（launcher 参与，页面上标"重启生效"）**：`NODE_USE_SYSTEM_CA`、`NODE_EXTRA_CA_CERTS`、`NODE_USE_ENV_PROXY`（仅当用户选 `env` 模式；若开 env 模式，launcher 须同时保证 `NO_PROXY` 写入硬豁免列表，否则跟随环境变量会劫持网关——这正是 curl NO_PROXY 大小写/语义混乱的高发坑）。
- **运行时（即时生效，主推路径）**：请求出口 `buildDispatcher(targetUrl)` —— 命中作用域且不在绕过表 → `new ProxyAgent({ uri, proxyTls?, headers? })` 作 per-request `{ dispatcher }`；否则不传。undici 随 Node 内置，零依赖。仅 `env` 模式才允许 `setGlobalDispatcher(new EnvHttpProxyAgent())`，且文档写明副作用面是全进程 fetch。
- **子进程**：git 用 `git -c http.https://github.com.proxy=<url>` 内联（照抄 Git 官方 per-URL 先例，不写用户配置）；npm/gh 注入 `HTTPS_PROXY/npm_config_https-proxy` + `NO_PROXY=<硬豁免列表>` 到 spawn env。B站工具链 spawn env 强制删除全部 *_PROXY 变量。
- **市场索引**：代理只是可选加强——现有 jsDelivr/gh-proxy 镜像回落链已实测可用，主链路继续走镜像，代理成功后可将镜像降为兜底；两条路径共享同一个"错误三分类"归因。
- **npm 源**：切镜像 = 设 `net.npmRegistry=https://registry.npmmirror.com`，落到 spawn env `npm_config_registry`（页面上改，不写 .npmrc，符合"配置在页面上"的要求）。

## 5. 可验收判据

1. **B站永不过 7897**：起一个本地假代理监听 7898，把 `net.proxyUrl` 指它；用本地假端点冒充 B站泳道目标（host 走绕过表匹配的单测夹具 + 一条 `*.bilibili.com` 集成断言）。判据：假代理连接日志为空 + `shouldProxy('https://api.bilibili.com/...')===false` 在 off/env/manual×all 四种组合下成立（一条 vitest）。
2. **回环永不过代理**：同 1，断言 `http://127.0.0.1:18910` 直连成功且假代理零日志。
3. **关代理时镜像仍通**：`net.proxyMode=off` 下跑市场索引刷新脚本（scratch/ 手工脚本，非 CI 网络测试），断言 200 且来源为镜像域名。
4. **证书错误 vs 网络错误分类正确**：单测注入三种 fixture 错误（`UNABLE_TO_GET_ISSUER_CERT_LOCALLY`、`ECONNREFUSED`、HTTP 412），断言 UI 状态机映射到 §3.3 三个不同状态码。
5. **NODE_EXTRA_CA_CERTS 非运行时可变**：一条文档化测试：进程内改 `process.env.NODE_EXTRA_CA_CERTS` 后 fetch 自签证书本地服务器仍失败 → 证明必须重启，页面据此显示"重启生效"徽标。
6. **env 模式遵守 NO_PROXY**：spawn `NODE_USE_ENV_PROXY=1 node -e "fetch('http://127.0.0.1:PORT1')"` 且设 `HTTP_PROXY` 指向 PORT2，断言 PORT1 收到请求（不回环劫持）。
7. **git per-URL**：临时仓库 `git ls-remote` 注入 `-c http.https://github.com.proxy=...` 后用户全局配置 `git config --get http.proxy` 仍为空（证明不落盘）。

## 6. 不确定的地方

- `NODE_USE_ENV_PROXY` 对 `http_proxy` 小写/大写的精确优先级，以及 Node 24 内置 undici 版本的 `no_proxy` 匹配是否支持 `.` 前缀/端口——需在 v24.16 上跑判据 6 的变体确认，不写死结论。
- VS Code `proxySupport: bypass` 的精确语义，官方措辞（"unconfigured request options"）与流传解读（"未匹配规则的域名走系统/直连"）不一致；我们未采用该枚举，不影响实现。
- `http.proxyFallback` 的默认值与精细行为（文档获取失败，仅二手来源）。
- 全局 fetch 的 `dispatcher` 选项在 v24.16 是否稳定支持传入独立创建的 ProxyAgent（undici 版本混用有已知坑），实现前用 5 行脚本验证。
- Steamcommunity302 假根是否真装在 Windows 用户证书库（决定 `trustSystemCa=on` 能否替代导入 CA；装了则开启系统库会顺带信任该加速器的全部 MITM，风险文案必须写明）。
- Chrome/Edge 的 WPAD 细节、Firefox Bypass 是否支持通配符，只取到二手来源，规格未依赖之。

Sources:
- [Node.js CLI options (all.html, v24/v26 docs)](https://nodejs.org/api/all.html)
- [Node.js 22.21.0 changelog backport: cli --use-env-proxy (openSUSE commit notice)](https://lists.opensuse.org/archives/list/commit@lists.opensuse.org/message/MR5MMPHSIUZJV7ASRAAEJQBAXGIUYROF/)
- [nodejs/node CHANGELOG_V22: "(SEMVER-MINOR) cli: add --use-env-proxy"](https://github.com/nodejs/node/blob/main/doc/changelogs/CHANGELOG_V22.md)
- [vercel/vercel issue #17629: "--use-env-proxy / NODE_USE_ENV_PROXY (added v24.5.0)"](https://github.com/vercel/vercel/issues/17629)
- [Node.js Enterprise Network Configuration guide (NODE_USE_SYSTEM_CA, extra CAs)](https://nodejs.org/learn/http/enterprise-network-configuration)
- [Node.js 23.10.0 release: intermediate certs in --use-system-ca](https://nodejs.org/en/blog/release/v23.10.0)
- [undici ProxyAgent docs](https://undici.nodejs.org/api/ProxyAgent)
- [undici EnvHttpProxyAgent.md (no_proxy matching rules)](https://github.com/nodejs/undici/blob/main/docs/docs/api/EnvHttpProxyAgent.md)
- [undici vs built-in fetch](https://undici.nodejs.org/best-practices/undici-vs-builtin-fetch)
- [Everything curl: Proxy environment variables](https://everything.curl.dev/usingcurl/proxies/env.html)
- [curl man page](https://curl.se/docs/manpage.html)
- [VS Code Network Connections docs](https://code.visualstudio.com/docs/setup/network)
- [VS Code default settings gist (proxySupport enum + override default)](https://gist.github.com/tsinis/f9d4cef8da42ce2a7a21a10b7512222d)
- [microsoft/vscode issue #198420: "proxySupport is set to override (default)"](https://github.com/microsoft/vscode/issues/198420)
- [coder/coder discussion: VS Code http.noProxy behavior](https://github.com/coder/coder/discussions/21666)
- [Aikido: VS Code Proxy Setup (systemCertificates)](https://help.aikido.dev/ai-and-dev-tools/ide-plugins-overview/troubleshooting/ide-plugin-proxy-and-ca-settings/vs-code-proxy-setup)
- [git-config http.<url>.proxy 引文 (cnblogs 转引 man 原文)](https://www.cnblogs.com/chucklu/p/5309891.html)
- [Stack Overflow: Only use a proxy for certain git urls/domains](https://stackoverflow.com/questions/16067534/only-use-a-proxy-for-certain-git-urls-domains)
- [npm config docs v8/v9 (noproxy default = NO_PROXY env, strict-ssl default true)](https://docs.npmjs.com/cli/v8/using-npm/config)
- [pnpm .npmrc reference (https-proxy, cafile)](https://pnpm.io/10.x/npmrc)
- [Chromium net/docs proxy.md (--proxy-bypass-list 语法)](https://chromium.googlesource.com/chromium/src/+/HEAD/net/docs/proxy.md)
- [Microsoft Edge proxy support](https://learn.microsoft.com/en-us/deployedge/configure-microsoft-edge-proxy-support)
- [Mozilla: Connection settings in Firefox](https://support.mozilla.org/en-US/kb/connection-settings-firefox)
- [Docker CLI proxy docs (~/.docker/config.json proxies.default)](https://docs.docker.com/engine/cli/proxy/)
