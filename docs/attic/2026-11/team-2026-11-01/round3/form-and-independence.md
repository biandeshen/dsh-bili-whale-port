# 形态与独立性（round3 · 2026-11-01）

调研方法：只读 `E:/WorkSpace_Qoder/dsh-bili-whale`（下称 **whale 仓**）与 `E:/WorkSpace_Qoder/Cortico`（下称 **Cortico**）源码 + 磁盘现状。未发起任何 B 站请求，未跑 `dm --status`，未改代码。

## 结论（对应四问）

1. **不再靠 DSH 的养鱼插件运行**：78 处 `DSH` 字样里，**0 处是对 DSH 应用本身的运行时调用**；真正的耦合是三条硬链接 —— ①数据默认落在 `~/.dsh/`（DSH 的 home 目录树里），②标识符 `DSH_HOME` 被 35 个文件 import，③Cortico 世界页的数据面直接动态 import whale 仓 5 个文件。插件时代的安装件（`cordis.patch.yml` + `package.json` 的 `dsh` 块 + `core/index.js`/`core/client.js` 这套 DSH adapter）已是死代码，只有测试还在 import。
2. **功能已基本迁到控制台**：7799 世界页 `world:bili-account` 声明了 7 个面板（鱼缸/待审稿/她的一天/日记/意见箱/规矩/体征），把 8447 面板的时间线·审批·意见箱·体征·日记全部覆盖。没迁过来的只有四类：**序列帧动画**（只在 `panel/views/tank.html:228-251`）、**go-gate 私信待审队列**（只在 `/api/pending`，读 `~/.bili-ai/pending-replies.json`，`core/api/routes.js:195`）、**主动通知**（`notify.type` 默认 `none`，原 DSH 桌面通知通道已断）、**桌面宠物常驻窗**（需原生置顶透明窗，浏览器 WebUI 做不到）。**Live2D 全仓无实现代码**，它只出现在兴趣标签里，卡点是素材许可不是宿主。
3. **形态 = 两个本地目录 + 一个进程**，whale 仓自身**零 npm 依赖**、可独立跑 CLI 与全部测试。它**已经不依赖 DSH 桌面端**；对 Cortico 的依赖是"借它的 WebUI 和调度宿主"，且 fork 只配了 `origin = biandeshen/Cortico-local`（无 upstream remote，不从上游拉补丁，代价是自己维护 World 的 in-tree 改动）。**现在就能独立**到"换机器 6 步起得来"；**要动代码才能独立**到"交付一个安装包"。
4. **扩展市场当前是坏的（离线不可用），但不是框架缺陷**：官方索引默认打 `raw.githubusercontent.com/Pal-AI-Lab/cortico-extensions/main`，本机 GitHub 直连不通、Clash MITM 的自签签发链不在 Node 的信任根里 → `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`（属本机网络层证书信任问题；Cortico 源码里没有 `NODE_EXTRA_CA_CERTS`/自定义 agent 的处理）。失败不致命：读不到就用进程上次结果与缓存文件。**本地扩展可以装**（`link:` 本机目录，不查 npm），`pnpm check:extension` 可用；我们自己的 bili-account 是 **in-tree World，不是扩展形态**，`extensions/package.json` 的 dependencies 是空的。

---

## Q1 · 78 处 DSH 引用的分类

`grep -rn "DSH" tools/ scripts/ --include=*.mjs` = **78 行 / 35 个文件**（不是 70 处）。按文件行数降序：`tools/lib/paths.mjs:11`、`scripts/c2-window.mjs:7`、`tools/commands/selftest.mjs:5`、`tools/video-build.mjs:4`、`tools/commands/deps.mjs:4`、`scripts/observation-day.mjs:4`、`scripts/action-watch.mjs:4`、`tools/lib/runtime.mjs:3`、`scripts/wake-audit.mjs:3`，其余 26 个文件各 1–2 行。

| 类 | 数量 | 样本 file:line | 删/改的后果 |
|---|---|---|---|
| **① 真运行时依赖**（删了就跑不起来） | 3 组 | `tools/lib/paths.mjs:23` `resolveWhaleHome` 的默认档 `~/.dsh`；`tools/media/video/studio.mjs:8-10` import `vendor/dsh-video-studio/{render,cover,ffmpeg}.js`；**跨仓**：`Cortico/src/worlds/bili-account/tank.ts:48-52` 动态 import `panel/data.js`、`panel/drafts.mjs`、`panel/feedback.mjs`、`scripts/dynamic-approve.mjs`、`tools/lib/traffic.mjs` | 第一条断了找不到现有配置/日记/草稿；第二条出片不可用；第三条世界页五块面板各自降级为"读不到"（`tank.ts:44` 是 `catch {}` 单能力降级） |
| **② 命名/环境变量遗产**（改名行为不变） | ≈ 45 行 | `DSH_HOME` 导出名被 35 文件 import（`tools/lib/nodebin.mjs:1`、`night-config.mjs:3`、`video-build.mjs:12`、`dm-send-core.mjs:19`、`credentials/mimo.mjs:14`、`scripts/ops-day.mjs:14` 甚至写成 `DSH_HOME as WHALE_HOME`）；`dshPath()`（`paths.mjs:41`，注释自己说"历史名"）；`runtime.mjs:26` 的 `DSH_NODE`/`DSH_DESKTOP_NODE_EXECUTABLE` 候选（`WHALE_NODE` 已优先）；面向人的文案 `deps.mjs:81,138`「重启 DSH」、`runtime.mjs:42`、`core/scheduler.js:201`、`core/node-runtime.js:6` | 纯改名：`WHALE_HOME` 语义已就位，`WHALE_HOME → DSH_HOME` 双读一版；文案改成"重启控制台/宿主"。**风险在跨仓**：Cortico 也硬写同一优先级链两处 —— `definition.ts:29` 与 `tank.ts:19`（注释 `paths.mjs:resolveWhaleHome` 一致，少一档两边读不同 home） |
| **③ 死代码 / 插件时代配置键** | ≈ 20 行 + 5 个文件 | 安装件：`cordis.patch.yml`（1–20 行整份是 DSH bundle 挂载声明，含 `dsh plugin --profile desktop add "link:..."`）、`package.json:59-67` 的 `"dsh": { bundle.patch, client.inject }`。宿主 adapter：`core/index.js:3` 「信任栅栏：DSH 专用」、`core/client.js:2` 「DSH『设置』里的养鱼 section」——现在**只有 `tests/helpers/plugin.mjs:20` 还 import 它**。配置键：`tools/lib/config.mjs:27-28` `sessionRotateDays: 0` / `personaOncePerSession: false`、`:54` `night.windows`。注释里的历史：`notify.mjs:202`（DSH Windows 沙箱管道 EPERM）、`feed.mjs:28`、`ai-share.mjs:57`「样本尚未由 DSH 模型评估」 | 删除即可，运行时无人调用；`core/index.js`/`core/client.js` 的测试（`tests/helpers/plugin.mjs`）要一起收。注意 `D:/AI/养鱼` 的 legacy 路径（`paths.mjs:52-53`、`MODULARITY` 第 11 条）不是 DSH 遗产，是换机器装不上的独立问题 |
| **④ vendor 第三方核心** | 2 个模块 / 21 文件 | `vendor/dsh-autocut`（源 `lolistlisa/dsh-autocut@0.3.0`，**MIT**，取 `lib/` 15 文件，明确"零 DSH 宿主依赖、零 npm 依赖"，唯一宿主入口 `index.js`（`@deepseek-ai/dsh-tools`）**未取**；状态：**未接线**）；`vendor/dsh-video-studio`（源 npm `litao36253/dsh-video-studio@0.4.3`，**MIT**，取核心 6 文件，tarball sha256 已记；状态：V1 smoke 通过、经 `tools/media/video/studio.mjs` 适配层在用） | 名字里的 `dsh` 是上游作者自己的命名，与 DSH 宿主无关；许可上 MIT 允许商用与再分发，只需保留 LICENSE/版权。可替换性已有边界：`studio.mjs` 头注释写明"换渲染器只改这个文件"。完整性由 `tests/vendor-{autocut,video-studio}.test.mjs` 对 `SHA256SUMS` 校验 |

### 要独立需要动的最小清单（Q1）

1. `paths.mjs:23` 默认档 `~/.dsh` → 新 home（如 `~/.whale`），保留 `DSH_HOME` 作为第三兼容档 + 一次性迁移脚本；**同时**改 `Cortico/src/worlds/bili-account/{definition.ts:29,tank.ts:19}`，两边必须同档数。
2. `DSH_HOME` 导出改名 `WHALE_HOME`（35 文件机械改名），`dshPath()` 改名；`runtime.mjs` 删 `DSH_DESKTOP_NODE_EXECUTABLE` 候选前先确认没有用户环境里只有它。
3. 删 `cordis.patch.yml`、`package.json` 的 `dsh` 块、`core/index.js`/`core/client.js` 与 `tests/helpers/plugin.mjs`（连同 `files` 里的打包项）。
4. 删 `config.mjs` 的 `sessionRotateDays`/`personaOncePerSession`/`night.windows` 与 `clock.enabled` —— 先确认 `~/.dsh/bili-whale.config.json` 里旧键写入不会因缺 schema 报错。
5. 把 `tank.ts` 依赖的 5 个 whale 文件收成一个显式契约（`whale-data` 的 `exports` 子路径），而不是靠绝对路径 `BILI_WHALE_ROOT` 拼相对路径。
6. vendor 的两个 `VENDOR.md` 状态行改写（"未接线"→接线后），并把 MIT 版权汇总进 `docs/CREDITS.md`。

---

## Q2 · 功能迁移现状

控制台已覆盖的（证据：`Cortico/src/worlds/bili-account/webui/client.ts:402-411` 声明 7 个 panel；数据面 `tank.ts:48-52`；聚合决策见 `definition.ts:351-353` 与 `docs/CURRENT.md:32`）：

| 面板 | 来源（8447 时代） | 现在的读法 |
|---|---|---|
| `tank` 鱼缸（心情 + 六场值 + 头像） | `panel/views/tank.html` | `invokeBinary('avatar')` 拿单张静态 `avatar.png`（`client.ts:69-78`），场值本地直读 |
| `drafts` 待审稿（✓放行 / ✗拒掉，二次确认） | `panel/drafts.mjs` + `dynamic-approve.mjs` | 同一份模块；审批令牌/kill/绑定保留 |
| `timeline` 她的一天 | `panel/data.js` 读 `whale-log.jsonl` | 改读 `causal.jsonl`（`whale-log.jsonl` 最后一条停在 2026-10-25，`MODULARITY:38`） |
| `diary` 日记双本（公开/私人） | `panel/data.js` | 同一函数 |
| `feedback` 意见箱（resolve） | `panel/feedback.mjs` | 折叠规则归 whale 模块，计数在 Cortico 侧（`tank.ts:19-20` 注释就是为这个不自洽写的） |
| `policy` 选片规矩 | 无（新） | — |
| `vitals` 体征（额度/今日计数/积压） | `panel/server.js:111` `/api/vitals` | 同一份 `vitals()` |
| `ops:day` 日报 | CLI | `npm run ops:day`（`package.json:25`） |

仍在旧形态、控制台没有的：

| 能力 | 只存在于 | 迁不过来的原因 |
|---|---|---|
| **序列帧游泳动画**（vlln/whale-girl 图形，CC BY-NC-SA 4.0，署名 ZipZipPipe/上善无形） | `panel/views/tank.html:228-251`（`backgroundPosition` 逐帧播放器 + `@keyframes swim/sway`）| **没有技术障碍**，是 25 行 CSS/JS 未搬；Cortico 面板只放了一张静态图 |
| **Live2D** | 全仓无代码 | 唯一证据是兴趣标签 `core/api/support.js:32` 与 `config.mjs:37` 的 `like: [... 'Live2D/模型']`。卡点是素材授权（溟月 CC BY-NC-SA 对 Live2D 有额外限制）+ 需要引入 `pixi-live2d-display` 运行时，**与宿主无关**（WebUI 本身就是浏览器页，技术上能跑） |
| **桌面宠物 / 常驻置顶透明窗 / 托盘** | DSH 桌面端（2026-10-25 已放弃） | **真障碍**：WebUI 是浏览器标签页，做不了 always-on-top 无边框透明窗与系统托盘；要这条得自带原生壳（Electron/Tauri）或系统级 PWA |
| **主动通知**（她醒了/出稿了叫你） | DSH 桌面通知；`notify.type` 现默认 `none`（`config.mjs:40`，`MODULARITY:41` 已记为体验根因） | 通道要重选：Windows Toast / 邮件 / IM 都行，但不再有宿主白送的通知 API |
| **go-gate 私信待审队列** | `/api/pending`（`core/api/routes.js:195`、`panel/data.js:51`，读 `~/.bili-ai/pending-replies.json`）；审批走 `scripts/dm-approve.mjs`/`dynamic-approve.mjs` | 7 个面板里没有 pending-replies 页签；**审批必须留 CLI 一次性令牌**（`MODULARITY:13`：插件化审批 = 给注入者开后门），所以这是"故意只读不迁交互"，不是漏迁 |
| **25 字段设置页** | `core/client.js:2-6`（注释自己说这份独立页面被 DSH 信任栅栏挡着打不开） | 那份页面当年就没在用；配置面现在是 Cortico `worlds.bili-account` 配置组 + `bili-whale.config.json` 单一事实源（`tank.ts:124`） |

---

## Q3 · 当前形态事实表

| 维度 | 事实 | 证据 |
|---|---|---|
| 进程 | 一个 detached Node 进程 `node bin/cortico.mjs mybot --port=7799`，由 whale 仓的启动器拉起，pid 落 `control/`，日志 `control/cortico.log`，起不来时先探 7799 再改发 `/api/run/resume` | `scripts/start-cortico.mjs:15,23,26,56`；入口 `start-cortico.cmd` |
| Node 运行时 | win32 硬编 `C:/Program Files/nodejs/node.exe`（非 win32 用 `process.execPath`） | `start-cortico.mjs:17` |
| 目录 | `E:/WorkSpace_Qoder/Cortico`（fork，master）+ `E:/WorkSpace_Qoder/dsh-bili-whale`（whale 仓）；两边靠绝对路径拼接，可被 `BILI_WHALE_ROOT` 覆盖 | `definition.ts:25`、`tank.ts:16` |
| 依赖 | whale 仓 `dependencies`/`devDependencies` **均为空**、无 lockfile、无 CI；Cortico 是 pnpm workspace（`packageManager pnpm@11.28.6`）；`extensions/package.json` dependencies **为空 = 一个扩展都没装** | `package.json:14-34,59-68`、`extensions/package.json` |
| 端口 | 7799 Cortico WebUI（只绑 127.0.0.1，**免口令**，故有 446/445 行注释警告任何本地进程能 POST 改策略）；8447 旧面板（未监听，提权僵尸进程杀不掉）；8448 临时面板已退役；18910 OFM 网关代理 | `definition.ts:175,445`；`docs/CURRENT.md:32`；`panel/server.js:33` |
| 凭据 | B 站 cookie（SESSDATA）在 `~/.bili-ai/credentials.json`（按 OS 用户，不随 whale home 漂移）；MiMo key 在 `<WHALE_HOME>/bili-whale/credentials/mimo.json`；面板 token `<WHALE_HOME>/panel.token`；LLM key 在 Cortico 部署 `.env` | `paths.mjs:45`、`credentials/mimo.mjs:20`、`cred.mjs:24` |
| 数据 | `~/.dsh/` 里既有 DSH 自己的 `profiles/sessions/storages/dsh-runtimes/plugin-backups/channel-pack`，也有她的 `bili-whale/`、`bili-whale.config.json`、`whale-diary*.md`、`avatar.png`、`panel.token`；另有 `~/.bili-ai/` 与 legacy `D:/AI/养鱼/{drafts,assets/daily}`（存在才用） | 磁盘 `ls ~/.dsh` 实测；`paths.mjs:52-53,56-70` |
| 验收 | `npm test`（266/266，见 `docs/CURRENT.md:34`）；`npm run gates` 连 Cortico 的 tsx 测试一起跑 + `check-consumers.mjs` + `check-hashes.mjs` 冻结哈希 | `package.json:15-18` |

**独立性判定**

- **不依赖 DSH 桌面端 = 已经是**。运行时路径里没有任何 DSH API 调用；`core/index.js`/`core/client.js` 这两个 DSH adapter 只被测试 import。剩下的只是 home 目录寄生（`~/.dsh`）与命名。
- **不依赖 Cortico 上游 = 事实已分叉**。`git remote -v` 只有 `origin https://github.com/biandeshen/Cortico-local.git`，无 `upstream` → 当前不从上游拉补丁。代价：World 是 in-tree（`src/worlds/index.ts` 的 `EXPORTS` 里 `'bili-account': 'BILI_ACCOUNT'`），将来想吃上游改动要把自己那 8 个文件 rebase 上去；反过来，in-tree 也让世界页能直接用 `src/web/shared/client-panel.ts` 私有接口，扩展形态做不到这么多。
- **换一台机器**（现状，6 步）：①装 Node 22+ 与 git；②`git clone` 两个仓到同级；③Cortico 里 `pnpm install` + `pnpm build:web`；④写 `WHALE_HOME`（或先建 home 并拷 `bili-whale.config.json`/日记/`~/.bili-ai/credentials.json`）；⑤`deployments/mybot/` 的 `.env` 填 provider key、`worlds.bili-account.enabled: true`；⑥`node scripts/start-cortico.mjs`（或改 `start-cortico.cmd`/`start-cortico.mjs:15,17` 里的两个绝对路径）。不做第 ④⑥ 步就会读到空 home 或起不来。
- **只交付一个可安装包 = 现在不行**。要动代码：把 bili-account World 抽成 `cortico-world-bili-account` 扩展（用 `webUiClient: dist/webui.js` 预构建面板 bundle），whale 仓发成 npm 包或作为 `link:` 目录随包，再把 `D:/AI/养鱼`、`~/.dsh`、`C:/Program Files/nodejs` 三类绝对路径全部改成可配置。

---

## Q4 · 扩展市场能不能用

| 项 | 事实 | 证据 |
|---|---|---|
| 官方索引 URL | `https://raw.githubusercontent.com/Pal-AI-Lab/cortico-extensions/main` 下的 `index.json`/`catalog.json`/`packages/<包名>.json`；raw 失败再问 `https://api.github.com/repos/Pal-AI-Lab/cortico-extensions/contents`；讨论区/评分走 `api.github.com/graphql`，登录走 device code | `market.ts:31-34,636,384,458`；`docs/extensions.md:76`；`src/extensions/README.md:105` |
| 读不到的后果 | **不阻塞**：`loadCatalog()` catch → `log.warn('官方索引的 catalog.json 读取失败')` → 用本进程上次值或 `<home>/market-catalog.json`；都没有就不补 Action 汇总字段。`index.json` 同理（`market-index.json`），只影响拉黑名单与合并搜索。错误文案带主机名 + undici `cause` 错误码 | `market.ts:39-44,519-536`；`extensions.ts:53,419`；`docs/extensions.md:53` |
| 装扩展怎么走 | `loadExtensions(repoRoot)` 读 `extensions/package.json` 的 dependencies，逐个从 `extensions/node_modules/<包>/` 按 `exports → module → main → index.js` import；目录可换 `CORTICO_EXTENSIONS_DIR`；`extensions/` 不进版本控制；manifest 的 `cortico.api` 与 `EXTENSION_API_VERSIONS[kind]` 不等就不加载 | `src/extensions/README.md`「装载」；`extensions.ts:97,252`；`docs/extensions.md:10,44` |
| 本地/离线安装 | **支持**：WebUI「扩展」页可把**本机目录以 `link:` 方式**装入，改源码重启生效，且 `link:` 不查 npm；装前调 `POST /api/extensions/check` 只读 manifest。npm 路线也能走镜像：扩展页「npm 源」读写 `extensions/.npmrc` 的 `registry=`（只收 http(s)） | `docs/extensions.md:13-18,53,55-61`；`web/server.ts:159,2087` |
| `pnpm check:extension` | 可用：`scripts/extension-check.ts` 存在，`package.json:27` 挂了脚本；用 `dry-mount.ts` 在假部署里调 `create()/tools()/webUi()`（不调 `start()`），报告只有英文，工具重名会写出占用者；标签词表读索引失败**只提示、不计入失败**；对上一版契约判失败 | `package.json:27`；`src/extensions/README.md:9-13`；`docs/extensions.md`「自描述」 |
| 我们自己是扩展吗 | **不是**，bili-account 是 in-tree 内建 World；`extensions/` 磁盘上只有 `package.json`（dependencies 空）与 `pnpm-workspace.yaml`，没有 `node_modules` → 从未装过任何扩展 | `src/worlds/index.ts:15-22`；`ls extensions` |

**离线环境可行做法（按可靠度）**：① `link:` 本机目录装扩展 —— 完全不碰 npm 与 GitHub；② 索引镜像：在扩展页「索引源」或 `CORTICO_MARKET_INDEX_BASE` 指到局域网一个 http 服务，目录结构同 raw 仓（`index.json`/`catalog.json`/`packages/*.json`）—— 校验只收 http(s)，写成 `file://` 会 400，所以必须起个小 HTTP 服务；③ 预热缓存文件 `market-index.json`/`market-catalog.json` 放进部署 home，断网时页面仍显示上次索引，只是 `stale`；④ 装第三方包走国内 npm 镜像（扩展页「npm 源」写 `extensions/.npmrc`）。

**证书问题根因（不含糊）**：`UNABLE_TO_GET_ISSUER_CERT_LOCALLY` 是 Node/undici 在做 TLS 证书链校验时，链上签发者不在它的信任根集合里且本地补不到。本机 GitHub 直连不通（502），流量经 Clash `127.0.0.1:7897` 做 HTTPS MITM 替换证书，替换证书由 Clash 自签 CA 签发，而这个 CA 既没进 Windows 受信任根、也没通过 `NODE_EXTRA_CA_CERTS` 交给 Node —— grep 全仓 `src/` 确认框架代码里 **0 处** `NODE_EXTRA_CA_CERTS` 或自定义 agent/undici dispatcher。所以这是**本机网络层与代理证书信任的配置问题，不是 Cortico 的缺陷**；框架的表现只是"读不到就退回缓存并记一条 warn"。修法二选一：把 Clash 的根 CA 装进系统受信任根并给 Node 设 `NODE_EXTRA_CA_CERTS=<ca.pem>`，或给 Cortico 进程设 `HTTPS_PROXY=http://127.0.0.1:7897`（Node 需 24+ 或 undici `EnvHttpProxyAgent`，否则得让 Clash 走透明/系统代理）。**不推荐**关证书校验（`NODE_TLS_REJECT_UNAUTHORIZED=0`）：扩展包内容从此可被中间人任意替换。

---

## 要更独立需要做的 6 件事（按代价/收益排序）

| # | 做什么 | 代价 | 收益 |
|---|---|---|---|
| 1 | 删插件时代死件：`cordis.patch.yml`、`package.json` 的 `dsh` 块与 `files` 里的对应项、`core/index.js`+`core/client.js`+`tests/helpers/plugin.mjs`、`config.mjs` 的 `sessionRotateDays`/`personaOncePerSession`/`night.windows`/`clock.enabled` | 低：一次 `refactor` 提交 + 收测试；不改行为 | 立刻摘掉"我们还挂着 DSH 插件"的事实依据；包体积与心智负担下降 |
| 2 | 文案与命名解耦：`deps.mjs`「重启 DSH」等面向人的字符串、`dshPath()`、`DSH_HOME` 导出改名 `WHALE_HOME`（35 文件）| 低-中：机械改名，跨仓要同步 `definition.ts:29`/`tank.ts:19` 的优先级档数，并留 `DSH_HOME` 兼容档 | 消除"两边 home 语义分叉"这一类反复出现的 bug 源（issue #27 就是这个） |
| 3 | 把跨仓隐式依赖写成显式契约：whale 仓 `package.json` 加 `exports`（`./panel-data`、`./feedback`、`./approve`、`./traffic`），Cortico 侧只从这些子路径 import，去掉拼相对路径 | 中：两边各改一次 + 补一层 contract 测试 | 换机器/分发时不再"少一个目录世界页就红"；也让"抽成扩展"变成可选项 |
| 4 | 数据 home 迁出 `~/.dsh`：默认 `<HOME>/.whale`，一次性迁移脚本（默认 dry-run，先备份）；同步清掉 `D:/AI/养鱼` 与 `C:/Program Files/nodejs/node.exe` 硬编码 | 中：迁移脚本 + `MODULARITY` 第 11 条已列的 P0；`scripts/hashes.json` 冻结的 4 个验收脚本内联 legacy 逻辑要一起重冻 | 真正"干净机器可装"，也是发安装包的前置 |
| 5 | 通知与序列帧补齐体验：把 `panel/views/tank.html:228-251` 的逐帧播放器搬进 `webui/client.ts` 的 `tank` 面板；`notify.type` 选一条不依赖宿主的通道（Windows Toast 起步）| 中：前端 25 行 + 一个通知 provider；图形要保留 CC BY-NC-SA 署名 | 去掉最后两项"只有旧面板才有"的体验落差，`panel/` 才真能归档 |
| 6 | 把 bili-account World 抽成 `cortico-world-bili-account` 扩展（`webUiClient: dist/webui.js`），或反向下决心上游补丁策略：给 fork 加 `upstream` remote 并把 World 改动做成一组可 rebase 的提交 | 高：扩展形态受 `api` 版本闸门约束、面板要用公开 `WebUiPanelContext`；加 remote 要持续 rebase | 上游能吃补丁、或整个能力可随 npm 分发 —— 只有到这一步才谈"一个安装包" |

## 不建议做的事

- **重写 vendor**。两个模块都是 MIT、零依赖、`SHA256SUMS` 有测试锁；`dsh-autocut` 明确"未接线"，`dsh-video-studio` 已被 `tools/media/video/studio.mjs` 适配层包住（换渲染器只改适配层）。重写换来的只是名字里没有 `dsh`，而名字与宿主无关（宿主入口 `index.js` 当初就没 vendor）。
- **引第二宿主**（为了桌面宠物再拉一个 Electron/Tauri）。会出现两个 WebUI/两套凭据边界，7799 免口令回环这条安全前提（`definition.ts:445`）就得在第二个宿主里重新证明；且 `MODULARITY` §0 的三条硬边界（单时钟 `:12`、审批单点 `:13`、冻结哈希 `:14`）在新宿主里要重建。
- **把 `worlds.bili-account` 从 in-tree 改成扩展只为"看起来独立"**。in-tree 才允许它直接用 `src/web/shared/client-panel.ts` 与部署内预热；扩展形态的 `api` 闸门会让本地 World 每次契约 bump 都卡住加载。等第 6 件真有分发需求再做。
- **为绕证书关掉 TLS 校验**。等于把扩展包完整性交给网络路径；`link:`/镜像源两条离线路已经够用。
- **观测期改码**。`vendor/dsh-autocut/VENDOR.md` 与 `docs/CURRENT.md` 都记着"2026-10-30 起观测期禁改码"；上面 6 件事的动手时机应排在 14 天观测结束、`scripts/hashes.json` 重冻之后。
