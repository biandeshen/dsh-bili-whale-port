# 记忆统一设计（记忆席 · 2026-11-03）

裁决前提：记忆是一种能力，必须可查、可换实现。目标架构里记忆归 bot 包（cortico-bot-xiaoyu），走框架 Memory；`fields.json` 只留场值与 `lastAppliedAt`。本文只读研究，不改代码；所有实测数字来自 2026-11-03 本机。

---

## 1. 现状清单：五处"记忆"，互不相认

### 1.1 World 的情绪记忆（fields.json）

- 位置：`C:\Users\Administrator\.dsh\bili-whale\fields.json`，实测 71,553 B（另有 `.bak` 71,553 B、一份 11-01 的 `.tmp` 残留 59,286 B）。
- 内容：`memories` 实测 **60 条**、`chain` 实测 **68 条**，上限 `HISTORY_LIMIT = 200`（`Cortico-up/src/worlds/bili-account/personaAdapter.ts:156`；`saveState` 在 :207 与 :215 各做一次 `slice(-HISTORY_LIMIT)`），另有 `fields`、`npcState`、`budget`、`emotionHistory`（上限 24，:157）、`lastAppliedAt`、`schemaVersion: 5`（:155）。
- 条目的形状：`Memory`（`Cortico-up/persona-core/src/types.ts:88-107`）——`id/sender/content/emotion/tags/vividness/accessCount/createdAt/encodingStrength/flashbulb/source`，作废章 `voided/voidedAt/voidReason`（:104-106，原文永不删除）。
- 谁写：`remember()`（personaAdapter.ts:297）、`rememberFirst()`（:322，同类第一次点亮 milestone）、`voidMemory()`（:345）、`applyRecall()`（:420，被想起 → vividness 升、accessCount+1）；每次 `saveState`（:205）原子写 + 留 `.bak`，坏文件走备份恢复（`loadState` :136-153）。触发方是 World 的 runner / 工具（`bili_mood_apply` 的 note 会写进记忆，`tool-decls.ts:36`）。
- 谁读：`describeStateWithTrace()`（:368）→ `recallMemories()`（`persona-core/src/retrieval.ts:101`），打分 `score = 0.40*关键词 + 0.30*vividness + 0.15*情绪贴合 + 0.15*新近`（retrieval.ts:145），带 `slot: 'core' | 'surprise'` 与 `why[]`（:88-95，"和眼下的事有关 / 刻在心里 / 鲜活 / N 天前"）。`recentWatch()`（:427）从记忆里数近 7 天看过的 BV/UP，供 `annotateFeed`（:438）打标。
- 检索接口：有，程序内（`recallMemories`、`findMemories` :336 按 id/正文片段）。作废通道：`bili_memory_void`（`tool-decls.ts:47`，点名一条，0 命中或多命中拒绝）。
- 视图：**没有独立视图**。她自己在意见箱 f-d99d64 报过"判断结果没有独立视图，只能从日记正文里捞"；记忆同样只能靠 `bili_mood_read`（tool-decls.ts:35）返回的本轮召回。

### 1.2 框架的文件式记忆（bot=cormini 的 workspace）

- 位置：`E:\WorkSpace_Qoder\Cortico\deployments\mybot\workspace\`，实测 **10 个文件、2.4 MB**：CONSTITUTION.md（1,011 B）、HANDOFF.md（14,310 B）、MODELS.md（2,691 B）、OPS.md（12,664 B）、judgments.md（4,048 B）、handoffs/ 3 份（57,673 / 34,274 / 143,312 B）、blobs/stickers。
- 谁写谁读：bot=cormini 的模型自己，经 9 个文件工具 `read_file/write_file/edit_file/delete_file/move_file/append_file/list_files/glob_files/grep_files`（`Cortico-up/bots/cormini/persona/workspaceTools.ts:129-266`），底层是 `GitWorkspaceMemory`（`bots/cormini/persona/memory.ts:208`）：路径护栏 `resolveSafe`（:253）、原子写（:305）、`grep`（:471）、`globFiles`（:452）、`WorkspaceBlobStore`（:139）、git 版本历史（:214）。
- 检索接口：有（glob + grep，命中行号级）。视图：有——`memoryDir` 交给 WebApp 出 Memory 页（`src/bot.ts:1012`、`src/web/server.ts:649`）。
- 关键事实：**这套和 1.1 完全无关**。`src/worlds/bili-account/*.ts` 对 `MemoryAssemblyContext` / `cortico/core/blobs.ts` / `BlobStore` / `workspace` 的引用 0 次（复核属实：该目录 import 只来自 `@xiaoyu/persona-core/*` 与 node 内置，personaAdapter.ts:8-20）。mybot 部署跑的是 cormini，不是小鱼；小鱼的 World 挂在另一条组装线上。

### 1.3 两本日记

- 位置：`C:\Users\Administrator\.dsh\whale-diary.md` 实测 **50,309 B**、`whale-diary-private.md` 实测 **65,357 B**。（任务描述里两本的 65KB/50KB 与实测相反：公开本 50K、私人本 65K，以实测为准。）
- 谁写：World 的 `diary.ts` 纯函数 `upsertDiarySection`（按日期块、小节"有则替换、无则追加"，含去重历史遗留重复小节）；谁读：`bili_diary_read`（`tool-decls.ts:34`，分页/按天/按小节/summary 统计）。
- 检索接口：有（分页 + heading + summary）。视图：只有工具回执，无 WebUI 页。

### 1.4 causal.jsonl——表态：不是记忆

- 位置：`C:\Users\Administrator\.dsh\bili-whale\causal.jsonl`，实测 **207 行、54,777 B**，append-only，宿主与 CLI 双写者、带 `actor` 署名（`src/worlds/bili-account/causal-io.ts` 头注释与 `causal()`）。
- 表态：它是**行为审计账**，不是记忆。判据：没有任何召回路径读它（她不会"想起"一条 causal），它服务的是主人复盘与 `autoSentToday` 这类限额计数。留在 World/宿主侧，不进 Memory；`chain`（1.1 里的 68 条因果链）同理偏账目，但 `describeState` 拿它拼"最近发生"，见 §3 处置。

### 1.5 days/ 快照

- `C:\Users\Administrator\.dsh\bili-whale\days\<date>\state.start.json / state.end.json`：每日场值+链+记忆快照，`counterfactual.mjs` 的输入（scripts/counterfactual.mjs:43-70）。属验收基础设施，迁移时必须保持可读（旧快照缺 chain/memories 时它已会回退 live fields.json 并标 `hybrid(live)`，:57-70）。

---

## 2. 框架 Memory 的准确契约

### Core 给 Persona 什么

- `Persona` 接口（`Cortico-up/src/core/types.ts:1016-1082`）要求三样与记忆相关的成员：
  - `memoryDir: string`（:1059）——Memory 目录的**绝对路径**，由 Persona 在构造时给出；
  - `blobs: BlobStore`（:1061）——`mem:` 句柄的后端，由 Persona 解释和保存二进制内容；
  - `memory?: object`（:1057）——Memory 实例，**Core 不读它的内容**；bot 没给 memoryName 时 WebUI 以类名作 Memory 页标题。
- `SystemPrefixContext { now, timezone, worlds }`（:988-993）：Core 构造 system 前缀时只提供时间与 World 环境段；记忆文本经 `systemSegments()`（:1018）由 Persona 产出。Core 不生成语义内容（AGENTS.md 边界 2）。
- `MemoryAssemblyContext { now: Date; timezone: string }`（:997-1000）：**只有这两个字段**。它不是 Core 回调 Persona 的钩子——Core 里没有调用点；是 Persona 自己渲染 MEMORY 模板时传给自己方法的参数（corti-soulmate 的 `assembleMemory(ctx)`，`bots/corti-soulmate/persona/index.ts:299`，被 :263 的 `systemSegments` 内部调用）。
- `PersonaWebUiDecl.memory?: { panels?, promptDocs?, storage? }`（:1109）：Memory 页的面板/模板文档/存储项声明归 Memory 而不归 Persona 页。

### Persona 给 Core 什么

- 一个目录路径（`memoryDir`）+ 一个 `BlobStore` + 前缀文本。仅此。Core 到达 Memory 只有这两条通道：目录路径和 blob 句柄（AGENTS.md §2 Names 表）。

### blobs 怎么用

- 契约 `BlobStore`（types.ts:289-293）：`put(nameHint, bytes, mime) → handle`、`get(handle) → { bytes, mime } | null`、`list(prefix?)`。句柄以 `mem:` 开头（`MEM_SCHEME`，`src/core/blobs.ts:12`），格式由后端定义，但要能原样当工具参数传；`log:` 句柄归 Core 按内容哈希分配，`mem:` 归 Persona 解析（types.ts:296）。
- 参考实现一：模板 `FileBlobStore`（`templates/extension/bot/persona/blobs.ts:12-66`）——句柄=相对 memoryDir 的路径（`mem:blobs/cat.png`），不带目录的名字提示落进 `blobs/`，越出 memoryDir 一律拒绝（:60-65）。
- 参考实现二：`WorkspaceBlobStore`（`bots/cormini/persona/memory.ts:139-190`）——同构，另可 `get` 工作区内任意文件。

### 路径谁决定

- bot 包声明子目录名：`paths: { memory: 'workspace', data: 'data' }`（`bots/cormini/index.ts:72`）；加载层解析成部署根下的绝对路径并写进 `CoreConfig.memoryDir`（`src/core/config.ts:170`，"解析后的绝对路径"），`loaded.memoryDir` 再传给 WebApp（`src/bot.ts:1012`）。即：**部署根归 Core 配置，子目录名归 bot 包，目录内容归 Persona**。AGENTS.md：Memory 在 `<deployment>/memory/`，Persona 选路径（Cormini 与 CortiV 选 `workspace/`）。
- World 永远不写 Memory（AGENTS.md 边界 3）——这正是今天 1.1 违宪的地方：小鱼的记忆写在 World 的 state 文件里。

### 可复用的两块积木

- `GitWorkspaceMemory`（cormini/persona/memory.ts:208）：路径安全、原子写、追加、grep/glob 检索、git 历史。corti-soulmate 直接 import 它（`bots/corti-soulmate/persona/memoTiers.ts:13`）。
- `MemoTiers` 三级分层（memoTiers.ts:1-52）：`memo/` 顶层常驻（前缀放全文，容量 residentCap）、`memo/active/`（前缀只列文件名，容量 activeCap）、`memo/archived/`（前缀只显示数量，正文由 agent 主动翻）；条目用通用文件工具移动，`memoCapGuard` 写入时强制容量。

---

## 3. 统一后的分层设计（cortico-bot-xiaoyu）

记忆全部搬进 bot 的 Memory 目录（部署根下 `workspace/`，与 cormini 同款积木）；`fields.json` 只剩 `{ fields, lastAppliedAt }`。

### 3.1 目录分层

```
workspace/
  MEMORY.md              # 前缀引导语与空态措辞（模板，参照 soulmate 的 MEMORY 0-4）
  CONSTITUTION.md        # 她的章程（从现有 workspace 实践平移）
  memo/                  # core 层：常驻前缀全文，容量 residentCap（建议 8）
    <id>.md              #   flashbulb/里程碑记忆的蒸馏卡片
  memo/active/           # recent 层：近端活跃条目，前缀只列名+一行摘要，容量 activeCap（建议 40）
    <id>.md
  memo/archived/         # long 层：vividness 衰减到阈值下的条目，前缀只报数量
    <id>.md
  memo/voided/           # 作废层：盖了章的条目，原文留着可复盘，永不进召回与 grep 默认域
    <id>.md
  diary/
    public.md            # 鲸鱼日记（原 whale-diary.md）
    private.md           # 私人日记（原 whale-diary-private.md）
  blobs/                 # 附件（表情包、看片截图等）
```

单条目文件形状（front-matter = 原 `Memory` 接口的逐字段平移，正文 = content）：

```markdown
---
id: mem-abc123-defg
sender: npc            # 'player' | 'npc'（persona-core/src/types.ts:91）
tags: [milestone, first-reject]
createdAt: 2026-10-30T14:02:11.000Z
vividness: 0.72
accessCount: 3
encodingStrength: 0.61
flashbulb: true
source: npc_self
voided: false
---
第一次被主人驳回草稿，理由是"太像机器人"。
```

### 3.2 各层存什么、怎么检索

- **core（memo/ 顶层）**：flashbulb 与里程碑（`rememberFirst` 第一次点亮的条目）。前缀全文常驻 → 每轮都"记得"。
- **recent（memo/active/）**：非闪光的活跃记忆。检索走**程序化召回**：Persona 读 active+core 层反序列化成 `Memory[]`，仍用 `recallMemories()`（retrieval.ts:101）原打分公式（mood 来自 fields.json 的场值），保证行为不变；模型侧另有 `grep_files`/`glob_files` 可按正文翻。
- **long（memo/archived/）**：vividness < 阈值（建议 0.35，可调）的条目由每日结算降级搬入；召回池不含 archived，但 surprise 槽可从 archived 抽（"忽然想起"正是远期记忆的行为学形态）——实现上召回时把 archived 只喂给 surprise 通道（retrieval.ts:158-166 已有 surprises 槽位）。
- **作废**：`bili_memory_void` 语义不变（点名一条、唯一命中、理由 ≥6 字）；落点改为 front-matter `voided: true` + 文件移入 `memo/voided/`。git 历史天然留痕。
- **衰减/回想写回**：`decayMemory`/`recallMemory`（personaAdapter.ts:241、:423）改为读文件→算→原子写回（`writeFileAtomic`，memory.ts:305）。每日结算批量做一次，不必每 tick 全量重写。

### 3.3 日记是不是 Memory 里的文档——是

日记搬进 `workspace/diary/`，`diary.ts` 的纯函数不动，读写通道换成 `GitWorkspaceMemory.readFile/writeFileAtomic`；`bili_diary_read` 回执格式不变。收益：日记获得 git 历史、WebUI Memory 页可见、和 memo 同一套检索工具（grep 跨日记+记忆一次命中）——直接回应 f-d99d64"只能从日记正文里捞"：judgments 也应是 `workspace/judgments.md` 这类一等文档并可被 grep。

### 3.4 剩下的状态去哪

- `chain`（68 条因果链）：短期情绪账目，不是记忆。搬去 bot 的 `dataDir`（`runtime/chain.json`），`describeState` 的"最近发生"从那里读。`causal.jsonl` 原地不动（§1.4 表态）。
- `npcState`、`budget`、`emotionHistory`：运行时状态，随 chain 进 `dataDir/runtime.json`。
- `fields.json` 终态：`{ schemaVersion, fields, lastAppliedAt }`。

### 3.5 TypeScript 接口形状（提案）

```ts
import type { MemoryAssemblyContext, BlobStore } from 'cortico/core/types.ts';
import type { GitWorkspaceMemory } from '<cormini>/persona/memory.ts'; // 或提取为共享包
import type { Memory, RecalledMemory } from '@xiaoyu/persona-core/types';

/** Persona.memory 实例；Core 不读内容，WebUI 以类名作 Memory 页标题。 */
export interface XiaoyuMemory {
  readonly ws: GitWorkspaceMemory;
  readonly blobs: BlobStore;

  /** MEMORY 模板 + 活数据 → 前缀文本（参照 soulmate assembleMemory，index.ts:299）。 */
  assemble(ctx: MemoryAssemblyContext): string;

  /** 读 core+recent（surprise 通道另抽 archived）→ 反序列化 → recallMemories 原公式。 */
  recall(opts: { k: number; surprises: number; text: string; mood: number; seed?: string; now: number }): RecalledMemory[];

  /** 写一条：落 memo/active/ 或（milestone）memo/；返回条目 id。 */
  remember(content: string, opts: RememberOptions): string;

  /** 召回写回：vividness 升、accessCount+1，原子重写命中文件。 */
  applyRecall(ids: string[]): void;

  /** 作废：唯一命中才生效；front-matter 盖章 + 移入 memo/voided/。 */
  void(sel: { id?: string; match?: string }, reason: string): { ok: true; id: string } | { ok: false; candidates: string[] };

  /** 每日结算：全量 decayMemory + 阈值降级（active→archived）+ 容量守卫（参照 memoCapGuard）。 */
  settle(days: number): void;
}

/** 单条目文件的 front-matter 契约；字段与 persona-core Memory（types.ts:88-107）一一对应。 */
export interface MemoryNote extends Memory {}
```

---

## 4. 迁移设计

### 4.1 脚本形状：`scripts/migrate-memory-unify.mjs`

完全参照 `dsh-bili-whale/scripts/migrate-state-roots.mjs` 的三条安全规则（该文件 :12-17）：

```
node scripts/migrate-memory-unify.mjs              # 默认 --dry：列出计划，什么都不动
node scripts/migrate-memory-unify.mjs --apply      # 真搬，落账本
node scripts/migrate-memory-unify.mjs --rollback <id>
```

- **从不改源**：`fields.json`、两本日记原件一律不动（copy 不 rename，migrate-state-roots.mjs:149-150 同款）；读侧"新优先、旧兜底"兼容期，退场日再由第二个脚本瘦身 `fields.json`。
- **账本**：`migrations.json` 追加 `{ id, at, gitSha, direction, files: [{ name, from, to, sha256After, bytes }], mapped: { memories: 60, chain: 68 } }`。
- **回滚**：只认账本 id；删新家文件让读取退回旧家；**任一目标文件 sha256 与账本 `sha256After` 不符（迁移后又被写过）→ 拒绝回滚，人工核对**（migrate-state-roots.mjs:88-93 原样照抄）。
- 复制后逐文件 sha 核对，不符即中止（:151-155）。

### 4.2 60 + 68 条怎么映射

| 源 | 判据 | 目标 |
|---|---|---|
| memory `flashbulb: true` 或 `pinned` | — | `memo/<id>.md`（core 层） |
| memory `voided: true` | — | `memo/voided/<id>.md`，front-matter 保留 voidedAt/voidReason |
| memory 其余，`vividness ≥ 0.35` | — | `memo/active/<id>.md` |
| memory 其余，`vividness < 0.35` | — | `memo/archived/<id>.md` |
| `chain` 68 条 | 整份 | `dataDir/runtime/chain.json`（不拆条） |
| `npcState/budget/emotionHistory` | 整份 | `dataDir/runtime.json` |
| whale-diary.md（50,309 B） | 整份 | `workspace/diary/public.md` |
| whale-diary-private.md（65,357 B） | 整份 | `workspace/diary/private.md` |
| causal.jsonl 207 行 | 不动 | —（非记忆，§1.4） |

若 active 层超 activeCap：按 `vividness*recency` 降序取前 N，其余进 archived——降级是机械规则，dry 模式先打印名单。

### 4.3 失败怎么办

- 任一条 memory 反序列化失败（缺 id/content）：该条写入 `workspace/migrate-quarantine/<id>.json` 并在账本记 `quarantined: n`，不阻塞其余；quarantine 非空时脚本以退出码 1 结束，提示人工处理。
- 目标已存在（重跑）：跳过并报告，不覆盖（安全规则 1）。
- 写入中途崩溃：目标目录里只有已核对 sha 的完整文件（逐文件 write→sha 核对→记账），旧家完好，重跑幂等。

### 4.4 验收怎么量

1. **计数守恒**：60 = core + active + archived + voided + quarantine 各层文件数之和；68 = chain.json 条数；日记 sha256 与源一致。
2. **召回等价**（核心验收）：对同一天的 `days/<date>/state.end.json` 快照，迁移前用 `recallMemories(旧 memories)`、迁移后用 `XiaoyuMemory.recall()`（读新文件），断言 **top-3 的 id 集合与 slot 完全一致**。`counterfactual.mjs` 天然可比对：它已经吃 `days/` 快照 + fields.json（:43-71）产出 `diffChars` 与 `memoryRecall`（:89-101）；迁移前后各跑近 7 天，要求 `memoryRecall` 命中 id 相同、`diffChars` 差 ≤1（voice-brief 只消费 memories 数组，来源换了但内容逐字段相同 → 输出应逐字节相同，差 >1 即映射有损）。
3. **作废通道**：对一条已 voided 的迁移条目跑召回，断言不出现；`bili_memory_void` 在兼容期对旧 id 仍能命中（id 原样平移，无重编号）。
4. **日记分页**：`bili_diary_read` summary 模式对迁移前后同一区间给出相同的天数/BV 数/小节计数。

---

## 5. 风险、代价与不知道

### 风险与代价

- **写路径搬家是最大改动面**：今天 `remember()` 由 World 侧 runner/工具触发（`bili_mood_apply` 的 note）。裁决后 World 不得写 Memory（AGENTS.md 边界 3），写入必须改为 World 发事件 → Persona 工具/钩子落盘。这不是迁移脚本能覆盖的，是 runner/tool 的结构性改动。
- **性能**：召回从"一个 JSON 一次读"变成"几十个小文件读 + 解析"。60 条量级无虞；每轮 git 提交（WorkspaceGit）的开销与仓库膨胀需要观察，handoffs 教训在前（单文件 143 KB）。
- **前缀缓存**：core+active 清单进 system 前缀，条目变动会打穿缓存（types.ts:1053 明示"内容只应随 Persona 自己的输入变化"）；settle 应集中在每日结算而非每 tick。
- **部署混用**：`deployments/mybot` 是 cormini 的家（2.4 MB 现成文件）。xiaoyu bot 必须用独立部署，否则两套 workspace 文件互相污染且回滚账本对不上。
- **双源兼容期**："新优先、旧兜底"期间若只有旧家被写（旧代码路径未切干净），新家会静默过期——migrate-state-roots 的脚本头注释（:5-7）就是为这个坑写的；兼容期要短、要有退场日。
- **schemaVersion 联动**：`fields.json` 瘦身是 `STATE_SCHEMA_VERSION` 语义变更（personaAdapter.ts:155-168 对不认得的版本宁可走备份），必须 `5 → 6` 并让旧代码拒绝读新文件，而不是让新文件被旧代码当坏文件恢复掉。

### 不知道 / 证据不足（诚实清单）

- 未读 `runner.ts`、`capability.ts`、`life-stages.ts`：`remember/applyRecall/saveState` 的全部调用点与时序没有逐一核实，写路径改动的准确工作量未知。
- 未读 `bili-whale.config.json` 与小鱼实际的 bot/部署组装方式：她的 World 今天挂在哪个 bot 下、`cortico-bot-xiaoyu` 是新建还是已有包，未核实。
- cormini 前缀如何常驻 CONSTITUTION/文件清单（`workspaceTools.ts` 只看了工具名），MEMORY 0-4 模板全文未读；residentCap/activeCap 的建议值（8/40）是拍的，无实测依据。
- `memoCapGuard` 只在 memoTiers.ts 注释里见到（:8），实现与触发点未读。
- WebUI Memory 页对文件式记忆具体渲染什么（`web/server.ts:649` 只确认了 memoryDir 传入），"可查"到什么程度未验证。
- `days/` 快照的完整 schema 只从 counterfactual.mjs 的用法反推（:57-70），`state.end.json` 是否总含全量 memories 未逐日核实——若不含，验收 §4.4.2 需改用 live fields.json 作迁移前基线并停写窗口比对。
- `voice-brief.ts`（`Cortico/persona-core/src/voice-brief.ts`，counterfactual 跨仓加载 :23）内部如何消费 memories 未读，"输出逐字节相同"的推断基于它只吃数组字段，未验证。
