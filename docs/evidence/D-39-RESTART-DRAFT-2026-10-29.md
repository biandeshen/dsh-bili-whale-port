# D-39 重启 turn 也能出稿 —— G3b 口径缺口（2026-10-29）

> 事实：2026-10-29 20:50:51 的“进程重启，session 已续上”触发了一轮完整流程，20:51:37 调用 `bili_draft_dynamic`，生成 `dyn-20261029-8e3377`（date=10-29、diaryHash 匹配）。
> 这不是 `bili.action_due` 自然唤醒，没有 trigger 事件。`g3b-check` / `day-report` 只看草稿字段，会把它算作“当天有稿”。

## 1. 证据

`session-main.jsonl` 20:50–20:52：

```
20:50:51 USER [system] 进程重启,session 已续上。
20:50:53 bili_mood_read
20:50:53 bili_traffic
20:50:57 bili_feed
20:51:09 bili_debrief
20:51:18 bili_diary_read
20:51:25/35 bili_diary_append ×3
        [system] 这一轮已经连续行动很多步。先按 ORIENTATION 把这一轮该做的做完（尤其是今天还没出的草稿），再调 end_turn。   ← D-38 修复已生效
20:51:37 bili_draft_dynamic → ok, dyn-20261029-8e3377
20:51:40 bili_mood_apply
```

`day-report --date 2026-10-29`：`PASS draft dyn-20261029-8e3377`、`draft.diaryHash==diary match`、`齐全`。

## 2. 问题

- G3b 的“连续 3 天”只看 cf + 草稿字段，**不区分草稿由自然 `action_due` 还是重启 turn 产生**。
- 观测 K1 同理，会把“零自然行动、仅重启补稿”的日子算成有稿天。
- 10-29 当天有一次自然行动（16:43 `kind:'action'`），所以按“当天至少一次自然行动”的规则，10-29 仍然算；但如果某天完全没有 action、只有重启补稿，就不该算。

## 3. 团队裁决

| 席 | 结论 |
|---|---|
| 产品 | 一天的成立要件是“她自然醒过一次”，不是“文件里有一份稿” |
| 架构 | 不从草稿反推来源（旧稿没有 provenance）；用 append-only `causal.jsonl` 的 `kind:'action'` 做“当天活过”的证据 |
| 运行 | 10-29 有 16:43 的 action，规则不会误杀今天 |
| 挑刺 | 这仍允许“自然 action 后、重启补稿”算一天；要精确到轮次需存 draft provenance，另立 D-39b，不在 G3b 前做 |
| 记录 | 规则写进 g3b-check 与 observation-status，补测试 |

**裁决：G3b 的每一天、观测 K1 的每一天，都必须在该逻辑日至少有一条 `causal {kind:'action', atMs}`。** 草稿字段仍要合规（diaryHash/date/degraded）。

## 4. 改动

| 文件 | 改动 |
|---|---|
| `scripts/g3b-check.mjs` | 每日新增 `hasAction`（读 causal，按 04:00 日界）；`draftBound` 需同时 `hasAction`；detail 加 `action=y/n` |
| `scripts/observation-status.mjs` | 行增加 `action`；K1 只数 `draft && action` |
| 测试 | g3b-check 测试的每天写一条 causal action；新增“无 action 不 ready”；observation-status setup 每天写 causal action，并加“无 action 不计 K1” |

## 5. 边界

- 旧日（10-26/27/28）没有 `kind:'action'` 记录（补写逻辑上线晚），本来也过不了 cf/diaryHash；不补造。
- 10-29 有 16:43 的 action，规则通过。
- D-39b（draft provenance：记录草稿由哪次 wake 触发）留到观测前评估，不在本轮做。

## 6. 验证（2026-10-29 21:01）

```
node --test tests/contract/g3b-check.test.mjs        # 5/5
node --test tests/contract/observation-status.test.mjs # 6/6
npm run gates                                        # dsh 33 文件 + Cortico 103/103，hash 一致
node scripts/g3b-check.mjs
# 10-28/27/26 均 action=n（旧日无 action 记录），不 ready——预期
```

10-29 在 `causal.jsonl` 有 16:43 的 `kind:'action'`，所以明天进入三天窗口后，`action=y`；草稿 `dyn-20261029-8e3377` 的 diaryHash 已匹配。

## 7. C2 恢复后的边界（2026-10-30 09:00）

C2 start 会恢复 session，Core 注入“进程重启”；模型可能像 10-29 20:51 那样，在**自然 action 之前**就跑完一轮并出稿。两种结果：

- **之后仍有自然 action**：当天 `action=y` + 草稿合规 → 按规则算一天。`todayDraftLine` 会让她在自然 action 里看到“今天已有稿”，从而不再重复出稿；这不影响判定。
- **整天没有自然 action，只有重启稿**：`action=n` → 不算。这是规则想要的效果，不是故障。

因此 10-30 的关键不是“有没有稿”，而是 **09:00 恢复后有没有一次 `kind:'action'`**。行动观察器 `207048` 到 15:06 就是在等这个。
