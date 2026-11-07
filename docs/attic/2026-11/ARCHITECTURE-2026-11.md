# ARCHITECTURE-2026-11 · owner: `Cortico/src/worlds/bili-account/definition.ts` + `dsh-bili-whale/tools/bili.mjs`（这两个文件变了就改本页）；次级 owner：`tools/lib/traffic.mjs`、`tools/lib/publish-policy.mjs`、`scripts/dynamic-approve.mjs`、`personaAdapter.ts`

> 本页只写**代码里现在成立的事**。所有箭头都指到具体 `file:line`（相对 `E:/WorkSpace_Qoder/`）。
> 计划中的事一律带 `(未实现)`。与 `docs/ARCHITECTURE.md`、`docs/BLUEPRINT.md`、`docs/CURRENT.md` 的出入集中在 §8。
> 图源：[`docs/architecture.dot`](./architecture.dot)（`dot -Tsvg architecture.dot -o architecture.svg`）；§9 附等价 Mermaid。

## 1. 一句话 + 北极星

一句话：**一个人格在 Cortico 里过日子，B 站只是她的手。** 人格算法是平台无关的纯函数（`persona-core/`），B 站的一切读写走一条 CLI 子进程链，两者之间只有文件与文本，没有 import 关系（唯一的例外见 §7⑥）。

北极星五条（每条都是现行代码可机械验证的判据，不是路线图）：

| # | 判据 | 代码锚点 |
|---|---|---|
| N1 | 她有连续状态：场值/因果/记忆跨轮持久，离线时间真实结算 | `Cortico/src/worlds/bili-account/personaAdapter.ts:180`（saveState）、`:203`（applyEffects 先结算衰减） |
| N2 | 对外表达默认要人点头：`publish.draftMode` 默认 `review` | `dsh-bili-whale/tools/lib/publish-policy.mjs:15` |
| N3 | 每次对外写都留一条 append-only 账，且结果能回写心情 | `dsh-bili-whale/tools/lib/causal.mjs:21`、`definition.ts:228`（consumeDraftResults） |
| N4 | 一个文件切断所有写，读不受影响 | `dsh-bili-whale/tools/lib/kill.mjs:18`、`tools/lib/traffic.mjs:100` |
| N5 | 额度/冷却/幂等由代码强制，不靠模型自觉 | `tools/lib/traffic.mjs:8`（默认预算）、`:114-125`（预约与拒绝） |

## 2. 分层与所有权

| 层 | 归属仓 / 目录 | 这一层允许做什么 | 既有裁决（违反即返工） |
|---|---|---|---|
| Core | `Cortico/src/core/` | 会话、事件存储、运行循环、工具调用 | Core 不含任何 bot 语义：不认识场值、不认识 B 站（Cortico `AGENTS.md` §3.1） |
| Persona | `Cortico/bots/cormini/persona/` | 系统提示词装配、workspace 工具、心跳 | 心跳只做节流（`heartbeat.ts:50` 指数退避），不含人格算法；**控制台对话不接她的状态**（§7①） |
| persona-core | `Cortico/persona-core/src/` | 7 场值、EffectBus、因果链、记忆/衰减、情绪、retrieval、rhythm、voice-brief、naming、budget | 纯函数、宿主无关，可单测；新增人格算法进这里，不进 World |
| Memory | `Cortico/bots/cormini/persona/memory.ts` + `workspaceGit.ts` | 她写的笔记/日记文件 + git 存档 | World 不写 Memory（Cortico `AGENTS.md` §3.3）。注意：`fields.json` 是 **World 侧人格状态**，不是 Memory |
| World | `Cortico/src/worlds/bili-account/` | 工具声明与编排、传感器、面板声明、子进程调用 | **人格逻辑不得寄生在 worlds 里**：World 只 import persona-core 的函数（`definition.ts:10-23`），算法本体留在 `persona-core/`；World 对模型输入做边界消毒而非判定（`definition.ts:113` sanitizeEffects：只收 7 原子场、`|delta|≤0.5`、来源强制 `custom`） |
| 渠道 CLI | `dsh-bili-whale/tools/bili.mjs` → `tools/commands/*.mjs` | B 站读写的唯一实现 | 写操作必须显式 `--dry`/`--go`（`bili.mjs:39-65`）；dsh 不 import 人格算法，只吃文本回执 |
| 草稿管线 | `dsh-bili-whale/tools/drafts/{compose,store,publishers}.mjs` + `scripts/draft-dynamic.mjs` | 出稿、落盘、发布实现唯一化 | 文案只在 `compose.mjs`，落盘只在 `store.mjs`，发布只在 `publishers/bilibili-dynamic.mjs`；`bili.mjs` 的 `dynamic-image`/`post` 是薄壳 |
| 审批 | `scripts/{ack,dynamic-approve,dm-approve}.mjs` | 一次性令牌 + 绑定 + 防双发 | 令牌不进 argv（`dynamic-approve.mjs:150-155`）；发送策略不在这里（`publish-policy.mjs:11-13` 红线分工） |
| 策略 | `tools/lib/publish-policy.mjs` ← `bili-whale.config.json` | 发送档位单一事实源，dsh 与 World 共读一份 | 不在代码里各存默认；`POLICY_DEFAULTS`（`:14-21`）是唯一的缺省值出处 |
| WebUI | `Cortico/src/web/` + `src/worlds/bili-account/webui/client.ts` + `tank.ts` | 「小鱼 · 鱼缸」世界页（7 块页签） | 产品 UI 只走 WebUI 公共 HTTP API；数据面在 `tank.ts`，它复用 dsh 模块（§7⑥） |
| 媒体/剪辑 | `dsh-bili-whale/tools/media/*`、`tools/video-build.mjs`、`vendor/dsh-autocut`、`vendor/dsh-video-studio` | 本地 TTS/BGM/视频合成 | **未接入任何调用方**：`bili.mjs` 命令表无此项、World 无此工具（§7⑤） |
| 运行态 | `~/.dsh/`（`C:/Users/Administrator/.dsh/`）与 `~/.bili-ai/` | 配置、状态、账本、草稿、证据包 | 两个目录两种口径：人格状态随 whale home，**流量状态与凭据随 OS 用户**（§5） |

## 3. 一次完整数据流（wake → … → 结算）

进程边界：Cortico 宿主（TS）↔ `spawn(node, dsh 脚本)`（子进程）↔ B 站 HTTP（`guardedFetch`）。

| 步 | 触发/调用 | 代码 |
|---|---|---|
| 1 起循环 | World 挂载后 5 秒首拍，之后自续 | `definition.ts:625` → `:620`（`setTimeout(lifeTick, nextDelay)`） |
| 2 判要不要动 | 3–7 分钟随机 + 日上限 + 体力闸 | `definition.ts:538`（`decideAction`）← `persona-core/src/rhythm.ts` |
| 3 结算审批结果（先于新决策） | 读 causal 里 `kind=draft-result` 的新条目，落到 `draftApproved/draftRejected` + 记忆 | `definition.ts:522` → `:228-255`；游标 `:210-221`；消费留痕 `:525` |
| 4 写状态 | 离线衰减 → EffectBus → 因果链 → 关系机，原子写 + `.bak` | `personaAdapter.ts:203`（`:216` 按真实毫秒衰减）→ `:180` |
| 5 投递事件叫醒一轮 | `bili.action_due` 推给宿主 | `definition.ts:330`（补投 pending `:632`，队列 `task-queue.ts`） |
| 6 她读自己的状态 | `bili_mood_read` 带出情绪+场值+关系+召回，并把召回写回 | `definition.ts:681` → `:193`（statePrompt）→ `personaAdapter.ts:325`；写回 `:377`（applyRecall） |
| 7 选题 | `bili_feed` → CLI `feed` | `definition.ts:653` → `tools/bili.mjs:28` → `tools/commands/feed.mjs:38`（config 偏好）`:42-44`（日记「爱看」兜底） |
| 8 避重打标 | 近 7 天 BV/UP、时长线、同 UP 计数 | `definition.ts:659` → `personaAdapter.ts:395`（annotateFeed）+ `:384`（recentWatch） |
| 9 看懂一条 | `bili_debrief` → CLI `debrief`（≤240s，异步不阻塞宿主） | `definition.ts:665` → `tools/bili.mjs:25`；成功后 `:669` causal `watched`、`:671-672` 写记忆并落盘（解析 `:137`，编码强度 `:150`） |
| 10 写两本日记 | `bili_diary_append`（同日同标题=整节替换） | `definition.ts:825-849`（校验 `:827-834`，upsert `:842`，落盘 `:844-846`，causal `:847`） |
| 11 出稿 | `bili_draft_dynamic`：纪律闸 → voiceBrief → 子进程 | 闸 `:755`（`gates.ts` canDraft/diaryFresh，违规写 `:756`、`:761`）→ `:769` `buildVoiceBrief`（`persona-core/src/voice-brief.ts`）→ 不想发就跳 `:773-775` → voice 落盘 `:777-782` → `:787` `scripts/draft-dynamic.mjs` |
| 12 草稿 + 令牌 | composeDraft（吃 voice）→ 落盘 `<day>.json` → 出稿即入队一次性令牌 | `scripts/draft-dynamic.mjs:67-69`、`:84`、`:86`（`ack.enqueue`，含 `draftId`+`textHash`）；目录口径 `tools/lib/paths.mjs:55-59` |
| 13a 人工放行 | 面板按钮 → 服务端持 token → approve | `tank.ts`（draftAction）→ `dynamic-approve.mjs:94`（approveFromPanel，token 不进 HTTP 响应 `:88-92`）→ `:101-114` 绑定校验/缺token 就按当前正文重新入队 |
| 13b auto 放行 | 策略 auto 且窗口内且未达上限，且只用出稿那张令牌 | `definition.ts:790-821`：窗口 `:796`、上限把失败也算上 `:800`、`freshAckToken` `:804`、令牌走环境变量 `:812`、回执打码 `:817-819` |
| 14 真发送 | kill → 额度/幂等/冷却 → HTTP → 风控记账 | `dynamic-approve.mjs:44` → `publishers/bilibili-dynamic.mjs` → `tools/lib/bili-api.mjs:162/168`（缓存退避）→ `tools/lib/traffic.mjs:100`（kill）`:106-127`（预约）`:162-177`（结果记账） |
| 15 结果结算 | 草稿 status + `kind=draft-result` 进账本；失败退回令牌 | `dynamic-approve.mjs:71-81`（`:76-78` 失败释放令牌）→ `tools/drafts/store.mjs:57-59` |
| 16 回心情 | 下一拍步骤 3 把它变成场值与记忆 —— 闭环在这里合上 | `definition.ts:522` |

私信支路：`bili_dm_read`（`definition.ts:852` peek → `:873-878` 加 `inbound` 效果并记 `user_said` 记忆 → `:887-888` ack + causal）；`bili_dm_reply`（`:893-914`，直发成功写 `dm-auto-sent` `:907`，被拒退回草稿队列 `:911-912`）。互关硬要求 `tools/commands/dm.mjs:88`（`REQUIRE_MUTUAL`）+ `:101`。

## 4. 进程与端口拓扑

- 常驻：**1 个** Cortico 宿主进程（node + tsx 跑 TS），对外只监听 **7799**（WebUI；`docs/CORTICO-RUNBOOK.md:5`，`definition.ts:175` 注释亦称"7799 本机免口令"）。pid 与日志在 `control/cortico.pid` / `control/cortico.log`。
- 短命子进程：每次工具调用 fork 一层 `dsh` CLI（`definition.ts:279` spawn `tools/bili.mjs`），`bili.mjs:80` 再 `spawnSync` 一层 `tools/commands/*.mjs` → 最深 3 层 node。长任务用 `runNodeAsync` 异步化以免阻塞宿主（`:275-297`）。
- 值守脚本（常驻，非 World 管辖）：`scripts/day-watchdog.mjs`（`control/day-watchdog.pid`）、`scripts/action-watch.mjs`（`control/action-watch-result.json`）、`scripts/cortico-health.mjs`（体检）。
- 外部通道：
  - 模型：OFM 网关 `http://127.0.0.1:18910/v1`（`docs/CORTICO-RUNBOOK.md:4,17`；DeepSeek 系属部署事实，不入架构）。
  - B 站：`api.bilibili.com` / `m.bilibili.com`，全部经 `guardedFetch`（`traffic.mjs:202-207`）。动态类写端点当前回 **412**，`bili-api.mjs:138/168` 按 IP 级限流处理：熔断 + 指数退避（默认 5 分钟，封顶 30 分钟），`traffic.mjs:156-169` 再记一次全局风控 `until`。
  - 本机生图 ComfyUI：**代码里 0 引用**（全仓 `*.mjs/*.js/*.json` 无 `comfy`/`8188`）→ 每日立绘只是从 `imagesDir()` 已有文件里挑（`paths.mjs:62-67`、`tools/lib/pick-image.mjs`）。生图自动化 `(未实现)`。
  - 旧鱼缸面板 8447/8448：已退役（`docs/CURRENT.md:32,34`），`panel/server.js` 仍在但不被 `bili.mjs`/World 引用。
  - 视频/直播链：`tools/video-build.mjs`、`tools/media/{tts,bgm,video/studio}.mjs`、`vendor/dsh-*` 无调用方（§7⑤）。

## 5. 状态文件清单

日界口径有两套，别混：额度闸按机器本地日切（`traffic.mjs:110`，`toLocaleDateString('sv-SE')`），行动数与草稿文件名按 `dayKey`（`definition.ts:90`、`:203`，来自 `persona-core/src/rhythm.ts`）。机器时区与部署时区不一致时两者可错日。

| 文件 | 谁写 | 谁读 | 格式要点 |
|---|---|---|---|
| `~/.dsh/bili-whale.config.json` | 主人手改；`quota set`（`tools/commands/quota.mjs`）；WebUI 策略页（`tank.ts:135` 在测试上下文拒写生产配置） | `tools/lib/config.mjs`、`publish-policy.mjs:23`、`feed.mjs:38`、World `policyState` | 单一用户配置；`risk`/`publish`/`permissions`/`preferences`/`owner.displayName`；`BILI_WHALE_CONFIG` 可改路径（`paths.mjs:28`） |
| `~/.dsh/bili-whale/fields.json` | World（`personaAdapter.ts:180`，原子 + `.bak`，坏文件转 `.corrupt-*` 不静默清空 `:111-128`） | World、`tank.ts:20`、WebUI 世界页 | `schemaVersion:5`（`:130`）、7 场值（`definition.ts:110`）、`chain`/`memories` 各截 200（`:131`）、`emotionHistory` 24、`npcState`、`budget`、`lastAppliedAt`；版本不认识就走备份（`:141-143`） |
| `~/.dsh/bili-whale/causal.jsonl` | World `causal()`（`definition.ts:126`）+ dsh `appendCausal()`（`causal.mjs:21`） | 结算 `:228`、对账 `countCausalActions` `:78`、面板、观测脚本 | append-only 单行 JSON；红线：不落正文/凭据/token，只落身份、日期、长度、时间戳（`causal.mjs:8-9`）。常见 kind：`watched diary action activity inbound dm-auto-sent dm-draft draft-result auto-publish discipline-violation draft-result-consumed dm-read-failed` |
| `~/.dsh/bili-whale/control/kill` | 主人（存在即开） | `kill.mjs:18`、`traffic.mjs:100`、`dynamic-approve.mjs:18,44`、`definition.ts:277`（子进程直接 `-2` 不启动） | 空文件即可；只断写，不断读 |
| `control/round.json` | World（`:102`） | 纪律闸 `gates.ts` | `{feedAt,debriefed,bvid,debriefedAt}`；`feedAt` 超 12 小时视为空（`:56,97`） |
| `control/life.json` | World（`:65`） | 决策 `:538`、面板 | 新字段 `actionsToday/lastActionAt/lastContactAt/connectMisses/lastInboundKey/lastDmReadAt`；旧 `rhythm.json` 只迁移不回填（`:61-62`）；并发覆盖以账本对账、只增不减（`:75,504`） |
| `control/queue.json` | `task-queue.ts`（写回 `:341/:347`） | 启动补投 `:632` | at-least-once；5 次失败转 dead |
| `control/dm-applied.json` | `:48-55` | `:42` | 已加过效果的私信 key，最多留 200 条，防重复加 connection |
| `control/draft-result.json` | `:214` | `:211` | `{consumedAt}` 游标，防重复结算 |
| `control/voice-<day>.json` | `:777-782` | `draft-dynamic.mjs --voice` | 必须符合 `tools/drafts/voice.schema.json`（`compose.mjs:179-190` 校验，缺字段拒稿） |
| `control/feedback.jsonl` | `tools/commands/feedback.mjs` | `tank.ts`（openFeedbackCount）、WebUI 意见箱页 | 本地文件，不联网 |
| `~/.bili-ai/traffic-state.json`（+ `.lock`、legacy `api-ban.json`） | `traffic.mjs:34,35,71`，锁只覆盖预约/写状态不覆盖网络 I/O | `traffic status`、`tank.ts:51` | `{until,reason,streak,riskEndpoint,manual{},accounts{},operations{},nextAt,lastDispatch,last}`；`operations` 上限 2000（`:116`） |
| `~/.bili-ai/pending-replies.json` | `go-gate.mjs:10,22-23` | 世界页放行、`go-rebuild.mjs` | 存完整 argv（展示=执行），故 argv 属模型可写输入 → 放行前重建 |
| `~/.bili-ai/credentials.json` | `paths.mjs:43` | `tools/lib/cred.mjs`、`credentials/bilibili.mjs` | 按 OS 用户，不随 whale home 漂移（`paths.mjs:14`） |
| `~/.dsh/whale-diary.md` / `whale-diary-private.md` | World（`:844-846`）、主人 | `bili_diary_read` `:677-679`、`diaryTail()` `:169`（当召回情境）、`feed.mjs:33` | 注意在 `~/.dsh/` 根，不在 `bili-whale/` 子目录；`heading` 不能是日期（`:831,834`） |
| 草稿目录 `<day>.json` + `.md` | `store.mjs:40` | World（`:200-207`）、`dynamic-approve list` | 优先级 `WHALE_DRAFTS` → 旧路径存在即用（本机 `D:/AI/养鱼/drafts`）→ `~/.dsh/bili-whale/drafts`（`paths.mjs:55-59`）；World 侧同优先级另写一份（`:165-166`）并用 `--drafts` 传下去（`:786`） |
| `~/.dsh/bili-whale/days/<日期>/` | 观测脚本（写入者候选 `scripts/day-snapshot.mjs`、`scripts/day-report.mjs`；本页未逐行核实落盘点） | 人、复盘 | 证据包；`incident.md` 也落在这里 |

## 6. 安全边界（四条，全部代码强制）

1. **kill**：`<whale home>/bili-whale/control/kill` 存在 → 所有 B 站**写**停。收口在 `traffic.mjs:100`（唯一咽喉：CLI `--go`、面板放行、auto、MCP 包装都要过），approve 层另留一处更友好的提前拦截（`dynamic-approve.mjs:44`）；World 在 spawn 前就退（`definition.ts:277`）。读不受影响 —— 急停是停手，不是失明。
2. **读写额度闸**：默认 `minGapMs 1500 / readHourly 600 / readDaily 3000 / writeHourly 12 / writeDaily 30 / writeGapSec 120 / dmGapSec 60`（`traffic.mjs:8`，`riskSettings` 只接受 >0 覆盖，`dmGapSec` 允许 0 —— 防手滑关闸 `:14-26`）。写前预约：同操作指纹重复即拒（`:78-91` + `:115`，指纹忽略 csrf/wts/rnd 等易变键）、冷却 `:117-118`、预算 `:119-120`、队列 `:121-122`。412/429 与风控码触发全局暂停，指数退避封顶 30 分钟（`:156-169`）。已派发但结果不明 → 禁止自动重发并要求人工回读（`:174`、`:181`）。`-101/401/12015` 类转"人工处理"锁（`:159,170`，`traffic resume` 才解 `:196`）。
3. **一次性令牌 + 绑定**：草稿出稿即入队一张 token（`draft-dynamic.mjs:86`），真发必须带且必须绑定 `draftId` + **入队时正文哈希**，审完改稿就拒（`dynamic-approve.mjs:46-54`）；令牌只走 `--token-env` 或进程 env，不进 argv/stdout/账本（`:150-155`、`definition.ts:812`、面板响应不含 token `:88-92,94-124`）；auto 不许自造令牌（`:803-807`）；没发出去就把令牌退回以便重试（`:76-78`）。
4. **公开表达待审**：草稿默认 `review`（`publish-policy.mjs:15`）。非草稿类写里，普通评论与弹幕的 `--go` 一律进待审队列（`tools/commands/comment.mjs:92-94`、`danmaku.mjs:17` → `go-gate.mjs:17-26`），队列存完整 argv 以"展示什么就执行什么"，放行前由 `tools/lib/go-rebuild.mjs` 重建（argv 是模型可写输入）；`like/fav` 是自发档但仍过 kill/额度（`publish-policy.mjs:18-19`，`fav.mjs:46-49` 仍强制五判据）；私信只发主人、须互关、一天锁定 1 人（`dm.mjs:88,101`）；`bili_mood_apply` 不接受模型自称 `masterReplied/inbound`（`definition.ts:689-691`）。

## 7. 已知断点（现状，不是待办）

① **聊天不带她的状态。** `Cortico/bots/cormini/**` 对 `describeState / personaAdapter / fields.json` 的引用实测为 0（本次 grep）。控制台对话页与她过日子是两套上下文；场值/记忆只经 `bili_mood_read`（`definition.ts:681`）进模型。修它要在 Persona 侧注入，Core 不改。

② **判断没有执行通道。** 她能写的只有日记、记忆、意见箱与场值；`bili_feedback` 的工具说明自己写着 "you do NOT fix code"（`definition.ts:310`）。她的偏好要变成工具行为，目前只有两条人肉路径：改 `config.preferences`、或改 `annotateFeed` 里硬编码的时长/同 UP 线（`personaAdapter.ts:405-410`）。"她的判断自动生效" `(未实现)`。

③ **feed 偏好仍部分来自日记文本解析。** `feed.mjs:38` 先读 `config.preferences.like/dislike`，`:42-44` 仍用正则从 `whale-diary.md` 抠「爱看」一行作兜底（`- **爱看**：…`）。这是格式耦合：日记回归纯叙事后这条兜底应删 `(未实现)`。

④ **写接口免口令。** `Cortico/src/web/auth.ts:2` —— 密码为空即不启用，所有请求照常放行；7799 在本机就是免口令口。已发生一次真实盲写（`docs/CURRENT.md:23`：`publish.draftMode` 被写为 `auto`，载荷含 `autoDailyCap=-9`）。已落的两条缓解：切 auto 必须往私人日记写「策略变了」（`definition.ts:177`，调用点 `:448`）、测试上下文拒写生产配置（`tank.ts:135`）。**给写口加认证 `(未实现)`**；nonce/口令挡不住同机进程，这是文档里已承认的诚实结论。

⑤ **视频与直播未接线。** 直播弹幕有 CLI（`bili.mjs:52-53`），但 World 无对应工具声明（`definition.ts:299-313` 的 13 个 `bili_*` 里没有 live 类），她既看不到也发不了弹幕；`bili_dm_read` 是私信不是直播间。视频侧 `tools/video-build.mjs:15` 调 `tools/media/tts.mjs`、`tools/media/video/studio.mjs` 引 `vendor/dsh-video-studio`，但 `bili.mjs:10-55` 命令表无该项、World 无该工具 → 整条媒体链无调用方。ComfyUI 生图全仓 0 引用（§4）。`vendor/dsh-autocut` 同样只被 `video-build.mjs` 系引用，未进 CLI。

⑥ **跨仓耦合两处，改一边会动另一边。** World 数据面动态 import dsh 的模块（`tank.ts:51` 加载 `tools/lib/traffic.mjs`）；home 与草稿目录各有一份等价实现（`definition.ts:29` vs `paths.mjs:24`；`definition.ts:165` vs `paths.mjs:55-59`），靠注释互指维持一致，无契约测试锁死 `(未实现)`。

⑦ **双日界口径**（§5 末）：额度按机器本地日，行动数与草稿按 `dayKey`。时区漂移时会错日 `(未统一)`。

## 8. 与现有文档的出入（10 条）

> 2026-11-01 逐条处置见本节末「§8.1」；文档分工的总仲裁在 [`INDEX.md`](./INDEX.md) §1。

| # | 文档说 | 代码事实 |
|---|---|---|
| 1 | `docs/ARCHITECTURE.md:8`（§0）："当前 `buildText()` 只吃日记文本，7 场值/因果/记忆对任何可观测产出零影响" | 已过期。出稿走 `composeDraft(diaryText,{date,voice})`（`scripts/draft-dynamic.mjs:67-69`），voice 缺字段直接拒稿（`tools/drafts/compose.mjs:184-190`），`stance.share=false` 时根本不出稿（`definition.ts:773-775`），审批结果由代码结算回场值（`definition.ts:228`、`:522`）。`buildText` 仍在（`compose.mjs:134`）但只是无 voice 的降级路径（`draft-dynamic.mjs:84` `degraded`） |
| 2 | `docs/BLUEPRINT.md:1` 自称"唯一真相源"，`docs/CURRENT.md:4` 让人看 BLUEPRINT | 分层名与代码不同名：现行是 Core/Persona/persona-core/Memory/World（Cortico `AGENTS.md` §2、`definition.ts:10-23` 的 import 面），BLUEPRINT 用 L1–L5 且自己承认有三版并存（`BLUEPRINT.md:16-24`）。两者不能同时是"唯一真相源" |
| 3 | `docs/BLUEPRINT.md:27`："语音：MiMo TTS 本地已通（未接 L5）" | 不止"未接 L5"：TTS 唯一调用方是 `tools/video-build.mjs:15`，而 video-build 既不在 `tools/bili.mjs:10-55` 命令表、也不在 World 工具（`definition.ts:299-313`）→ 整条媒体链无任何调用方 |
| 4 | `docs/CURRENT.md:3`："feed 回执里的偏好仍来自解析日记叙事，不是 config" | 不完整。`feed.mjs:38-39` 首选 `config.preferences`，日记「爱看」仅在配置未给时兜底（`:42-44`，注释即"兼容旧写法"）。残留的是兜底那半条（§7③） |
| 5 | 任务书/口头口径把 go-gate 写作 `tools/go-gate.mjs` | 实际 `tools/lib/go-gate.mjs`；队列文件是 `~/.bili-ai/pending-replies.json` 而非 `control/pending/`（`go-gate.mjs:10`） |
| 6 | "运行态都在 `C:/Users/Administrator/.dsh/`" | 流量状态、待审队列、凭据在 `~/.bili-ai/`：`traffic.mjs:201`（目录硬编码 `USERPROFILE/HOME` + `.bili-ai`）、`go-gate.mjs:10`、`paths.mjs:43`；`paths.mjs:14` 明确"凭据按 OS 用户走，不随 whale home 漂移" |
| 7 | "kill/round/life/pending/feedback/observation 全在 `control/`" | `control/` 里实有 `kill round.json life.json queue.json feedback.jsonl draft-result.json dm-applied.json voice-*.json cortico.pid` 等；但"待审"有三处不同文件：`control/queue.json`（她的意愿队列，`task-queue.ts`）、`~/.bili-ai/pending-replies.json`（go-gate 待放行）、草稿自身的 `status:pending`（`store.mjs:40`）。同名不同物 |
| 8 | `definition.ts:1` 头注释："所有对外写操作只入队，不发送" | 不符。`bili_dm_reply` 直发（`definition.ts:903-909`，工具说明 `:309` 明写 auto-approved since 2026-10-31）；`bili_like`/`bili_fav` 自发档（`:311-312` + `publish-policy.mjs:18-19`）；`draftMode=auto` 时 `bili_draft_dynamic` 真发（`:790-821`）。头注释需重写（本页不改代码，只记账） |
| 9 | `personaAdapter.ts:2-4` 头注释："World 只依赖这里的四个函数" | 不符。`definition.ts:8` 一次 import 了 12 个符号（loadState/saveState/applyEffects/remember/rememberFirst/describeStateWithTrace/applyRecall/recentWatch/annotateFeed/PRESETS 及类型） |
| 10 | `docs/CURRENT.md:32,34`："面板 8447/8448 已退役，代码保留" | 与代码一致，但补一句：`panel/server.js` 仍在且有 173 行、`panel/*.mjs` 被 World 的 `tank.ts` 复用为数据模块来源；退役的是**端口**，不是目录。旧 8447 是提权进程、本机仍杀不掉（`docs/CURRENT.md:34`） |

### 8.1 逐条处置（2026-11-01，文档席）

| # | 处置 | 落在哪 |
|---|---|---|
| 1 | **已改**：`docs/ARCHITECTURE.md` §0 那句加删除线 + 现行事实（`composeDraft`/`assertVoice`/结算回场值 + `voice-state-coupling` 复跑读数）；§内另一处 `buildText 只吃日记` 同样标注；`docs/BLUEPRINT.md` §6 引用处标注"断链已闭合"；`docs/ISSUES.md` D-01 由 `OPEN` 改 `FIXED` 并附证据 | 那四个文件 |
| 2 | **已仲裁**：`docs/INDEX.md` §1 定五份真相源（架构=本页 · 现状=`CURRENT.md` · 产品=`PRODUCT.md` · 判据=`OBSERVATION-PROTOCOL.md`+`evidence/G3B-DECISION-2026-11-01.md` · 版本=`CHANGELOG.md`+`package.json`+tag）。`BLUEPRINT.md:1` 的"唯一真相源"、`CURRENT.md:4` 的"看 BLUEPRINT（唯一真相源）"、`PRODUCT.md:4` 的同一句话**全部就地改掉并互相指认**；BLUEPRINT 保留 50 项清单与改动纪律，架构部分让位给本页 | `INDEX.md` §1/§2 |
| 3 | **已改**：`BLUEPRINT.md` 分层图 L5 那格改成"未接任何调用方"，与本页 §7⑤ 一致 | `BLUEPRINT.md:29` |
| 4 | **已更正到台账**：`CURRENT.md` 那条"偏好仍来自解析日记叙事"补了口径——`tools/commands/feed.mjs:38-46` 首选 `config.preferences`（`prefsFrom='统一配置'`），日记「爱看」只在配置为空时兜底（`prefsFrom='日记兜底'`，注释即"兼容旧写法"）；残留的是兜底那半条 = 本页 §7③。11-01 的 `76519ff` 又把来源标进了回执 | 本页 §7③ |
| 5 | **文档侧无需改**：全仓 grep 无 `tools/go-gate.mjs` 写法（`CLOSEOUT.md:33` 等已是 `tools/lib/go-gate.mjs`）。这是任务书/口头口径问题，纠正记录在此 | 本节 |
| 6 | **以本页 §5 为准**：运行态分两处（`~/.dsh/bili-whale*` 与 `~/.bili-ai/`）。dsh 侧文档没写过"全在 `.dsh`"，`CURRENT.md` 约定节写的正是"凭据只进 `~/.bili-ai/`"——与代码一致，不改 | 本页 §5 |
| 7 | **以本页 §5 状态文件清单为准**：三处"待审"不同文件已列名（`control/queue.json` / `~/.bili-ai/pending-replies.json` / 草稿 `status:pending`）。`RUNBOOK.md` §2、`DEPLOY.md` §C 已补"退役的是端口"一段 | 本页 §5 + 那两份手册 |
| 8 | **不在本席边界内**：改的是 `Cortico/src/worlds/bili-account/definition.ts:1` 的头注释。本席只做文档与版本线，不碰 `E:/WorkSpace_Qoder/Cortico*`；**转交 Cortico 席**：头注释应改成"对外写默认待审；`dm_reply`/`like`/`fav` 是自发档、`draftMode=auto` 时出稿即发"（依据 `definition.ts:903-909`、`:311-312`、`:790-821` 与 `publish-policy.mjs:18-19`） | 待 Cortico 席 |
| 9 | 同 8：`personaAdapter.ts:2-4` 头注释与 `definition.ts:8` 的 12 个 import 不符，转交 Cortico 席改注释 | 待 Cortico 席 |
| 10 | **已落到手册**：`RUNBOOK.md` §2 与 `DEPLOY.md` §C 顶部各加"现行界面是 7799 世界页 / 退役的是端口不是目录" | 那两份手册 |

## 9. 等价 Mermaid（没装 graphviz 时用这份）

```mermaid
flowchart TB
  subgraph COR["Cortico 宿主（1 进程 · 7799 WebUI）"]
    subgraph PW["Persona 层 bots/cormini"]
      PER["persona.ts 提示词装配"]
      HB["heartbeat.ts:50 指数退避"]
      MEM["memory.ts + workspaceGit.ts"]
    end
    subgraph PC["persona-core（平台无关纯函数）"]
      RHY["rhythm.ts decideAction"]
      EB["effect-bus.ts"]
      CCH["causal-chain.ts"]
      MRY["memory.ts + retrieval.ts"]
      VOX["voice-brief.ts"]
      EMO["emotion.ts / emotion-projection.ts"]
    end
    subgraph WD["World src/worlds/bili-account"]
      DEF["definition.ts 工具声明+编排"]
      ADP["personaAdapter.ts saveState:180 applyEffects:203"]
      TK["tank.ts 数据面"]
      GT["gates.ts 纪律闸"]
    end
  end

  subgraph DS["dsh-bili-whale（CLI，子进程）"]
    BILI["tools/bili.mjs:80 spawnSync"]
    FEED["commands/feed.mjs:38"]
    DEB["commands/debrief.mjs"]
    DIA["draft-dynamic.mjs:86 令牌入队"]
    COM["drafts/compose.mjs assertVoice"]
    APPR["scripts/dynamic-approve.mjs:44,46,60"]
    PUB["drafts/publishers/bilibili-dynamic.mjs"]
    POL["lib/publish-policy.mjs:15"]
    TRF["lib/traffic.mjs:100 kill, :114 额度"]
    GATE["lib/go-gate.mjs 待审队列"]
    MED["video-build.mjs + media/* + vendor/dsh-* （无调用方）"]
  end

  subgraph ST["运行态"]
    CFG["~/.dsh/bili-whale.config.json"]
    FLD["~/.dsh/bili-whale/fields.json"]
    CAU["~/.dsh/bili-whale/causal.jsonl"]
    CTL["~/.dsh/bili-whale/control/ kill·round·life·queue·voice·draft-result"]
    DRAFTS["drafts 目录 D:/AI/养鱼/drafts 优先"]
    DIARY["~/.dsh/whale-diary.md (+private)"]
    BA["~/.bili-ai/ traffic-state·pending-replies·credentials"]
  end

  subgraph EX["外部通道"]
    OFM["OFM 网关 127.0.0.1:18910"]
    BL["api.bilibili.com（动态端点回 412）"]
    COMFY["ComfyUI（代码 0 引用·未实现）"]
  end

  OFM --> PER
  PER --> WD
  HB --> DEF
  DEF -->|"lifeTick :625"| RHY
  DEF -->|"pushEvent bili.action_due :330"| PER
  DEF -->|"`bili_*` 工具"| ADP
  ADP --> PC
  DEF -->|"spawn runNodeAsync :279"| BILI
  BILI --> FEED & DEB & DIA & APPR
  DIA --> COM --> VOX
  APPR --> PUB --> TRF --> BL
  GATE --> APPR
  ADP --> FLD
  ADP --> CAU
  DEF --> CTL
  FEED --> DIARY
  FEED --> CFG
  APPR --> DRAFTS
  CAU -->|"consumeDraftResults :522"| ADP
  TK --> FLD & CAU & CFG
  TK -->|7799 世界页| PER
  PUB -->|412 熔断| TRF
  MED -.-> COMFY
  POL --> APPR
```

维护：改 `definition.ts` 的工具表或状态文件口径、改 `traffic.mjs` 的预算默认、改 `publish-policy.mjs` 的档位、改 `paths.mjs` 的目录优先级 —— 都要同步本页与 `architecture.dot`。
