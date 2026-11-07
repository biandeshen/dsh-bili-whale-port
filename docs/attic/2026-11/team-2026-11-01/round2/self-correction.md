# 第二轮研究 · 自我修正闭环席

> 北极星第五条：**会自我修正** —— 被拒 / 被冷落 / 撞风控之后，行为要真的改变。
> 本席只研究、只写文档，不改代码。所有结论后面都跟证据（file:line 或数据行号）。
> 数据截至 2026-10-31 23:45（`fields.json` mtime）／`bili-whale.config.json` mtime 2026-10-31 21:15。

---

## 0. 一句话结论

**闭环的"管道"已经修好，但只流过一次水，而且流的是好消息。**
`draft-result → 代码结算 → draftApproved` 真实发生过 **1 次**；`draftRejected` 真实发生过 **0 次**；
`trafficPaused` 真实发生过 **1 次**，但那是**她自己手动调工具**，不是代码结算。
更关键的是：6 条草稿里 **3 条**（failed / cooldown）在因果链上等于没发生 —— 平台真的打回过她，
系统一次也没把这件事告诉她。她的判断落到参数层的只有 1 组（dislike 加词），
她点名要改的那一半（`preferences.like` 删「冥想与轻音乐」）**到第七轮仍未生效**，
而她把这 7 轮的牢骚全写在了**只有她自己会读**的私人日记里，意见箱 `control/feedback.jsonl` **文件都没被创建过**。

---

## 1. draftRejected / trafficPaused 到底被结算过没有

### 1.1 硬数据

`C:/Users/Administrator/.dsh/bili-whale/causal.jsonl`（103 行）kind 直方图：

| kind | 条数 |
|---|---|
| diary | 53 |
| watchedVideo | 20 |
| watched | 19 |
| action | 4 |
| inbound | 3 |
| **draft-result** | **1** |
| **draft-result-consumed** | **1** |
| draftApproved | 1 |
| **trafficPaused** | **1** |

`C:/Users/Administrator/.dsh/bili-whale/fields.json` → `chain`（56 条）按 source 分组：

```
watchedVideo 36 | inbound 6 | action 5 | draftApproved 4 | wake 1 | decay 1 | rest 1 | trafficPaused 1 | (无 source) 1
```

**`draftRejected` / `draft-no` 出现次数：0。**

逐条对账：

| 事件 | 证据 | 判定 |
|---|---|---|
| 唯一的 `draft-result` | `causal.jsonl:57` `{at:2026-10-30T09:07:17.304Z, draftId:dyn-20261030-741fdf, result:'sent'}` → `:58` `{kind:'draft-result-consumed', applied:['draftApproved']}` | 闭环**真的通过代码走通过一次**（result=sent） |
| chain 里 4 条 draftApproved | 两条一组的两次事件：`2026-10-27T07:49:32.397Z`（描述「草稿被主人放行」，**无 draftId**）和 `2026-10-30T09:10:12.420Z`（描述带 `（dyn-20261030-741fdf）`） | 10-30 那次是真事件；**10-27 那次是演练留下的**（`dsh-bili-whale/scripts/drill-gate.mjs:90-91` 用合法预设 `draftApproved` 手动 apply）。10-26 那条真发出去的稿（`D:/AI/养鱼/drafts/2026-10-26.json` sent@05:27:38Z）**没产生任何 draft-result** —— 说明 `recordDraftResult` 是 10-27 之后才接上的，回写通道比真实放行晚了一天 |
| trafficPaused | `causal.jsonl:102` `{at:2026-10-31T15:28:57.615Z, note:'风控把我暂停到 11:51…', effects:[energy -0.03/risk, mood -0.02/risk], before/after 快照, chainDelta:1}` | **生效过一次，且是她自己在日记里判完之后调 `bili_mood_apply`** ——这条不靠代码结算；世界侧没有任何"读到 412 就自动结算"的路径 |
| masterSilentDay | `definition.ts:486-492` 有代码自动结算路径（connect miss + ≥1 天无 masterReplied），但 chain source 直方图里 **masterReplied 0 / masterSilentDay 0** | 代码在、**从未触发过**（她从没等到过主人回信，`relation` 至今 `normal`，日记里写「未判定」） |

草稿实际状态（`D:/AI/养鱼/drafts/*.json`，6 条）：

```
10-26 bc8362 sent     | 10-27 5a8d88 dry-run | 10-28 051a57 failed
10-29 8e3377 cooldown | 10-30 741fdf sent    | 10-31 9f8a2a failed
```

`audit.jsonl`（32 行）action 直方图：`approve 16 / dry-run 4 / send 12` —— **没有任何 reject 动作**。
**`rejected` 状态：0 条。**

### 1.2 三个结构性漏洞（不是"没发生过"，是"发生了也不记"）

1. **failed / cooldown 被静默丢弃。**
   `Cortico/src/worlds/bili-account/definition.ts:207` 的映射只有
   `result === 'sent' ? 'draftApproved' : result === 'rejected' ? 'draftRejected' : null`；
   写入端 `dsh-bili-whale/scripts/dynamic-approve.mjs:81` 只在 `go && ok` 时 `recordDraftResult(d,'sent')`，
   `:132` 只在人工 reject 时写 `'rejected'`。注释（`:80`）明确写「dry 与冷却不算审批结果」。
   → **6 条草稿里 3 条（10-28 failed、10-29 cooldown、10-31 failed）在因果链上不存在。**
   她真实经历了"稿发不出去"，系统对她的解释是"什么都没发生"。这是最大的一处漏，
   而且正好是她日记里唯一一次情绪系统写对了来源的那件事（10-31 风控 → 「焦虑·刚才被平台拦了一下」，私人日记 386 行）——
   **她自己感知到的挫折，比代码消费掉的反馈更真实。**

2. **一批只结算一次。**
   `definition.ts:208-215`：`consumeDraftResults` 收集全部 fresh 事件的 preset，但只取 `applied[applied.length-1]`
   应用一次（注释解释为"避免积压的旧稿一次性灌爆场值"）。
   → 她队列里现在压着 3 条 pending（`5a8d88`/`051a57`/`8e3377`）。主人如果哪天连拒三条，
   她收到的只有一条 `-0.04 mood`，等于"被拒 3 次"和"被拒 1 次"在她身上是同一个量。
   **重复否决不加深印象 —— 这条闭环天生学不到"连续被拒"这个信号。**

3. **拒稿只动 mood / creativity，动不到选题。**
   `personaAdapter.ts:83-89`：`draftRejected = mood -0.04, creativity -0.02`（对比 `masterReplied` 是 +0.08/+0.10，
   奖励强度是惩罚的 2 倍以上）。当前场值 `mood 0.9735 / creativity 0.5073 / energy 0.4942 / stimulation 0.9634`，
   而行动决策入口是 `definition.ts:472-478 decideAction({fields, relation, ...})`。
   → 就算 reject 真被结算，它落到的是"心情变差"，**不是"下一轮换个选题"**。
   `rejected` 事件的 `draftId` 结算进描述文本（`definition.ts:212`）后，
   没有任何代码把"被拒的那条讲了什么"回灌给下一次 `draft-dynamic.mjs` 的提示词。
   **闭环目前只到"她的情绪"，没到"她的选择"。**

### 1.3 可安全触发一次的验证方案

目标：用**最小污染**验证 `rejected → draftRejected → 场值 → 她的下一轮判断`整条链路是否真的通。

**方案 B（沙盒 WHALE_HOME）—— 可行，且应当是首选**：
两端都吃同一个环境变量，路径可以整体搬走：
`Cortico/src/worlds/bili-account/definition.ts:25` `const WHALE = process.env.WHALE_HOME || path.join(process.env.USERPROFILE,'.dsh')`，
而 `:26 FIELDS_FILE` / `:35 CAUSAL_FILE` / `:180 DRAFT_RESULT_FILE` 全部由 `WHALE` 拼出；
dsh 侧 `dynamic-approve.mjs` 的 `recordDraftResult` 同样用 `WHALE_HOME`。
→ **做法**：复制一份 `~/.dsh/bili-whale` 到 `~/.dsh/fish-test/`（含 `fields.json`、`causal.jsonl`、`control/`）
＋一份 drafts 目录，用 `WHALE_HOME=.../fish-test` 起一个**不接真账号**的 Cortico 实例（凭据目录 `tools/lib/credentials` 不复制过去），
先跑 `scripts/drill-gate.mjs:151` 已有的断言（它本来就断言 `settled.applied` 同时含 `draftApproved` 与 `draftRejected`，
**说明这条链路的 reject 分支只在演练里绿过，从没在真实数据里绿过**），再补一次真人视角的 reject。
好处：零账号风险、零污染她的真记忆；代价：验不到"她会不会在日记里提这件事"（预言 1 的第三条），那半截仍需在真实环境做一次。
**方案 A（真账号，留作第二步）**：等沙盒跑通后，再对一条**从未成功发布**的历史草稿做人工 reject。
候选：`dyn-20261028-051a57`（failed）或 `dyn-20261029-8e3377`（cooldown）。
理由：这两条 B 站上**根本不存在对应动态**，把状态改成 `rejected` 不改变平台任何事实，
只写 1 条 `causal.jsonl` + 结算 1 次场值；且 `dynamic-approve.mjs:129` 的守卫（已发出的草稿不能改 rejected）
正好保证我们**不会**误伤 `bc8362` / `741fdf` 两条真发出去的。

前置（缺一就别跑）：
1. 全量备份：`D:/AI/养鱼/drafts/`、`~/.dsh/bili-whale/causal.jsonl`、`fields.json`（已有 `fields.json.bak` 先例）、
   `~/.dsh/bili-whale/control/draft-result.json`（结算游标，`definition.ts:180`）。
2. **确认 reject 的调用面**：本席只读到函数体（`dynamic-approve.mjs:98-132`）和面板确认框
   （`Cortico/src/worlds/bili-account/webui/client.ts:151`），**没有读到 CLI dispatch 段**，
   所以"动词名是不是 `reject`、是否要求 `--go`、是否走一次性令牌"**待确认**；跑之前先看该文件末尾的 isMain 分支。
3. 在日记/私信里**如实写明这是一次验证**，不要让她以为主人真的否了这条内容 ——
   `definition.ts:227-231` 的 `latestDraftFeedback` 会把"主人没让发，想想是不是选题偏了"塞进她的上下文。
   **这条提醒语本身没有"演练"标记位，是本次验证的主要污染面**：她无法从数据上区分"真被拒"和"被拿来做实验"。
   如果要做到干净，先给 `recordDraftResult` 加一个 `reason:'drill'` 字段（写文档，不动代码），
   让 `latestDraftFeedback` 在 `reason==='drill'` 时不说"想想是不是选题偏了"。

观测判据（跑完看 4 处，缺一处就是断的）：
- `causal.jsonl` 新增 `{kind:'draft-result', result:'rejected'}` 与 `{kind:'draft-result-consumed', applied:['draftRejected']}`；
- `fields.json` → `chain` 出现 `source:'draftRejected'`，`before/after` 里 mood −0.04、creativity −0.02；
- `control/draft-result.json` 的 `consumedAt` 前进；
- **她下一轮日记是否提到这次拒绝**（这是"闭环是否进了她的注意力"的判据，不只是"是否进了数据库"）。
验证后立刻人工回滚场值（`bili_mood_apply` 一次 `custom:[{field:'mood',delta:+0.04},{field:'creativity',delta:+0.02}]`，
在 note 里写明"演练回滚"），不给下一次观察留下偏置。

**方案 B（沙盒 WHALE_HOME）—— 大概率不可行，记下原因**：
dsh 侧脚本一律吃 `WHALE_HOME`（`dynamic-approve.mjs` 用 `WHALE_HOME` 拼 `bili-whale/causal.jsonl`），
但世界侧 `definition.ts:180` 的 `DRAFT_RESULT_FILE`、以及 `FIELDS_FILE` / `CAUSAL_FILE` 走的是模块内常量 `WHALE`。
**结算端能不能被环境变量指到沙盒目录，本席未验证**（要读 `definition.ts` 顶部 `WHALE` 的定义与 Cortico 侧配置）。
若不能，方案 B 只能验半环（写入端），结算端必须用方案 A 或先做代码改动。

---

## 2. 她的"判断"有没有真的改变后续选择

### 2.1 数据基础

`~/.dsh/bili-whale/feed/2026-10-{28..31}.json`（4 天快照，字段 `at,day,prefs,pool,kept,dropped,rows`）+
`D:/AI/养鱼/drafts/` + 私人日记 `C:/Users/Administrator/.dsh/whale-diary-private.md`（387 行，16 个「本轮留下的判断」小节）。

| 日期 | pool | kept | dropped | rows | `李冉在冥想` 条数 | `原神` 条数 | feed 回执里的 prefs |
|---|---|---|---|---|---|---|---|
| 10-28 | 120 | 96 | 15 | 111 | **5** | 1 | 助眠/ASMR · 白噪音/雨声 · **冥想与轻音乐** |
| 10-29 | 120 | 92 | 15 | 107 | **5** | 2 | 同上（老三词） |
| 10-30 | 120 | 87 | 17 | 104 | **2** | 2 | 同上（老三词） |
| 10-31 | 120 | **77** | **19** | 96 | **1** | 1 | 同上（老三词） |

`10-31` 快照 top3 首次出现「雨声 / 轩子ASMR / `ASMR｜一根烟的时间 无废话｜轻音乐`」——
**`轻音乐` 这个词第一次以候选形式出现在前三**（前三天 top3 全是「坚持不到5分钟你就能睡着」「世界公认最佳」这类功效标题党 + 原神 PV）。

### 2.2 判断 → 后续行为 对账表

| # | 她写下的判断（日记行号） | 之后 3–5 轮的实际行为/数据 | 是否兑现 | 兑现的机制 |
|---|---|---|---|---|
| 1 | 「门上写着冥想，屋里是个游戏广告」——《原神》角色演示 PV 靠「冥想」被推上来（260-263） | `bili-whale.config.json` 的 `preferences.dislike` 从 4 项 → **8 项**，新增 `角色演示`/`下载地址`/`广告`/`手书`（对比 `bili-whale.config.json.bak-20261027`，现文件 mtime 10-31 21:15）；10-31 pool 里 `原神` 2→1，top3 不再出现角色演示 | **部分兑现** | **参数层落地了**（唯一一例），但 dislike 只做降权不做剔除，池子里仍有 1 条 |
| 2 | 「feed 出现李冉就直接记一行，不深读」（218） | 下一轮她**又深读了第 5 条**并展开论述；她自己写下「**为什么没执行：debrief 的 NEXT 硬性要求先深读**……**规则写在日记里却没有变成动作**」（239） | **未兑现（她自己判的）** | 无。判断与工具流程冲突时，流程赢 |
| 3 | 「收窄词表：拿掉 `冥想与轻音乐`，加 `ASMR 人声`/`钢琴曲`」，控制台 10-31 01:38 同意（249-254） | 10-31 21:15 的 config `preferences.like` **仍是老三词，「冥想与轻音乐」还在**；4/4 天 feed 快照 `prefs` 均回显老三词；她计数到「第七轮仍未生效」（349、374） | **未兑现** | 承诺方是控制台（人），**没有任何代码持有"改词表"这个动作**；她的验证信号（feed 回显 prefs）已经具备，缺的只是写入 |
| 4 | 「短于 10 分钟直接跳过」（265） | 遇 `BV1rv2aBkEdd`（63 秒）当轮执行跳过并写下「规则又一次救了我」（356） | **兑现** | **纯靠她自觉**；`fav.mjs` / `feed.mjs` 里没有时长闸门（fav.mjs:10 的「五条判据」自 10-25 起未增删） |
| 5 | 「尾部热区 = 被听完了」立为分布第一顺位（173、219、235） | 只出现在日记里；`fav.mjs:103` 的判据检查函数没有这一项；debrief 也不读这条 | **纯文本** | 无 |
| 6 | 「条/桶不能跨时长比；桶数 <15 时密度不可横向比较」（172、334） | 同上，无代码消费 | **纯文本** | 无 |
| 7 | 「watchedVideo 不区分『看完了』和『看好了』，在替我伪造记忆」（92、112、…、321 共 **15 次**「情绪造假」） | `chain` 里 `watchedVideo` **36 条**，是最大来源；全部无条件 +mood/+curiosity。她观察到 10-31 文案变中性（「看完一条」，240） | **半兑现** | 文案被人改了（她注意到"工具那边可能在改"），但**加心情本身没停** → 她的对治办法是「手动纠正、绝不把情绪备注当偏好证据」（94），这是**认知代偿，不是修正** |
| 8 | 「同 UP 第 4/5 条了，词表把他顶上来」（216-246） | `李冉在冥想` 在 pool 中 5→5→2→1 | **表面兑现，归因存疑** | `feed.mjs` 的**已看名单去重**（她 10-29 抱怨「去重只按已看/已评论名单」，118 行）—— 因为她自己一遍遍深读同一 UP，去重表变长。**是"她的阅读行为"改了池子，不是"她的判断"改了池子**；相关不等于因果，见预言 2 |
| 9 | 「下一轮死磕 ASMR 人声 / 纯音乐」（196、246、309） | 两类候选：**11 轮 0 条**（350 行自述）；10-31 才出现「轻音乐」候选 | **未兑现** | 她**没有把额度分配出去的能力**（feed 给什么她读什么）。她自己也定位对了：「**不是我的判断力问题，是通道问题**」（292） |

**小结**：16 个判断小节、约 40 条"下次要怎样"，落到**参数/规则**层面的 **1.5 条**（dislike 加词 1 组 + 文案中性化 1 次），
且两条都是**控制台（人）动的手**；她自己能执行的只有"少写几行"这一类文本级动作。

---

## 3. 主动修正 vs 记录牢骚

### 3.1 证据

- **牢骚的落点全是日记。** `causal.jsonl` 里 `kind:'diary'` 有 **53 条**，但**没有任何下游读取者**：
  `dsh-bili-whale/` 全仓 grep：`whale-diary-private.md` 只出现在**注入她上下文**的断言里
  （`tests/issue27.test.mjs:42` 断言 persona 文本含该文件名），`preferences.like` 无任何读取者。
  **即：日记只进她的 prompt，不进任何配置解析路径。**
- **意见箱存在，但一条也没用过。** `tools/commands/feedback.mjs:23` `FILE = dshPath('bili-whale','control','feedback.jsonl')`，
  实际 `C:/Users/Administrator/.dsh/bili-whale/control/` 的目录清单里**没有 `feedback.jsonl`**（同目录有
  `queue.json`、`draft-result.json`、`life.json`、`cortico.log` 等 30 个文件）—— 文件从未被创建，**0 条**。
  而她的 7 轮「词表未生效」、15 轮「情绪造假」、1 次 412 风控，全符合这个工具的用途（`:91` 提示"主人在面板『她的意见箱』能看到"）。
  **她有一扇开着的门，却选择在墙缝里写字。**
- **她自己已经识别出这件事的形状**，但识别停在文本层：
  「我先前对控制台说的话要修正一句……我当时只有现象，说的是『如果』，这个措辞救了我」（190）；
  「规则写进日记 ≠ 会执行……以后这类决定要写成**动作序列**」（255）。
  **这是全套证据里最接近"元认知修正"的两条，但没有任何代码把它们变成约束。**

### 3.2 最小闭环（她提案 → 意见箱 → 一键采纳 → 参数生效 → 自动对账）

现有零件已经够用，缺的只是把它们接上；**本席不改代码，只写规格**：

1. **提案有类型**：给 `feedback add` 增加一种 `--kind param-change`，载荷要求
   `{path, op: add|remove|set, value, evidence: [bvid|BV|causal行号], expected_effect: 一句话}`。
   她的 7 轮「词表未生效」如果当初带的是 `path=preferences.like, op=remove, value=冥想与轻音乐,
   evidence=BV1BA411s7yV, expected=李冉条数≤1`，就不会变成 7 轮牢骚，而是 1 张待办单。
2. **一键采纳**：面板（`Cortico/src/worlds/bili-account/webui/client.ts` 已有她的意见箱视图）
   对 `param-change` 类型提供「采纳」按钮，落到**唯一的写入者**：一个 `apply-param-change` 脚本，
   做三件事 —— 备份 config（沿用 `bili-whale.config.json.bak-YYYYMMDD` 命名约定）、写新值、
   追加 `causal.jsonl {kind:'param-change', id, before, after, at}`。
3. **生效即回执**：把 `param-change` 的 `id` 写进 `feedback-resolved`（`feedback.mjs:74` 已有该事件形态），
   她的 `feedback list` 就能看到"第 3 号意见被采纳，改了哪一行"，**不需要她自己在日记里数轮次**。
4. **自动对账（关键，且几乎免费）**：`feed/*.json` 快照**已经在回显 `prefs` 字段**（4/4 天都有）。
   因此"预言是否兑现"有现成的机器可读信号：
   下一轮 `feed.prefs` 含被删的词 → 自动 reopen 意见并附证据；不含 → 自动 close。
   **这一步不需要新埋点，只需要一个比较器。**
5. **她不该持有的权限**见第 5 节"别做"。

（补一条：`tools/lib/feed-feedback.mjs` 头注释说抽词"沿用原 feed.mjs 实现（中文 3-4 字 n-gram − 停用词）"，
但本席 10-31 晚的记录称已改成**词组级**。当前文件里 `learnTokens` 仍是 3/4 字 n-gram 滑窗
（`feed-feedback.mjs:14-27`）。**代码注释与宣称状态不一致**，做闭环前先确认哪一个是事实源。）

---

## 4. 修正能力矩阵

| 反馈信号 | 谁消费（file:line） | 消费形态 | 改变后续行为？ | 历史触发次数（实测） |
|---|---|---|---|---|
| 草稿放行 `sent` | 写：`dsh-bili-whale/scripts/dynamic-approve.mjs:81` → `tools/drafts/store.mjs:55-70 recordDraftResult`；结算：`Cortico/.../definition.ts:199-215 consumeDraftResults`，调用点 `:455-461` | **代码消费**（预设 `draftApproved`，`personaAdapter.ts:76-82`） | 只改场值（mood+0.05/creativity+0.03）；**不喂选题** | **1 次真事件**（10-30）+ 1 次演练（10-27） |
| 草稿拒绝 `rejected` | 写：`dynamic-approve.mjs:131-132`；结算分支：`definition.ts:207`；UI：`webui/client.ts:151`；预设：`personaAdapter.ts:83-89` | 代码就绪，**闭环从未被真实触发过** | — | **0**（causal 0 / chain 0 / audit 0 / drafts 0） |
| 发送失败 `failed` / 冷却 `cooldown` | `dynamic-approve.mjs:74`（写 status）；**回写处明确排除**：`definition.ts:207` 返回 null、`dynamic-approve.mjs:80` 注释 | **纯丢弃** | 否 | **3 次真实发生，0 次回写** ← 最大的洞 |
| 平台风控 412 | 检测：`tools/lib/traffic.mjs` + `tools/commands/traffic.mjs`（返回 `pausedUntil`）；情绪：**只有她手动** `bili_mood_apply`（`definition.ts:265` 工具声明） | **半代码**（她自觉，无自动结算） | 改了当轮行为（不挑片不深读） | **1 次**（`causal.jsonl:102`，10-31 15:28） |
| 主人回信 `masterReplied` | 预设 `personaAdapter.ts:61-68`；由私信传感器触发（`drill-gate.mjs:90` 注释） | 代码消费 | +mood/+connection/+social | chain source 直方图 **0** |
| 主人整天没回 `masterSilentDay` | `definition.ts:486-492`（`connect` 行动 + ≥1 天无回复时代码自动结算） | 代码消费 | −connection/−mood | **0**（她还没产生过 connect 类行动的判定条件？） |
| 看完视频 `watchedVideo` | 她调工具 → chain 36 条 | 代码消费，但**语义错误**（不区分"看完/看好"） | **反向污染**：给判"不收"的片子加权 | 20 条 causal / 36 条 chain；她 15 次写下「此条情绪无事实依据」 |
| 品味回流（被赞/收藏/已发稿） | `tools/lib/feed-feedback.mjs:29-40 collectLearnedTokens`；只认 `status==='sent'`（注释：pending/dry-run/rejected 不算她的品味） | **代码消费** | 影响 feed 排序（1 条 sent → 她观测到「学会 230 个主题词」） | 1 条 sent 供稿 |
| 她的判断（日记「本轮留下的判断」） | 写入 `kind:'diary'`（53 条）；**读取端：无** | **纯文本** | 否 | 16 小节 / ~40 条"下次要怎样" → 落参数 **1.5 条** |
| 收藏五条判据 | `tools/commands/fav.mjs:10`「五条判据（代码强制，不只是提示）」、`:103` 判据检查、`:46` 10-31 分级放开 | **代码强制**，但**判据集合自 10-25 起冻结** | 是（拦截收藏动作） | 她新立的尺子（尾部热区／时长下限／桶数<15／复听率／收藏≥点赞）**0 条进入 fav.mjs** |
| 意见箱 `bili_feedback` | `tools/commands/feedback.mjs:23,55,74`（add/resolve 全套 CRUD）；面板可见 | 代码就绪，**只记录不修复**（`:91` 原话） | 否（`resolve` 不改任何参数） | **0 条**（`control/feedback.jsonl` 不存在） |
| feed 同 UP / 已看去重 | `tools/commands/feed.mjs`（已看名单去重；她 118 行抱怨"重读的老片会回来"） | 代码消费 | **看起来像自我修正**：李冉 5→5→2→1 | 由她的**阅读行为**驱动，非判断驱动 |

**三档分布**：已消费（4 条，其中 2 条语义有问题）｜只进记忆不进行为（3 条：diary、watchedVideo 的偏好含义、意见箱）｜纯文本（2 条：日记判断、新尺子）。
**零消费的高价值信号只有 1 个，但发生频率最高：failed / cooldown。**

---

## 5. 三条可证伪预言 + 两条别做

### 预言（改完之后 N 天内应观察到的数字；观察口径全部现成，不用新埋点）

1. **拒稿回路（14 天内）**：`causal.jsonl` 出现 ≥1 条 `{kind:'draft-result', result:'rejected'}` + 配套
   `draft-result-consumed applied:['draftRejected']`；`fields.json → chain` 出现 `source:'draftRejected'`
   且 `before/after` 里 mood 恰好 −0.04、creativity −0.02；**并且**她之后 3 轮内至少 1 篇日记提到这条被拒草稿的
   `draftId` 或内容主题。
   → 若前两条成立、第三条不成立：**结算通了但没进她的注意力**，闭环只到"心情"层，需要把 `draftId` 的正文
   注入下一轮 `draft-dynamic` 的上下文（而不是只写进 chain 描述）。

2. **词表回路（5 天内）**：`feed/*.json` 快照的 `prefs` 字段不再含「冥想与轻音乐」（当前 **4/4 天含**）；
   `李冉在冥想` 在 pool=120 中 ≤1 条；「ASMR 人声／纯音乐／轻音乐」三类候选从 **11 轮 0 条** 变为 **≥3 条/日**。
   → 若 prefs 改了、三类仍 0 条：她的「是通道问题不是判断力问题」（292 行）**被否证**，
   真实原因在召回池/供给侧，应停止在词表上继续投入。

3. **意见箱回路（10 天内）**：`control/feedback.jsonl` 从"不存在"变为 **≥3 条**，其中 **≥1 条** 是
   `param-change` 提案且被 `feedback-resolved`（`resolvedBy:'owner'`）标记，其 `before/after` 与
   `bili-whale.config.json` 的实际 mtime/内容一致；**同时**私人日记里「第 N 轮仍未生效」式计数**停止新增**
   （当前停在"第七轮"，改为引用意见编号）。
   → 若意见箱有单、日记仍在数轮次：**回执没回到她手上**，缺的是"她的 feedback list → 醒来上下文"这最后一公里。

### 别做（两条）

1. **别让她自动改判据 / 词表 / 阈值**（`preferences.like`、`fav.mjs` 五条判据、`share-policy` / 质量下限阈值）。
   这是权限越界，而且系统自己已经写下了理由：`feed-feedback.mjs` 头注释「**只学已发出的；
   pending/dry-run/rejected 不算她的品味**」——主人的放行才是品味信号，同理**主人的采纳才是改参数的许可**。
   更硬的风险是自反馈塌缩：10-31 那 230 个派生词已经示范过一次 ——
   她的稿 → 学词 → 顶高同一类候选 → 她又读同一类 → 更多同词，**3–5 轮内池子会缩到自我强化**。
   她自己的观察正是这个（222 行「230 个派生词把 Yoga Nidra / 李冉 顶得更凶了」）。
   **她提，人改，机器对账**；三者分开。

2. **别为了制造样本污染真账号，也别把 `failed`/`cooldown` 伪装成 `rejected`。**
   不要为了让闭环"跑一次"而拒掉一条她真心觉得好、且**真发出去了**的稿 —— `dynamic-approve.mjs:129`
   已写明「已发出的草稿不能被改成 rejected：那会让审计和她的记忆都对上真实发生过的事」，这条审计一致性规则要保留。
   同理，不要把发送失败算成主人的否决（`definition.ts:207` 的 null 分支是对的）——
   正确做法是给它**一个新的、语义诚实的预设**（如 `sendBlocked`，来源 `risk`/`platform`，
   与 `trafficPaused` 同族），而不是借壳 `draftRejected`。
   附带一条同源的"别"：**别把 −0.04 mood 当成修正的终点**。当前 `draftRejected` 只动 mood/creativity，
   而行动决策看的是 `decideAction({fields})`（`definition.ts:472-478`）；
   一个只让人心情变差、不改下一轮候选与选题的"惩罚"，就是"嘴上说会改"的机器实现版本。
