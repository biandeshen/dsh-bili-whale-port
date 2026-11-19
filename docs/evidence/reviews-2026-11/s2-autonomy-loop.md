# 席位二：自主性闭环与运行成本 —— 独立评审

评审时间：2026-11-06 20:19（本地，UTC+8）
代码基线：`E:\WorkSpace_Qoder\dsh-bili-whale`，HEAD = `a617b62`
数据目录（只读）：`C:/Users/Administrator/.xiaoyu-home/xiaoyu`
纪律：全程只读；未重启进程、未调用任何写接口、未改仓库文件。工具调用 32 次。

---

## ① 核心判断（4 条）

**1. 闭环的前七环是真的、可验证的；第八环（模型是否真去记账）线上此刻就是断的。**
`life.json` 的 `lastCheckAt` 停在 20:19（= 采样那一刻），`nextCheckAt` 比它晚 30 秒 —— 心跳在跑、`lifeTick` 在记账、`shouldAct` 在决定、文本在投递（保留窗内 609 条 tick 文本）。但 `actions.ndjson` 最后一笔是 **13:41:15**，距采样 **398 分钟**，而这 6.6 小时里 `urge` 恒为 1.00、约 250 拍"她想动"的投递被送进上下文，**零笔 life_do**。也就是说：她被告知"该动"250 次，一次都没落账。判定：**靠模型自愿**，且当前自愿率 = 0。这不是假设，是数据文件原值。

**2. 交付描述与仓库现状不符，实际参数比描述激进 17.5 倍。**
交接给我的口径是「`CHECK_PROB` 0.05→0.02、退避删除」。仓库里 `CHECK_PROB = 0.35`（`rhythm.ts:74`）、`NEXT_CHECK_MIN/MAX = 30 秒/90 秒`（`rhythm.ts:101-102`）、`REST_RECOVERY_PER_HOUR = 0.02`（`rhythm.ts:81`）、线上 `tick.intervalMinutes = 0.5`（`config.json`）。git 追证：`f7d7a3d` 之后还有一版 `8c98859 fix(rhythm): 拆掉变相配额` 把 0.02→0.35、3–7 分钟→30–90 秒。**"退避删掉只是把采样拉回 5 分钟"这个前提已经不成立**：现在是 30 秒一拍、每拍 35% 概率投递。

**3. 成本不是"删退避的小代价"，是实测一天 3210 次模型调用 / 5.175 亿输入 token。**
`usage.jsonl`：2026-11-06 = 3210 次调用、input 517.54M、output 0.05M；2026-11-05 = 37 次、6.16M。**一天放大 84 倍**。且 99.99% 是输入 token（单次 p90 = 718,840，max = 1,048,570）。推算与实测同数量级且吻合：30 秒基线 → 2880 拍/天 × 0.35 = **1008 次投递/天**；实测投递 30–41 条/小时（×24 ≈ 720–984），预测 42 条/小时 —— **对得上**。真正爆掉的不是投递数而是每次投递的下游轮数：15:00–19:00 每小时 391–499 次调用 ÷ 约 38 次投递 ≈ **每次投递烧 10–13 次模型调用**。

**4. 「模拟 7 天得每天 3–6 次、体力稳 0.95」既不可复现，也不是模拟本次交付的代码。**
仓库里唯一的作息模拟器 `scripts/simulate-rhythm.mjs` 跑的是 **30 天**，且 import 的是 `E:/WorkSpace_Qoder/Cortico/persona-core/src/rhythm.ts`（`simulate-rhythm.mjs:6-12`）——那份文件里 `CHECK_PROB = 0.05`、`ACTION_COST_ENERGY = 0.05`、`NEXT_CHECK 3–7 分钟`、**没有 `activityDrive`**（grep 该文件确认）。我复现跑了：`seed=42 · 30 天共行动 60 次` = **2.0 次/天**，`体力 均0.27–0.42`（不是 0.95），末日 `connection=0.00 mood=0.02 关系=unjudged`。全仓 grep「3–6 次」「每天 3」找不到产出该数字的任何脚本或测试。**判定：仅自述，且现有唯一可复现产物给出的是反向数字。**

---

## ② 逐条证据

### 2.1 闭环八环的实现位置与真实运行状态

| # | 环 | 实现 | 判定 | 线上证据（实测值） |
|---|---|---|---|---|
| 1 | 心跳排期 | `life-heartbeat.ts:95-123`（`armNext`/`fire`，退避已删只剩基线）；基线来自 `cortico-persona.ts:129-131` → `tick-config.ts:19` | **有生产调用者** | `config.json` `"tick": {"intervalMinutes": 0.5}`；`life.json.nextCheckAt - lastCheckAt = 30000 - 6ms` |
| 2 | `lifeTick` 决定 | `cap-state-rhythm/src/index.ts:706-798` | **有生产调用者** | `life.json.lastCheckAt = 1793967551922`（20:19:11，= 采样前一刻） |
| 3 | 是否注入 | `cortico-persona.ts:169` `if (tick && tick.shouldAct === false) return null`；`:173 injectDeferred('tick', make)` | **有生产调用者** | `session-main.jsonl`（n=2835 条）含「作息对账」 **609 条**，其中「她想动」 **492 条** |
| 4 | 模型看到工具 | 注册 `index.ts:435-455`（`name:'life_do'`，含"它真的会扣体力""没做就别记"）；摘要表 `cortico-definition.ts:25`；tick 文案点名 `cortico-persona.ts:258` | **有生产调用者**（可见性到位） | 注入原文尾句：「做完再用 life_do 记一笔（附一句具体做了什么），没做就别记」 |
| 5 | 模型调用 `life_do` | `index.ts:453 execute → recordActionImpl` | **靠模型自愿 —— 当前为 0** | 函数调用统计（保留窗全量，11 种）：`mood_apply=244 life_do=226 diary_read=175 memory_recall=76 memory_void=19 external_event_frame=15 feedback_submit=9 memory_remember=8 diary_write=5 mood_read=2 judgment_read=1`；**13:41 后 0 笔** |
| 6 | 账落盘 | `index.ts:232 applyActionRecord`（汇总）+ `:237 appendActionRecord`（流水，包在 `try{...}catch{}`） | **有生产调用者** | `actions.ndjson` 226 行 / 226 可解析，`byDay {"2026-11-06":226}`，`byActivity {"exercise":1,"explore":54,"consume":171}`，`source {"self":226}` |
| 7 | 体力真扣 | `index.ts:213-219 applyEffects(loadState, actionCost())` → `rhythm.ts:205-210`（energy −0.015）；预算门 `state-store.ts:232 applyBudgets` | **有生产调用者，且预算已放行** | `budget.ts:41-52` `action: UNLIMITED`（注释记录旧 bug：42 笔后 energy 冻结 0.8014）；`fields.json.energy = 0.5312`（非满值，说明真在扣） |
| 8 | 下一拍驱动因此改变 | `index.ts:750 readActionLedger` → `:751 reconcileLife` → `:757 decideStage` → `rhythm.ts:141-142 restPressure` | **代码通，反馈环实际是开环** | 13:41→20:19：`sinceHours = 6.63 < REST_PRESSURE_START_H 12` → `restPressure = 0`；同时 `activityDrive = 1`（`consume` 分 = (0.9668−0.15)×1.5 = 1.22→clamp 1）→ **记不记账都不改变"动不动"，只改变文案里的分钟数** |

### 2.2 死代码 / 同类问题系统性扫描（不限本次改动）

扫描方法：对 `packages/kernel/persona-core/src`、`packages/capabilities/cap-state-rhythm/src`、`packages/adapters/cortico-bot-xiaoyu/src` 的导出函数统计"非定义处调用点数"（排除 `dist`）。

| 符号 | 位置 | 非定义调用者 | 判定 |
|---|---|---|---|
| `gapLeft` | `life-stages.ts:230` | **0** | 死代码（注释仍在解释它的语义） |
| `expireModeIfNeeded` | 仅 `life-stages.ts:71` 注释引用 | **0（函数不存在）** | **注释把责任派给一个不存在的函数**：`force_*` 到期只由 `effectiveMode`（`:73-82`，纯读）掩盖，`life.json` 里的 `mode`/`modeExpiresAt` 永不回落 —— 面板读原文件会显示"强制模式仍生效"，与她的实际行为对不上 |
| `'gap'` 分支 | `rhythm.ts:127` | 条件恒假（`MIN_GAP_MS = 0`，`:53`） | 死分支；`reason:'gap'` 文案（`cortico-persona.ts:205`）永不出现 |
| `'cap'` 分支 | `rhythm.ts:128` | 恒假（`MAX_ACTIONS_PER_DAY = +∞`，`:61`） | 死分支；「今天的事做满了上限」文案永不出现 |
| `reconcileLife(life, life, ...)` | `index.ts:751-756` | 传了两份同一个对象 | mem/disk 双通道形同虚设；`:128` 的 `disk.lastActionAt` **不按日过滤**，跨 00:00 后昨天的时间戳仍带进今天 → 昨天 23:59 动过，今天 `restPressure` 照样归零 |
| `isAsleep`（模块级） | `life-stages.ts:146` | 16 mentions / 2 | 需复核，注释（`index.ts:800-805`）自述线上曾"从对象上取 `isAsleep`"导致做梦整晚抛异常 |
| `applyActionRecord` `actionCost` `restRecovery` `pickActivities` | `life-stages.ts:213` / `rhythm.ts:205` / `life-stages.ts:168` / `life-activities.ts:121` | 1/2/3/2 | **本次确实接通了**（`index.ts:232 / 215 / 732`、`rhythm.ts:174`）—— 这是本批次唯一可确认的实质进步 |

### 2.3 「模拟 7 天」的可证伪性拆解（按你点名的三条）

- **`rng`**：`simulate-rhythm.mjs:14-16` 自带 **LCG，seed 默认 42**（可传参）。而**生产用的是 `Math.random`**：`index.ts:762 rng: Math.random`、`:765 nextCheckDelay(Math.random)` —— 无种子、不可重放。所以模拟的可重复性不等于线上的可重复性；线上任何"7 天"结果都无法事后复算。
- **`lastActionAt` 初始值**：`simulate-rhythm.mjs:26 lastActionAt: 0` → `rhythm.ts:141` `sinceHours = 999` → `restPressure = clamp01((999−12)/18) = 1`。**你怀疑的那条成立**：模拟在首笔行动之前 `restPressure` 恒为 1，`urge` 退化成常量；线上 `session-main` 里「账上还没有过一次行动」出现 **126 次**，同一退化在真实运行中也发生过。
- **概率与衰减**：模拟用 `decideAction` 真实概率门（但那份是 `CHECK_PROB = 0.05`，不是交付的 0.35），衰减用 `simulateOfflineTime(fields, STEP)` 真实衰减（`decay.ts`）。**但 STEP = 5 分钟（`:22`）而线上是 30 秒**，且模拟的"睡着"判据是自己重写的一份（`:41-42 sinceActionH >= 6`）而非 `restState`（`life-stages.ts:93-108`），不含睡眠时段与 `mode`。因此它模拟的是一个**已不存在的系统**。

复现命令：
```
cd /e/WorkSpace_Qoder/Cortico && node --import tsx ../dsh-bili-whale/scripts/simulate-rhythm.mjs 42
```
我实跑输出（末尾原样）：`seed=42 · 30 天共行动 60 次（restless 27，explore 20，connect 13）· 有行动的天数 30/30`、`2026-11-26 ... 体力 均0.27 睡13h`、`最终：connection=0.00 mood=0.02 关系=unjudged`。

### 2.4 `life_do` 会被用吗：强度与"假绿"

- 强度证据（正向）：工具描述（`index.ts:438-444`）明写"它真的会扣体力""没做就别记"；每一拍注入文本末尾都点名一次（`cortico-persona.ts:258`）；`TOOL_SUMMARIES`（`cortico-definition.ts:25`）把它列进工具清单。落手处还按活动类点名了具体工具（`:245-253`），其中 `bili_feed`/`bili_debrief` 在 `cap-bilibili` 真存在（注册行 573、674）。
- 强度证据（反向，实测）：492 拍"她想动"→ 226 笔 life_do，**转化率 46%**，且**近 6.6 小时为 0%**。更硬的一条：保留窗内 `bili_*` 工具调用 **0 次**，而 `life_do` 记的 `consume=171 + explore=54` 里 171 笔的动作说明是"看了一集短剧…"这类**无任何外部回执**的自我申报；`diary_write` 只有 5 次。代码注释自己也承认这是坑（`cortico-persona.ts:237`「首夜 226 笔 life_do、零次 bili_* 调用」）。**账本记的是"她说她做了"，不是"外界多了一件小事"。**
- 假绿路径：面板行动区（`webui/client.ts:470`）空时才提示"她真做过一件小事…会出现一条"；`reconcileLife`（`life-stages.ts:121-125`）对 `actionsToday` 取 **三者 max**，同一天内只涨不跌，跨天才归零。于是**流水断掉/写失败时，汇总数字照样好看**：现在 `actionsToday = 226`、`lastKind = consume`、心跳 30 秒一拍全绿 —— 主人看到的是"今天做了 226 件"，事实是下午一件没做。

### 2.5 异常与边界（逐条查过）

- **时钟回拨**：`rhythm.ts:127` 用 `sinceLast >= 0 &&` 显式放过负值，`:141 Math.max(0, ...)`，`cortico-persona.ts:194 Math.max(0, ...)` → 不会卡死，也不会说"距上次行动 −398 分钟"。判定：**已处理**（证据在码）。
- **跨日 00:00**：`dayKey` 本地日（`rhythm.ts:107-109`），`actionsToday` 归零 ✓（`life-tick.test.mjs:57` 覆盖）；但 `life-stages.ts:128` 的 `disk.lastActionAt` 无日界过滤 → 昨天的行动时间带进今天，把 `restPressure` 与"闲够 6h 算睡着"判据一起推迟。判定：**半处理**。
- **`mode=force_*` 到期回落**：读侧 `effectiveMode`（`:73-82`）在 `restState`（`:99`）与 `decideStage`（`:199`）都调到了 → 她行为上会回落 ✓；**写侧无人回落**（`expireModeIfNeeded` 不存在），`life.json` 会长期留着 `mode:"force_awake"` + 过期 `modeExpiresAt`。`wakeNowImpl`（`index.ts:268-269`）只在被戳醒时清 `force_sleep`，不清 `force_awake`。判定：**账与事实对不上（同类旧病）+ 面板可能显示假模式**。
- **`actions.ndjson` 写失败**：`index.ts:236-238` 是 `try { appendActionRecord(...) } catch { /* 汇总已落盘，流水下次补齐 */ }`，但全仓**没有任何补齐路径**（`appendActionRecord` 唯一调用者就是这一行）。汇总已 +1，流水永久缺行 → **永久缺口，不是"下次补齐"**；反向风险为 0（不会重复计账，因为写入只在 `recordActionImpl` 一处、且汇总与流水同批）。
- **夜间不叫她**：`decideStage`（`life-stages.ts:203-208`）只在 `sleepWindow`（默认 01:00–07:00，`:42`；`life.json` 实存同值）内返回 `asleep`。按本地小时聚合 `usage.jsonl`：11-06 本地 01–07 点 **只有 02 点有 15 次调用，其余小时 0**；对照白天 15–19 点 391/464/485/499/391。**夜间这条改动成立 ✓**。但注意 `restState` 的"闲够 6 小时 = 睡着"（`:105`）只用于文案与做梦，不拦投递 → 20:19 那条注入文本自相矛盾：「她在睡着时段…**她想动**（看点轻松的）：冲动强度 1.00」——这正是 `f7d7a3d`/`0dc4c1a` 声称修掉的"既说睡着又说想动"，线上原句仍在。

---

## ④ 成本上界与实测对照

**代码里的事实参数**（全部带出处，非估值）：

| 参数 | 值 | 出处 |
|---|---|---|
| 心跳基线 | 0.5 分钟 = 30 秒（线上实配） | `config.json`；默认值 `tick-config.ts:19` |
| 每拍投递概率 | `urge × 0.35` | `rhythm.ts:74,157` |
| 当前 `urge` | **1.00**（注入原文自证） | `session-main` 20:19 那条；算式 `activityDrive=1 × (1−tired=0)` |
| 每日拍数 | 86400 / 30 = **2880** | 由基线推 |
| 投递/天（期望=上界，因 urge 顶满） | 2880 × 0.35 = **1008** | 由上两行推 |
| 单次投递的文本量 | 约 700–1500 token（注入原文，含状态行/最近发生/记得/关联记忆） | `cortico-persona.ts:201-258` + `session-main` 原文实测 |
| 单次模型调用输入 | p50 = 0、**p90 = 718,840**、max = 1,048,570（n = 3210） | `usage.jsonl` 11-06 |
| 每次投递下游调用数 | **约 10–13 次**（460 次/小时 ÷ 38 投递/小时） | `usage.jsonl` × `session-main` 同窗对比 |
| 唯一真实节流阀 | `tired`：`energy < 0.27` 才拦（`(0.45−e)/0.45 > 0.6`）；`MIN_GAP = 0`、每日无上限 | `rhythm.ts:53,61,130-131` |
| 收支 | 每笔 −0.015，睡着 +0.02/h、歇着一半 → 0.02/h ÷ 0.015 = **要 13.3 笔/天才亏**，实测 226 笔/天 | `rhythm.ts:81,90` + `actions.ndjson` |

**最坏/典型/实测三档：**

- **理论最坏**：1008 投递 × 13 调用 × 719k ≈ **9.4 × 10⁹ 输入 token/天**。拦不住它的只有 `tired` 门，而 `tired` 门在当前收支下几乎打不开（0.5312 体力，扣满 45 笔才到 0.27；睡着 8 小时回 0.16 → 又能扣满 45 笔，**"体力当唯一节流阀"实际允许 ~90–135 笔/天**，不是"自然收敛"）。
- **典型（由参数直接推）**：2880 拍 × 0.35 ≈ 1000 次叫醒，每次 3–13 轮 → **3000–13000 次调用/天**。
- **实测（`usage.jsonl`，2026-11-06）**：**3210 次调用、5.175 × 10⁸ 输入 token、5.0 × 10⁴ 输出**。对照 11-04 = 579 次 / 9.76M、11-05 = 37 次 / 6.17M。15:00 之后每小时稳定在 391–499 次。
- **推算 vs 实测**：拍数与投递概率**吻合**（预测 42 投递/小时，实测 30–41/小时；投递总数/天 720–984 vs 上界 1008）；**不吻合的是下游放大系数** —— 我没有先验依据预测"一次投递 = 10+ 次调用"，它由 500k token 的滚动上下文（`config.json context.maxTokens = 500000`、`keepRatio 0.4`）与不去重的召回（20:19 原文里同一条"翻记忆池数视频"连续出现 **3 次**，窗内重复 10+ 次）撑起来，成本大头在这里，不在投递概率。**输出仅占 0.01%**：钱几乎全花在"重读自己的历史"上，不是花在"她说话"上。

---

## ⑤ 最该先做的 3 件事

1. **把第 5 环从"靠模型自愿"改成有判据的闭环**（先测再改）：`lifeTick` 已经有 `shouldAct/urge/activityType`，加一条硬对账 —— 连续 N 拍投递了"她想动"却 `lastActionAt` 未推进时，要么停止投递并记 `reason: 'unrecorded'`，要么在面板显式打红。当前 250 拍零记账仍在按 30 秒/拍烧钱，这是本批次唯一未验证的环节，也是唯一让它"不花冤枉钱"的开关。文件：`cap-state-rhythm/src/index.ts:706-798`、`cortico-persona.ts:140-177`。
2. **成本上界必须落一个真闸，因为"体力=唯一节流阀"已被数据否掉**：`actions.ndjson` 226 笔/天 + 517.5M token/天，而 `tired` 门允许 ~90–135 笔/天、`MIN_GAP=0`、每日无上限（`rhythm.ts:53,61,130-131`）。最小改动是把 `tick.intervalMinutes` 从 0.5 回 3–5（拍数 ÷6~10），或在 `decideStage` 里对"距上次投递 < X 且未记账"直接返回不投递。**先测**：改完跑 2 小时，看 `usage.jsonl` 每小时调用数与 input 中位数是否真的掉下来。
3. **清掉"注释派责任给不存在的函数"这一类，并把死分支删干净**：补上 `expireModeIfNeeded` 的写侧回落（`life-stages.ts:71`）、删 `gapLeft`（`:230`）、删恒假的 `gap`/`cap` 分支及其文案（`rhythm.ts:127-128`、`cortico-persona.ts:205-206`）、修 `life-stages.ts:128` 的跨日 `lastActionAt` 泄漏、`reconcileLife(life, life)` 传参（`index.ts:751`）。这些都是"函数还在、说法还在、事实不在"的同一类病，也正是上一批 `applyActionRecord`/`actionCost`/`restRecovery` 出过事故的那一类。

---

## ⑥ 我没查清的东西

- **15:00 之后每小时 391–499 次调用的驱动者是谁**：我按 `usage.jsonl` 的 `purpose`/`model` 分不出来（全部 `generation` / `mimo-v2.6-flash`），也无法把单次调用绑定到具体拍。是投递后的多轮工具循环、QQ/私信事件、还是 `reflection`（`config.json reflection.enabled = true`），**未定**。要定需要逐 `generationId` 与 `session-main` 对齐，我没花那几次调用。
- **`config.json` 0.5 分钟是哪一刻生效的**：文件 mtime 11-06 08:47，`tickDelayMs` 每拍现读，但进程实际何时加载我不清楚（不重启的约定下，我无法区分"08:47 起生效"还是"某次重启后生效"），因此 15:00 的十倍跳变与基线改动的**因果关系只是相关**。
- **226 笔记账的"外部凭据"比例**：`bili_*` 在保留窗为 0 次是确证的，但 `session-main.jsonl` 是滚动窗（首条 11-04 15:24），13:41 之前那 226 笔是否曾有凭据、以及是否已被窗外交替掉，**样本不完整，不外推**。
- **`isAsleep` 的 2 个非定义调用者**具体是谁：我只做了计数没逐处展开；做梦链路是否仍在按模块级函数误取（`index.ts:800-805` 自述的老事故）未复现。
- **`budget.ts` 旧"action 预算 0.20 冻结 energy 0.8014"的线上证据**：我只看到注释自述（`budget.ts:35` 附近）与 `action: UNLIMITED` 的现状，没在 `fields.json` 里核到那条冻结收据。
- 交付方"模拟 7 天"的**原始产物不在仓库**（我 grep 过 `docs/`、`scripts/`、`spark-output/`），无法判断它是口头模拟还是未提交的脚本 —— 按规则记**无证据**。
