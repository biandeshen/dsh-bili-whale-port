# 01 · 作息与自主行动

> 本文只写**现在成立的机制**。历史与案卷在 `docs/attic/`，不许作为施工依据。
> 状态：**运转中，但"节流阀"的说法已被实测证伪过一次**（见 ⑤）。

## ① 现在是什么

心跳每 30–90 秒评估一次（宿主 `tick.intervalMinutes=0.5` 提供节拍，persona-core 决定下一拍间隔）。
每次评估算四路驱动：`explore`（好奇）、`connect`（想念）、`restPressure`（歇够了想动）、`activityDrive`（7 类生活活动里最想干的那一类的强度），
取 `drive = max(四路) × (1 − tired)`；再乘概率门 `CHECK_PROB` 决定这一拍要不要**投递给她**。

投递与否的语义在 2026-11-06 被纠回来过一次：`shouldAct=false` 时 `make()` 返回 null、宿主 `renderDeferred` 见 null 就 `continue`，**一次模型调用都不花**；
此前我们是"先叫醒她，再告诉她别动"，每 5 分钟烧一次调用换回一句"待着，不动"。
投递之后由她决定做什么，做完用 `life_do` 记一笔进 `actions.ndjson`（append-only，这是"她真做过什么"的账），
`fields.json` 里的 `actionsToday / lastActionAt / lastKind / nextCheckAt` 只是它的汇总。

三态休息是**三个不同状态**，不是"睡/醒"两态：`awake`（醒着）/ `resting`（有点累在歇着，体力慢慢回、不做梦、不触发夜间结算）/ `asleep`（睡着时段，记忆结算与遗忘叙事在这里跑）。

## ② 真值在哪

| 参数 | 定义 | 配置键 | 面板控件 |
|---|---|---|---|
| `CHECK_PROB` | `packages/persona-core/src/rhythm.ts:74` | 无（写死在码里） | 无 |
| `NEXT_CHECK_MIN_MS` / `NEXT_CHECK_MAX_MS` | `packages/persona-core/src/rhythm.ts:101-102` | 无 | 无 |
| `ACTION_COST_ENERGY` | `packages/persona-core/src/rhythm.ts:88` | 无 | 无 |
| `REST_RECOVERY_PER_HOUR` | `packages/persona-core/src/rhythm.ts:83` | 无 | 无 |
| `energy` | `fields.json` 的 `fields.energy` | 无 | 鱼缸滑块 `cap-state-rhythm/src/webui/client.ts` |
| `intervalMinutes` | 宿主 tick | `tick.intervalMinutes`（部署 `config.json`） | 设置页 |
| `sleepWindow` | `persona/life.json` | `worlds.*.sleepWindow` | 作息模式与时段控件 |

**读法纪律**：改这一层之前先看 ⑤ 的两条实测矛盾，不要拿参数表当结论——`CHECK_PROB` 的数值与"每天几次"的历史口径已经漂过两次（见 ⑤ 第 1、2 条）。

## ③ 失败与边界

- **上游不通（402/429）**：投递在 2026-11-07 加了退避（`packages/cortico-bot-xiaoyu/src/cortico-persona.ts` 调 `stallScheduleMs`，1/2/4/8/16/30 分钟封顶，公式唯一一份在 `stall-backoff.ts`）。
  它拦的是"对着已知死的端点再敲一次"，**不是**她今天能做几件事；恢复即清零；读数失败时照常投递。
  账落不落：退避只记 warn 日志，不写 `actions.ndjson`（不写=不污染 ②）。
- **概率门不投的拍**：不产生模型调用，但作息账照记（`lifeTick` 在投递判定之前跑完），主人查得到 `nextCheckAt` 与理由。
- **体力低于疲劳门**：`tired` 收束活动；**这条不是外部配额**，是 ② 里那组收支算出来的结果。
- **记账与真做过脱节**：`life_do` 是她说"我做了"，除 05/06 的读路与写路回执外没有独立校验——所以本层的"226 件"绝不能被当成对外产出（判据在 06 与 `scripts/outward-evidence.mjs`）。

## ④ 操作面

- 场值 6 条（体力/刺激/想念/社交/好奇/创作）与心情：鱼缸面板可直接拖滑块，**改完即时生效、不需重启**。
- 作息模式（自然 / 强制休息 / 保持清醒）与睡眠时段：面板可改；`modeExpiresAt` 到期由下一次 `lifeTick` 读回自然态。
- `CHECK_PROB`、间隔上下限、行动开销与恢复速率：**当前只能改代码**（没有配置键也没有面板入口）。要上面板属于新旋钮，须先说清"治带多少、不治说几次"的界线。
- 心跳节拍 `tick.intervalMinutes`：改部署 `config.json`，**需重启**才生效。

## ⑤ 已知缺陷与验证方式

1. **"实测 116–125 次/小时 vs 上界 42 次/小时 ⇒ 概率门没生效"这个结论不成立，是单位混用**，我复核并推翻过：投递回合实测（transcript 里 `[system] 已安静…` 开头）本地 08–19 时是 **27–52 次/小时、均值约 36**，与 `120 拍/小时 × 0.35 ≈ 42` 同量级；116–125 是**模型调用数**＝回合 × 每回合轮数（全天 1.97，停摆期 ≥3，因为 402 重试也在往同一回合加调用）。复现：`node scripts/token-anatomy.mjs --date=2026-11-06`，以及按 `[system] 已安静` 计数 transcript。
2. **历史回执与代码漂**：交付曾写「`CHECK_PROB` 5%→2%」，被 `8c98859` 推翻，现值 `0.35`。凡引用本层数值，必须从 ② 的定义行读，不要从任何回执读。
3. **`lastKind` 只写不读、候选无当日记忆**：`pickActivities(fields, { now, rng, k = 3 })`（`packages/persona-core/src/life-activities.ts:121`）的参数里没有 `lastKind`，决策路径不读它 → 同一类活动可被反复递上。
   实测后果：`diary_read` 172 次只有 17 种入参、`life_do` 226 笔只有 35 种、中位间隔 62.2 秒、最后两笔相隔 68 秒逐字相同。复现：`node scripts/token-anatomy.mjs --date=2026-11-06`（⑤ 与 ②c 两张表）。
4. **自我重读循环与成本是同一个环**：225/226 笔行动的内容是重读她自己的本子，而 `diary_read` 的回灌占单次成本 **34.7%（≈22 万 token/次）**。已做的一刀是"同一入参不重送全文"（`packages/cortico-adapter/src/index.ts` 的读去重，测试 `tests/read-dedupe.test.mjs`），**没有做**的是候选去重——因为本层设计明写"代码不替她决定做哪个"。
5. **死码与不存在的符号**：`expireModeIfNeeded` 不存在；`gapLeft` 与 gap/cap 分支在现路径里不可达。引用它们会写出无法执行的验收，复现：`grep -rn "expireModeIfNeeded\|gapLeft" packages/persona-core/src packages/cap-state-rhythm/src`。
6. **"唯一节流阀是体力"这句已被证伪过一次**：2026-11-06 让她停下来的是外部额度（体力 0.531，远高于疲劳门 0.18）。复现：`node scripts/outward-evidence.mjs --date=2026-11-06` 与 `data/usage.jsonl` 的 status 分布。
7. **待修（负责人：本任务；批次：#64）**：重启后成对报"单次 input p50/p90"与"交接次数"，验证 ② 的预算与去重是否净省；若她的活动分布被压窄即为做错方向。这是本份唯一保留的"待"字条目。
