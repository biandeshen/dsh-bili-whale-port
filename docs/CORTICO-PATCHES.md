# Cortico 侧补丁清单（该目录不是 git 仓库，改动以此为准）

根：`E:\WorkSpace_Qoder\Cortico`

## 新增
- `src/worlds/bili-account/definition.ts`：World（7 工具 + 每日 21:40 + catch-up + kill 守卫 + 违规 causal + 轮次落盘）
- `src/worlds/bili-account/personaAdapter.ts`：World ↔ persona-core 适配（唯一状态源；离线衰减、因果、记忆、关系机、情绪标签）
- `src/worlds/bili-account/gates.ts`：canDraft / canApplyWatched / violationNotice
- `src/worlds/bili-account/runner.ts`：可注入 kill 守卫的 spawn 包装
- `persona-core/src/decay.ts`：原子场离线衰减（移植 AMpath `field-engine/real-time.ts`，一步不越过基线）
- `persona-core/tests/core.test.mjs`：16 条人核心单测（含衰减/硬耦合）
- `persona-core/tests/adapter.test.mjs`：9 条适配层单测（同源效果、冷战、情绪成因、状态原子写/备份/triggerId）
- `tests/core.test.mjs`：7 条 World 纯函数单测（情绪标签、门禁、custom 白名单、记忆、runner）
- `deployments/mybot/prompts/ORIENTATION.md`：小鱼人设与每轮步骤
- `deployments/providers/opencode-go/`：provider 配置（.env 含 key，勿提交）

## 修改（上游文件）
- `src/worlds/index.ts`：注册 `bili-account`
- `bots/cormini/index.ts`：debug 日志已移除（无功能改动）
- `bots/cormini/persona/persona.ts`：心跳文本追加“按 ORIENTATION 执行一轮”
- `tests/core/provider-routing.test.ts`：harness 隔离并恢复 DEEPSEEK_API_KEY
- `tests/env-prompt-contract.test.ts`：git ls-files → fs 遍历（不依赖 git）

## 2026-10-27 二轮审计 P0 修复
1. **频率门吞效果（P0-1）**：`applyEvent` 不再 `new FrequencyGate(50)`；一个事件即一个批次，同源效果全部生效。
2. **场值从不衰减（P0-2）**：新增 `persona-core/src/decay.ts`，每次应用事件先按离线时长结算；`connection` 可由 0.5 跌破 0.3 并在 24h 后进入 `cold_war`（有单测）。
3. **双事实源（P0-3）**：删除 `fields.ts` / `mood.ts` / `decay.ts`（266 行死代码）；情绪标签 + 成因并入 `personaAdapter.readMood`，直接读 7 个原子场。
4. **令牌不可用（P0-4，dsh 仓）**：`dynamic-approve list` 打印完整 token；ack 队列原子写、`wx` claim 防并发双放行、`timingSecureEqual`、过期清理、草稿精确匹配（去掉 `startsWith`）。
5. **崩溃清空记忆（P0-5）**：`fields.json` 原子写 + `schemaVersion` + `.bak`；坏文件改名留档并从备份恢复；链截断清掉悬空 `triggerId`。
6. **mood_apply 忽略入参（P0-6）**：支持 `custom`（白名单校验：7 场、|Δ|≤0.5、≤8 条）；`note` 的 `remember()` 返回值不再丢弃。
7. **调度器三套并存（P1）**：删掉 HKCU `WhaleDraft`（21:30 nightly-scheduler）；DSH 插件新增 `clock.enabled` 开关并在本机置 false（`night.windows=[]` 即时生效，等下次 DSH 重启后连时钟都不启动）；只留 Cortico 21:40。唤醒状态先记 `lastFiredAt` 再触发，重启不会补醒第二次。
8. **门禁后门（P1）**：删除 `canDraft` 的「2 小时自动放行」；feed/debrief 轮次落盘到 `control/round.json`（进程重启仍算同一轮，12h 过期）。
9. **阻塞式 spawn（P1）**：`bili_draft_dynamic` 改用异步 `runNodeAsync`，不再 `spawnSync` 卡事件循环。
10. **typecheck**：`npx tsc --noEmit` 0 错误（修掉 `createInitialState('xiaoyu')` 多余参数、未用导入）。
11. **状态驱动作息（P1，"像人"）**：新增 `persona-core/src/rhythm.ts`（纯函数）。没有固定时间表：`decideWake` 按 无聊(explore)/想他(connect)/睡够了(restless 睡眠压力，距上次醒来 12h 起、30h 满) × 体力 × 随机抖动 决定醒不醒，单日 ≤3 次、两次间隔 ≥2.5h；评估间隔 3–7 分钟随机。睡着时体力按 0.003/h 恢复，醒一轮 0.05。连续 `connect` 醒来却没人回 → `connectMisses` 递增、越等越少（几天不等会回落）；每新的一天等不到人自动吃一次 `masterSilentDay`；冷战期不主动找他。`masterReplied` 会把 `connectMisses` 清零。当天已出过草稿时，唤醒文本会明确说"这轮不用再出稿"。30 天离线模拟（`scripts/simulate-rhythm.mjs`，seed 42）：40 次醒来、28/30 天有醒、时段覆盖 17 个不同小时。
12. **健康检查**：`cortico-health.mjs` 改读 `cortico-wake.json` 的 `mode=state-driven`（显示今天醒了几次/上次类型），待审令牌用 `listPending`（会清理过期项）。
13. **日记闭环（产品 P0）**：新增 `bili_diary_append`（`src/worlds/bili-account/diary.ts` 纯函数，按 `## YYYY-MM-DD` 块 + 小节"有则替换、无则追加"；公开用 h2、私人用 h3；≤6000 字；只写两本固定文件）。`bili_draft_dynamic` 增加两条闸：公开日记 24h 内没更新 → 拒绝出稿（`draft-with-stale-diary`）；`draft-dynamic.mjs` 只解析**当天**日期块（`buildText(diary,{date})`），并拒掉与其它日期草稿一字不差的文案（`findDuplicateText`）。ORIENTATION 增加"写今天两本日记"步骤。
14. **审批回流（自我修正）**：唤醒文本会读最近一条 `sent`/`rejected` 草稿；若她还没用 `mood_apply` 消化（链里没有更晚的 `draftApproved/draftRejected`），就提醒她记下来。
15. **第三方复审后的追加修复（2026-10-27）**：
   - **节奏停摆（最关键）**：`rhythmTick` 原先把"睡着恢复"攒到 0.005 才写盘，却每 tick 重置计时 → 恢复永不发生；决策读的是上次落盘的旧场值（刺激量不衰减）→ 默认状态下**再也不会醒**。现在每 tick 都走一次 `applyEffects`（结算离线衰减 + 按真实 elapsed 恢复），并 `try/finally` 保证写盘失败也不会停摆。另外"下次评估时间"与 `setTimeout` 现在共用同一个随机延迟（之前抽两次，文件写 15:19 实际可能 15:22 才跑，看起来像停摆）。
   - **跨天计数**：先清 `wakesToday` 再 +1（原实现先改 day 再加，第二天从 4 开始，之后每天只能醒 1 次）。`connectMisses` 加 `lastMissAt`，几天不等会回落到 0（不会永远不再找他）。
   - **一次性令牌**：默认 TTL 2h → 12h（隔夜草稿早上还能批）；冷却/风控这类"写之前就拒了"的失败会 `ack.release` 退回令牌，同一个 token 可重试（有测试）。
   - **日记注入**：heading 去 `#`/换行；正文里禁止出现日期标题（会打乱按天解析）；小节匹配由 `startsWith` 改为精确相等；日期匹配用 `^##\s+DATE(\D|$)`（不会误命中 `2026-10-270`）。
   - **custom 效果**：`source` 固定为 `custom`，模型不能伪造成 `masterReplied` 骗过情绪成因/审批回流判断。
   - **因果读取**：逐行容错 + 只读末 2000 行（一行坏不再让整份归零）。
   - **EffectBus**：彻底删掉 `FrequencyGate`（连同把旧 bug 当特性的那条单测），避免以后有人再打开。
   - **状态**：`normalizeState` 校验 `fields/npcState`，`{}` 这类"合法 JSON 但没数据"按坏文件走 `.bak` 恢复；所有控制文件 tmp 名加 pid+随机。
   - 体力：`WAKE_COST_ENERGY` 0.05、恢复 0.003/h（一天一轮≈收支平衡，连醒三天会累）。

## 已知未修 / 下一步
- 跨进程锁：旧进程与新进程短暂重叠时，`fields.json` 仍可能后写覆盖（单实例启动器把窗口压到秒级，但没做文件锁）。
- 日记的物理格式沿用她历史写法（公开本用 `## 日期` + `## 小节`，同日两个 h2 层级）；解析器已按天取块，但格式本身仍不"干净"。
- `scripts/simulate-rhythm.mjs` 是演示/回归用的离线镜像，不是 World 的真实回路；drill 的 draft CLI 是假的（只验门禁，不验 B 站写链路）。

## 验证命令
```
# 纯函数单测（人核心 + 适配层 + World）
cd E:/WorkSpace_Qoder/Cortico && node --import tsx --test persona-core/tests/core.test.mjs persona-core/tests/adapter.test.mjs tests/core.test.mjs
# 门禁 + ack drill（需从 Cortico 目录跑）
node --import tsx ../dsh-bili-whale/scripts/drill-gate.mjs
# 类型检查
npx tsc --noEmit
# 消费侧测试
npx vitest run tests/env-prompt-contract.test.ts tests/core/provider-routing.test.ts
```
