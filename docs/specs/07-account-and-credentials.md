# 07 · 账号与凭据

> 只写成立的机制；案卷在 `docs/attic/`，不作施工依据。行数按 2026-11-07 工作区核对。
> **这份不写任何凭据值**——只写键名、路径、有无、长度是否存在。

## ① 现在是什么

一条 cookie 路，一个文件，一份现读视图。

- **单一口径**：`parseCredentials()` 认三种形状（JSON、`k=v` 扫描、整段 Cookie 头），键名白名单 `sessdata / bili_jct / buvid3`
  （`packages/cap-bilibili/src/client/bili-read.ts:84-88`、解析 `:90/:95/:101`）。
- **现读不是快照**：`liveCredentials()` 每次调用都重读文件，env 优先（`bili-read.ts:130-136`、`:145-158`）——**换 cookie 不需重启**。
- **写入只有一条**：`saveCredentials()` 逐行保留其他键、`mode: 0o600`、tmp + 带重试的改名（Windows EPERM 会把"改了没用"伪装成"没生效"，注释 `:219-220`），
  并先留一份 `.env.pre-bind-<ts>`（`:216-217`）。
- **落点**：`<部署家>/xiaoyu/.env`（路径由 `packages/cortico-world-bilibili/src/index.ts:132` 钉死为 `<botDir>/.env`）。
- **身份**：`identity.selfMid` 内存字段 + `<dataDir>/bili-connection.json`（只记 mid/uname/时间/指纹，`packages/cap-bilibili/src/index.ts:178-184`、路径 `:186-188`）。
- 这一面板是目前**唯一一处"操作面做对了"的样板**，②③④ 都在照着它对齐（见 10）。

## ② 真值在哪

| 参数 | 定义与执行点 | 配置键 | 面板控件 |
|---|---|---|---|
| `sessdata` | `bili-read.ts:84`（白名单第一项）；现读 `:130-136` | 无 config 键，值在 `.env` | 连接页粘贴框（`packages/cap-bilibili/src/webui/client.ts:858-859`）→ `bindCookie`（`packages/cap-bilibili/src/index.ts:1351-1428`） |
| `bili_jct` / `buvid3` | `bili-read.ts:85-87` | 同上 | 三字段分栏同样可填（`index.ts:1369-1375`） |
| `credentialsFile` | `packages/cortico-world-bilibili/src/index.ts:132` | **无键**（硬编码 `<botDir>/.env`） | 无 → 只能改文件 |
| `ownerMid` | 同上 `:126`，`create()` 里一次性求值（`:125-127`） | `worlds.bili-account.identity.ownerMid`（部署实值存在） | 无写入口径 → 改文件后**需重启** |
| `selfMidHint` | 同上 `:127` | `identity.selfMid` | 同上 |
| `allowUnverified` | `packages/cap-bilibili/src/index.ts:1394`（不勾就验不过不写） | 无 | 勾选框 `webui/client.ts:860` |
| `listen.*`（节奏） | `packages/cortico-world-bilibili/src/index.ts:141` 惰性 `listenConfig()` | `worlds.bili-account.listen.*` | 收件箱/设置页（见 05），**不需重启** |
| 身份指纹 | `bili-read.ts:160-173`（只给 sha1 前 6 位，不给长度与值） | — | 页面回显 `webui/client.ts:842-845` |

## ③ 失败与边界

- **先验后写**：`index.ts:1380-1400`——校验走 `checkLogin()`（`bili-read.ts:335-339`，唯一入口 `web-interface/nav`），
  **验不过直接 return，一个字节不落**；网络不通也算"没验通"而不是"失败"（`index.ts:1334-1338`、`:1346-1347`）。
  边界：明勾 `allowUnverified` 才允许离线照存，且记录里永久留 `verified:false`（`index.ts:1394`、`:1414`）。
- **没解析出 SESSDATA 就不敲 B 站**：`index.ts:1377-1379`（回归锁：`packages/cap-bilibili/tests/bili-connection.test.mjs:156-162` 断言 `seen.length === 0`）。
- **cookie 失效说人话**：`-101` → "重抄 cookie"（`packages/cap-bilibili/src/client/bili-write.ts:81`）；账号级挂起（401/`12015`/`-105`）单独成类并要求人工登录
  （`packages/cap-bilibili/src/platform/traffic.mjs:160-161`、`:172`）。
- **412**：写侧熔断 30 分钟 + 原因落账（`domain/write-gate.ts:636-643`），解除需 `confirm`（`index.ts:1285-1290`）。
- **监听连败**：倍增到 15 分钟封顶并写 `sourceFails`（`packages/cap-bilibili/src/domain/inbox-listener.ts:211-213`、`:231-233`、`:250-256`），面板 `listenStatus()` 可见（`index.ts:505-507`）。
- **身份账写不上不许把成功绑定报成失败**：`index.ts:214-219`（这条曾经用空 catch 吞掉一轮 ReferenceError，现在必须留痕）。
- **降级不留白**：探不到 nav 时回"上一次账 + stale 标记"（`index.ts:1345-1347`），而不是空白页。

## ④ 操作面

面板（`connection`，`packages/cap-bilibili/src/index.ts:1319`）：体检（`get`，`:1324-1350`）、绑定（`bindCookie`，`:1351-1428`，服务端强制 `confirm:true` `:1364-1366`）、
解绑（`unbindCookie`，`:1429-1450`，同样强制确认；空串即删键 `:1440` → `bili-read.ts:200-203`）、换号当场明示（`changedAccount`/`previous`，`index.ts:1408`、`:1423-1425`）。
**只有 cookie 粘贴一条路**：全仓无扫码/QR 登录实现（`grep -rn "qrcode\|auth_code\|扫码" packages core` → 0）。
**只能改文件**：`credentialsFile` 路径本身、`ownerMid`（换主人，需重启）、`worlds.bili-account.listen.*` 之外的 identity 键、
`worlds.qq.token/wsUrl/groups/privates`（本仓无 QQ 能力包，宿主实现未找到）、宿主模型 key（在 `<部署家>/providers/<name>/.env`，与她的 B 站 cookie 物理分离）。

## ⑤ 已知缺陷与验证方式

1. **同一件事两套口径并存**：新面板先验后写（`packages/cap-bilibili/src/index.ts:1380-1401`），
   旧 HTTP 面 `core/api/routes.js:123-128` **先写后验**（`:145` 的返回值自己承认"已写入，但 B 站不认这个 cookie"）。
   旧面还在仓里、还能被本机免口令端口打到。复现：`sed -n '123,128p' core/api/routes.js`。
2. **新旧两家凭据文件分裂**：新 `<部署家>/xiaoyu/.env`（`packages/cortico-world-bilibili/src/index.ts:132`）vs 旧 `~/.bili-ai/credentials.json`
   （`tools/lib/credentials/bilibili.mjs:3-4`）；`scripts/preflight.mjs:43-46` 仍读旧家并据此报"B 站凭据缺失"。
   复现：`grep -n "credentialsPath" scripts/preflight.mjs tools/lib/credentials/bilibili.mjs` ＋ 离线落点账 `node scripts/audit-state-locations.mjs`。
3. **`.env.pre-bind-*` 是明文滚动备份**：每次换 cookie 都留一份含旧凭据全值的文件（`bili-read.ts:216-217`），
   它们**不在 git**（`.gitignore:28` 的 `.env.*` 命中，实测 `git check-ignore -v .env.pre-bind-1` 有输出），但**在盘上无人清理**。
   复现：`ls ~/.xiaoyu-home/xiaoyu/.env*`；`git check-ignore -v .env.pre-bind-1`。
4. **备份的第二道闸拦不住 `.env`**：`SENSITIVE = /(credentials|token|secret|cookie)|\.(key|pem)$/i`（`scripts/ops-backup.mjs:29`）不匹配 `.env`；
   今天安全只因为白名单源里根本没列 `<botDir>/.env`（`ops-backup.mjs:51-90`）——**侥幸，不是防线**。
   复现：`grep -n "SENSITIVE = " scripts/ops-backup.mjs`（看那条正则里没有 `env`）＋ `grep -n "botDir" scripts/ops-backup.mjs`（白名单源里没有 `.env`）。
5. **`ownerMid` 改后要重启**：`create()` 一次性求值（`packages/cortico-world-bilibili/src/index.ts:125-127`），
   而同文件 `:141` 的 `listenConfig` 是惰性函数——同一面板里一半热一半冷，界面上没写。
   复现：`grep -n "ownerMid\|listenConfig" packages/cortico-world-bilibili/src/index.ts | head -6`。
6. **身份账没补齐时是"明说跳过"，不是"静默降级"**：私信监听整路跳过并写明原因（`packages/cap-bilibili/src/domain/inbox-listener.ts:221-224`）、
   `ownerMid` 缺 → 记一条 `sourceFail`（`packages/cap-bilibili/src/client/bili-inbox.ts:191-192`）、"只认主人"退化成拿空串比对（`inbox-listener.ts:270-273`）。
   复现：`grep -rn "selfMid" packages/cap-bilibili/src/domain/inbox-listener.ts`。
7. **部署里没有 `bili-connection.json`**：说明新面板的 `bindCookie` 从未在这台机器上跑过，身份全靠 config + 旧配置桥
   （`packages/cortico-world-bilibili/src/legacy-identity.ts:29-56`）。复现：`node -e "const fs=require('fs'),os=require('os'),p=require('path');const f=p.join(os.homedir(),'.xiaoyu-home','xiaoyu','data','bilibili','bili-connection.json');console.log(fs.existsSync(f)?'在':'不在：'+f)"`。
8. **"不许把凭据提交进仓"没有门禁**，只有 `.gitignore` 与人工纪律：全仓 `scripts/` 里没有任何秘密扫描器（实测 `ls scripts | grep -ci secret` → 0）。
   身份账 `data/bilibili/bili-connection.json` 也不在 ignore 覆盖内（内容只 mid/uname/sha1 前 6 位，`index.ts:178-184`）——今天无凭据值，
   但"谁往里加一个 cookie 字段"没人拦。复现：`git ls-files | grep -Ei "env|credential|token" | wc -l`（应为 0）＋ `node scripts/check-doc-hygiene.mjs`（本仓唯一会因"声明了没人读"变红的门禁，秘密面尚无对应项）。
9. **探针纪律是这条链上唯一拦住误诊的地方**：`listenAutoStart` 与凭据同时满足才敲 nav（`packages/cap-bilibili/src/index.ts:469-486`，条件 `:472`）。
   复现：`node --test packages/cap-bilibili/tests/bili-connection.test.mjs`（含"没凭据零次网络"断言）。
