# D-36 唤醒语把 ORIENTATION 变成可选 —— 团队裁决（2026-10-29）

> 事实：两次真实自主唤醒都没有走完流程，尤其没有 `debrief` 和 `draft_dynamic`。
> 议题：G3b 要求连续 3 天有稿；但“做不做由你定”是她“活着”的一部分，不能直接改成打卡。

## 1. 事实（会话原文，非推测）

| 唤醒 | 实际调用 | 缺什么 |
|---|---|---|
| 2026-10-27 15:49（restless） | `external_event_frame` → `bili_mood_apply(draftApproved)` → `bili_feed(n=2)` → 3 次 `bili_diary_append` | **无 `bili_debrief`、无 `bili_draft_dynamic`**；feed 返回的是播放个位数的新片，她判定“无从判断”后跳过 |
| 2026-10-28 22:21（restless） | `external_event_frame` → 1 次私人日记（“情绪系统与我的判断不一致”） | **无 mood_read/traffic/feed/debrief/草稿**；她选择记录系统矛盾，没看片 |

证据：`Cortico/deployments/mybot/data/session-main.jsonl`（按 `context.ts` 过滤 22:21–23:30、15:49–15:50）。
唤醒语原文：`按 ORIENTATION 走一轮；做多少、做不做，由你定。`（`definition.ts` 行动事件末尾）
活动列表前缀：`这轮可以先挑一件小事（也可以不做）`。

## 2. 六席裁决

| 席 | 主张 | 结论 |
|---|---|---|
| 产品席 | “看”是生活，“发”是表达。每天都可以看，但不该被逼着发；G3b 要的是表达证据，所以表达要被**默认**，不是被强制 | 采纳：看的部分强制，草稿默认、可拒但须留原因 |
| 架构席 | 只改提示词，不动工具门禁与场值；`bili_draft_dynamic` 的 debrief/日记/去重三闸保持 | 采纳 |
| 运行席 | 10-27 跳过 debrief 的直接原因是 feed 质量差（播放 1）；D-31 已收回多命中免检，需在下一轮自然唤醒复看 | 采纳：把 feed 质量当作前提一起观察 |
| 安全席 | 不放松任何写操作；草稿仍只入队 | 采纳 |
| 挑刺席 | 改提示词不保证模型遵守；应该直接在 `bili_diary_append` 返回里加 `[NEXT] 写草稿` | **部分驳回**：先观察一轮；若仍跳，再加工具级 nudge（记 D-36b） |
| 记录席 | 不能用“改了提示词”当证据，必须等一次自然唤醒的工具序列 | 采纳：D-36 在自然唤醒前保持 OPEN/MITIGATED |

## 3. 改动

| 位置 | 改前 | 改后 |
|---|---|---|
| 行动事件末尾 | `按 ORIENTATION 走一轮；做多少、做不做，由你定。` | `这一轮先看：mood_read → traffic → feed → debrief → 读/写当天两本日记。这几步不能跳。` + `看完再决定要不要出草稿（第 6 步）；不想发，就在私人日记里写清原因。` |
| 活动列表 | `这轮可以先挑一件小事（也可以不做）` | `看完还有余力，可以再挑一件小事` |
| ORIENTATION 第 6 步 | “调用 draft_dynamic 生成草稿” | 补一句：`看完如果有想说的就写；实在不想发，就在私人日记里写清原因。` |

没有改：工具参数、写操作审批、`canDraft`/`diaryFresh` 闸、feed 预算、节奏阈值。

## 4. 验收

- **D-36 关闭条件**：一次自然唤醒的 `session-main.jsonl` 里出现 `bili_feed` → `bili_debrief` → 当天公开日记 → `bili_draft_dynamic`（或私人日记里明确写“不发+原因”）。
- 若连续两次自然唤醒仍跳过 debrief/草稿 → 启用 D-36b：在 `bili_diary_append` 的返回里追加下一步提示，不改门禁。
- 不把“提示词改了”算作通过；不算 G3b 证据。
