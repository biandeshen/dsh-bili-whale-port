# persona-core

小鱼的人格内核。**移植自 AMpath**（`codex/ampath-unified-candidate` 分支，2026-10-26），纯 TS、零 Electron 依赖。

## 来源与取舍

| 文件 | 来源 | 处理 |
|---|---|---|
| `types.ts` | `packages/shared/src/types.ts`（36KB） | 只抽 `AtomicFields`/`Effect`/`CausalEvent`/`Memory` 等 7 个依赖符号 |
| `effect-bus.ts` | 同名文件 | 原样搬（Collect→Resolve→Apply + 50ms 频率门 + 0.03 阈值） |
| `causal-chain.ts` | 同名文件 | 原样搬（L0/L1/L2 + 因果树 + `explainMoodDrop`） |
| `memory.ts` | 同名文件 | 原样搬（编码强度/衰减/flashbulb/回忆加成） |
| `npc-state-machine.ts` | 同名文件 | 原样搬（关系五态：正常/冷战/missing/修复/重聚） |

**弃用**：Fastify server、Drizzle/SQLite、Electron 渲染层、EmergentDimension 生命周期、60× 加速时钟。

## 与宿主的关系

Cortico 提供运行层（事件流/会话/timer）；本包只提供人格层。

```
Cortico Persona（壳）
  └─ persona-core（芯）
       ├─ EffectBus：所有状态变化的唯一通道
       ├─ CausalChain：为什么变成这样
       ├─ Memory：记得什么、淡忘什么
       └─ StateMachine：和主人的关系处于哪一态
```

## 用法

```ts
import { EffectBus } from './effect-bus.ts'
import { DEFAULT_ATOMIC_FIELDS } from './types.ts'

const bus = new EffectBus()
bus.collect({ field: 'mood', delta: +0.08, source: 'master-reply', priority: 5 })
const resolved = bus.resolve()
const changes = bus.apply(DEFAULT_ATOMIC_FIELDS, resolved)
```

## 许可事项

AMpath 为私有仓库、无 LICENSE。本包仅供本地自用；**对外发布前必须重写或取得授权**。
