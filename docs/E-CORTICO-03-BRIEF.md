# E-CORTICO-03 Brief（P0「活过来」立项卡）

> 配套 `docs/PRODUCT.md`。原则：先把「活」做出来，再开渠道。

## 范围（P0）

- 作息：**状态驱动**（无聊/想他/睡够了 × 体力 × 抖动），无固定时间表；单日 ≤3 次、间隔 ≥2.5h
- 人格：7 场值 + 情绪成因 + 因果 before/after + 逐日衰减 + 硬耦合（12h 上限，不越基线）
- 记忆：看完就记（编码强度按刺激量）、按天衰减、flashbulb 免衰减；醒来带出最清晰的 3 条
- 纪律：feed 后必须 debrief；违规落盘并下一轮点名
- 表达：每天 1 条动态草稿，ack 一次性令牌（12h），人审后发
- 自我修正：审批结果写 causal → 醒来由**代码**结算成 draftApproved/draftRejected
- 安全：kill 守卫、审计、预算查询
- **不含**：视频、直播、评论、私信、跨平台、Coopanion

## 14 分（当前自评）

| 维度 | 分 | 说明 |
|---|---|---|
| 正确性 | 1.5 | 纯函数 5/5 + drill 21/21；缺 World 集成单测 |
| 安全 | 2 | ack 一次性 + kill 演练 + 门禁拒绝 |
| 可观测 | 2 | run/toolcalls/transcript/causal/audit + health |
| 可恢复 | 2 | 补醒实测 + 重启单实例 |
| 风控 | 1 | 预算可查，缺硬日写额度与停手演练 |
| 可用性 | 2 | 单实例自启 + 健康检查 |
| 可维护 | 1.5 | RUNBOOK/BRIEF/PATCHES；Cortico 非 git |
| **合计** | **11/14** | 未达 12，不能对外发布 |

## 锁定项

- 人设：小鱼 / 鱼片 / 本小姐；四条铁律；正文无 AI 声明，披露在简介
- 节奏：21:30 出稿（Track A）+ 21:40 唤醒（Cortico），每天最多 1 条发布
- 渠道：P0 仅动态；其余渠道按 PRODUCT.md 逐关开放
- 数据：WHALE_HOME=`~/.dsh`；草稿=`D:\AI\养鱼\drafts`；控制=`~/.dsh/bili-whale/control`

## P0 验收（连续 14 天）

1. 每晚 run 含 `mood_read → traffic → feed → debrief → diary_read → draft → mood_apply`
2. 未审批写操作 = 0；纪律违规连续 7 天 = 0
3. 草稿 token 正常生成、无重复放行；kill 演练每月一次
4. 日记连续、情绪成因可追溯
5. drill 21/21 + core 5/5 + track-a 6/6 保持

## 补分顺序（到 12 分才开 P1）

1. **风控 1→2**：World 层硬日写额度（1/天）+ 412/-352/-101 停手演练
2. **正确性 1.5→2**：World 集成单测（用假 CLI 跑 7 工具）
3. **可维护 1.5→2**：Cortico 补丁纳入版本化（git init 或 bundle 快照）
