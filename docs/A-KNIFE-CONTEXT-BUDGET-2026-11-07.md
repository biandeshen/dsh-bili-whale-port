# A 刀：为什么"上下文预算 50 万"从来没拦住过（2026-11-07 根因 + 补丁方案）

这份文件只做两件事：把根因钉到行号，把要改的三处写清楚。
**没有随这份文件落代码**——原因写在最后，不是推，是我判断在这个会话预算下改宿主配置链会留半截。

## 一、现象（实测，不是估的）

部署里写的是 `context = { maxTokens: 500000, keepRatio: 0.4, softRatio: 0.85 }`（`~/.xiaoyu-home/xiaoyu/config.json`）。
而 2026-11-06 真计费数据：单次 input **p50 = 615,918**、p90 = p99 = max = **1,048,570**（模型天花板），一天 **132 次撞顶**。
主人当天就说见过这个错位：「本身设置的是 50 万，他都快 100 万了。」

## 二、根因（三行读完）

1. **服务端唯一的数字闸是 `hardTokens`**，算法是 `contextWindow − spec.maxTokens`
   （`Cortico-up/src/core/core.ts:324-328`）。这台机器 provider 配的是
   `contextWindow: 1048576, maxTokens: 8192` → `hardTokens = 1,040,384`。
2. **超限时才交接**：`exceededHardLimit()` 只跟这一个数比（`Cortico-up/src/core/loop.ts:1626-1641`），
   `estTokens <= hard` 就一路放行。
3. **部署里那个 `context.maxTokens = 500000` 服务端根本不读**：
   宿主的 `LoopConfig.context` 类型里**只有 `keepPastThinking`**（`Cortico-up/src/core/types.ts:1227-1230`），
   全仓 grep `context.maxTokens` 的读取点只有 web 前端一处
   （`src/web/client/features/live/context.ts:113`，拿它和 `softRatio` 算"软阈值"**显示**用）。
   写入方在我们这边：`packages/cortico-bot-xiaoyu/src/cortico-definition.ts:74` 与
   `context-config.ts:60`（面板旋钮）。

**结论：这是一个"写进配置、面板能调、前端会显示，但服务端从不用它拦"的旋钮。**
不是阈值算错、也不是估算不准——是那条路根本没接上。所以今天 p50 能越过 50 万到 61.6 万，
最后由 provider 在 1,048,570 处硬截。

## 三、要改的三处（补丁方案，落到宿主 + 我们各一半）

1. `Cortico-up/src/core/types.ts`：`LoopConfig.context` 增加 `budgetTokens: number | null`
   （以及 `softRatio/keepRatio` 是否要下沉到服务端——建议**只下沉 budget**，比例继续归前端显示，
   少一个服务端可变量就少一处漂移）。
2. `Cortico-up/src/core/core.ts`（配置归一处）：把部署 `config.context.maxTokens` 读进来，
   并在 `contextFacts().hardTokens` 里取 `min(providerHard, budgetTokens)`——
   **运维预算只能收紧，不能放宽物理窗口**。
3. `Cortico-up/src/core/loop.ts:1626` `exceededHardLimit()`：日志字段从 `hardTokens` 改成同时带
   `providerHard / budgetTokens / applied`，否则下次又要人肉猜"这个 1,040,384 是谁定的"。
   交接 machinery（`handoffContext`/`forcedHandoffHard`/不可达标记）一行不动，只是**更早触发**。

我们这边随后补一条门禁（属于 P5/#7 那一类）：部署配置里的 `context.maxTokens` 若在运行期未被
服务端承认为生效上限，`check-live-drift` 直接报红——**"面板上有个旋钮"和"它拦得住"必须是两件事**。

## 四、代价，说在前面（不要只报收益）

阈值从 1.04M 降到 0.5M：**每次调用的 input 直接腰斩**（乘数项，这正是 A 刀要的）。
但代价是**交接（压缩/摘要）频率上升**，而一次交接本身也要花调用；今天 814 次付费调用摊在
14 小时里，窗口越短、交接越频繁。所以落地时必须成对测量，交付要同时给这两个数：

· 单次平均 input（预期 ≈↓2 倍）；
· 交接次数与其消耗（预期 ↑）。

若净收益不如预期，正确做法是把预算调到一个中间值（例如 35 万 / 40 万）而不是回滚成"不设上限"——
**"配置里写了个数"与"这个数生效"是两回事，这次的教训是后者。**

## 五、为什么这一轮没落代码

改动落在宿主的配置归一链路（types → core → loop 三处联动），并且必须跑宿主 `vitest` 与
`npm run typecheck` 才算验。我这个会话的上下文已经不足以读完这三处再改、再跑、再核对——
今天我已经犯过一次"没跑门禁就提交"的错（`.mjs` 里写 TS 断言那次），
**不想在宿主循环上再犯一次更贵的**。方案已经写到可以直接照抄执行，下一步从第 1 处开始。
