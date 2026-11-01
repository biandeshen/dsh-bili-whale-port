# 架构盘点与解耦改造方案（2026-11-01）

对象：`Cortico`（框架+宿主，master）、`Cortico-dev`（dev/policy）、`dsh-bili-whale`（CLI/数据层，port/core-opencode-panel）、`Cortico-dev/persona-core`（人格内核）。
配套审计报告：`E:/WorkSpace_Qoder/AUDIT-2026-11-01.md`（缺陷证据、自报对账）。本文只做**结构分析与改造方案**，缺陷的现场证据不重复抄。

---

## 0. 基线声明（先读这一节）

**本页的分析与改造全部针对 `master@144157d`（及其 dev/policy 工作树）。**写成时仓库里还有**第三个检出**，它不是实验分支，是另一条主干：

| 检出 | 分支 | HEAD | 相对 master | 相对 upstream/main |
|---|---|---|---|---|
| `E:/WorkSpace_Qoder/Cortico` | `master` | `144157d` | — | 落后 **435**（无共同祖先，合并不成立） |
| `E:/WorkSpace_Qoder/Cortico-dev` | `dev/policy` | `fe4392c` | 同一份工作树，只多 3 条 | 同上 |
| **`E:/WorkSpace_Qoder/Cortico-up`** | **`reanchor/replay`** | **`c3cb8ff`** | 落后 116（未合 master） | **落后 0 / 领先 100** |

> 基线数字会变。这一行写于 2026-11-02 00:4x：`reanchor/replay` 已**追平上游**（落后 0）。数字若再变，以 `git rev-list --count HEAD..upstream/main` 现算为准，不要引本表。

**2026-11-02 补记（重要，推翻本文早先的一句判断）**：本文先前写"`reanchor/replay` 是功能超集，落在这里不回退任何能力"。**那句是错的**，逐文件核对后发现它比 `dev/policy` 少了整整 8 条提交（重放停在了 `0ecbc0e` 那个点位，之后的都没搬）：

```
91aa02e  因果账与私人日记写失败不再吞掉
2affef6  历史能按日期和关键词检索，日记能按小节取
ba89ab2  通知渠道在页面上是下拉
ddca555  前置检查失败不再把启用意图一起抹掉
316928b  手脚清单口径跟着授权改
9158aaa  日记能给区间汇总
480d456  控制台顶栏能填"我是谁"
fe4392c  她真能看图了 —— bili_look 把图作为附件交回
```

这 8 条已逐条 cherry-pick 到 `reanchor/replay`（两处真冲突：`server.ts` 的 import 与激活失败日志、`live/index.ts` 的顶栏布局，都按"两边能力都留"解掉）。补完后 `bili_look` / `summarizeDiaryRange` / `searchTranscript` / `history/search` / withLedgerError / cortico.live.who / ENUM_KEYS 七项在两条线上取值相同；`tsc` 两个项目均 0 错，`vitest run` 290 文件 5208 通过。**"功能超集"这个结论现在才是真的，之前不是。**

`reanchor/replay` 是从上游 `cb9ddbd`（0.2.7）**认亲后重放本地改动**的产物（`git merge-base` 与 `upstream/main` 只差 57 个提交，不是快照导入）。它已经做掉了本页列为"未做/待做"的一批事，**这些条目在原线上不必重做**：

| 本页原本的待办 | `reanchor/replay` 的实际状态 | 代码证据 |
|---|---|---|
| 上游 `StreamErrorEvent` 缺失 → opencode provider 加载失败 | **已补** | `src/providers/transport/errors.ts:13` `class StreamErrorEvent extends LLMError` + `:21 upstreamText` |
| 判断→动作闭环（#31） | **已做（两版）** | `definition.ts:473` `bili_judgment` 工具、`:581` 判断卡面板、`:620` `judgment-adopted`；`tank.ts:522` `judgmentList` |
| 模型候选进供应商页（`modelOptions`） | **已做** | `a227bfd` 端点可声明候选、`5128677` 名字行、`6ec1d11` 保存校验去重 |
| 她的名字双源（#48） | **已做** | `tank.ts:207` `hostDisplayName`、`:220` `renameSelf`；`60db038` 本机名与 B 站昵称分开说 |
| 控制台看历史（#59） | **已做** | `server.ts:31` `readTranscriptHistory`、`:1818` `/api/runs` |
| 浏览器激活失败不可见 | **已做** | `3d5a075` 原因留在卡片上并可就地填 |

**同一条里必须区分清楚的**：`2711963`「控制台的图能真看，看不了就明说」修的是**控制台**（人发给她的图、界面上的图），**没有**给她新增读图工具——`definition.ts:898` 仍是 `canSeeImages()`，本部署无 `*_image` 工具 → 恒 false。所以"她能看图"这件事**仍未做**，别把两者混为一谈。

**因此执行前必须先定一件事：改造落在 `master` 还是 `reanchor/replay`。**

### 0.1 结论：落 `reanchor/replay`

实测对比（同一台机器，两次独立核查）：

| 判断项 | `master` | `reanchor/replay` |
|---|---|---|
| 上游距离 | 落后 435，且**无共同祖先** | **落后 0**（已追平） |
| opencode provider | 加载失败（缺 `StreamErrorEvent`） | **可加载** |
| 判断卡 / 名字双源 / 控制台历史 / 激活失败可见 | 无 | **有** |
| `tsc --noEmit`（两套配置） | 干净 | **干净**（修复前 web 侧 41 错） |
| World 工具集 | 15 个 | **15 个一个不少** |
| 本会话新增的 8 条功能 | 缺 5 条 | **补齐后 8 条全有**（见 §0 补记） |
| 部署目录 | `deployments/mybot` | 同一份 |

三条理由：① 它已经解掉本方案 P0 的两个外部阻塞（上游、provider），在 master 上做等于先补一遍再迁；② 重放漏下的 8 条提交补完后，它才是真正的功能超集（**这句先写错过一次**，见 §0 补记）；③ 它结构已更干净，C/C2 的工作量更小。

**落线门三条，逐条给状态**（2026-11-02 00:4x 实测）：

| # | 门 | 怎么验 | 状态 |
|---|---|---|---|
| ① | 编译 | `npx tsc --noEmit` + `npx tsc -p tsconfig.web.json --noEmit` | **通过**：两套均 0 错 |
| ② | 测试 | `npx vitest run`（全量，不只 web） | **通过**：290 文件 / 5208 通过 / 3 跳过 |
| ③ | 两张皮能不能合上 | 真机跑一次真实 tick + 一次 `bili_debrief` | **通过**：tick 持续有新行（2026-11-02 00:28 仍在写），debrief 六节齐全 |

> ③ 的意义：`reanchor/replay` 改的是宿主侧（World/前端），`dsh-bili-whale` 是另一条线的 CLI；两边对回执契约、路径解析、环境变量注入要有同一套理解。实测三件事都成立——`days/<今天>/ticks.jsonl` 有新增行、`fields.json` 的 `lastAppliedAt` 在推进、`bili_debrief` 回执含"采样口径/还剩多少"这类事实字段。
> **但这只证明了"能跑"，没证明"跑对"**：8 条补齐之后要按 §8 每 4 个 commit 重跑一次六项检查，别拿一次通过当长期结论。

切换完成后 `master` 只做维护（hotfix），不再承接新功能；本页后续所有条目默认作用在 `reanchor/replay` 上。


---

## 1. 现状架构（实测）

三仓两进程，边界是进程与权限：

```
浏览器 127.0.0.1:7799
   WebUI（框架）                        world:bili-account 世界页（7 面板）
        │                                       │
        ▼                                       ▼
Cortico 进程 ────────────────────────────────────────────────
  core/          Loop / Bus / Session / Storage / Tools 装配
  bot.ts         读部署 config → 装 Persona / World / provider
  persona-core/  纯 TS 人格内核（15 模块，无 IO）
  worlds/
    bili-account/  definition.ts(15 工具 + 生活循环 + WebUI 声明)
                   tank.ts(persona/配置数据面) personaAdapter.ts(内核适配)
                   diary.ts(纯函数) dm*/gates/task-queue/runner/webui/
    console / qq / minecraft / websearch / bilibili(内建，未启用)
  providers/     openai-responses-compat / llamacpp / webui
  extensions/    装 npm 包 → 主进程 import
        │ spawn（唯一对外出口）
        ▼
dsh 子进程（短命）                         状态落点（四处）
  tools/commands/ 32     tools/lib/ 32      ~/.dsh/bili-whale/   人格/日记/草稿/账本
  scripts/ 36            panel/ 8447        ~/.dsh/bili-ai/      风控/队列（新家）
  tools/drafts/ publisher                   ~/.bili-ai/          凭据
                                            D:/AI/养鱼/drafts    草稿真身
        │ HTTPS（额度/间隔/幂等/kill）
        ▼
     B 站 API
```

规模：她的 World **15 个工具**、世界页 **7 个面板**、dsh **32 命令 / 32 库 / 36 脚本**、配置 **58 项（17 项未在 DEFAULTS 声明，18 组）**、实装扩展 **5 个**。

---

## 2. 耦合度评估（结构原因，不是缺陷清单）

| 模块 | 内聚 | 对外耦合 | 可替换性 | 判断依据 |
|---|---|---|---|---|
| `core/` | 高 | 低 | 高 | 对 `bili\|whale` 零命中，语义无关 |
| `persona-core/` | 高（纯函数） | **实际上低，工程上高** | 低 | **没有 `package.json`**，靠相对路径被 `personaAdapter.ts` 直接 import；不能独立安装/版本化 |
| `worlds/bili-account/definition.ts` | **低** | 高 | 低 | 一个文件同时担当：工具声明、工具实现、生活循环、WebUI 声明、环境提示词、面板路由、配置校验 |
| `tank.ts` | 中 | 高 | 中 | 同时做：配置读写、策略读写、草稿统计、体征、反馈计数、头像；且**复写了 dsh 的策略语义** |
| `diary.ts` | 高 | 低 | 高 | 纯函数 + 测试齐，是全仓最好的样板 |
| `personaAdapter.ts` | 中 | 中 | 中 | 适配层定位正确，但承担了 state 文件读写（IO）与内核语义混合 |
| `dsh tools/lib/` | 中 | 中 | 中 | `traffic/paths/ack` 清晰；但 `dm-quota`/`reply-draft` 等**自带落点**，绕过 paths |
| `dsh tools/commands/` | 中 | 中 | 中 | 每命令一个文件，好；但每个命令各自拼 `.bili-ai` 路径 |
| 跨仓语义 | — | **高** | 低 | 发送策略、路径解析、日记小节解析各两份实现，无跨仓等值测试 |

三条结构性断层（其余缺陷都长在这三条上）：

- **FR-1 状态落点四分**：同一个概念（草稿、风控状态、队列）在不同代码路径解析到不同目录 → 所有"读数不一致"的根。
- **FR-2 同一语义两份实现**：`publish-policy.mjs` ↔ `readPolicyLite`；`draftsDir()` ↔ `definition.ts:170` ↔ `wake-audit.mjs`；日记小节解析 ↔ `compose.mjs`。
- **FR-3 一个文件即一个子系统**：`definition.ts` 把六件事焊在一起，任何一项改动都要重新验证其它五项，也无法被别的 World 复用。

（命名为 `FR-` Fracture，避免与 `ISSUES.md` 里表示"已修复"的 `F-01…F-13` 撞号；详见 `docs/README.md` §6.2。）

---

## 3. 目标架构（v2 · 2026-11-01 修订）

**原则**：内核纯函数、边界用端口、能力走适配器、装配只在一处、状态只有一个家、**每个状态只有一个写者**、**每次写入可归因**。

### 3.1 结构

```
┌─ 约定的唯一实现（不新建层，只在现有两处里各指定一份）──────────────┐
│  persona-core/index.ts     补 package.json + exports（它本来就该是包）│
│  dsh tools/lib/publish-policy.mjs   策略唯一实现（含 schema/向量）    │
│  Cortico src/worlds/bili-account/diary.ts   日记小节唯一实现          │
│  dsh tools/lib/state-roots.mjs      resolve(kind) → {write, read[], owner} │
└───────────────┬───────────────────────────────────────────────────┘
                │ 端口（interface）
┌───────────────▼───────────────────────────────────────────────────┐
│ World（与宿主无关的"她"）                                            │
│   tick.ts              显式五阶段：settle → decay → decide → apply → deliver│
│   life-engine.ts       只做 decide（纯，14 种活动）                   │
│   memory-gateway.ts    recall / remember / void（经 port，不碰文件）  │
│   expression-pipeline.ts  (state) → Intent                          │
│   perception-gateway.ts   (bvid) → DebriefResult（经 port）          │
│   definition.ts        只留 15 工具声明 + 装配 + WebUI 声明          │
└───────────────┬───────────────────────────────────────────────────┘
                │ 适配器（可替换）
   dsh-cli（现状，唯一实现） · （未来）MCP server
                │
   横切三件（每条写路径都要过）：
     actor 归因   causal.jsonl 与日志里带 webui:operator / cli:script:<name> / world:<id>
     withStateLock(name, fn)   状态文件互斥（从 traffic.mjs 提取，通用化）
     migrations.json          数据迁移账本（planned → done + sha256，可幂等重跑）
```

判定表——一个能力该放哪（不变）：

| 判据 | 内核 | World | 扩展(npm) | MCP |
|---|---|---|---|---|
| 是"她"的语义（场值/记忆/情绪） | ✅ | | | |
| 某平台细节（B 站/QQ） | | ✅ | | |
| 跨 World 复用且与本机无关 | | | ✅ | |
| 跨机器给别的 agent 用 | | | | ✅ |
| 会写外部系统 | | ✅ | | |

### 3.2 v1 的四处错误（不是能力缺失，是判断错）

| # | v1 的问题 | v3 的改法 | 落在 |
|---|---|---|---|
| 1 | 发明 `contracts/` 层 = 第四个副本 | 删掉该层，只在现有两份里指定唯一者 | B |
| 5 | 端口化过度（给 5 个能力设计 port，实际只有一个实现） | D 收窄到只做 debrief | D |
| 6 | 回执既给模型看又被正则解析，没定渲染唯一出口 | `DebriefResult` + `renderDebrief()` | D |
| 10 | 回滚只有单步，且备份从未真恢复过 | A1.5 先做恢复演练 | A |

### 3.2.1 v2/v3 补上的六项能力（不是纠错，是原来就没有）

| # | 补什么 | 为什么必须有 | 落在 |
|---|---|---|---|
| 2 | **写者所有权**（`owner: cli \| host \| both-with-lock`） | 路径统一后两进程仍会各写；实测已分账 | A0.5 / A7 |
| 3 | **迁移账本**（`migrations.json`，planned→done + sha256） | `--go` 中断后无法判断搬没搬过 | A4.5 |
| 4 | **tick 五阶段**（settle→decay→decide→apply→deliver） | 顺序语义原来没有归属，错了测试也全绿 | C |
| 7 | **停用契约**（`onDeactivate: keep\|archive\|purge`） | 现在"停用"没有定义，残留累积 | E |
| 8 | **写操作归因**（`actor`） | `figure` 被谁关的查不出 | A8 |
| 9 | **门禁归因**（报告带 `gitSha` + owner） | 出红时要知道是谁弄红的 | F |
| 11 | **persona-core 包化** | 6 处脚本用 `file:///` 拼路径，换目录即静默失败 | B2 |
| 12 | **`tank.ts` 拆分** | 592 行 33 导出，读写混在一处，P0-2 就长在这 | C2 |

### 3.3 明确不动的部分（防过度纠正）

- **三条硬边界**（单调度器 / 安全单点 `ack+kill+go-gate` / 冻结判据）——一条都不碰；
- **B 站能力留在 World**，不拆成插件；
- **不引消息队列/数据库**；
- **不给 15 个工具设计抽象基类**；
- **不把 persona-core 拆成多包**：它只需要一个 `package.json` 与 `exports`（见 B2），拆包是另一种过度设计；
- **她不读 `docs/`**（v3 新增边界）：World 内没有任何读取 `docs/` 的代码路径，唯一喂给她的是 `ENV_PROMPT.md`。这是有意的——文档是**描述**，日记和记忆才是**经历**。将来若有人想"把文档喂给她让她懂自己"，先回答一个问题：那是她的记忆，还是主人的说明书？本项目按后者处理，因此不做。**若要做，必须是独立提案，不能夹在解耦改造里。**

### 3.3.1 跨仓耦合的准确口径（v3 修正）

原文引 `ARCHITECTURE-2026-11.md` 写"dsh 不 import 人格算法，只吃文本回执"。**实测与此不符**，必须改准：

| 类别 | 允许依赖 persona-core？ | 现状 | 理由 |
|---|---|---|---|
| `tools/commands/*`（对外命令） | **否** | 是（只吃文本） | 命令是手脚，不该懂人格 |
| `tools/lib/publish-policy` 等 | **否** | 是 | 纯策略 |
| `scripts/counterfactual` `preview-recall` `simulate-rhythm`（诊断/模拟） | **是，且必须走包边界** | 是（但用 `file:///` 拼路径） | 反事实必须用同一套人格函数，否则结论无效 |
| `scripts/drill-gate` `smoke-tools` | **是**（读 World 定义） | 是（拼路径） | 门禁探针，需要真实定义；改为只读接口或显式"仅同仓可用" |

结论：跨仓耦合**不是要被消灭**，而是要被**声明与约束**——诊断脚本允许，命令不允许，且一律经包名 import（B2）。

### 3.3.2 跨仓契约的唯一范本（v3 新增）

全仓已有**一处做对了的跨仓契约**：`tools/drafts/voice.schema.json` —— 它把 `persona-core` 的 `buildVoiceBrief` 输出固化成 JSON Schema，`draft-dynamic` 的 `assertVoice` 与之对齐，`tests/contract/voice.test.mjs` 锁住两侧一致，文件头还写明"必须一致（有测试锁定）"。

**这才是跨仓契约的模板**：schema 文件 + 两侧校验 + 一致性测试 + 注释说明。B 方案的策略向量、日记小节解析、以及 `debrief` 的 `DebriefResult`，都应当照这个形状做，不要再发明新花样。

### 3.4 与原架构文档的差别

| 维度 | 原文档 | 本方案 |
|---|---|---|
| 关注点 | 层次与所有权（谁在哪层、允许做什么） | **边与契约**：层不变，补三类边（状态 / 语义 / 能力）+ 两件横切（归因 / 锁） |
| persona-core | "一等包、平台无关"（ARCHITECTURE.md §2） | 同一定位，但**指出它现在做不到**：无 `package.json`，靠相对路径 import |
| 状态落点 | 承认"两个目录两种口径" | 升级为契约：`resolve()` + R1–R5 规则 + 测试 |
| 策略 | "单一事实源在 publish-policy.mjs" | 指出实际有两份（`readPolicyLite`），给出消除步骤 |
| World 内部 | 只约束"不该有什么" | 给出**该有什么**：五个文件，各自输入输出与依赖允许表 |
| 不可拆三条 | MODULARITY 列出 | 全部保留并加强；把"不该拆"与"该怎么拆"分开写 |
| 记忆层（A+C/MemoryWeaver） | BLUEPRINT 保留为设计 | **不碰**，划归内核专项，与解耦无关 |

### 3.5 优势 / 劣势（不掩饰）

| 优势 | 怎么证明 |
|---|---|
| 读数不再说谎 | badge == 面板 == 灯 == CLI，一条断言 + 一次 curl 三项对照（现为 0 vs 1） |
| 换实现不改 World | 把适配器换成 stub，World 全部测试仍绿 |
| 改动半径可度量 | `definition.ts` 行数 ≤1/3、`--flag` 出现 0 次、`'.bili-ai'` 字面量 0 处——三个数字进 gates |
| 语义不再漂移 | 策略向量双向测试；改一侧另一侧必红 |
| 出事能查到人 | 每条写有 `actor`，`figure 被谁关的`这类问题当天可答 |

| 劣势 | 代价 | 为什么仍值得 |
|---|---|---|
| 改造期风险 | 动的是"她真的会动"的路径；错的表现是"她不说话了"而不是测试红 | 每步跑真实 tick 看 `ticks.jsonl` 有新行，不只看单测 |
| 多一层间接 | "发一条私信"从 1 跳变 3 跳 | 只对 debrief 做端口化，其余保留直调 |
| 拆文件后"一次改动变三处" | 现在改生活循环只碰一个文件 | 但现在是"改一处要重验五处" |
| 文档与代码不同步风险 | 分层越细 owner 越易错 | 所以 D1（补 owner）+ M1（owner 检查进 gates）先做 |
| **不改善"她更像人"** | 纯工程卫生 | 必须说清：解耦解决可维护性与可信度；体验缺口在判断→动作、事件驱动、看图、扩展能力，另立验收 |

---

## 4. 六个改造方案（按杠杆率排序）

每个方案给：问题 → 方案 → 契约 → 迁移 → 验收 → 规模。

### A. 状态根单一化（解 FR-1）— 最高杠杆

**问题（实测）**：`grep -rn "\.bili-ai" tools scripts panel core adapters` = **62 处出现（其中 11 处在 `paths.mjs` 自身，实际待收口 51 处）**；写操作集中在 4 处（`comment.mjs:195`、`selftest.mjs:103-104`、`core/scheduler.js:429`），读操作散布在 quota/diary/dm/feed/deps/verify。基础设施其实已经就位：`paths.mjs` 有 `stateDir/statePath/stateReadPath/stateExists/readStateText/writeStateText/stateReadPathFrom/credentialsPath/draftsDir`，`tests/contract/state-home.test.mjs` 有 9 条契约测试。**缺的不是能力，是收口。**

#### A0 先定语义（写进代码，不靠记）

新增 `tools/lib/state-roots.mjs`（不新建层，放在既有 `tools/lib/` 里）：

```js
// resolve(kind) → { write: string, read: string[], owner: OwnerKind }
// OwnerKind = 'cli' | 'host' | 'both-with-lock'
```

#### A0.5 写者所有权表（v2 新增，v1 的漏洞）

**"只有一个写入路径"不等于"只有一个写者"**。实测：`traffic-state.json` 新旧两份同时在写、数值不同（14:20 新家 `readDay 53`、13:13 旧家 `36`）——路径统一后，两个进程仍会各写各的。

| 状态文件 | 唯一写者 | 允许共写？ | 依据 |
|---|---|---|---|
| `traffic-state.json` | `cli`（所有 HTTP 都经 CLI） | 否 | 只有 `traffic.mjs` 该动它 |
| `api-ban.json` / `api-cache.json` | `cli` | 否 | 同上 |
| `pending-replies.json` | `cli`（go-gate） | 否 | 宿主只读 |
| `dm-quota.json` | `cli` | 否 | 发送方唯一 |
| `fields.json`（人格状态） | `host` | 否 | 只有 World 结算时写 |
| `draft-result.json`（游标） | `host` | 否 | 宿主消费 |
| `diary*.md` | `host` | 否 | 只有 World 写日记 |
| `causal.jsonl` | `both-with-lock` | **是** | CLI 写 `draft-result`，宿主写 `policy-change` 等 → 必须 `withStateLock` + `appendFileSync` 单行原子 |
| `runs/*` | `host` | 否 | Core 独占 |

落地两条：
1. 每个文件在 `resolve()` 里声明 `owner`；调用侧若以错误身份写，测试直接红（用一个 `assertWriter(kind, who)` 守卫，`who` 由进程入口注入：CLI 入口=`cli`、World=`host`）。
2. `both-with-lock` 的文件只允许 `withStateLock(name, fn)` 下写；`withStateLock` 从 `traffic.mjs` 现有锁提取，通用化后两边共用。

#### A0.6 四条硬规则（原 A0 表格，新增 R5）

| 规则 | 内容 | 不这么做会怎样 |
|---|---|---|
| R1 | 读写分离：写只用 `write`，读按 `read` 顺序探测 | 现状 `dm.mjs` 读写都用旧家 → 额度分叉（已实证 5 vs 4） |
| R2 | `credentials.write` 固定旧家 `~/.bili-ai` | 写新家 → 陈旧副本压住真 cookie → 登录静默失效 |
| R3 | `drafts.write` 取**当前真实在用**的目录（现为 `D:/AI/养鱼/drafts`），首次启动打一条日志 | 两个 `DRAFTS_DIR` 各判一次 → badge 恒 0 |
| R4 | 探测必须"存在即用"，不得因目录不存在改变读取语义 | `tank.ts` 读不存在的目录 → 待放行恒 0 |
| **R5** | **每个文件只有一个写者（或显式 `both-with-lock`）**；写者身份由进程注入，错写即红 | 路径统一后仍会分账 |

#### A1 基线快照（先把"错的现场"固定下来）

1. 记录当前读数：新旧两份 `traffic-state` 的 `readDay/writeDay`、`dm-quota` count、草稿条数与 pending 数。
2. `npm run gates` 输出存 `docs/evidence/gates-before-A.json`。
3. 把已知错误写成**会失败的测试**（红着进来）：
   - `badge 待放行 == 待审稿面板 pending 数`（现在 0 vs 1，必红）
   - `traffic-state 只有一处写入路径`（现在两份都动，必红）
4. **v2 新增**：把写者所有权表落成 3 条测试（`cli` 写 `fields.json` 必须被拒、`host` 写 `traffic-state.json` 必须被拒、`both-with-lock` 无锁写必须被拒）。

**迁移的验收 = 这些测试从红变绿**，不是"跑绿了"。

#### A1.5 真恢复演练（v2 新增，v1 只有备份没有演练）

审计实测：备份只跑过 1 次，且**从未 `--apply` 恢复过**（`backups/` 下没有 `pre-restore-*`）。没演练过的备份不算备份。

开工前必须做一次，并把结果写进 `docs/evidence/restore-drill-<日期>.md`：
1. `node scripts/ops-backup.mjs --go` → 记包名与 MANIFEST。
2. 恢复到**临时目录**（不是原地）：`--restore <包> --to <临时目录> --apply`。
3. 比对：`fields.json` 记忆条数、两本日记 sha256、`causal.jsonl` 行数、草稿 pending 数。
4. 四项全等才算通过；不等则先修备份脚本，再谈迁移。

#### A2 用 `resolve()` 重写 `paths.mjs`（不改任何调用方）

保持现有导出签名不变；内部改调 `resolve()`；补 `resolve('queue')`、`resolve('runs')`；`legacyStateDir()` 只允许 `resolve()` 调用，并在文件头写禁止外部再拼。
验收：`state-home.test.mjs` 9 条 + R1–R4 各 1 条全绿。

#### A3 收口写侧（风险最小，先做）

| 批 | 位置 | 动作 | 验收 |
|---|---|---|---|
| A3-1 | `selftest.mjs:103-104` | 自检标记 → `writeStateText` | 自检仍能跑过 |
| A3-2 | `core/scheduler.js:429` | `dm-tick-err.log` → `resolve('log')` | 出错时日志落在新家 |
| A3-3 | `comment.mjs:195` | `once-debug.log` 同上 | 同上 |
| A3-4 | `dm.mjs:50,81` + `reply-draft.mjs:25` | 读写都走 `statePath`/`stateReadPath` | **`dm --status` 的 count 与文件内容一致**（解 P1-1） |
| A3-5 | `core/api/routes.js`、`panel/data.js` 残余 | 改走已有的 `stateReadPathFrom` | 面板与审批视图同数 |

#### A4 一次性数据迁移（在改读侧之前做）

`scripts/migrate-state-roots.mjs`：默认 dry-run，列"哪个文件从哪搬到哪、多大、是否两边都有"。
冲突策略必须显式：两边都有 → 保留写入侧，另一份改名 `.legacy-<时间戳>` 存档并记 manifest；`--go` 先复制、校验字节数、再删旧，任一步失败即中止。
迁移对象：`pending-replies.json`（现只在旧家）、`dm-quota.json`、`traffic-state.json`、`api-ban.json`、`used-images`、`replied/favorites/liked-videos`。
**草稿目录不搬**：`D:/AI/养鱼/drafts` 是活的正在写，只注册为 `drafts.write` 当前值。

#### A4.1 若改 `fields.json` 结构，必须先 bump `schemaVersion`（v3 补漏）

`personaAdapter.ts:155` 写死 `STATE_SCHEMA_VERSION = 5`；`:166-168` 遇到**高于 5 的版本直接抛** `state schema unsupported`，`loadState` 随后走 `.bak` 恢复。后果很具体：如果 A4 顺手改了 `fields.json` 的结构（加 `voided`、改 memories 形状）却没 bump 版本，旧进程读到新文件 → 抛错 → 回滚到 `.bak` 的旧结构 → **迁移白做，而且你看不出是迁移失败**。

规则：
1. 任何结构性变更 → `STATE_SCHEMA_VERSION` 加 1，并在 `normalizeState` 里加 `5→6` 的显式转换（只加字段、不删字段）。
2. 加**双向兼容测试**：新代码读 v5 文件正确升到 v6；**旧代码读 v6 文件必须抛错**（现状正确，但没人测）。
3. 迁移账本（A4.5）里记 `fromVersion/toVersion`。

#### A4.2 旧家兜底必须有退场日（v3 补漏）

`stateReadPath` 现在是"新家没有就读旧家"，而**这个兜底永远不会自己结束**。三年后 `~/.bili-ai` 还在被读，于是没改到的调用点只要旧家有文件就"看起来正常"——A 方案就只是"暂时对齐"，不是归一。

规则：
1. `resolve(kind)` 返回 `legacyUntil`（默认 `2026-12-01`），可用 env 覆盖。
2. 未到期：照旧兜底，但**每次读旧家记一条 WARN**（把"还在用旧家"变成可观测事实）。
3. 到期后：`read` 数组不再含旧家路径；旧家文件仍在盘上但不读。到期前一周在 `STATUS` 里挂一行提醒。
4. 测试：把时钟推到 `legacyUntil` 之后，断言 `read` 里没有旧家、且读不到旧家时返回 ENOENT 而不是静默空值。

#### A4.3 数据回滚路径（v3 补漏）

所有回滚都只写"revert commit"，但**代码回滚了、数据已经搬走了**——旧代码读新家还是把数据搬回去？没有答案就会卡住。

规则：`migrations.json` 的 `done` 记录里存 `{from, to, sha256}` 三件；`migrate-state-roots.mjs --rollback <id>` 按记录把文件搬回原位并校验 sha256；`--rollback` 同样默认 dry、`--apply` 才写。验收：迁移后立刻 `--rollback --apply`，三处读数回到迁移前且 sha256 一致。

#### A4.5 迁移账本（v2 新增）

`--go` 搬到一半崩掉时，第二次跑无法判断"这文件搬过没有"。`fields.json` 有 `schemaVersion` 兜底，但数据迁移本身没有。

`~/.dsh/bili-ai/migrations.json`：
```json
{ "migrations": [ { "id": "state-roots-2026-11", "at": "…", "state": "planned|done|failed",
                    "files": [ { "from": "…", "to": "…", "bytes": 8874, "sha256": "…" } ] } ] }
```
规则：`--go` 前写 `planned`、全部成功改 `done`、任一步失败记 `failed` 并保留现场；重跑时 `done` 直接跳过、`failed` 从断点续（已搬的校验 sha256 后跳过）。

#### A5 收口读侧（51 处待收口）

| 批 | 范围 | 注意 |
|---|---|---|
| A5-1 | `tools/lib/*`（cred、config、credentials/bilibili、publishers） | 凭据类走 `credentialsPath()`，不走 `statePath` |
| A5-2 | `tools/commands/*`（quota、comment、feed、diary、dm-await、danmaku-await、deps） | 日志类走 `resolve('log')` |
| A5-3 | `core/*`（scheduler 7、routes 5、client 2） | 进程内读点，改完必须重启真机验证 |
| A5-4 | `scripts/ops-backup.mjs` | **它现在备份的 drafts 目标就是错的**，改完重跑一次备份核对 manifest |
| A5-5 | `tools/verify/*` | 只读，最后改 |

#### A6 上锁

1. `scripts/check-state-roots.mjs`：`paths.mjs`/`state-roots.mjs` 之外出现 `'.bili-ai'` 字面量即失败，进 `gates`。
2. 同源断言：起真服务，`/api/webui/manifest` 的 badge 与 `panels/drafts/state` 的 pending 数相等。
3. 单写断言：测试锁定 `traffic-state.json` 只能经 `statePath` 写。
4. 把 `grep -c "'.bili-ai'"` 的存量数字记进 `docs/evidence/`，作为后续回归指标。

#### A7 状态锁通用化（v2 新增）

`traffic.mjs` 已有"同一状态一次只做一次预留/更新"的锁。提取成 `withStateLock(name, fn)`，所有 `both-with-lock` 的状态文件（当前只有 `causal.jsonl`）都走它。
验收：两个进程同时 append `causal.jsonl`，行数与内容完整（不出现半行、不丢行）。

#### A8 写操作归因（v2 新增）

审计最扎心的一条：`World 激活状态已改 {id, enabled}` **没有操作者**；`figure` 在 14:13 被关掉，至今查不出是谁。

规则：
1. 进程入口注入 `actor`：CLI 子进程=`cli:<脚本名>`、宿主=`host:world:bili-account`、WebUI 写=`webui:operator`（无登录态时记 `webui:anonymous`）。
2. 所有写 `causal.jsonl` 的调用必须带 `actor`；`gates` 加一条：新增 causal `kind` 若无 `actor` 即失败。
3. WebUI 面板（待审稿/策略/扩展）的写操作把 `actor` 显示在"她的一天"里。

验收：新发生的同类事件（如关掉 `figure`）能立刻回答"谁做的"；历史事件无法补，但**从现在起每次写入都有署名**。

#### A 总验收（缺一不算完）

1. `paths.mjs`/`state-roots.mjs` 之外 `'.bili-ai'` 字面量为 **0**（含 panel/core/scripts）。
2. `badge == 面板 == 灯 == CLI`，且用**真实"有 1 条 pending"**验证。
3. 迁移脚本跑两次：dry 输出符合预期；`--go` 后三处读数一致且备份包含全部状态文件。
4. **每个状态文件只有一个写者**（或显式 `both-with-lock` 且带锁），错写测试全绿。
5. **迁移账本**存在且状态为 `done`；中断重跑幂等（已搬的按 sha256 跳过）。
6. **恢复演练**做过一次（`docs/evidence/restore-drill-*.md` 四项全等）。
7. **写操作带 `actor`**：今天再关一次 `figure`，能在"她的一天"里看到是谁。

#### 顺序与规模

**A1.5（恢复演练，必须先做：证明退路存在）→ A0/A0.5（语义与写者表）→ A1（四红测试）→ A2（换实现）→ A3（写侧五批）→ A4（数据迁移）→ A4.5（账本）→ A5（读侧五批）→ A6（上锁）→ A7（锁通用化）→ A8（归因）**。

两条顺序理由：
- **A1.5 提到最前**：如果备份恢复不成立，整条迁移链没有退路，先证明退路再动土。
- **A4 必须在 A5 之前**：读侧一改旧家就不再被读，数据要先归位；A3 先做是因为风险最低且立刻解掉 dm 额度分叉。

规模 **5–6 天**（v2 比 v1 多：演练 0.5 + 写者表与锁 1 + 归因 0.5）。回滚：全部是"新增函数 + 调用点替换"，按 commit 逐个 revert；数据迁移有 `.legacy-*` 存档 + `migrations.json` 账本。

### B. 策略内核单一实现（解 FR-2 之最危险一处）

**问题**：`tools/lib/publish-policy.mjs` 与 `Cortico/src/worlds/bili-account/tank.ts` 的 `readPolicyLite` 是同一语义的两份实现（发送档位、auto 上限、时段、点赞/收藏/回信档位）。当前逐行等价，但各被自家测试锁，**没有跨仓等值测试**——新增一个键，靠人记得改两处。

**方案**：dsh 侧那份变唯一实现，并生成 schema 供页面渲染。

```ts
// tools/lib/publish-policy.mjs（唯一实现）
export const POLICY_SCHEMA = { … }            // 字段/类型/范围/默认值
export function normalize(policy): Policy      // 收敛与兜底
export function inWindow(policy, now): boolean
export function capReached(policy, todayCount): boolean
```

Cortico 侧删掉 `readPolicyLite`，改为：服务端 import 该模块；页面字段由 `POLICY_SCHEMA` 渲染，不在前端硬写六个控件。

**迁移步骤**
1. 建 `tests/contract/policy-vectors.json`：≥20 条输入/期望（含 `autoDailyCap=0` 表示不限、`autoWindow=""` 表示全天、非法值回落）。
2. 两侧各加一个读同一份向量的测试（此刻两侧应都绿，证明"等价"是实测而非断言）。
3. 删 `readPolicyLite`，Cortico 改 import；把 `policySet`/`settingsSet` 的校验改调 `normalize`。
4. 页面控件改由 schema 渲染（`llm-settings` 那套字段渲染可复用）。
5. 加一条"改一侧语义，另一侧测试必红"的元测试：故意把向量里一个期望改错，确认两侧同时红（手动跑一次，记入 evidence）。

**验收**：`grep -rn "readPolicyLite" Cortico/src` = 0；向量测试覆盖字段全集；新增键只改 `publish-policy.mjs` 一处，页面自动出现。
**规模**：0.5–1 天。**风险**：auto 模式涉及对外发言，迁移期必须保持 `draftMode=review` 不变，最后一步才验证 auto 路径。

---

### B2. persona-core 包化：消灭 `file:///` 拼路径的跨仓 import

**实测（比"没有 package.json"严重得多）**：dsh 有 **6 个脚本**用字符串拼路径动态 import Cortico 的源码——

```js
const { buildVoiceBrief } = await import('file:///' + CORTICO.replace(/\\/g,'/') + '/persona-core/src/voice-brief.ts')
```

| 脚本 | import 的是什么 |
|---|---|
| `scripts/counterfactual.mjs:20` | `persona-core/src/voice-brief.ts` |
| `scripts/preview-recall.mjs:16` | `persona-core`（同上） |
| `scripts/simulate-rhythm.mjs` | `persona-core`（同上） |
| `scripts/drill-gate.mjs` | `src/worlds/bili-account/definition.ts` + `gates.ts` |
| `scripts/smoke-tools.mjs` | `src/worlds/bili-account/definition.ts` |

后果：Cortico 换目录、改名、或 `persona-core` 移动，这些脚本**运行时静默失败**（`import()` 拒绝不是构建错误）。它比"不能版本化"更危险，因为失败发生在跑的时候。

**方案**：给 `persona-core` 一个真正的包身份。

```
Cortico/persona-core/package.json
{ "name": "@xiaoyu/persona-core", "type": "module",
  "exports": { ".": "./src/index.ts", "./*": "./src/*.ts" },
  "peerDependencies": { "tsx": "*" } }
```

新增 `src/index.ts` 统一导出（目前 15 个模块各导出各的，没有入口）。

**迁移步骤**
1. 建 `package.json` + `index.ts`；在 Cortico 根 `package.json` 里加 `workspaces: ["persona-core"]`。
2. dsh 侧改为 `import('@xiaoyu/persona-core')`——用 `pnpm -C ../Cortico add ../Cortico/persona-core --workspace` 或 `file:` 依赖；**不再拼路径**。
3. 需要读 `definition.ts` 的两个脚本（drill-gate / smoke-tools）单独处理：它们要的是"世界定义"，属于**跨 World 依赖**，应改为调用 World 暴露的只读接口，或降级为"仅在同仓 checkout 时可用"并显式报错。
4. 补测试：Cortico 目录改名后，6 个脚本的 import 仍能解析（用一个临时 symlink 模拟）。

**验收**：`grep -rn "file:///" dsh/scripts` = 0（drill-gate/smoke-tools 若保留，必须带"仅同仓可用"的显式错误信息，并列入白名单）；`persona-core/package.json` 存在且 `exports` 可解析。

**规模**：0.5–1 天。**风险**：`exports` 通配 `./*` 可能把内部文件也暴露出去——先只导 `index.ts` 与 `voice-brief`/`retrieval`/`naming` 三个真正被外部用的，其余等需要时再开。

---

### C. World 瘦身：一个文件拆成四个子系统（解 FR-3）
**问题**：`src/worlds/bili-account/definition.ts` 一个文件同时是：15 个工具声明、工具实现、生活循环、WebUI 声明、环境提示词、面板路由、配置校验。任何一项改动都要重新验证其它五项，且无法被别的 World 复用。

**目标结构**（同目录，五个新文件 + 原文件保留装配职责）

| 文件 | 职责 | 输入 → 输出 | 依赖 |
|---|---|---|---|
| `tick.ts` | **一轮的固定阶段** | `(state, now) → {state, sideEffects}` | 下面四个 |
| `life-engine.ts` | 只决定"这一轮做什么" | `(state, now, ctx) → Action \| idle` | 仅 `persona-core` |
| `memory-gateway.ts` | 召回/写入/作废 | `(query) → Memory[]` / `remember(...)` | 经 port，不碰文件 |
| `expression-pipeline.ts` | 想说什么 | `(state) → Intent` | `voice-brief` |
| `perception-gateway.ts` | 看懂一条视频 | `(bvid) → DebriefResult` | port（现为 CLI） |
| `definition.ts` | 装配 + 工具声明 + WebUI 声明 | — | 上述五个 |

**tick 的五个阶段（v2 新增：顺序必须有归属）**

现在 tick 里藏着顺序语义（先结算审批 → 再衰减 → 再决定 → 再写状态 → 再投递事件）。把"决定动作"抽走之后，这个顺序就没有归属了——所以顺序本身要显式：

```
settle()  结算审批结果（draft-result → 记忆/场值）   ← 必须先，否则她按旧情绪决策
decay()   离线衰减（按真实毫秒差）
decide()  life-engine 决定这一轮动作（可能 idle）
apply()   改场值 / 写记忆 / 写日记
deliver() 投递 bili.action_due，排下一拍
```

契约：每阶段纯函数，`tick.ts` 只做串联；**顺序测试**：给定"有一条未结算的 draft-result"，断言本轮 `decide()` 的输入已包含结算影响，且不得在结算前产生新动作。

**迁移步骤（每步一个 commit，可单独发）**
1. **先抽 `tick.ts` 的五阶段骨架**（v2 新增，必须先做）：把现有 tick 拆成 `settle/decay/decide/apply/deliver` 五个函数调用，但函数体仍留在原处——这一步只把顺序**显式化**，行为一字不改；补一条顺序测试。
2. 抽 `life-engine.ts`：把 `pickActivities` 的调用点与状态门（asleep/能量）搬过去，**行为不变**。
3. 抽 `perception-gateway.ts`：把 `bili_debrief` 内的参数拼装与解析搬过去（此时仍是 CLI 实现）。
4. 抽 `memory-gateway.ts`：把 `personaAdapter` 中"世界侧用到的"函数包一层，**先只搬调用点，不搬 IO**。
5. 抽 `expression-pipeline.ts`：把 `buildVoiceBrief` + 日记取尾 + 判断合成 intent。
6. `definition.ts` 收尾：只剩 `DECLS` + `tools()` 装配 + `webUi()`/`envPromptVars()`。

**验收（可度量的门禁数字）**
- `definition.ts` 行数 ≤ 原 1/3；
- World 目录内 `--flag` 字符串出现次数 = 0（配合 D）；
- 新增一种活动只改 `life-engine.ts` + 一处注册表；
- **五阶段顺序测试存在且绿**（"未结算不得决策"）；
- 全部现有测试绿（不需要新写，行为不变）。

**规模**：2–3 天。**风险**：生活循环是唯一"她真的会动"的路径，任何一步都要跑一轮真实 tick 验证（`ticks.jsonl` 有新行），不能只看单测。

---

### C2. `tank.ts` 拆分：592 行、33 个导出、读写混在一起（v3 补漏）

**为什么之前漏了**：我一直把 `definition.ts`（1359 行）当唯一的巨型文件，但 `tank.ts` **592 行、33 个导出**，是世界页 7 个面板的**全部数据来源**。审计 P0-2（待审稿分家）的 `DRAFTS_DIR` 就长在这里。

**它的问题与 `definition.ts` 不同**：`definition.ts` 是"六件事焊一起"，`tank.ts` 是**读和写混在一处**——`policyState`（读）与 `policySet`（写）、`settingsOverview`（读）与 `settingsSet`（写）在同一个文件里，所以任何一次面板只读改动，都要重验配置写入。

**33 个导出的归属**（实测枚举，逐个落位）

| 目标文件 | 导出 | 数量 |
|---|---|---|
| `config-surface.ts` | `policyState` `policySet` `readPolicyLite` `policyInWindow` `settingsOverview` `settingsState` `settingsSet` `ownerNameFromConfig` `personaNameFromConfig` `hostDisplayName` `renameSelf` `autoSentToday` `freshAckToken` | 13 |
| `panel-data.ts` | `tankLocal` `lastTickAt` `pendingDraftCount` `openFeedbackCount` `killOn` `trafficStatus` `vitalsState` `timelineState` `diaryState` `draftsState` `draftAction` `feedbackListSafe` `feedbackResolve` `draftForDay` `judgmentList` `judgmentAdopt` `judgmentReject` `judgmentActive` | 18 |
| `avatar.ts` | `avatarBinary` | 1 |
| 保留在 `tank.ts` | `warmConsole`（模块预热）+ 再导出（保持调用方不变） | 2 |

**迁移步骤**
1. 先只做**文件拆分 + 再导出**：`tank.ts` 保留 `export * from './config-surface.ts'` 等三行，**调用方一行不改**，测试应全绿（证明拆分无行为变化）。
2. 再逐个把调用方直接指向新文件，删再导出。
3. `panel-data.ts` 内部按"只读聚合"约束：**不许 import `node:fs` 系列写接口**（用 lint 拦），所有数据来自 `dsh` 模块或只读读文件。
4. `config-surface.ts` 与 A 方案的 `resolve()` 对齐：所有路径走它，不再自己拼。

**验收**
- `tank.ts` ≤ 30 行（只剩再导出与预热）；
- `panel-data.ts` 中 `writeFileSync|appendFileSync|renameSync` 出现 **0** 次；
- 7 个面板全部仍可用（真机点一遍）；
- `待放行` badge 与 `draftsState` 用同一个目录来源（顺带解 P0-2 的一半）。

**规模**：1 天。**风险**：`panel-data.ts` 里 `draftAction` 是**写操作**（放行/拒绝），它按职责该在 `config-surface` 还是 `panel-data`？——它属于"面板动作"，留在 `panel-data.ts` 但必须显式调用 `mods.approve`，不得自己写文件；这条要写进该文件的头部注释。

---

### D. 端口化：只做 debrief，且回执只有一个渲染出口（v2 收窄）

**问题**：World 直接拼 CLI 参数并正则解析回执（`runAsync(['debrief', bv, '--no-frames', '--top','3', …])` 再从文本里抠标题/UP/采样比）。回执格式一改，World 静默解析失败。**另一个更隐蔽的问题**：同一份文本既给模型看、又被代码解析，两边要求不同——模型要被如实告知"截断/采样口径"，代码只要字段。

**v1 错在哪**：我为 5 个能力设计了 `BiliPort`，理由是"可替换"。但**目前没有第二个实现的需求**（opencode 那件事是 provider 故障，不是 port 缺失）。抽象要等第二个实现出现，否则只是给自己加一层要维护的间接。

**v2 方案**：只对 `debrief` 做端口化（它正则最脆、字段最多），其余保留直调。

```ts
// perception-gateway.ts 内部
interface DebriefPort {
  run(o: { bv: string; from?: number; to?: number }): Promise<DebriefResult>
}
// 唯一渲染出口
function renderDebrief(r: DebriefResult): string
```

`DebriefResult` 里必须保留三类事实字段（不是只留标题）：
`truncated: {inlined: n, total: n}`、`sampling: {got, claimed, ratio, buckets}`、`missing: ['subtitle'|'frames'|'vision']`。
`renderDebrief` 是唯一能把结果变成文本的地方——测试锁"`truncated.inlined < truncated.total` 时输出必须含剩余量"、"`missing` 含 `vision` 时必须出现'本会话不可读图'"。

**迁移步骤**
1. 从 `runs/*/toolcalls.jsonl` 抽 4 条真实回执（有字幕/无字幕/被截断/无读图），写成解析测试的样本。
2. 实现 `DebriefResult` 解析 + `renderDebrief`，**先让渲染结果与现状逐字节一致**（用样本对照），证明"只重构不改变输出"。
3. World 侧改为调 port + 渲染，删掉正则。
4. 补"换 stub 仍绿"：World 测试用内存 stub 实现 port。

**验收**：`debrief` 的正则在 World 内 0 处；渲染输出对 4 个真实样本与改造前逐字节一致；`truncated/missing` 两条断言绿。
**规模**：1 天（原估 1.5–2，因收窄到一条）。
**风险**：渲染"逐字节一致"意味着改造期不能顺手改文案——想改文案另开一个 commit，别混在迁移里。

---

### E. 扩展化路线（复用现有 5 个扩展）

**现状实测**：`coo-world-petdiary 0.3.5`（日记世界，会向她推送 `alarm_set` 要求）、`cortico-provider-opencode 0.3.6`（加载失败）、`cortico-world-browser 0.4.1`（激活被 preflight 拦住）、`cortico-world-figure 1.4.4`（0 工具，只出画面）、`cortico-world-selfkit-alont1 0.1.5`（命名不合 `cortico-world-*` 规范的下划线/账号后缀）。

**四类处理**

| 扩展 | 处理 | 理由 |
|---|---|---|
| pet-diary | **当独立日记本接入**，不塞进她的主日记 | 它有自己的存储与闹钟语义；混进主日记会造成双写 |
| figure | **激活并把它变成工具**（封面/立绘生成） | 它现在只出画面不出工具，等于装了看不见 |
| browser | 修 preflight 可见性 + 必填项可达 | 见审计 P1-4；激活失败必须常驻可见 |
| opencode | backport `StreamErrorEvent` 解加载 | 见 STATUS §2；不整跟上上游 |
| selfkit | 记一条"命名不规范，勿在文档里当范例" | 装不装由主人定 |

**"该自研 vs 该装"的判定**（写死，不再每次讨论）：B 站读写必须自研（已是本仓 World，不能外包给第三方包）；"看懂视频"可以抽成 `cortico-world-media` 供别人复用，但**不引入同名第三方包**；模型 provider 用官方/上游实现，不自己写协议栈。

**停用契约（v2 新增）**

现在"停用"没有任何定义，于是残留偷偷累积：`figure` 被停用后目录还在、`worlds.figure.enabled=false` 留在配置里；`pet-diary` 有自己的 `alarms.json`；`pending/` 里还有 2 枚未消费令牌。

规则：每个 World 声明 `onDeactivate: 'keep' | 'archive' | 'purge'` 与 `storage` 清单（已有 `webUi().storage`），停用时按声明执行，并在页面显示"停用后保留了什么"。

| 扩展 | 建议 | 理由 |
|---|---|---|
| figure | `keep` | 生成的封面素材属于她，不该删 |
| pet-diary | `archive` | 有独立存储与闹钟，归档到 `bili-ai/archive/<id>-<日期>/` |
| browser | `purge` | 只有浏览器 profile 与缓存，没有她的记忆 |
| selfkit | `keep` | 状态未定，先不删 |

验收：停用任一 World 后，页面能列出"保留/归档/清除 了哪些路径"，且没有残留进入"无主文件"。
**规模**：0.5 天。

**验收**：扩展页每张卡的"装/导/启"三态都有可执行动作与可见原因；`bili_capabilities` 报出的状态与扩展页一致（同源）。
**规模**：边界先说清 0.5 天；按需接入另计。

---

### F. 观测与门禁（让上面每一步都能被证明）

**问题**：门禁数字只活在会话里；transcript 有存档无检索；无 CI 覆盖 `.mjs` 行为测试。

**方案三段**

1. **历史可读**：`GET /api/runs/:id/transcript?offset=&limit=`（数据已在 `deployments/mybot/data/runs/r-*/transcript.jsonl`）；控制台页加"跨 run + 日期 + 关键词"检索；`ops:backup` 覆盖 `runs/`。
2. **门禁落盘**：`run-mjs-tests.mjs --report docs/evidence/gates-<date>.json`（`tests/fail/EXECUTED/sha`）；文档只引路径。
   **v2 新增**：报告里带 `gitSha` + 失败用例的 owner 映射（用 `docs/README.md` 的 owner 表），失败时直接输出"这条属于 `definition.ts`，最近改动 <sha> <subject>"，不必人去翻 git。
3. **CI**：Cortico `ci.yml` 增 `master` 分支与 `node --test tests/*.test.mjs`；dsh 新增最小 workflow（hashes / consumers / mjs-tests）。

**验收**：给定日期区间与关键词能列出消息并打开原文；`docs/evidence/` 下每期都有 gates 文件；CI 在 PR 上真跑。
**规模**：1 天。**风险**：历史检索要处理 1343 条以上规模，分页必须在服务端做，不整包下发。

---

## 5. 分期路线（v3）

| 期 | 内容 | 出口标准 | 回滚 |
|---|---|---|---|
| **P-1 退路** | 真恢复演练（A1.5）+ 备份覆盖 `runs/` | `docs/evidence/restore-drill-*.md` 四项全等 | 不涉及改动，只证明退路存在 |
| **P0 地基** | A 状态根（写者所有权 / 迁移账本 / 锁 / 归因）+ **B2 persona-core 包化** + B 策略内核 + 修 P0 缺陷（go-gate 覆写、causal 吞错、kill 覆盖面、读图死锁） | 同源断言绿；单写者测试绿；`grep "file:///" scripts` = 0；关一次 World 能查到 actor | 新增函数 + 调用点替换，按 commit 逐个 revert；数据迁移有账本与 `.legacy-*` |
| **P1 结构** | C World 瘦身（五阶段 tick 先行）+ **C2 `tank.ts` 拆分** + D debrief 端口化 | `definition.ts` ≤1/3；`tank.ts` ≤30 行；`panel-data.ts` 零写接口；World 内无 debrief 正则 | 每批独立可发；C2 第一步只做再导出，调用方零改动 |
| **P2 能力** | 对话历史检索 + 判断→动作 + 模型选型 + 扩展边界（E 含停用契约） | 主人能按日期翻回聊天；judgments 生效；候选模型进供应商页；停用后残留可见 | 功能开关（`enabled`）关闭即回到现状 |

**每期结束必须做一次「她还能动」六项检查**（§7 第 9 条），不通过不算完成——这是 v3 加的门槛：测试绿只证明代码没坏，不证明她还在过日子。

不做（防过度设计）：不为了"插件化"把 B 站能力拆出去；不引入消息队列/数据库；不给 15 个工具设计抽象基类；不把 persona-core 拆成多包（只需要 `package.json` + `exports`）；**不对只有一个实现的能力做端口抽象**；**不把 `docs/` 喂给她**（§3.3）。

---

## 6. 与审计缺陷的对应（按"会多快出事"分组）

**6.1 P0 · 已经在造成损失**

| 审计项 | 结构原因 | 由哪个方案解 |
|---|---|---|
| P0-1 额度分账 | FR-1（同一概念多落点）+ **两个进程各写一份** | A：路径统一（A0–A6）+ **A0.5 写者所有权** + A7 锁 |
| P0-2 待审稿分家 | FR-1 + FR-2（`definition.ts:170` 与 `tank.ts:24` 两个 `DRAFTS_DIR`） | A：R3 + A5 读侧收口 + **C2（`panel-data` 与 `config-surface` 分家）** |
| P0-3 go-gate 覆写 | 局部防御缺失 | A（同批修：读失败禁止写） |
| P0-4 causal 吞错 | 局部防御缺失 | A（同批修）+ **A8**（写失败带 `actor` 可追） |
| P0-5 评论直发 / kill 漏域 | 权限边界未集中 | A（先看 A0.5 写者表：谁有权改权限）+ B |
| P0-6 历史读不回 | 观测缺读端 | F |

**6.2 P1 · 会造成误判或不可恢复**

| 审计项 | 结构原因 | 由哪个方案解 |
|---|---|---|
| P1-1 dm 额度分叉 | FR-1 + 读写同用旧家 | A：R1 读写分离 + A3-4 修 `dm.mjs`/`reply-draft.mjs` |
| P1-2 备份不可用（只跑过 1 次、drafts 目标错、从未真恢复） | 无校验、无演练 | **A1.5**（先做演练）+ A5-4（修 `ops-backup`）+ F（`runs/` 纳入备份） |
| P1-4 浏览器激活死锁 | World 配置项不可达 | E（preflight 可见 + 必填项可达）+ F（失败原因进日志） |
| P1-5 写操作不可归因（`figure` 谁的关的查不出） | 写路径没有操作者身份 | **A8**：进程入口注入 `actor` |
| P1-13 成本账未配价（`cost=0`、539 次 unpriced） | 观测缺口径 | F（usage 补计价字段）；**不属解耦范围**，只登记 |
| P2-新 persona-core 无包身份，6 个脚本用 `file:///` 拼路径 | 跨仓依赖未声明 | **B2**（包化 + exports） |
| P2-新 `tank.ts` 592 行 33 导出，读写混在一处 | FR-3 的第二个实例 | **C2**（拆 config-surface / panel-data / avatar） |

**6.3 结构断层（不是单点缺陷，是缺陷的土壤）**

| 断层 | 表现 | 由哪个方案解 |
|---|---|---|
| **FR-1 状态落点四分** | 草稿/风控/队列各解析到不同目录；读数互相矛盾 | A |
| **FR-2 同一语义两份实现** | 策略、路径、日记解析各两份；靠人记着同步 | B（照 `voice.schema.json` 的范本做） |
| **FR-3 一个文件即一个子系统** | `definition.ts` 1359 行六件事；`tank.ts` 592 行读写混合 | C、C2、D |

---

## 7. 验收口径（不写"完成"，只写怎么证明）

1. **同源**：`badge == panel == lamp == CLI`，用一条测试 + 一次 `curl` 三项对照。
2. **单写者**：每个状态文件只有一个写者（或显式 `both-with-lock`）；`traffic-state.json` 只有一处写入路径；错写测试全绿。
3. **可替换**：把 debrief 适配器换成 stub，World 的全部测试仍绿（证明端口边界成立）。
4. **瘦身**：`definition.ts` 行数、World 内 debrief 正则数、`grep "'.bili-ai'"` 次数，三项都作为可度量的门禁数字。
5. **可回看**：给定日期区间与关键词，能列出跨 run 的消息并打开原文。
6. **可归因**（v2）：关掉/启用任一 World 后，"她的一天"能显示 `actor`；历史无法补，但新写入必有署名。
7. **可回滚**（v2）：`docs/evidence/restore-drill-*.md` 存在且四项全等；`migrations.json` 记录 `done`。
8. **顺序不变**（v2）：tick 五阶段顺序测试绿——"审批未结算时不得产生新动作"。
9. **她还能动**（v3，最重要的一条）：每期结束后的**运行时**验收，不能只用测试代替——

| 检查 | 命令/位置 | 通过标准 |
|---|---|---|
| 循环在跑 | `~/.dsh/bili-whale/days/<今天>/ticks.jsonl` | 改造后 30 分钟内出现新行 |
| 状态在结算 | `~/.dsh/bili-whale/fields.json` 的 `lastAppliedAt` | 比改造前更新 |
| 记忆在写 | `fields.json` 的 `memories` 条数 | 不少于改造前 |
| 因果在记 | `causal.jsonl` 末尾 | 出现带 `actor` 的新条目（A8 之后） |
| 对外仍可用 | `bili_traffic` 工具回执 | 额度未耗尽、非 paused |
| 日记仍可写 | 两本日记 mtime | 改造后 24 小时内更新过 |

**这条为什么必须单列**：A 改的是状态写入、C 改的是生活循环——**测试全绿但 tick 不跑**是最可能的事故形态，而它不会让任何一条单测变红。验收时如果只报"gate 绿"，等于没验。

---

## 8. 执行编排（25 个 commit，按依赖排序）

> **开工前的第一件事不是第 1 步，是 §0.1 的门 ③**：用 `reanchor/replay` + 现 dsh 换端口起一次真机，跑一次 tick + 一次 `bili_debrief`，看 `ticks.jsonl` 有新行、debrief 回执里有"采样口径/还剩多少"、日记记忆有新增。
> 门 ①（两套 tsc）与门 ②（vitest web 1309 绿）已过；**门 ③ 未做**。它不过，下面 25 步一步都别开始——A 改状态写入、B 改策略读取，都建立在"两边对同一份状态理解一致"这个还没验过的前提上。
> 另：门 ② 的 mjs 侧（Cortico `node --import tsx --test tests/*.test.mjs`）也还没在 `reanchor/replay` 上跑过，与门 ③ 同批补。

| # | commit 主题 | 依赖 | 验收命令 | 卡住时的降级 |
|---|---|---|---|---|
| 1 | `chore(docs): 落线声明 + 本方案基线` | 落线门 | `git log --oneline -1` 与 §0.1 一致 | — |
| 2 | `feat(scripts): ops-backup 覆盖 runs 与正确 drafts` | — | 备份 MANIFEST 含 `runs/` 与 `D:/AI/养鱼/drafts` | 先只加 runs，drafts 另开 |
| 3 | `chore(evidence): 备份恢复演练（临时目录比对四项）` | 2 | `docs/evidence/restore-drill-*.md` 四项全等 | 演练失败则先修备份，A 全线暂停 |
| 4 | `feat(lib): state-roots resolve() 与 R1–R5` | 3 | 新测试 5 条绿 | — |
| 5 | `test: 四红测试（badge/单写/错写者/无锁写）` | 4 | 4 条红（预期） | 某条写不出来→先只留 2 条 |
| 6 | `refactor(lib): paths.mjs 内部改调 resolve()` | 4 | 既有 9 条契约测试绿 | — |
| 7 | `fix(commands): selftest / scheduler 日志落点` | 6 | 日志出现在新家 | — |
| 8 | `fix(commands): dm / reply-draft 读写分离` | 6 | `dm --status` count == 文件内容 | — |
| 9 | `chore(scripts): migrate-state-roots --dry` | 6 | CSV/清单输出与预期一致 | — |
| 10 | `feat(scripts): 迁移账本 + --apply + --rollback` | 9 | 迁移→回滚→读数复原 | 回滚不通→不执行迁移 |
| 11 | `chore(data): 执行迁移（一次性操作，记录 id）` | 10 | 三处读数一致；账本 done | 半途失败→按账本续跑 |
| 12 | `refactor(core): scheduler/routes/client 读侧收口` | 11 | badge==面板==灯==CLI | 逐文件拆更小 commit |
| 13 | `chore(tools): verify/* 与残余手拼收口` | 12 | `grep "'.bili-ai'"` = 0（除 paths/state-roots） | — |
| 14 | `feat(scripts): check-state-roots 进 gates` | 13 | gates 多一行 OK | — |
| 15 | `feat(lib): withStateLock 通用化 + causal 并发测试` | 14 | 两进程并发 append 不丢行 | 只为 causal 开后门并注释 |
| 16 | `feat(all): actor 归因（CLI/Host/WebUI 三入口）` | 15 | 关一次 World 能查到 actor | 先只做 World 与 CLI |
| 17 | `feat(persona-core): package.json + exports + index` | 16 | `import('@xiaoyu/persona-core')` 可解析 | exports 先只开 3 个入口 |
| 18 | `refactor(scripts): 6 处 file:/// 改为包名 import` | 17 | `grep "file:///" scripts` = 0 | drill-gate/smoke-tools 标"仅同仓"白名单 |
| 19 | `refactor(world): tick 五阶段显式化（行为不变）` | 18 | 顺序测试绿 + 真实 tick 有新行 | 只拆 settle/decide 两阶段 |
| 20 | `refactor(world): life-engine / perception / memory / expression` | 19 | World 内 `--flag` = 0；全测试绿 | 一次只抽一个，可停在任意一步 |
| 21 | `refactor(world): tank.ts 拆分（先只再导出）` | 20 | `tank.ts` ≤30 行、调用方零改 | — |
| 22 | `refactor(world): panel-data 零写接口` | 21 | 三个写函数 = 0 次 | 保留 draftAction 并注释例外 |
| 23 | `feat(world): debrief 端口 + renderDebrief` | 22 | 4 样本逐字节一致 | 只做解析不做渲染迁移 |
| 24 | `feat(scripts): gates 报告落盘 + owner 归因` | 23 | `docs/evidence/gates-*.json` 带 gitSha | — |
| 25 | `chore(docs): README/INDEX 按新结构重写` | 24 | 两份入口一致 | — |

**每 4 个 commit 做一次「她还能动」六项检查（§7 第 9 条）**；任一项不通过，回退到上一个通过点，不要继续叠。

**并行可能性**：2–3（备份/演练）与 4–6（状态根）可并行；17–18（包化）与 19–20（World 瘦身）可并行——但两者都动 `personaAdapter.ts` 周边，**同一时刻只能有一个人动那个文件**。
