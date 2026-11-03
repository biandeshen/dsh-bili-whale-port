# @xiaoyu/persona-core

小鱼的纯函数内核与统一能力扩展契约（100% 宿主无关、零 IO、零 `cortico/*` 依赖）。

## 模块构成

| 文件 | 职责 |
|---|---|
| `capability.ts` | `XiaoyuCapability` 四件套契约与 `validateCapabilityContract`（强制要求可写操作面板） |
| `types.ts` | 7 个原子场、效果、三层因果事件、记忆结构与核心常量 |
| `emotion.ts` / `emotion-projection.ts` | 7 场 → 15 情绪连续投影与成因合成 |
| `rhythm.ts` / `npc-state-machine.ts` / `life-activities.ts` | 状态驱动作息、关系五态机、日常微活动 |
| `decay.ts` / `effect-bus.ts` / `budget.ts` | 场值衰减、效果收集结算总线、来源每日预算 |
| `memory.ts` / `retrieval.ts` | 记忆编码强度、闪光灯衰减、四信号确定性召回与意外槽 |
| `voice-brief.ts` / `causal-chain.ts` / `conversation-assessment.ts` | 出稿语气 Brief、因果树追溯、入站对话归因 |
| `temporal.ts` / `naming.ts` | 昼夜相位与季节元信息、`owner.displayName` 唯一称呼收口 |
