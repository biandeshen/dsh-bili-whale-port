# 01 · 架构裁决席（2026-11-03）

> 只读研究，未改任何代码。所有结论带 `file:line`；证据不足的写「未证实」。
> 证据源：`Cortico-up/docs/extensions.md`、`Cortico-up/templates/extension/**`、`Cortico-up/src/extensions.ts`、
> `Cortico-up/src/extensions/manifest.ts`、`Cortico-up/src/extensions/runtime.ts`、`Cortico-up/src/world.ts`、
> `Cortico-up/src/core/types.ts`、`Cortico-up/src/bot.ts`、`Cortico-up/src/launcher.ts`、
> `Cortico-up/scripts/{extension-check,extension-describe,publish-package,build-web}.ts`、
> `Cortico-up/src/web/server.ts`、本机已装的 `Cortico/extensions/node_modules/cortico-world-figure/package.json`。
> 冲突双方：`docs/ARCHITECTURE-DECOUPLING-2026-11-01.md` §9.2（另一席）与 `docs/ARCHITECTURE-TARGET-2026-11-03.md`（本席）。

---

## 0. 裁决摘要

| 冲突点 | 裁决 |
|---|---|
| 扩展粒度 | **域**。B 站整个域 = 1 个 world 扩展包；收件箱是**包内模块**，不是独立扩展 |
| §9.2「互动感知独立成一个单元」 | **对，但「独立」一词须改写**：独立 = 包内模块 + 依赖方向单向，不是独立 npm 包 |
| persona-core | **独立普通包**（非 Cortico 扩展），被两个包共同依赖 |
| WebUI 页签 | World 页归 world 包；Persona 页归 bot 包 |
| 写闸门 | 归 world 包（它是 B 站写的唯一持有者） |
| TARGET §2.1/§2.2 的 api 值 | **错**：bot 契约是 **7**，不是 6；world 契约是 **6** |

---

## 1. 扩展契约的准确形状

### 1.1 package.json 必须字段

以 `templates/extension/world/package.json` 与 `templates/extension/bot/package.json` 为范本，逐条追到校验代码。

| 字段 | 值 / 要求 | 依据 |
|---|---|---|
| `type` | `"module"`，**硬要求**，非 module 直接拒装 | `src/extensions/manifest.ts:112-114`（`t.typeModule` 进 reasons）；`docs/extensions.md:188` |
| `name` | npm 合法名（`PACKAGE_NAME` 正则） | `src/extensions.ts:394`、`src/extensions.ts:1063` |
| `version` | 必需（浏览器产物 URL 带版本，缺版本浏览器会拿旧缓存） | `scripts/extension-check.ts:78` |
| `main` | 包入口；`resolveExtensionEntry` 的取值顺序是 `exports` → `module` → `main` → `index.js` | `src/extensions.ts:126-137` |
| `cortico.kind` | `"world"` / `"provider"` / `"bot"`，与默认导出的形状对应 | `src/extensions/manifest.ts:14-15, 129-133`；形状检查 `src/extensions.ts:139-164` |
| `cortico.api` | **必须等于当前契约版本**：world **6** / provider **6** / bot **7**。旧一版（world 5 / provider 5 / bot 6）经过渡层照常加载但给 warning，`check:extension` 判失败 | `src/extensions/manifest.ts:23-27, 135-147`；`src/extensions/previous-contract.ts:28-38`；`scripts/extension-check.ts:88-90` |
| `cortico.describe` | 包内相对路径，`.json`；**缺失即 `check:extension` 失败** | `src/extensions/describe-export.ts:156-159`；`src/extensions/manifest.ts:168-169` |
| `keywords` | 必须含类关键字 `cortico-world` / `cortico-bot`，缺了给 warning | `src/extensions/manifest.ts:174-179`；`templates/extension/world/package.json:7-10` |
| `files` | 必须含入口目录、`describe.json`、README、CHANGELOG | `templates/extension/world/package.json:22-27`；`templates/extension/bot/package.json:22-28`；`docs/extensions.md:264` |
| `devDependencies.cortico` | 框架源码（无入口），只给编辑器/tsc/vitest；运行时不参与 | `templates/extension/world/package.json:32-38`；`templates/extension/README.md:38-39` |
| `devDependencies` 其余 | `typescript` / `vitest` / `tsx` / `@types/node` | `templates/extension/world/package.json:32-38` |
| `dependencies` | 包真正需要的第三方库（不是 devDep） | 实例：`Cortico/extensions/node_modules/cortico-world-figure/package.json` 的 `"dependencies": { "fflate": "0.8.3" }` |
| `pnpm-workspace.yaml` | `allowBuilds: { esbuild: true }`（有构建脚本的依赖要在这里放行，否则 `pnpm install` 退出 1） | `templates/extension/world/pnpm-workspace.yaml:1-2`；`templates/extension/README.md:29-30` |
| `tsconfig.json` | `allowImportingTsExtensions` + `noEmit`，Node 侧 lib 不放 DOM | `templates/extension/world/tsconfig.json:2-19` |

可选但有实际用途的 manifest 字段：`displayName` / `icon` / `locales` / `screenshots` / `tags` / `webUiClient` / `webUiStyle`
（`src/extensions/manifest.ts:42-57`；`webUiClient`/`webUiStyle` 必须是包内 `.js`/`.mjs`/`.css` 相对路径，且有 client 才有 style，`manifest.ts:149-166`）。

### 1.2 必须导出的东西

**world 包**（`src/extensions.ts:139-146` + `src/world.ts:52-72`）：

- **默认导出**一个 `WorldDefinition`：`{ id, label, defaults(): S, create(ctx): World, describe?, preflight?, configOptions? }`。
- `id` 是 World 命名空间内的唯一键，**不得与内建 World id 相同**（内建 id 由启动器预占）：
  `src/extensions.ts:265-268` + `src/launcher.ts:173-175`；内建表 `console / qq / bilibili / minecraft / websearch / bili-account`（`src/worlds/index.ts:12-19`）。
  撞名 → 该扩展**不加载**（`src/extensions.ts:357-362`）。
- `defaults()` 必须返回对象且 `enabled === false`（`src/extensions/dry-mount.ts:137-143`）。
- `create(ctx)` 必须能在**默认配置、无密钥**下构造成功（装配层为所有 World 建实例）：`src/extensions/dry-mount.ts:146-152`。
- 实例 `world.id` 必须等于定义 `id`：`src/extensions/dry-mount.ts:153-157`。
- 实例要实现 `tools()` / `envPromptVars()` / `webUi(language)` / `start(host)` / `stop()`：`templates/extension/world/src/world.ts:32-74`、`src/core/types.ts:941-942`。
- 工具名不得与其它 World 或 Core 保留名撞名：`src/extensions/dry-mount.ts:179-181`。

**bot 包**（`src/extensions.ts:158-164` + `src/bot.ts:68-86`）：

- **默认导出**一个 `BotDefinition`：`{ id, defaults(): C, build(loaded, worlds): BotParts, declares?, memoryName?, describe? }`。
- `id` 不得与仓内 `bots/<id>/index.ts` 同名（撞名会拿错 WebUI 面板产物）：`src/extensions.ts:249-251`；
  现仓内 `bots/` 只有 `cormini` / `corti-soulmate` / `cortiv`（`ls Cortico-up/bots`），`xiaoyu` 空闲。
- `declares` 里写 World id；该 World 未装时是灰卡（`docs/extensions.md:236-237`）。

### 1.3 describe.json 怎么生成

- 生成：`pnpm describe:extension <包目录>`（`scripts/extension-describe.ts:21-73`）。
  写到 `cortico.describe` 指定的路径；未写时写 `describe.json` **并把 `"describe": "describe.json"` 补进 package.json 的 cortico 块**（`scripts/extension-describe.ts:59-66`，默认值 `src/extensions/describe-export.ts:19`）。
- 内容来源：World = `describe.tools` + `describe.events` + `webUi('zh')` 里 `role: 'envPrompt'` 的模板原文（`src/extensions/describe-export.ts:46-56`）；
  bot = `describe.tools` + `declares` 的 World id + `memoryName` + `memory.form` + `build()` 出的 Persona 提示词模板原文（`src/extensions/describe-export.ts:74-80`，`docs/extensions.md:259-264`）。
- 校验：`pnpm check:extension <包目录>`（`scripts/extension-check.ts`），会打印 `Contracts: world v6 / provider v6 / bot v7`（`scripts/extension-check.ts:74`）。
  `describe.tools` 必须覆盖实例 `tools()` 返回的全部工具名，否则**失败**（`src/extensions/describe-export.ts:132-137`）；
  `cortico.describe` 缺失 / 指向不存在 / 与重新生成的不一致 → **失败**（`src/extensions/describe-export.ts:156-170`）。
  运行时若推出的事件 type 不在 `describe.events` 里，事件照常生效但运行日志记 warn（`docs/extensions.md:266-267`）。
- `package.json` 有 `files` 时必须含 describe.json，否则 npm 发布不带（`scripts/extension-describe.ts:67-69`）。

### 1.4 怎么装

| 方式 | 命令 / 路由 | 行为 | 依据 |
|---|---|---|---|
| WebUI 手动安装 | 扩展页填**包目录绝对路径** | 走 `pnpm add <绝对路径>`（link 装入），写进 `extensions/package.json` 的 dependencies，**重启进程后加载** | `docs/extensions.md:13-19`；`templates/extension/README.md:32`；`src/extensions.ts:1080-1096`（`this.pnpm(['add', spec, ...])`）；`src/extensions.ts:1106-1120`（路径必须是存在的目录且含 package.json） |
| WebUI 装前预检 | `POST /api/extensions/check` | 体 `{ target: { path } \| { name, version }, kind }`；**只读 manifest，不导入包代码**；类别不符 / 声明不合格即拒 | `src/web/server.ts:2137-2154`；`src/extensions.ts:1056-1074` |
| WebUI 安装 | `POST /api/extensions/install` | 调 `pnpm add`，回 `restartRequired: true` | `src/web/server.ts:2156-2175` |
| 命令行 | `cd extensions && corepack pnpm add <包名或目录>` | 装到 `extensions/` 独立工作区 | `docs/extensions.md:22-29` |
| 扩展目录位置 | 默认 `<检出根>/extensions`；`CORTICO_EXTENSIONS_DIR` 可改 | | `src/extensions.ts:99-104` |
| 已装清单 | 读 `extensions/package.json` 的 `dependencies` | | `src/extensions.ts:117-120` |

### 1.5 `cortico/*` 在运行时怎么解析

- `src/extensions/runtime.ts:18-31`：用 `node:module` 的 `registerHooks` 注册 `resolve` 钩子，
  凡 specifier 以 `cortico/` 开头，映射到**宿主自己的 `src/<路径>`**（`SRC_URL = new URL('../', import.meta.url)`），
  再交给下一个解析器，因此最终 URL 与框架内部 import 一致、共享同一份模块实例；**早于 `node_modules`**。
- 钩子的注册时机：导入 bot 包（`src/extensions.ts:242`）与装载扩展 World/provider（`src/extensions.ts:263`）时各调一次。
- 引擎子进程保留父进程加载器并追加 `--import <本模块>`（`src/extensions/runtime.ts:37-42`）。
- 开发期：`cortico` 是 devDependency，npm 上装下来就是框架的 `src/`，`exports` 是 `{"./*": "./src/*"}`（`scripts/publish-package.ts:88`），
  编辑器 / `tsc` / vitest 按同一批文件解析；**包里那一份不参与运行**（`templates/extension/README.md:38-39`）。
- 浏览器侧例外：**对 `cortico/*` 只能 `import type`**（`docs/extensions.md:197-199`）。
- 因此扩展里**不能**用相对路径摸框架源码。当前 in-tree 的写法必须改：`src/worlds/bili-account/definition.ts:6-9` 里的
  `../../world.ts`、`../../extensions.ts`、`../../paths.ts`、`../../core/types.ts` → 改成 `cortico/world.ts`、`cortico/core/types.ts` 等。
  其中 `cortico/paths.ts` 虽能解析（`exports` 是 `./*` → `src/*`），但不属于发布契约闭包（`scripts/publish-package.ts:127-132`），**不应依赖**；
  状态路径改用 `WorldContext`（`src/world.ts:31-50`：`botDir` / `dataDir` / `packageDir` / `persist` / `secret` / `storeSecret`）。

---

## 2. 裁决表

| # | 冲突点 | 两席主张 | 裁决 | 依据 |
|---|---|---|---|---|
| 1 | **扩展粒度** | A席：互动感知独立成一个单元，不塞进 World（`DECOUPLING:812-831`）；B席：整个 B 站域一个 world 包（`TARGET:89-108`） | **B席对**。域 = 扩展粒度；A席的「独立」被限定为**包内模块 + 依赖方向单向**，不是独立 npm 包 | Cortico 只有三种扩展点 world/provider/bot（`src/extensions/manifest.ts:14-15`），没有「库/插件」这一类；41 个包不可行；A席自己 §9.2 末尾已写「为什么不让它变成独立 npm 扩展…先在 World 内做」（`DECOUPLING:831`）——**与 B 席不冲突，是同一主张的两种措辞** |
| 2 | **收件箱在哪** | A席：`dsh: tools/lib/inbox.mjs` 独立文件 + World 三个工具（`DECOUPLING:817-824`）；B席：`src/client/inbox.ts`（`TARGET:99`） | **在 world 包内，`src/client/inbox.ts`**；工具 `bili_inbox_read` / `bili_inbox_mark` / `bili_comment_reply` 仍由 World 提供 | 工具必须挂在 World 上（`src/core/types.ts:941`；Persona 只能拿 World 的工具 `templates/extension/bot/persona/persona.ts:110`）；World 是 B 站写的唯一持有者 → 闸门不可绕过 |
| 3 | **World 包装什么** | A席：B 站能力留在 World、不拆插件（`DECOUPLING:206-213` §3.3）；§9.4 改口「写不拆，感知拆」（`DECOUPLING:876-879`） | **整域进包**：收件箱/feed/评论/弹幕/动态/点赞收藏/闸门全在 `cortico-world-bilibili` 内。§9.4 的「感知拆」只在**包内模块边界**成立，不构成第二个扩展点 | `docs/extensions.md:5-6`（一个包补一个 World）；宿主侧 `src/extensions.ts:351-366` 一个包只产出一个 WorldDefinition |
| 4 | **bot 包装什么** | A席：未明确；B席：人设 + 记忆 + heartbeat + 控制台，**不认识 B 站**（`TARGET:73-87`） | **同 B 席**。bot 包只有 Persona / Memory / 会话声明，World 声明只写 world 包暴露的 id | `src/bot.ts:68-86`；`templates/extension/bot/index.ts:18`（`declares`）；边界「World 不写 Memory、Persona 才写 Memory」见 `src/core/types.ts:1057-1061` |
| 5 | **persona-core 是包内依赖还是独立包** | A席 §3.3：不拆多包，只需 package.json + exports（`DECOUPLING:212`）；B席：普通依赖（`TARGET:70,110-112`） | **独立包（普通 npm 依赖，非 Cortico 扩展）**，被 world 包与 bot 包共同依赖 | Cortico 没有「纯函数库」这一扩展 kind（`src/extensions/manifest.ts:15`）；它已经是 `@xiaoyu/persona-core`（`Cortico-up/persona-core/package.json:2-10`），现在只是**寄居在 Cortico 检出里**（`Cortico-up/pnpm-workspace.yaml:12-14` 把它列为 workspace 成员）——搬出后两个包各写一条 `dependencies` |
| 6 | **WebUI 页签归谁** | A席：未明确；B席：world 包 `src/webui/`（`TARGET:102`） | **World 页（`world:<id>`）归 world 包，Persona 页（`persona:<id>`）归 bot 包**。鱼缸/待审稿/她的一天/日记/意见箱/判断卡/发送策略/体征 8 个页签全在 world 包 | 页 id 由 kind 决定：`src/extensions.ts:45-48`；World 面板声明在 `WorldWebUiDecl.panels`（`src/core/types.ts:866`），数据面走 `World.webUi().invoke(panel, method, args)`（`src/core/types.ts:867-871`）；现声明在 `src/worlds/bili-account/definition.ts:219-228` |
| 7 | **闸门归谁** | A席 §E：不可逆动作把关链不可拆（`TARGET:54` 记为「唯一不该拆的东西」）；B席 §2.4：`WriteGate` 在包内 `domain/` | **归 world 包 `src/domain/gates/`**，且是唯一写出口 | 写闸门必须在**唯一持有写能力的包**内才不可绕过：bot 包不认识 B 站 ⇒ 没有第二条写路径（`TARGET:87`）。B 站 API 细节与 412 风控也不出包（`TARGET:108`） |
| 8 | **记忆归谁** | B席 §2.1/§3：记忆只走框架 Memory，`fields.memories` 迁进 bot 包（`TARGET:87,157,174`） | **同 B 席**：Memory 归 bot 包（Persona），World **不写 Memory** | `AGENTS.md` 边界 3「A World never writes to Memory」；`WorldHost` 只有只读 `blob(handle)`（`src/core/types.ts:732`），写附件只能走事件的 `blobs` 字段（`src/core/types.ts:690`）；Persona 侧才有 `memory` / `memoryDir` / `blobs: BlobStore`（`src/core/types.ts:1057-1061`） |
| 9 | **场值/生活循环归谁** | A席：「是她的语义→内核」（`DECOUPLING:176-178`）；B席：`src/persona/`（`TARGET:101`） | **判据落 world 包**：persona-core 只放**纯函数**（`TARGET:112`「零 IO、零宿主引用」），场值的**存取与驱动**是 World 的事；纯函数被 world 包与 bot 包共用 | `persona-core` 自身声明「No dependency on Cortico's src/」（`Cortico-up/persona-core/package.json:6`）；现调用点全在 World 侧（`src/worlds/bili-account/definition.ts:15-28`、`personaAdapter.ts:10-20`） |
| 10 | **TARGET §2.1/§2.2 的 api 值** | B席写 `"api":6`（bot）与 `"api":6`（world） | **bot 应为 7，world 才是 6**。bot api 6 是上一版契约，会被拒（`check:extension` 判失败） | `src/extensions/manifest.ts:23-27`；`templates/extension/bot/package.json:18`；`src/extensions/previous-contract.ts:28-32` |
| 11 | **world 包能不能叫 `bilibili`** | B席包名 `cortico-world-bilibili`，World 声明 `['bilibili']`（`TARGET:61,79`） | **包名可以叫 `cortico-world-bilibili`；World id 不行**。`bilibili` 已被上游内建直播 World 占用；且 `bili-account` 也在内建表里 | `src/worlds/index.ts:15,18`；启动器把内建 id 全部预占（`src/launcher.ts:173-175`），扩展撞名不加载（`src/extensions.ts:357-362`） |
| 12 | **argv/CLI** | 主人已裁：不是架构层，要删；CLI 可留成排障薄壳 | 同裁决：**生产路径走包内 typed API**；CLI 只剩 `src/cli.ts` 薄壳 | `src/worlds/bili-account/runner.ts:13-20` 是今天唯一的 spawn 入口（`spawnSync(nodePath, [biliPath, ...args])`） |
| 13 | **停用契约 `onDeactivate`** | A席 §E 新增字段（`DECOUPLING:645`） | **暂缓**：当前契约里没有 `onDeactivate`，`WorldWebUiDecl` 有 `storage` 但没有停用语义（`src/core/types.ts:879-880`）。等上游加，或用 `storage` 的 `clear()` 表达 | 未证实上游是否计划该字段；**未证实** |

---

## 3. 目标包目录树（文件级，标出从哪搬）

### 3.1 `cortico-world-bilibili/`（kind=world, api=6）

```
cortico-world-bilibili/
├── package.json                 ← 抄 templates/extension/world/package.json:1-38
│                                 （name/kind/api/tags/describe/main/files/scripts/devDeps 形状不变）
├── describe.json                ← pnpm describe:extension 生成（scripts/extension-describe.ts:59-66）
├── pnpm-workspace.yaml          ← templates/extension/world/pnpm-workspace.yaml:1-2
├── tsconfig.json                ← templates/extension/world/tsconfig.json:1-19（+ 一份带 DOM 的 webui tsconfig）
├── README.md / CHANGELOG.md / AGENTS.md / CLAUDE.md
│                                 ← templates/extension/world/ 同名文件（AGENTS.md 是发布清单）
├── src/
│   ├── index.ts                 ← templates/extension/world/src/index.ts:1-6（默认导出定义）
│   ├── definition.ts            ← Cortico-up/src/worlds/bili-account/definition.ts:1035-1044
│   │                                 （BILI_ACCOUNT → BILIBILI；id 需重选，见 §2 裁决 11）
│   ├── world.ts                 ← Cortico-up/src/worlds/bili-account/definition.ts:175-1033
│   │                                 （BiliAccountWorld 类：webUi()/invoke()/工具装配/事件投递）
│   ├── config.ts                ← 新建。段形状 = Cortico-up/src/worlds/bili-account/config-store.ts
│   │                                 （策略/名字读写）+ 路径/额度/身份；JSON Schema 按
│   │                                 docs/extensions.md:288-291 的规则（路径落在 worlds.<id>. 内且有默认值）
│   ├── ENV_PROMPT.md            ← Cortico-up/src/worlds/bili-account/ENV_PROMPT.md
│   ├── client/                  ← dsh-bili-whale/tools/（43 条 CLI 改 typed API）
│   │   ├── inbox.ts             ← dsh tools/lib/msgfeed.mjs:25-60（pullFeed）+ tools/commands/likes.mjs
│   │   │                           + tools/commands/dm-await.mjs（私信收件箱）
│   │   ├── dm.ts                ← Cortico-up/src/worlds/bili-account/dm.ts:31-53（parseDmPeek）
│   │   ├── feed.ts              ← dsh tools/commands/feed.mjs
│   │   ├── comment.ts           ← dsh tools/commands/{comment,comment-digest,comment-await,comment-del}.mjs
│   │   ├── danmaku.ts           ← dsh tools/commands/{danmaku,danmaku-await}.mjs
│   │   ├── dynamic.ts           ← dsh tools/commands/{dynamic,edit-dynamic,dynamic-image}.mjs
│   │   ├── publish.ts           ← dsh tools/lib/plain-outbound.mjs（出站清洗，收在构造处）
│   │   └── watch.ts             ← dsh tools/commands/{debrief,bili-watch,subtitles,video-content}.mjs
│   ├── domain/                  ← 写闸门与账本（唯一写出口）
│   │   ├── gates.ts             ← dsh tools/lib/{traffic,quota-gate,kill,go-gate,publish-policy}.mjs
│   │   ├── pending-queue.ts     ← dsh tools/lib/pending-queue.mjs（待放行队列 + 一次性令牌）
│   │   ├── plain-outbound.ts    ← dsh tools/lib/plain-outbound.mjs（如上，构造处唯一调用）
│   │   ├── causal.ts            ← Cortico-up/src/worlds/bili-account/causal-io.ts:1-42
│   │   └── state-roots.ts       ← dsh tools/lib/state-roots.mjs（resolve(kind) → 单一写者）
│   ├── persona/                 ← 她这一轮看到什么
│   │   ├── prompts.ts           ← Cortico-up/src/worlds/bili-account/prompts.ts
│   │   ├── capability.ts        ← Cortico-up/src/worlds/bili-account/capability.ts
│   │   ├── life-stages.ts       ← Cortico-up/src/worlds/bili-account/life-stages.ts
│   │   └── diary.ts             ← Cortico-up/src/worlds/bili-account/diary.ts
│   ├── state/                   ← World 自己的状态 IO
│   │   ├── paths.ts             ← Cortico-up/src/worlds/bili-account/paths.ts（状态路径；改为可配）
│   │   ├── config-store.ts      ← Cortico-up/src/worlds/bili-account/config-store.ts
│   │   └── task-queue.ts        ← Cortico-up/src/worlds/bili-account/task-queue.ts
│   ├── cli.ts                   ← dsh tools/bili.mjs + tools/commands/* 的薄壳（排障用，生产不走）
│   └── webui/
│       ├── client.ts            ← Cortico-up/src/worlds/bili-account/webui/client.ts:1-709
│       │                           （import type 改 cortico/web/shared/client-panel.ts）
│       └── build.mjs            ← 新建（参考已装 cortico-world-figure/scripts/build-webui.mjs:1-24）
├── assets/icon.svg              ← 新建/复制（cortico.icon，可选）
└── tests/
    ├── helpers/fake-host.ts     ← templates/extension/world/tests/helpers/fake-host.ts:1-41
    ├── world.test.ts            ← templates/extension/world/tests/world.test.ts
    └── contract/                ← dsh-bili-whale/tests/contract/*（跨仓契约测试：voice.schema.json 范式）
```

### 3.2 `cortico-bot-xiaoyu/`（kind=bot, **api=7**）

```
cortico-bot-xiaoyu/
├── package.json                 ← 抄 templates/extension/bot/package.json:1-39（api 改 7）
├── describe.json                ← pnpm describe:extension 生成
├── pnpm-workspace.yaml / tsconfig.json / vitest.config.ts
│                                 ← templates/extension/bot/ 同名文件
├── README.md / CHANGELOG.md / AGENTS.md / CLAUDE.md
├── index.ts                     ← templates/extension/bot/index.ts:1-55
│                                 + Cortico-up/bots/cormini/index.ts（Persona 装配、heartbeat）
├── persona/
│   ├── persona.ts               ← templates/extension/bot/persona/persona.ts:1-140
│   │                                 + Cortico-up/bots/cormini/persona/persona.ts
│   │                                 （会话声明、ownToolNames、workspace 工具）
│   ├── blobs.ts                 ← templates/extension/bot/persona/blobs.ts（FileBlobStore）
│   │                                 + Cortico-up/bots/cormini/persona/blobs.ts
│   ├── memory.ts                ← Cortico-up/bots/cormini/persona/memory.ts（框架 Memory 三层）
│   │                                 + Cortico-up/src/worlds/bili-account/personaAdapter.ts 的记忆段
│   │                                 （loadState/saveState 的记忆部分、remember/findMemories/voidMemory）
│   ├── heartbeat.ts             ← Cortico-up/bots/cormini/persona/heartbeat.ts
│   ├── workspaceTools.ts / workspaceGit.ts / handoffNote.ts
│   │                            ← Cortico-up/bots/cormini/persona/ 同名文件
│   ├── PREFIX.md                ← templates/extension/bot/persona/PREFIX.md
│   │                                 + Cortico-up/bots/cormini/persona/PREFIX.md
│   ├── CONSTITUTION.seed.md     ← Cortico-up/bots/cormini/persona/CONSTITUTION.seed.md
│   ├── ORIENTATION.md           ← Cortico-up/bots/cormini/persona/ORIENTATION.md
│   ├── MEMORY.seed.md           ← templates/extension/bot/persona/MEMORY.seed.md
│   └── config.ts                ← Cortico-up/bots/cormini/persona/config.ts
└── tests/bot.test.ts            ← templates/extension/bot/tests/bot.test.ts
```

### 3.3 `persona-core`（第三个包，普通依赖）

```
xiaoyu/packages/persona-core/     ← 整目录搬出 Cortico-up/
├── package.json                  ← Cortico-up/persona-core/package.json:1-11（name @xiaoyu/persona-core）
├── src/*.ts (16 个)              ← Cortico-up/persona-core/src/*
└── （不含 Cortico 依赖；不改名）
```
搬出后 `Cortico-up/pnpm-workspace.yaml:12-14` 的 `persona-core` 条目要删（否则上游检出继续带我们的包）。

---

## 4. 什么必须留在宿主（附论证）

| 必须留在宿主 | 论证（不是"感觉上"） |
|---|---|
| **扩展装载器与 manifest 解析** | 三种扩展点与契约版本是宿主定义并强制的（`src/extensions/manifest.ts:14-27`）。包只是被装载的产物。 |
| **`cortico/*` 模块解析钩子** | 钩子必须指向**宿主正在运行的那份框架**（`src/extensions/runtime.ts:14, 26`）；装在包里的框架副本不参与运行（`templates/extension/README.md:39`）。 |
| **Core：事件队列 / 事件库 / 会话 / 认知 / Memory 装配 / provider 注册** | 事件与游标由 Core 分配（`src/core/types.ts:689-692`）；工具表的装配、去重、可见性过滤在装配层（`src/core/types.ts:743-748`）；`MemoryAssemblyContext` 由 Core 构造（`src/core/types.ts:997-1000`）。 |
| **装配层（启动器）** | 内建 World + 扩展 World 合成一张表再交给 bot（`src/launcher.ts:171-181`）；`withWorlds()` 补默认值、按 `declares` 决定默认启用（`src/world.ts:100-121`）。世界不在表里就永不挂载。 |
| **WebUI 内核与面板数据面路由** | 面板的数据面是 `World.webUi().invoke(panel, method, args)`（`src/core/types.ts:867-871`），服务端负责路由；扩展面板产物由宿主分配 URL 并只发声明过的文件（`src/extensions.ts:307-327`、`src/extensions/manifest.ts:204-222`）。 |
| **部署根、密钥与 config.json 合并** | `WorldContext.secret/storeSecret/persist` 由装配层实现（`src/world.ts:43-47`）；密钥写部署 `.env` 且只本人可读。 |
| **契约版本号** | 改 `WorldDefinition` 就加 world，改 `BotDefinition` 就加 bot（`src/extensions/manifest.ts:17-27`）；版本号是宿主对包的承诺。 |

**反过来，下面这些必须搬出宿主**（今天的痛点即证据）：
她的状态文件与 B 站 API 细节（`src/worlds/bili-account/paths.ts:1-98` 里硬编码的 `ROOT`/路径解析，
`src/worlds/bili-account/definition.ts:30-32` 里 `BILI_WHALE_ROOT` 与 `tools/bili.mjs` 路径）、
她的写闸门（dsh `tools/lib/{traffic,quota-gate,kill,go-gate,publish-policy}.mjs`）、
她的生活循环与日记（`src/worlds/bili-account/{life-stages,diary,prompts}.ts`）、
她的页面（`src/worlds/bili-account/webui/client.ts:1-709`）、
她的人格（`Cortico-up/bots/cormini/`，仓内参考 bot）。

---

## 5. 我不知道 / 证据不足（标「未证实」）

1. **WebUI 面板 invoke 路由是否鉴权** —— 2026-11-01「盲 POST 把 `publish.draftMode` 改成 auto」的事故（`TARGET:54`）指向面板写路径，
   但我**没有核对** `src/web/server.ts` 的鉴权中间件，**未证实**。这直接决定「闸门不可绕过」的论证是否成立，需在 P2 前补查。
2. **`@xiaoyu/persona-core` 作为已安装扩展的依赖怎么落** —— 扩展装进 `extensions/`（独立 pnpm 工作区，`docs/extensions.md:26-29`），
   我们自己的包若未发到 registry，`dependencies` 指向什么（`file:` / `link:` / 私有 registry）**未证实**。
3. **扩展包能否依赖 workspace 包** —— 现在 `@xiaoyu/persona-core` 是 Cortico 检出的 workspace 成员（`Cortico-up/pnpm-workspace.yaml:12-14`）；
   装成扩展后这条链是否还成立**未证实**。
4. **内建 `bili-account` 删掉后，扩展 World 能否沿用 id `bili-account`** —— 逻辑上启动器不再预占即可（`src/launcher.ts:173-175`），
   但**没有实跑验证**；且删它要改 `src/worlds/index.ts:18`，属改上游检出。
5. **world id 用什么** —— `bilibili` 被上游直播 World 占（`src/worlds/index.ts:15`）；`bili-account` 在内建表里（`:18`）。
   选 `bili-account`（改配置键 `worlds.bili-account` 不变）还是新 id（要迁部署配置 + WebUI 页 id `world:<id>`）**未证实哪条迁移成本更低**。
6. **工具命名前缀** —— 仓内约定是 World id 的 PascalCase 前缀（`AGENTS.md` 命名节）；现网工具是 `bili_*` 族（`TARGET:51` 引 `tool-decls.ts`）。
   改前缀要动 18 个工具名与 `describe.json`，**未证实**该改。
7. **43 条 CLI → typed API 的实际工作量与 79 个测试文件的搬家代价** —— `TARGET:190` 只是估算，**未证实**。
8. **停用契约 `onDeactivate`** —— 当前 Cortico 契约里没有这个字段（`src/core/types.ts:857-887` 无此声明）；上游是否计划加**未证实**。
9. **上游 `bilibili` 内建 World（直播）与新包的工具名是否撞名** —— `dry-mount.ts:179-181` 会拒，但没跑过 `check:extension`，**未证实**。
10. **`bots/cormini` 抄一份 vs 继续依赖上游** —— `TARGET:191` 自己标了「没有结论」；本席不重开，只记录：抄 = 跟上游漂移，依赖 = 接受上游改接口。

---

## 6. 最大的分歧（供主持人参考）

A 席 §9.4 的「感知拆 / 走端口 + 适配器」与 §3.3 的「B 站能力不拆」**在同一篇里互相矛盾**（`DECOUPLING:209` vs `:879`）。
本席的裁决是：**矛盾只在措辞层**——域级扩展包内部做端口 + 适配器，不构成第二个扩展点。
按此改写，A 席 §9.2 的「独立成一个单元」= world 包内 `src/client/inbox.ts`，「为什么不让它变成独立 npm 扩展」那段**原样保留并升格为通用规则**。
两席在此合流，无需重开已裁事项。
