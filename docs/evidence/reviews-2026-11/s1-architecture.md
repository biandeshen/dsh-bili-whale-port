# 席位一：架构与可插拔性

评审对象：`E:\WorkSpace_Qoder\dsh-bili-whale`（12 个 `packages/*`，80 个生产 .ts / 20,101 行）＋宿主 `E:\WorkSpace_Qoder\Cortico-up`。
方法：静态 import 图统计（grep 全量）＋ `node --experimental-strip-types` 实际加载试验（本机 node v24.16.0）。全程只读，未跑测试套件、未访问 7799 实例、未读数据目录。
证据档位标注：【已验证】= 我亲自跑/读出来；【仅自述】= 文档或代码注释声称但我没核；【无证据】= 我没查清。

---

## ① 核心判断（5 条，均可反驳）

**J1【已验证】「万物皆扩展」在无头（headless）路径上是工程事实，在面板（webui）路径上是修辞。**
6 个 `cap-*` 的 `src/index.ts` 全部能只靠本仓自身加载成功（8/8 通过，见 E1）。但每个 `cap-*` 的 `src/webui/client.ts` 都有恰好 2 行硬 import 指向 `../../../cortico-adapter/src/webui-helpers.ts`（合计 12 行），另有 2 处把宿主的 HTTP 路由形状写死在能力包里（`cap-state-rhythm/src/webui/client.ts:353` 打 `/api/session/history`、`:400` 打 `/api/webui/providers/` 且 provider id 硬编码为 `world:media-studio`，即跨过了自己的所有权边界）。结论：换转接头，服务端 0 行；要面板＋数据家约定，约 18–20 处（见 J2 分解）。

**J2【已验证】包边界是「目录约定」，不是「模块边界」——全部跨包引用走 `../../<peer>/src/x.ts` 深链到对方源文件，声明的 workspace 依赖 0 处被使用。**
`pnpm-workspace.yaml` 存在，11 个 `packages/*/package.json` 声明了 `@xiaoyu/*: workspace:*`，但本仓 `node_modules` 不存在（实测 `ls -d node_modules` → 无），代码里没有任何一处 `from '@xiaoyu/...'`。所以这些声明是装饰性的：真正的解析依赖「两个仓库是兄弟目录且包名拼写正确」这一物理布局。宿主侧更直接：`Cortico-up/extensions/package.json:5-7` 写死 `link:E:/WorkSpace_Qoder/dsh-bili-whale/packages/cortico-bot-xiaoyu`（3 条机器绝对路径），且只 link 了 3 个转接头，6 个 `cap-*` 与 `persona-core` 都不在 `extensions/node_modules` 里——它们是靠深链相对路径被物理拽进来的。

**J3【已验证】内核 `persona-core` 确实是叶子（依赖图干净），但同时存在两份分叉实现，且两份都在运行时可达。**
`packages/persona-core` 生产代码跨包 import = 0 条（104 个 specifier 全是 `./` 包内或 `node:*`）。然而 `Cortico-up/persona-core/src` 是另一份：16 个 .ts vs 本仓 21 个；`diff -rq` 报 20 条差异，其中 15 个文件字节级不同、5 个文件只在本仓有（`atomic-write.ts`、`capability.ts`、`cortico-defaults.ts`、`temporal.ts`、`tz.ts`——注意 `capability.ts` 正是「能力包契约」本身）。宿主 `Cortico-up/package.json:38` 声明 `@xiaoyu/persona-core: workspace:*` 且 `Cortico-up/node_modules/@xiaoyu/persona-core` 实际存在。所以：能力包用相对路径拿本仓那份，宿主自己的 world 代码用包名拿宿主那份。【已验证到"两份都在、都被解析"这一层；未验证 live 进程具体加载哪份，见⑤】

**J4【已验证】`cap-*` 之间没有生产级循环依赖；但有 3 条横向生产边 + 5 条测试层的依赖倒置（叶子包反向 import 转接头）。**
生产 `src/` 里 cap→cap 只有 5 条：`cap-journal→cap-memory` 1（`src/index.ts:23` 取 `WorkspaceGit`）、`cap-media-studio→cap-bilibili` 2（`src/vendor/media-config.mjs:6`、`src/vendor/mimo.mjs:14` 都去取 `cap-bilibili/src/platform/paths.mjs` 的 `whaleHome/whalePath`）、`cap-bilibili→cap-vision` 2（`src/client/bili-watch.ts:18-19`）。反向倒置全在测试里：`cap-bilibili/tests/*` import `cortico-world-bilibili/src`（2 处）、`cap-media-studio/tests/*` import `cortico-world-media/src` 与根 `tests/helpers/panel-harness.mjs`、`cap-vision/tests` 同。这些不构成运行期环，但构成「能力包的测试离开转接头就跑不了」。

**J5【已验证】「无 node_modules、纯相对 import、`node --experimental-strip-types`」三条主张两半真半假；且版本要求在文档层面自相矛盾。**
本仓确实没有 `node_modules`（已验证），但 `package.json` 的 `gates` 脚本第 3 段直接要求 `--import tsx`（第三方 loader，本仓无法解析）；`scripts/build-webui.mjs:24` 明确把 `../Cortico-up/node_modules/esbuild/lib/main.js` 列为第一候选，找不到才 fallback 本仓 `node_modules`（本仓没有）→ 实际语义是「不装依赖，但借宿主的依赖」。语法层面主张成立：`packages/*/src` 里 enum / namespace / 参数属性 / abstract class 命中数 = 0，`--experimental-strip-types` 可跑。版本层面矛盾：全仓 12+1 个 `package.json` 都没有 `engines` 字段（已验证），而 `README.md:156` 写 Node 22+，`setup.cmd` 与 `start.cmd` 检查文案写「Node.js 20+ not found」，`scripts/start-cortico.mjs:36` 注释说 `--use-system-ca` 需 Node 22.15/23+。Node 20 既不能 strip-types 也没有 `--use-system-ca`——按 cmd 脚本的门槛装出来的环境跑不起来。

---

## ② 逐条证据

### E1 能力包无宿主可加载（实测，非推断）

命令：对 8 个入口逐个 `node --experimental-strip-types --input-type=module -e "await import('./<entry>')"`，cwd = 本仓根，无任何宿主注入。

```
packages/kernel/persona-core/src/capability.ts        => OK
packages/capabilities/cap-state-rhythm/src/index.ts         => OK
packages/capabilities/cap-memory/src/index.ts               => OK
packages/capabilities/cap-journal/src/index.ts              => OK
packages/capabilities/cap-vision/src/index.ts               => OK
packages/capabilities/cap-bilibili/src/index.ts             => OK
packages/capabilities/cap-media-studio/src/index.ts         => OK
packages/adapters/cortico-bot-xiaoyu/src/index.ts       => OK
```
8/8。判定强度限制：这只证明 **import 图可解析＋模块顶层可求值**，不证明 `createXxxCapability()` 起来后能用（没构造、没做 IO、没跑工具）。而且 `cortico-bot-xiaoyu` 也 OK —— 说明「转接头对宿主的可加载性」在这里没有被真正测到（它 imports `cortico-adapter`，而 adapter 自己声明「不 import cortico/*」，见 E4）。

### E2 跨包 import 边全量清单（生产 `src/` 口径）

命令口径：对每个包取全部 `from|import(|require(` 的 specifier，筛出以 `../` 开头者，归并到目标包名。**先报总量再报样本，不外推。**

生产 `src/` 跨包 specifier 总数 **61**，按目标分类：

| 目标 | 边数 | 说明 |
|---|---|---|
| `persona-core` | 41 | cap-bilibili 4 / cap-journal 5 / cap-media-studio 2 / cap-memory 8 / cap-state-rhythm 21 / cap-vision 1 |
| `cortico-adapter` | **12** | 6 个 cap × 恰好 2 行，全部在 `src/webui/client.ts` |
| 兄弟 `cap-*` | 5 | 见 J4，3 组具体文件行号 |
| 仓根 `vendor/` | 3 | 全在 `cap-media-studio`，且 `../../../../../vendor/` 跳出 `packages/` 5 层：`src/index.ts:13-15`、`src/render.ts:9,10,19` |
| **`persona-core` 自身跨包** | **0** | 104 specifier = 81 包内 `./` + 23 `node:*`（node:test 10、node:assert/strict 10、node:fs 2、node:path 1） |

`cortico-adapter` 的 12 行原文（`grep -rn "cortico-adapter" packages/cap-*/`，12 条命中）：
```
packages/capabilities/cap-bilibili/src/webui/client.ts:8,9        PanelCtx + call,actionButton,createDirtyGuard
packages/capabilities/cap-journal/src/webui/client.ts:12,13       PanelCtx + call,actionButton,createDirtyGuard
packages/capabilities/cap-media-studio/src/webui/client.ts:7,8    PanelCtx + call,actionButton
packages/capabilities/cap-memory/src/webui/client.ts:7,8          PanelCtx + call,actionButton,textField,createDirtyGuard,debounce
packages/capabilities/cap-state-rhythm/src/webui/client.ts:8,9    PanelCtx + call,actionButton,sliderField,createDirtyGuard
packages/capabilities/cap-vision/src/webui/client.ts:8,9          PanelCtx + call,actionButton,sliderField
```
→ 新宿主必须提供一个导出 **6 个符号**（`PanelCtx` 类型、`call`、`actionButton`、`createDirtyGuard`、`textField`、`sliderField`、`debounce`，去重后 7 个）的同名模块。这是「换转接头改几行」的真实代价下界。

对照：测试层的跨包边（另一套数，不并入 61）：`cap-bilibili/tests` → `cap-journal` 3 / `cap-memory` 1 / `cortico-world-bilibili` 2；`cap-memory/tests` → `cap-journal` 1；`cap-media-studio/tests` → `cortico-world-media` 1 / 根 `tests` 1；`cap-vision/tests` → 根 `tests` 1。

### E3 webui 不在服务端可达图里（结构性理由，支撑 J1 的「无头成立」）

`grep -rn "webui" packages/cap-*/src/index.ts packages/cap-*/src/*.ts` 过滤 import/from → **空输出**。即 6 个能力包的 `src/index.ts` 都不 import 自己的 `webui/client.ts`。
但 `grep -n -i cortico` 在非 webui 生产文件里的命中，多数是注释（`cap-state-rhythm/src/index.ts:684,700`、`cap-vision/src/index.ts:13` 的「严禁 import cortico/*」自述铁律【仅自述】、`cap-memory/src/workspace.ts:2` / `workspace-git.ts:2` 的「自 cormini 抄入并去掉 cortico/* 依赖」、`cap-state-rhythm/src/dream-tick.ts:37` / `dream-reflection.ts:22` 的「模型调用在 cortico-bot-xiaoyu 那边，那里才有 CoreApi」）。
**唯一非注释的宿主耦合**：`packages/capabilities/cap-bilibili/src/platform/paths.mjs:75,82,108` 读 `process.env.CORTICO_HOME` / `CORTICO_BOT`，且把 bot 名默认成字面量 `'xiaoyu'`。这是宿主命名约定渗进能力包，3 个代码点。

### E4 `cortico-adapter` 是「假适配层」：它不含业务，也不真的对齐宿主类型

`packages/cortico-adapter` 全树只有 3 个文件（`package.json`、`src/index.ts`、`src/webui-helpers.ts`），import specifier 总数 **0**（`grep -rhoE ... packages/adapters/cortico-adapter/` → `total_specifiers: 0`）。
`src/index.ts:7-8` 注释自陈：「这里用本地声明的最小结构类型（不 import cortico/*），这样本包自身仍是宿主无关的；真正的类型一致性由 cortico-* 转接头在编译期对齐」。
`src/index.ts:11,20` 用注释指回宿主行号：「见 Cortico src/core/types.ts:182,261」「见 Cortico src/core/types.ts:790」。
→ 后果是可反驳的：适配层的 `CorticoToolDef` / `CorticoPanelDecl` 与宿主真实形状漂移时，本仓 TS 不会报错，只有运行时炸。`handler: (... ctx: any)`、`execute: (args: any)`（`index.ts:17,35,43`）把参数面全退化成 `any`。

### E5 内核双份（J3 的原始数字）

```
$ ls /e/WorkSpace_Qoder/Cortico-up | grep -i persona      -> persona-core
$ find Cortico-up/persona-core -name '*.ts' | wc -l       -> 16
$ find dsh-bili-whale/packages/persona-core -name '*.ts' | wc -l -> 21
$ diff -rq Cortico-up/persona-core/src dsh-bili-whale/packages/persona-core/src | wc -l -> 20
   其中 "Only in .../packages/persona-core/src"（本仓独有）5 个：
     atomic-write.ts  capability.ts  cortico-defaults.ts  temporal.ts  tz.ts
   "differ" 15 个：budget causal-chain conversation-assessment decay effect-bus
     emotion emotion-projection index life-activities memory npc-state-machine
     retrieval rhythm types voice-brief
$ ls -d Cortico-up/node_modules/@xiaoyu/persona-core  -> 存在
$ grep -n persona-core Cortico-up/package.json  -> :38 "@xiaoyu/persona-core": "workspace:*"
```
`scripts/check-live-drift.mjs:78` 的注释也承认这件事：「宿主那份（另一条链）：`Cortico-up/persona-core/src/` —— 宿主自带 world 用的副本」，`:218` 给出的修法是 `cd Cortico-up && pnpm describe:extension ../dsh-bili-whale/packages/<name>`。→ 项目里已经存在一个专门盯着这份漂移的脚本，这本身就是「漂移是已知长期风险」的一手证据。

### E6 遗留物卫生（逐目录判定，含引用者计数）

计数命令：对每个目录 d，分别 `grep -rlE "\.\./+d/|\./d/"` 限定扩展名，统计引用者文件数。

| 目录 | 文件数(.ts/.js/.mjs) | tests/ 引用 | scripts/ 引用 | packages/ 引用 | 同级互引 | 判定 |
|---|---|---|---|---|---|---|
| `tools/` | 94 | **46** | **29** | 0 | 12 | **活**（最重的一块） |
| `core/` | 10 | **11** | 0* | 0 | 3 | **半死**（只被测试+脚本读） |
| `panel/` | 6 | 3 | 0** | 0 | 0 | **半死**（cmd 启动链可达） |
| `adapters/` | 4 | 0 | 0 | 0 | 1 | **半死**（只被 `panel/server.js` 用） |
| `vendor/` | 21 | 0 | 0 | **4** | 0 | **活** |
| `legacy/` | 0 | — | — | — | — | **不存在**（见下） |

补充精确证据：
- `legacy/` 在本仓**根本不存在**：`find . -maxdepth 3 -type d -name '*legacy*'` 只无命中；`git ls-files legacy | wc -l` → 0。任务描述里的「`legacy/bili-account-retired/` 导致 20 个测试 ERR_MODULE_NOT_FOUND」如果发生过，那个目录现已被彻底移出本仓；有 `legacy/` 的是**宿主**（`Cortico-up/legacy` 存在）。我没能证伪也没能证实那次事故，列为⑤。
- `tools/` 的活性来源不是 packages 而是测试与运维脚本：如 `tests/contract/go-gate.test.mjs:85-86`、`tests/contract/kill-unified.test.mjs:8-10`、`tests/contract/judgment.test.mjs:17` 深链 `../../tools/lib/*.mjs`；`scripts/` 里 29 个文件同样深链 `tools/lib/*.mjs`。→ 「扩展化改造」只覆盖了 `packages/` 那 20,101 行，运维/合同面仍住在非包化的 `tools/` 里。
- `scripts/check-state-roots.mjs:28`：`const SRC = ['tools', 'core', 'panel', 'scripts']` —— 本仓自己的 gate 把这四个目录当一等公民扫描，等于承认它们仍是生产路径。
- `panel` 的真实可达路径不是 import 而是 spawn：`scripts/launch-panel.mjs:44` → `spawn(process.execPath, [path.join(ROOT,'panel','server.js'), '--port', ...])`，而 `open-panel.cmd` / `start.cmd` 都调 `scripts\launch-panel.mjs`。`panel/server.js:22` 再 `import '../adapters/opencode/controller.js'`。所以我上面表里 `panel/scripts:0` 是「相对 import 形式」为 0，**不能读成「panel 无人启动」**——这点如果我只报数字就会误导，特此更正。
- `core/` 的 scripts 引用同理：我的 `core/` 计数在 scripts 里全是 `memo/core` 目录名误命中，真正的代码引用为 0。
- 根 `package.json` 的双重身份：`"main": "core/index.js"`、`exports {".": "./core/index.js", "./client": "./core/client.js"}`、`files` 含 `core adapters panel tools tests`——**发布产物是老树，运行产物是 `packages/cortico-*`**。同一份 package.json 服务两个不相干的分发形态。

### E7 依赖管理与 vendoring

- 声明但不可解析：11 个包声明 `@xiaoyu/*: workspace:*`；本仓无 `node_modules`；代码里 0 处 bare specifier。`cap-media-studio`、`cap-vision`、`cap-state-rhythm`、`cortico-world-*`、`cortico-adapter` 的 deps 名单和真实深链目标还**不一致**（例：`cap-bilibili` 生产代码 import `cap-vision`，但 `cap-bilibili/package.json` 只声明 `@xiaoyu/persona-core`；`cap-media-studio` import `cap-bilibili`，声明里也只有 persona-core）。→ manifest 与真实依赖图脱钩，且脱钩方向是**少报**。
- 实际需要第三方：`tsx`（`package.json:gates` 第 3 段 `--root ../Cortico-up --import tsx`）、`esbuild`（`scripts/build-webui.mjs:24`，第一候选就是宿主的 node_modules）。`dist/` 已产出：`ls -d packages/*/dist | wc -l` → 9。
- vendor 卫生（正面）：`vendor/dsh-video-studio/LICENSE` = MIT, Copyright (c) 2026 litao；`vendor/dsh-autocut/LICENSE` = MIT。`VENDOR.md` 钉住了来源 `npm dsh-video-studio@0.4.3`、上游 tarball sha256 `588e760d…361dd`、逐文件 `SHA256SUMS`、以及「未取用清单 + 为什么不取（宿主/面板耦合部分）」。这块是**做得对的**。
- vendor 反例（两处）：① 同一上游有两个存放位置——仓根 `vendor/dsh-video-studio/` 与包内 `packages/capabilities/cap-media-studio/src/vendor/video/studio.mjs`；后者是 shim（`:9,10,11` 出现 vendor 路径），但 `src/index.ts:13-15` 和 `src/render.ts:9,10,19` **绕过 shim 直接从 packages/ 外面 5 层抓根 vendor**，等于同一个包内混用两条 vendor 通道。② 包内还另有 `packages/capabilities/cap-vision/src/vendor/see-now/`（10 个 .js + `LICENSE` + `NOTICE` + `VENDORED.md`）——第二份 vendoring 的 license 条款我**没读**，见⑤。
- 无 `engines`：`grep -H engines packages/*/package.json package.json` → 无任何命中。

### E8 加载器与运行时

`node -v` → `v24.16.0`。本仓 `--experimental-strip-types` 实测可用（E1 八次加载就是用它跑的），且 0 处 non-erasable 语法（enum/namespace/parameter-property/abstract class 命中 0）。所以「靠 strip-types 免构建跑 TS」这条主张在**语法层**成立；在**版本门槛层**不成立（见 J5 的 20+ vs 22+ vs 22.15+ 三处矛盾）。
`scripts/start-cortico.mjs:22-23`：live 用 `CORTICO_ROOT=E:/WorkSpace_Qoder/Cortico-up`、`CORTICO_HOME=~/.xiaoyu-home`、`CORTICO_BOT=xiaoyu`，健康检查打到 `http://127.0.0.1:7799/`。`:16-21` 注释里自陈「代码树 / 部署树 / bot 名是三条成对的线，少一条就会起出新代码配旧数据……今天 12:53 就误起过一次」——这是一手事故记录。
另有 5 个脚本把默认 `CORTICO_ROOT` 硬编码成**旧树** `E:/WorkSpace_Qoder/Cortico`（`counterfactual.mjs:13`、`day-watchdog.mjs:17`、`drill-gate.mjs:12`、`simulate-rhythm.mjs:6`、`smoke-tools.mjs:13`、`wake-audit.mjs:16`），而 `start-cortico.mjs:23` / `check-consumers.mjs:17` / `check-live-drift.mjs:86` 默认 `Cortico-up`。同一仓内「宿主在哪」有两个不同的默认答案。

---

## ③ 架构债务清单（严重度 / 具体后果 / 怎么验证已经修好）

| # | 债务 | 严重度 | 具体后果（可观察、可反驳） | 修好的验证判据 |
|---|---|---|---|---|
| D1 | 内核双份：`packages/persona-core` 与 `Cortico-up/persona-core` 分叉，15 文件字节级不同 + 5 文件本仓独有 | **高** | 能力包拿 A 版语义、宿主自带 world 拿 B 版语义。同一时刻 live 里跑着两套 `rhythm/types/memory/emotion` 判定；`capability.ts`（契约本体）只在 A 版存在，所以 B 版根本没在校验任何东西。表现为「改了包内行为、线上没变」这类无法复现的漂移 | ① `diff -rq Cortico-up/persona-core/src dsh-bili-whale/packages/persona-core/src \| wc -l` → **0**；② 宿主那份改为 `link:` 或删目录只留 `node_modules/@xiaoyu/persona-core` 一条解析路径；③ `node scripts/check-live-drift.mjs` 通过且不再包含「双份副本」这条分支 |
| D2 | 包边界不是模块边界：100% 跨包引用是 `../../peer/src/file.ts` 深链；manifest 依赖系统性少报 | **高** | 任何 cap 都能伸手进别人的 `src/` 私有文件（已发生：`cap-journal` 取 `cap-memory/src/workspace-git.ts`，`cap-media-studio` 取 `cap-bilibili/src/platform/paths.mjs`）。重构对方内部文件名 = 静默炸别的包；`package.json` 的 deps 不能用来生成拓扑序或做子集安装 | ① `grep -rhoE "from '\.\./\.\./[a-z-]+" packages/cap-*/src \| wc -l` 从 61 → 只剩 `@xiaoyu/persona-core` 的 bare specifier；② 每个 `cap-*` 有 `exports` 白名单且深链目标不在白名单内时报 `ERR_PACKAGE_PATH_NOT_EXPORTED`；③ 手工比对：每包 `dependencies` 列表 ⊇ 该包真实跨包目标（当前 `cap-bilibili`/`cap-media-studio` 至少少报 1 条） |
| D3 | 宿主绝对路径进仓：`Cortico-up/extensions/package.json:5-7` 的 `link:E:/WorkSpace_Qoder/...` × 3，加本仓 8 个脚本里硬编码 `E:/WorkSpace_Qoder/Cortico(-up)` | **高** | 换机器 / 换目录 / CI 上直接解析不到扩展；且 `start-cortico.mjs:19-21` 记录了真实事故（12:53 误起旧 bot）。默认值在 `Cortico` 与 `Cortico-up` 之间不一致（D8），跑脚本时静默对着错误的树做审计 | ① `grep -rn "E:/WorkSpace_Qoder\|E:\\\\WorkSpace_Qoder" . --include=*.json --include=*.mjs --include=*.js` → 0 命中；② 全部改 `process.env.CORTICO_ROOT` + 单一常量模块；③ 在临时目录 clone 两份仓，`scripts/start-cortico.mjs --print-flags` 能正常输出 |
| D4 | 面板把宿主 HTTP 契约写死进能力包：`cap-state-rhythm/src/webui/client.ts:353` `/api/session/history`、`:400` `/api/webui/providers/` + provider id `world:media-studio` | **中高** | 换宿主后服务端能跑，但状态面板的两块功能是 404 或串到别人的面板；跨 provider 硬编码意味着 media-studio 的 URL 形状一变，state-rhythm 的面板静默失效 | ① `grep -rn "'/api/" packages/cap-*/src/webui/ \| wc -l` → 0；② 路由前缀与 provider id 由 `webui-helpers.ts` 注入；③ 用另一套路由前缀 mock 宿主起面板，两功能仍可用 |
| D5 | `cortico-adapter` 无类型约束：0 import、`ctx: any` / `args: any`、靠注释指回宿主行号（`src/index.ts:11,20`） | **中** | 宿主改 `ToolDef`/`WorldPanelDecl` 形状时本仓 tsc 不报错；注释里的 `types.ts:182,261,790` 行号会腐烂成误导。适配层宣称「换宿主只写同样形状的适配器，5 个能力包一行不用动」（`index.ts:4-5`【仅自述】），但没有机制保证形状一致 | ① 适配层从宿主取真实类型（宿主导出公共类型包，或加一份 contract fixture + 编译期断言）；② 故意在 fixture 里加必填字段，`tsc --noEmit` 必须失败；③ 注释里的行号引用被类型引用替代 |
| D6 | 三处 vendoring 通道并存，且包内绕过自己的 shim：根 `vendor/` × 2 + `cap-media-studio/src/vendor/` + `cap-vision/src/vendor/see-now/`；`src/index.ts:13-15` / `src/render.ts:9,10,19` 直接 5 层跳出 `packages/` 抓根 vendor | **中** | 同一上游两个版本可能不同步；`SHA256SUMS` 只覆盖 `vendor/`，包内两份不在哈希范围内；`check-hashes.mjs` 是否覆盖包内 vendor 未验证。`packages/` 目录不再可独立搬运 | ① `grep -rn "\.\./\.\./\.\./\.\./\.\./vendor/" packages/ \| wc -l` → 0；② 每个包内 vendor 有 `VENDORED.md`+`LICENSE`+哈希且被 `node scripts/check-hashes.mjs` 覆盖；③ `mv packages /tmp/p && node -e import(cap-media-studio)` 仍 OK |
| D7 | 非包化的活主干：`tools/` 94 个源文件被 46 个测试 + 29 个运维脚本深链；`tools/lib` 39 个 .mjs 里 **33 个仍是真身（85%）未进任何包**，只有 6 个是转发壳（`export * from '../../packages/cap-{bilibili,media-studio}/...'`）。方向干净：`tools→packages` 11 个文件、`packages→tools` **0 条**。`scripts/check-state-roots.mjs:28` 把 `tools/core/panel/scripts` 当一等源 | **中** | 「万物皆扩展」的覆盖面实际只有 `packages/` 的 20,101 行；运维、gate、状态根、合同测试全住在体系外。想装/搬一个宿主时，搬不走的正是这一块 | ① `grep -rlE "\.\./+tools/" tests scripts \| wc -l` 从 75 → 0，或 `tools/` 变成 `packages/cap-*` 并被正确声明；② `check-state-roots.mjs` 的 SRC 常量改成从包元数据生成 |
| D8 | `legacy/` 目录在本仓不存在但叙事仍在（`Cortico-up` 才有 `legacy/`）；老树发布身份仍在 `package.json` 的 `main`/`exports`/`files` 里（`core/index.js`、`panel`、`tools`） | **中低** | 一次「移动目录→import 未改」的事故类（任务描述里那 20 个 ERR_MODULE_NOT_FOUND）说明这类目录操作没有守卫；同时 `npm pack` 出来的是老树、`link:` 装进去的是新树，两个产物同名不同物 | ① `node -e "import('dsh-bili-whale')"` 的解析目标与 `packages/cortico-bot-xiaoyu` 一致，或 `main/exports/files` 删除老树条目；② `pnpm gates` 里有一条 `check-consumers`/`check-live-drift` 明确断言无悬空目录引用，且**故意 rename 一个目录能让 gate 红** |
| D9 | 版本门槛三处打架且无 `engines`：README:156 Node 22+ ／ setup.cmd+start.cmd「Node.js 20+」／ start-cortico.mjs:36 `--use-system-ca` 需 22.15/23+；全仓 package.json 无 `engines` | **中低** | 按 cmd 脚本文案在 Node 20 环境「检查通过」的人，会在 strip-types 与 `--use-system-ca` 两处失败；`systemCaFlags()`（`start-cortico.mjs:38-41`）对 20 返回空数组，于是静默失去系统证书、报 `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`（注释已描述该症状） | ① `grep -n engines package.json` 有 `"node": ">=22.15"`；② 三处文档/脚本口径一致；③ 在 Node 20.9 跑 `setup.cmd --check` 明确失败并指出正确版本 |
| D10 | 测试层的依赖倒置：`cap-bilibili/tests` → `cortico-world-bilibili/src`、`cap-media-studio/tests` → `cortico-world-media/src` + 根 `tests/helpers/panel-harness.mjs` | **中低** | 能力包的测试离开转接头/根 harness 就跑不了，因此「能力包可独立验证」这句话在测试层为假；换宿主时这层测试整体不可移植 | ① `grep -rn "cortico-world\|../../../tests/" packages/cap-*/tests \| wc -l` → 0；② 每包有只依赖 `persona-core` 假宿主的 in-package harness |
| D11 | `9 个 packages/*/dist` 产物是提交/落盘状态，且 `build-webui.mjs` 会**改写 package.json**（`:85-91` 加/删 `cortico.webUiClient`） | **中低（需复核）** | 构建脚本改 manifest → 构建顺序影响 package.json 内容，两次构建产出不同 manifest 的 diff；我只读到代码，未跑过脚本（只读纪律），未验证是否真造成脏 diff | ① `git status` 在连续两次构建后干净（我没执行，也不该由我在本任务执行）；② `dist/` 是否入库需查 `.gitignore`（我没读） |

---

## ④ 最该先做的 3 件事

1. **收一内核（D1）**：把 `Cortico-up/persona-core` 变成指向 `dsh-bili-whale/packages/persona-core` 的单一解析（link 或删），然后 `diff -rq` 必须长期为 0。这是唯一一条能同时消掉「改了包内行为线上没变」和「`capability.ts` 契约只存在于一份」的改动，收益/成本比最高。做完的判据不是「跑通测试」，而是 `diff -rq` 输出 0 行 + `check-live-drift.mjs` 里那条双份分支被删掉。
2. **把包边界从深链改成 exports（D2）**：先只做两件小事实名化——`cap-journal→cap-memory/src/workspace-git.ts` 和 `cap-media-studio→cap-bilibili/src/platform/paths.mjs`（后者本质是「配置/数据家路径」这个横切关注点被塞进了 bilibili 包，应上提到 `persona-core`），并给每个 `cap-*` 写 `exports` 白名单。这一步顺手把 manifest 少报的依赖补对（`cap-bilibili` 补 `cap-vision`、`cap-media-studio` 补 `cap-bilibili` 或改为依赖 persona-core 的新位置）。
3. **清一次「宿主在哪」的单一来源（D3）**：1 个 `scripts/lib/host-root.mjs` 常量 + `CORTICO_ROOT` 环境变量，替换掉 6 个脚本里的 `E:/WorkSpace_Qoder/Cortico` 和 3 个脚本里的 `Cortico-up`，以及 `extensions/package.json` 的 3 条 `link:E:/...`。这条最便宜，且直接降低 `start-cortico.mjs:19-21` 注释里那种「三条线没对齐所以起错实例」的事故面。

（第 4 顺位：D4 面板路由注入——因为它是唯一「服务端跑得通但面板静默坏」的问题，最难被现有 gate 抓到。）

---

## ⑤ 我没查清的东西（列全，别当已验证用）

1. **live 进程实际加载哪份 persona-core**：我只证明了「本仓那份被能力包相对引用」＋「宿主那份被 `@xiaoyu/persona-core` bare specifier 解析到、且 `node_modules/@xiaoyu/persona-core` 存在」。没读 live 的模块解析记录、没读 `Cortico-up` 里 world 代码的 import、没读 `~/.xiaoyu-home` 的 `deployment.json`。→ D1 的**影响半径**（到底有几处真在用 B 版）未量化。
2. **测试套件的通过状态**：纪律是只读，我没有跑 `node scripts/run-mjs-tests.mjs` / `pnpm gates`。所有「能加载」结论仅为 E1 的 8 次模块求值。109 个 `tests/` 文件的真实绿灯数 = 未知。
3. **任务描述里 `legacy/bili-account-retired/` 那次 ERR_MODULE_NOT_FOUND 事故**：本仓现在既无 `legacy/` 目录也无 0 个 git 跟踪文件；我没有去翻 git log 找那次 rename，所以「20 个宿主测试文件受影响」既没证实也没证伪，且**它可能是 Cortico-up 侧的事**。
4. **包内 vendor 的 license**：`packages/capabilities/cap-vision/src/vendor/see-now/LICENSE` 与 `NOTICE` 存在但我没打开；`vendor/dsh-autocut` 我只读了 LICENSE 头 5 行（MIT）和 VENDOR.md 未读；`packages/capabilities/cap-media-studio/src/vendor/` 6 个 .mjs 的上游与许可完全没查（它们不是 npm tarball 形态，可能是自写）。→ D6 里「许可风险」这一支是**无证据**。
5. **`check-hashes.mjs` / `check-consumers.mjs` 的实际覆盖范围**：我读了 `check-live-drift.mjs` 的注释和 `check-state-roots.mjs:28`，没读这两个脚本。所以「包内 vendor 不在哈希保护内」是推测，不是结论。
6. **`dist/` 是否入 git**：`ls -d packages/*/dist` → 9 个存在，但 `.gitignore` 内容我没读，无法判断是构建残留还是入库产物。D11 因此只到「代码会改写 manifest」这一层。
7. ~~**`tools/lib` 与 `packages/cap-*/src` 之间有没有语义重复实现**~~ → **已查明（撤回原疑点，改判）**：不是重复，是**单向转发壳**。实测：`tools/lib/*.mjs` 共 39 个，其中 6 个是转发壳、33 个是真身；全仓 `tools/` 里 11 个文件 import `../../packages/`；**反向边 `packages/ → tools/` = 0 条**。6 个壳的目标（`grep -h "export \* from" tools/lib/*.mjs`）：`cap-bilibili/src/platform/{traffic,plain-outbound,paths,kill,api}.mjs` ＋ `cap-media-studio/src/vendor/proc.mjs`。壳的自陈（`tools/lib/traffic.mjs:2-3`）：「真身已收编进 packages/…（独立化 A2，2026-11-04）。本壳保证 tools/ 的 CLI 薄壳、scripts/ 与 tests/ 的既有引用零破坏」。**方向正确**（老层依赖新层，不是复制）。仍遗留的量化事实：`tools/lib` 33/39 = **85% 的真身还没搬进任何包**，D7 的依据由这个数替代原先的猜测。
8. **`core/` + `panel/` 这条路今天还有人手动开吗**：`open-panel.cmd`、`start.cmd`（端口 8447）确实指到 `panel/server.js`，但当前只有 7799（Cortico）是线上实例。8447 面板是「保留的回滚入口」还是「已经没人用的第二套 UI」，我没证据（没看进程，也不该看）。
9. **`persona-core` 那 81 条包内 `./` specifier 里有没有指向已删文件的悬空引用**：只验了 `src/capability.ts` 一个入口，没做全量入口覆盖。
