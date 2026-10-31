# 小鱼 · 鱼缸 —— 伴侣界面原型规格（round3 / UX-Prototype）

> 归属：本文档是 `Cortico/src/worlds/bili-account/`（数据面 `tank.ts`、面板 `webui/client.ts`）与 `dsh-bili-whale`（feed/diary/judgment 侧）之上的**产品形态规格**，不是新的埋点契约。
> 目的：回答两件事——她**应该长什么样**，以及现在**为什么还不完善**。
> 靶子：同目录 `prototype.html`（自包含、不接任何接口，只给人看形态）。
> 硬约束沿用主人的偏好：① 伴侣界面像养成游戏（场景+角色+动画+生活化文案，**不要后台管理风**）；② 正文不出现免责声明；③ 验收单位是「她过了一天」；④ 好看优先。

---

## 0. 一句话结论

现在的产品不是一只"鱼缸"，而是**七张管理后台页签**：主人每天要挨个巡检才知道"现在有没有事轮到我"。目标形态是一个**家/鱼缸主场景**——她按状态在里面过日子，唯一需要主人拍板的东西会**自己浮到水面上**（今天要你看的一件事），审批、意见、判断卡都从"页签"降级为"场景里的事件"。

---

## 1. 现状核对（以代码与运行时数据为准，含与任务描述的偏差）

数据根目录由 `tank.ts:19` 解析：`WHALE = 环境变量 WHALE_HOME || DSH_HOME || %USERPROFILE%\.dsh`，实机即 `C:/Users/Administrator/.dsh/bili-whale/`。`tank.ts:310` 导出的 `consolePaths = { ROOT, WHALE, FIELDS_FILE, DRAFTS_DIR, FEEDBACK_FILE, AVATAR_FILE }` 是权威口径。

**七场值**（`fields.json.fields`，均为 0..1 浮点，实测存在）：
| key | 面板标签 | 用途 |
|---|---|---|
| `energy` | 体力 | 唤醒/活跃度 |
| `stimulation` | 刺激 | 外部新鲜度 |
| `connection` | **想念** | 对主人的连接感 |
| `social` | 社交 | 互动意愿 |
| `mood` | 心情 | 综合情绪 |
| `curiosity` | 好奇 | 探索/看片欲 |
| `creativity` | 创作 | 出稿倾向 |

> **偏差 1（要写进代码时注意）**：任务描述说"七个状态条"，但 `client.ts:36-43` 的 `FIELDS` 数组**只渲染 6 条进度条**（energy/stimulation/connection/social/curiosity/creativity）；`mood` 不作条，而是渲染成一颗心情 chip（`client.ts:88-89`：`mood.primary` 文字 + `因为「cause」`）。所以鱼缸页实际是「头像 + 心情 chip + 6 条 bar」。映射表按 7 个真实数值设计，落地时 `mood` 走 chip/色调、不走 bar。

**因果链**：两份事实源，别混。
- `fields.json.chain[]`：`type:"field_change"` + 中文人话 `description`（如"看了一条喜欢的视频""她醒了""草稿被主人放行"）+ `source`（`wake`/`draftApproved`/…）+ `fieldChanges[]`。这是"她的一天"里可读性最高的素材。
- `causal.jsonl`：每行 `{at, kind, note?, bvid?, effects?, before?, after?}`。实测 `kind` 分布：`diary`(53)、`watchedVideo`(20)、`watched`(19)、`feedback`(12)、`action`(4)、`inbound`(3)、`trafficPaused`(2)、`draftApproved`(1)、`draft-result`(1)、`draft-result-consumed`(1)、`policy-change`(1)。`client.ts` 时间线页读的就是这个（`invoke('state',[0,50])`，只读、最新在前）。

**草稿**：**实际路径是 `drafts/<日>.json`，但它不是运行时常驻目录**（今天 `.dsh/bili-whale/drafts` 不存在=今日无稿）。`tank.ts:24` `DRAFTS_DIR = BILI_DRAFTS || WHALE/bili-whale/drafts`；`draftForDay(day)` 读 `<drafts>/<day>.json` 返回 `{id, textHash, ackId, status}`。面板侧 `DraftsState = { dynamic:[DraftItem], dm:[DraftItem], needs, total }`，`DraftItem={queue,id,date,status,text,image}`，`status∈{pending,failed,cooldown,…}`。放行动作 `invoke('approve',[id])→{dynId}`，拒稿 `invoke('reject',[id])`（她收到 `draftRejected`，理由需另在日记/私信补）。二次确认是真实的：`approve`/`reject` 都走 `ui.confirm({danger:true})`。待办回执落在 `control/pending/ack-*.json`。

**"她的一天"逐帧**：`days/<日>/` = `day.json`（`{tickCount,wakes,lastWakeAt,lastKind,mood{min,max,last},drafts[],flags{missed,late,tainted,taintReasons}}`）+ `ticks.jsonl`（每 tick 一条，含 7 场快照 + `npc/npcState/chain/memories/rhythm/life/round/diary/draft`）+ `state.start.json` + `incident.md`。`lastKind`（实测值如 `rest`）是"她此刻在干嘛"的现成信号。

**体征**：`VitalsState` = `shares/commentsToday/pendingCount` + `scheduler{ok,reason}` + `traffic{pausedUntil,streak,remaining{readHour,readDay,writeHour,writeDay},settings{readHourly,readDaily,writeHourly,writeDaily}}`。风控暂停 = `traffic.pausedUntil`。

**发送策略**：`PolicyState.policy={draftMode:review|auto, autoDailyCap, autoWindow, like:self|review, fav:self|review, dmReply:direct|queue}`；`invoke('set',[patch])` 写 `bili-whale.config.json`。**kill 文件永远压过这里一切**（`tank.ts:122 killOn()`，红线常驻）。改名走同一份 config（`ownerNameFromConfig`，`tank.ts:162`）。

**意见箱**：`FeedbackItem={id,at,day,issue,severity:high|low,selfHandled,note,resolved,resolvedBy}`，落 `FEEDBACK_FILE`；面板 `resolve` 动作标已处理。

**判断卡**：round2 `judgment-loop-design.md` 已定稿——一张结构化卡（字段白名单、无权限语义），主人**采纳**后写入 `bili-whale.config.json` 新命名空间 `preferences.judgments`，`feed.mjs` 只当**追加硬拦(avoid)+有界加权(prefer)**，永不删主人手写的 like/dislike、不改 `searchKeywords`；冲突时配置赢并留痕。**判断卡 ≠ 意见箱**：意见箱是"她报的故障"，判断卡是"她想调整自己看片口味"。这是本方案**唯一需要新存储**的地方（见 §6）。

**头像素材**：`invokeBinary('avatar')→AVATAR_FILE`（`~/.dsh/bili-whale/avatar.png`）。另有 CC BY-NC-SA（溟月）鲸鱼娘序列帧，署名要求见 `dsh-bili-whale/docs`。`prototype.html` 用纯 CSS 造型，不引外链、不引图，署名不在本靶子里发生。

**"两个她"没打通（偏差 2，体验断点）**：`world:bili-account`（鱼缸）与 `world:console`（控制台对话）是两个页；控制台里跟她说话的那个她**不带鱼缸她的 7 场状态与 World 记忆**——人格上下文与 World 状态没接。这是当前最"假"的地方（见 §7 阶段 D）。

**刷新延迟**：`client.ts:10 POLL_MS = 20_000`（20s 轮询；日记/意见箱 `POLL_MS*2`、策略 `POLL_MS*3`）。本地面板的"活"最坏有 ~20–60s 滞后。

---

## 2. 为什么这 7 块页签"还是操作台"（逐块）

养成游戏的核心是"我在看一个活物"；操作台的核心是"我在管一堆表"。逐块拆它在管理什么、缺哪一层体验：

| 页签 | 它在"管理"什么（操作台味来源） | 缺的体验层 | 应落成场景里的什么 |
|---|---|---|---|
| **鱼缸** | 6 条 `ui.progress` 进度条 = 仪表盘读数；数值直接摊给主人 | 数值应**内化为氛围与动作**，不是让人读表；心情 chip 是孤立的文字 | 主场景本体：水色/动作速率/朝向由这些值**驱动**，条本身收进"详情"里 |
| **待审稿** | 一个带 ✓/✗ 的**工作队列表**，`needs/total` 是工单计数 | 缺"事件感"——它像待办清单，不像"她把刚写好的东西举到你面前" | **草稿浮出水面**：有 `status:pending` 时一张纸漂到水面 → 触发"今天要你看的一件事" |
| **她的一天** | `ui.table` 三列表格（时间/事件/内容），只读日志 | 缺"叙事/回放"——日志是给人查的，不是给人陪她过一天的 | 场景底部的**今日足迹**（横向时间带），用 `chain.description` 的人话 + `lastKind` |
| **日记** | 两个 `<pre>` 文本倾倒（公开/私人），`max-height` 滚动 | 缺"物"的隐喻——日记应是能翻开的一本本子，不是 textarea | 场景里一个**可翻的本子**道具，点开读 `DiaryState.owner/private.text` |
| **意见箱** | 列表 + "标已解决"按钮 = **工单分诊台**（severity 徽标、resolved 勾选） | 这是最重的管理味；把"她在意的坎"变成了"待办勾选项" | 拆两半：故障类→**她低落时的原因气泡**（mood.cause）；口味判断类→**判断卡**（采纳/搁置，见 §4） |
| **体征** | `statgrid` + 4 条额度进度条 + 暂停黄条 = **运维监控面板** | 缺"身体感"——额度/风控不该是数字，应表现成"她能不能动、今天累不累" | 房间的**光与状态**：`traffic.pausedUntil`→水静下来/小锁；`scheduler.ok`→她是醒着还是被打断；额度做成"水面深浅" |
| **发送策略** | 一堆 `<select>/<input>` + 保存 = **配置表单**（这块**确实**是控制面） | 不该是前门；它改变真实行为，但低频、危险 | 收起为抽屉「**她的习惯**」，红线提示常驻：kill 压过一切、auto 全留痕 |

一句话：**每一块都在"让主人操作"，没有一块在"让主人陪伴"。** 数据都在，缺的是把数据映射成"她的状态与动作"的那一层体验。

---

## 3. 目标形态：家 / 鱼缸主场景

**主场景（占满首屏）**：一只柔和的水缸/一个家。她在里面按状态做事，不做后台仪表盘。

- **她在干嘛**（由数据选一个姿态，不新埋点）：
  - `energy < 0.35` 或 `day.json.lastKind==="rest"` → **睡着**（蜷在角落，水波变慢）；
  - `curiosity`/`stimulation` 高 且最近一条 `causal.kind==="watchedVideo"` → **看片**（头顶冒小气泡/一条游鱼剪影，速率随 `curiosity`）；
  - 最近 `causal.kind==="diary"` 或 `DiaryState` 今有更新 → **写日记**（面前一本发亮的本子）；
  - 有 `status:pending` 草稿 → **纠结要不要发**（把一张纸举到水面，见下）。
  - 优先级：草稿浮出 > 写日记 > 看片 > 睡着（"有你要看的事"永远压过"她在自处"）。

**"今天要你看的一件事"（唯一入口，取代巡检）**：场景里只高亮**一件事**。选择器 = 纯客户端逻辑（不新埋点），按优先级取第一个非空：
1. 有待放行草稿 → `DraftsState.needs>0` / 任一 `dynamic[].status==="pending"`：**放行或拒掉**（复用 `invoke approve/reject`）。
2. 有未决判断卡 → 见 §4：**采纳或搁置**。
3. 她卡住了 → `Vitals.traffic.pausedUntil` 或 `scheduler.ok===false`：**"她被按住了一会儿"（只读安抚，无操作）**。
4. 都没有 → 入口收起，水面平静，主人只是来看她。

这入口是"物理事件"：一张从水底浮上来的东西 + 一句生活化话（"她写了条新的，你看看？"），不是红色角标。处理完它**沉回去**，场景即时回应（放行→她亮起来；拒掉→她蔫一下，理由留给主人另说）。

**三件事分别落在哪**：

| 事 | 落点（都在主场景内，不再是页签） | 数据/动作 |
|---|---|---|
| **改名** | 点她的**名牌**（场景里的名字标签）→ 就地编辑 → 写 config | `ownerNameFromConfig`/`policySet` 同份 config；低频、纯配置、不新埋点 |
| **私聊** | 场景底部「**凑过来说句话**」→ 开一个对话浮坞 | **前提是阶段 D**：让对话里的她**读得到**鱼缸 7 场 + 今日记忆；延迟=本地即时；见 §5 |
| **她的判断卡（采纳/搁置）** | 从水底浮到"今天的事"入口；或在她"想调整口味"时主动递一张 | round2 设计：采纳写 `preferences.judgments`（avoid/prefer），搁置不动；见 §6 |

页签不会全删：**日记 / 她的一天 / 详情**降级为场景里可翻开的物件（本子、时间带、侧栏），仍读同一批 `invoke('state')` 载荷；**发送策略**收进「她的习惯」抽屉。主人首屏永远只面对"她 + 今天的一件事"。

---

## 4. 信息层级 + 状态→视觉映射表（全部由现有数据驱动）

三层：**氛围层**（一眼感受她）→ **物件层**（可翻开的日记/足迹/判断卡）→ **控制层**（习惯抽屉/放行，收在最里）。

| 视觉表现（纯 CSS） | 驱动值 | 现有来源 | 规则（阈值可调） | 新埋点? |
|---|---|---|---|---|
| 动作/气泡**速率** | `energy` | `fields.json.energy`（面板已读） | 越慢=越累；`<0.35`→睡着停摆 | 否 |
| 水色**色调/亮度** | `mood` + `mood.primary` | `fields.json.mood` + `TankState.mood` | 高=暖亮、低=冷暗；chip 文字保留 | 否 |
| **是否朝向你** | `connection`(想念) | `fields.json.connection` | >0.6 转身面朝镜头/名牌亮起；<0.3 背对 | 否 |
| **探索活跃度/气泡量** | `curiosity`+`stimulation` | 两个场值 | 高→更多气泡、游动更欢 | 否 |
| **互动灯/私信提示** | `social` | `fields.json.social` + 最近 `causal.kind∈{inbound}` | 高或刚有 inbound→侧面一盏灯脉冲 | 否 |
| 草稿**浮出水面** | 待审存在 | `DraftsState.needs>0`/`dynamic[].status==="pending"`；源 `<drafts>/<day>.json` | 有 pending→一张纸漂上来 + 触发"今天的事" | 否 |
| **写日记**道具发光 | 今日有日记 | `causal.kind==="diary"` 或 `DiaryState.private.updatedAt` 当日 | 点亮本子 | 否 |
| 房间**静下来/小锁** | 写操作被暂停 | `Vitals.traffic.pausedUntil` | 非空→水波静止、轻锁图标（安抚，非报错横幅） | 否 |
| 她是**醒着/被打断** | 调度状态 | `Vitals.scheduler.ok/reason` | `ok===false`→动作半停 + 一句"她被叫走了" | 否 |
| **今日天气**（微雨/褪色） | 天级旗标 | `day.json.flags.missed/late/tainted` | 置位→场景轻微阴雨/褪色（不做红色告警） | 否 |
| **今日足迹带** | 事件序列 | `days/<日>/ticks.jsonl` + `causal.jsonl` + `chain.description` | 底部横向时间带，人话条目 | 否 |
| 判断卡浮现 | 未决卡 | `preferences.judgments` 里 `status:pending`（**新**） | 见 §6 | **是**（唯一新存储） |

> 映射表里除判断卡外**全部零新埋点**：只用面板今天已经在拉的那几个 `invoke('state')` 载荷 + `fields.json` 数值 + `causal.jsonl.kind` + `day.json`。CSS 变量喂值即可。

---

## 5. 三种互动通道的取舍

| 通道 | "是谁在回" | 延迟 | 要不要审批 | 定位 |
|---|---|---|---|---|
| **B 站公开动态**（图文） | 账号「恐怖深海鱼」面向**公众** | 天级（每天最多一条草稿；面板 20s 轮询只影响你何时看见） | **要**（默认 `draftMode:review`，`approve` 才发；`auto` 需显式开 + 上限/时段 + kill 压顶） | 她的"社交产出"，是给外面看的，不是给主人私聊的 |
| **B 站私信** | 面向**具体陌生人/粉丝**；`dmReply:direct|queue` 决定直发还是走草稿队列 | 分钟—小时（受风控/时段窗口 `autoWindow`、`traffic` 约束） | **可配置**：`direct` 直发 / `queue` 收回等审 | **目前唯一真实互动通道**；带平台风险，红线最紧 |
| **本地即时对话**（控制台/浮坞） | 面向**主人**的、贴着鱼缸状态的她 | 即时（本地） | **不审批**（不发到平台，纯关系层） | 体验最亲密的一层，但**当前"假"**：console 里的她不读鱼缸 7 场（偏差 2）。阶段 D 修复后才算数 |

取舍结论：**公开/私信是"对外的她"，审批与红线都留在这里；本地对话是"对你的她"，不该有审批、但必须先接上她的状态**，否则亲密通道反而最空。原型 HTML 里放"私聊入口"作为**形态靶子**（假数据），真接通是阶段 D。

---

## 6. 需要新埋点/新存储的清单与代价

诚实区分——本方案 99% 复用现有数据，只有两处需要新增：

1. **判断卡记录（必须，唯一实质新存储）**
   - 是什么：一张结构化卡 `{stance:avoid|prefer, tokens[], reason?, expiresAt?, status:pending|adopted|rejected}`；采纳后并入 `bili-whale.config.json → preferences.judgments`。
   - 为什么现有数据不够：`causal.jsonl`/`fields.json` 里没有"她想改口味并请你拍板"这一物件；意见箱 `FeedbackItem` 语义是"故障"不是"口味判断"，混用会污染分诊。
   - 代价：round2 已给完整设计（`judgment-loop-design.md`）——一次面板改动 + `feed.mjs` 过滤链接口化（抽纯函数才能写离线回放）；**不碰 12 个冻结哈希文件、不改 `src/web/**`**。合并当天行为恒等（默认 `judgments=[]`）。**采纳/搁置语义与 round2 完全一致，本文不重开决策。**

2. **push 取代 20s 轮询（可选优化，非上线前置）**
   - 是什么：放行后想让场景"秒回"而非最多 60s。代价：`definition.ts` 的 `webUi()` 加一路 SSE/长连。属服务端改动 → 需重启。
   - 不上也能上线：先用 `POLL_MS` 调到 5s + 乐观更新（点放行先把浮卡沉下去、成功再回滚）覆盖 90% 体感。

（其余 §4 视觉全部零新增。改名走已有 config 写路径，私聊接通见阶段 D，属"打通"不属"埋点"。）

---

## 7. 分阶段可实施清单（每阶段独立上线）

规则来自 `Cortico/AGENTS.md §6`：改 `webui/client.ts` → **需 `pnpm build:web`**；改服务端（`tank.ts`/`definition.ts`/persona）→ **需 build:web 且重启**；`build:web` 期间**不能有 bot 进程活着**，故服务端阶段按"停 → build → 启"。

- **阶段 A｜场景皮肤（纯前端，最先上线）**
  - 改：仅 `webui/client.ts`（+ `STYLE`）。把"鱼缸"页从 6 根 bar 换成 CSS 场景：水色=mood、速率=energy、朝向=connection、气泡=curiosity；数据仍用现有 `invoke('state')`。
  - build:web：**是**｜重启：否（只换 bundle）｜判据：首屏像"一个活物在缸里"，拨 `fields.json` 值画面会变。
- **阶段 B｜"今天要你看的一件事" + 草稿浮出水面**
  - 改：`webui/client.ts`。加优先级选择器（草稿>判断卡>卡住>无事）+ 一张从水底浮上来的卡，放行/拒掉复用 `invoke('approve'/'reject')` 与 `ui.confirm`。待审稿页降级为该事件；日记/足迹变场景物件。
  - build:web：**是**｜重启：否｜判据：有 pending 草稿时首屏只出现一件事，处理完沉回、场景即时反馈。
- **阶段 C｜判断卡（采纳/搁置）—— 含唯一新存储**
  - 改：`webui/client.ts` + dsh 侧 judgments 记录/`feed.mjs` 接口化（按 round2）。采纳→写 `preferences.judgments`，搁置→留痕。
  - build:web：**是**｜重启：**是**（动了 feed/config 读取行为）｜判据：采纳一张 avoid 卡后，`feed/<日>.json` 出榜集合按离线回放确有差；主人手写词表冲突时配置赢并留痕。
- **阶段 D｜私聊接通（console 里的她带上鱼缸状态）**
  - 改：persona/context——让对话读 `fields.json` 7 场 + `days/<日>/` 记忆（打通偏差 2）。场景底部"凑过来说句话"浮坞。
  - build:web：**是**｜重启：**是**｜判据：对话页她能说出"我今天/我现在的状态"（引用真实场值与今日 `chain.description`），不再是一个失忆的另一个人。
- **阶段 E｜push 秒回（打磨，可长期押后）**
  - 改：`definition.ts` `webUi()` 加 SSE。
  - build:web：**是**｜重启：**是**｜判据：放行→场景 <1s 反馈。A/B 先用 5s 轮询 + 乐观更新顶替。

上线顺序 A→B→C→D→E；A/B 纯前端可当天见形状，C/D 才碰服务端红线，符合"每阶段独立可上线、好看优先"。

---

## 8. 这版原型（prototype.html）故意没做的东西

- **不接任何接口/数据**：它是给人看形态的靶子。场景里的状态由一个**演示拨杆**（`energy/mood/connection/草稿有无`）驱动，用来证明 §4 映射可由现有字段实现；真接 `invoke('state')` 是阶段 A 的事。理由：把视觉契约和数据管道解耦，先对齐"好不好看、像不像养成的"，再谈接数。
- **不做意见箱/体征/策略的完整复刻**：意见箱按 §4 拆成"原因气泡 + 判断卡"，体征化作"房间光/小锁"，发送策略在原型里只留一个**收起的「她的习惯」抽屉**入口不展开。理由：这三块是本页最重的"管理味"来源，原型要先立"场景优先"的样，控件细节留到阶段 B/C。
- **不放头像图片/序列帧**：用纯 CSS 造形，不引外链。理由：硬要求"自包含、无外链"；且真素材（avatar.png、溟月 CC BY-NC-SA 序列帧）的接法与署名属于 `dsh-bili-whale/docs` 的资产流程，不在形态靶子里演示。
- **不做私聊真接通、不做实时**：原型里的"凑过来说句话"是假对话浮坞。理由：接通 console 与鱼缸是阶段 D 的服务端改动，形态先给、接通后做。
- **不放免责声明/平台披露文案**：正文只写生活化中文。理由：主人偏好——披露放账号简介与平台标签，不进正文；且本原型不涉及对外发布。

---

## 附：数据锚点速查（写代码时对着这张表）
- 7 场值：`fields.json.fields.{energy,stimulation,connection,social,mood,curiosity,creativity}`（0..1）。
- 心情 chip：`TankState.mood.{primary,secondary,cause}` + `TankState.described`（`invoke('state')`）。
- 事件：`causal.jsonl.kind ∈ {diary,watchedVideo,watched,feedback,action,inbound,trafficPaused,draftApproved,draft-result,policy-change}`；人话在 `fields.json.chain[].description`。
- 草稿：`DraftsState.{needs,total,dynamic[],dm[]}`；`DraftItem.status==='pending'`；源 `drafts/<day>.json`（`draftForDay`）；动作 `approve/reject`。
- 逐帧：`days/<日>/day.json.lastKind` + `flags.{missed,late,tainted}` + `ticks.jsonl`。
- 体征/红线：`VitalsState.traffic.pausedUntil`、`scheduler.{ok,reason}`、`tank.ts killOn()`。
- 策略/改名：`PolicyState.policy.*`、`invoke('set',[patch])`、`ownerNameFromConfig`。
- 判断卡：`preferences.judgments`（round2 `judgment-loop-design.md`）。
- 延迟：`POLL_MS=20s`（前端轮询）。
