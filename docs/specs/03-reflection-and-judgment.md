# 03 · 反思与判断卡

> 只写成立的机制；案卷在 `docs/attic/`，不作施工依据。行数按 2026-11-07 工作区核对。

## ① 现在是什么

三件事，不要混：**做梦结算**（归档，零模型钱）、**睡前反思**（花钱的模型回合）、**判断卡取题**（只读）。

睡前反思**不是心跳也不是定时器直接触发**：唯一挂载点是 `DreamTick` 的"当日一次睡眠结算之后"
（`packages/cortico-bot-xiaoyu/src/cortico-persona.ts:405` 装配、`:447` 启动；`packages/cap-state-rhythm/src/dream-tick.ts:127-129` 调 `onReflect`，**不 await**）。
实际节拍 = 30 分钟轮询（`dream-tick.ts:63`，调用方从未传 `intervalMs`）× 睡着判据（`life-stages.ts:102-106`：时段内 / 闲够 6 小时）× 同一逻辑日只结算一次（`dream-tick.ts:118`）。
所以**她一晚最多反思一次**，"睡了多久"是 `Date.now() - life.json.lastActionAt` 换算的小时（`cortico-persona.ts:438-442`）。

反思跑在一个隔离会话里：`persistent:false`、`receivesEvents:false`、轮数 soft2/hard3
（`cortico-persona.ts:656-662`），提示词把两份 persona 正本 + 8 条活跃卡 + 5 条归档卡（各截 60 字）+ 今天日期喂给她
（`cortico-persona.ts:320-334`；**不喂日记、不喂行动账**）。产物她自己用工具写进记忆/日记，收尾回声截 400 字注入主会话
（`packages/cortico-bot-xiaoyu/src/dream-reflection-runner.ts:153`）。

判断卡取题器 `judgment_revisit` 是**只读**的：全量取非 retired 的卡，按"同主题结论打架 → unclear → 立了没采纳 → 无关不出题"分四档优先级，
同档按"隔得最久"排，默认 3 题、钳 1..10（`packages/cap-journal/src/judgments-feedback.ts:490-527`），
并且明写"本工具不动任何账"（`:534`）。

## ② 真值在哪

| 参数 | 定义与执行点 | 配置键 | 面板控件 |
|---|---|---|---|
| `enabled` | `packages/cortico-bot-xiaoyu/src/reflection-config.ts:19`（默认 false）；判据 `dream-reflection.ts:100` | `reflection.enabled`（部署实值 `true`） | 无自定义控件，走宿主「配置」页 schema（`reflection-config.ts:48`） |
| `maxPerDay` | `reflection-config.ts:20`（1）；判据 `dream-reflection.ts:103-105` | `reflection.maxPerDay`（1..3） | 同上（`:59`） |
| `maxRounds` | `reflection-config.ts:21`（2）；**只进了收线提示文案**（`dream-reflection-runner.ts:137`→`:146`） | `reflection.maxRounds`（1..4，`:68`） | 同上 |
| `minSleepHours` | `reflection-config.ts:22`（3）；判据 `dream-reflection.ts:107` | `reflection.minSleepHours` | 同上（`:78`） |
| `intervalMs` | `dream-tick.ts:63` 硬编码 30 分钟 | 无键 | 无 → **只能改文件** |
| `archiveThreshold` | `card-store.ts:390-396` 经 `dream-tick.ts:120` | `memory.archiveThreshold`（见 02） | 配置页 |
| 睡着时段 | `life-stages.ts:42`（01:00–07:00）、`SLEEP_AFTER_MS` `:136` | `life.sleepWindow` | 作息面板两个按钮（`packages/cap-state-rhythm/src/webui/client.ts:232-237`） |
| 反思账保留 | `dream-reflection.ts:123`（30 天） | 无键 | 无 |
| 取题条数 `count` | `judgments-feedback.ts:526`（默认 3、钳 10） | 无键 | 无面板入口（见 ⑤ 第 7 条） |
| 每次最多写几条 | `dream-reflection.ts:155` 提示词里写死"三条" | 无键 | 无 |

## ③ 失败与边界

- **失败只有一条出口**：`safeLog`/`hostLog` 写进宿主 run 日志（`dream-reflection-runner.ts:159`、`cortico-persona.ts:444`；落盘 `<data>/runs/<run>/log.jsonl`，宿主 `E:/WorkSpace_Qoder/Cortico-up/src/bot.ts:229`）。
  **面板零入口**：cap-state-rhythm / cap-memory / cap-journal / cap-vision 的面板方法里没有任何反思相关项，事故文件也没有。
- **失败照样进账**：计数发生在模型调用之前（`dream-reflection-runner.ts:139`，注释自己承认"记一次**尝试**"），
  所以 402/ENOTFOUND 连着失败也会把当日额度吃满（`maxPerDay` 就此耗尽，当晚不再反思）。
- **不污染记忆，但会污染"我今天做了什么"的读法**：回声只在成功且有正文时注入（`dream-reflection-runner.ts:152`）；
  账本却已经把失败那次记成"想过一次"。
- **关掉开关/已达上限时不写账**：`dream-reflection-runner.ts:123-126` 早退，不 `markDreamReflected`。
- **做梦主路不受反思失败影响**：`dream-tick.ts:125-135` 用 `void` + 双层 try/catch 兜住。
- **私人本写失败只 warn**：`cortico-persona.ts:419-421`，不进任何账。
- **取题器只读**：`judgments-feedback.ts:477-478` 明示不动账；候选只剔 `retired`，不看新鲜度，
  因此**空判断卡池 = 无题可出**（部署实测 `judgment.jsonl` 仅 3 行，其中 1 条 `proposed`）。

## ④ 操作面

主人能改（不需重启）：`reflection.enabled/maxPerDay/maxRounds/minSleepHours`、`memory.archiveThreshold`、睡着时段（面板按钮）。
**改了也不生效**：`maxRounds`（见 ⑤ 第 2 条）。**只能改文件**：反思轮询间隔、提示词"三条"、30 天账本裁剪、
取题条数、`dreamDigest` 的模板文本（`packages/cap-memory/src/card-store.ts:416-423`）。
**没有入口**：手动触发一次反思（全仓无第二个调用者）、查看反思账（`readDreamLedger` 只有两处内部调用）、判断卡的取题台（见 ⑤ 第 7 条）。

## ⑤ 已知缺陷与验证方式

1. **反思账记的是"尝试次数"不是"成功次数"**：计数在 `await core.spawnFork` 之前（`dream-reflection-runner.ts:139` vs `:142`）。
   复现：`node -e "console.log(require('fs').readFileSync(require('path').join(require('os').homedir(),'.xiaoyu-home/xiaoyu/data/persona/dream-reflection.json'),'utf8'))"`
   对照同一天的 run 日志：`grep -c "反思没跑成" ~/.xiaoyu-home/xiaoyu/data/runs/*/log.jsonl`（实测 11-06 账上 1 次，日志里全是 fetch failed / 402）。
2. **`reflection.maxRounds` 改了不生效（只改文案里的数字）**：`runner` 把它夹成 `rounds`
   （`packages/cortico-bot-xiaoyu/src/dream-reflection-runner.ts:137`）后**只插进 `capNote` 那句话**（`:145`），
   真轮数取会话声明 `hard: 3`（`cortico-persona.ts:660` → 宿主 `E:/WorkSpace_Qoder/Cortico-up/src/core/core.ts:370-371`）。
   复现：`grep -n "rounds" packages/cortico-bot-xiaoyu/src/dream-reflection-runner.ts`（`rounds` 只出现在 137 与 capNote 一行）
   ＋ `grep -n "rounds: () => ({ soft: 2, hard: 3 }" packages/cortico-bot-xiaoyu/src/cortico-persona.ts`。
3. **`onReflect` 把 `{archived, digest}` 整段丢掉**：传参在 `dream-tick.ts:129`，接收方签名是 `async () =>`（`cortico-persona.ts:432`）。
   复现：`grep -n "onReflect: async () =>" packages/cortico-bot-xiaoyu/src/cortico-persona.ts`。
4. **反思上下文拿的是最老的 8 条活跃卡**：`readAll({tier:'active'})` 已按新→旧排序（`card-store.ts:184`），
   再 `.slice(-8)`（`cortico-persona.ts:328`）＝取尾巴。2026-11-07 实测：喂给反思的 8 条落在 **10-27 ~ 10-29**，而最新一条是 **11-06**。
   复现：`node -e "const fs=require('fs'),os=require('os'),p=require('path');const d=p.join(os.homedir(),'.xiaoyu-home','xiaoyu','workspace','memo','active');const a=fs.readdirSync(d).map(f=>{const m=fs.readFileSync(p.join(d,f),'utf8').match(/^createdAt:\s*(\S+)/m);return m?m[1]:'?'}).sort((x,y)=>y.localeCompare(x));console.log('active',a.length,'· 实际拿到的 8 条：',a.slice(-8)[0],'~',a.slice(-8)[7],'· 最新是',a[0])"`（负责人：批次负责人；批次 #66 之后与 02 的第 6 条一起收）。
5. **`dreamDigest` 确认仍是模板文本，且这条写日记的路径从未落地过**：模板在 `card-store.ts:416-423`（前 3 条、各截 30 字），
   写入点在 `cortico-persona.ts:412-418`（append 进 `private.md`，无小节结构、无去重）；本机 `private.md` 里那句「夜里结算记忆」**0 命中**
   ——唯一自洽解释是 settle 从未归档过任何卡（`digest` 恒 null）。上一轮评审标"待核"的这条，现在结清为：**有代码、无实例**。
   复现：`grep -c "夜里结算记忆" ~/.xiaoyu-home/xiaoyu/workspace/diary/private.md`。
6. **做梦 fork 拿到的是全部 hub 工具**：`tools: () => self.toolDefs()`（`cortico-persona.ts:663`）而 `toolDefs()` 无任何过滤（`:617-619`），
   与同文件 `:655-656` 的注释"工具只给她自己那几把，**没有 B 站那把**"**相反**——半夜反思时她手上是有写工具的（真发不出去是因为流量闸与凭据，不是因为工具表）。
   复现：`grep -n "没有 B 站那把" -A8 packages/cortico-bot-xiaoyu/src/cortico-persona.ts | grep "toolDefs"`。
7. **`judgment_revisit` 没有面板入口**：工具注册在 `packages/cap-journal/src/index.ts:403`，面板只有判断卡表与意见箱（`webui/client.ts:116-143`）。
   复现：`grep -rn "judgment_revisit\|pickRevisitCandidates" packages/cap-journal/src/webui` → 0 行。
8. **`host.log` 形状坑仍在抛错路径上**：宿主 `Logger` 是对象（`E:/WorkSpace_Qoder/Cortico-up/src/core/types.ts:1181`，`core.ts:622` 注入的就是它），
   而 `packages/cortico-world-bilibili/src/cortico-world.ts:117`、`packages/cortico-world-media/src/cortico-world.ts:94` 写成 `host.log?.(level, msg)`——
   `?.()` 只挡 null，挡不住"不是函数"。persona 侧已用 `hostLog`/`safeLog` 认形状（`cortico-persona.ts:355-363`、`dream-reflection-runner.ts:103-111`），
   两个 world 桥接层没跟上，下游 `cap-bilibili` 的监听器 catch 里那几处 `d.log('warn', ...)`（`packages/cap-bilibili/src/domain/inbox-listener.ts:125,213,233,254`）因此变成二次抛错。
   复现（三行，离线）：`node -e "const log={info(m){return m}};try{log?.('warn','x')}catch(e){console.log('抛错：'+e.message)}"`；
   现存调用点清点：`grep -rn "host.log?.(" packages/cortico-world-bilibili/src packages/cortico-world-media/src packages/cap-bilibili/src | wc -l`。
   历史实锤：`grep -h "is not a function" ~/.xiaoyu-home/xiaoyu/data/runs/*/log.jsonl | head`。本轮纯文档不修（主人拍板），列此供下一批。
