# 配置总览规格（小鱼 · 鱼缸「设置」页签）

本文档的 owner：dsh `tools/lib/config.mjs` 的 `DEFAULTS` 与运行态 `~/.dsh/bili-whale.config.json`；Cortico `src/worlds/bili-account/tank.ts` 的 `policyState/policySet/readPolicyLite`、`src/worlds/bili-account/definition.ts` 的 `webUi()`/`DECLS`、`persona-core/src/rhythm.ts`。改这些文件必须同步改本页。

取证口径：本文所有 file:line 均为本次实读结果（2026-11-01，Cortico 分支 master、dsh 工作区当前内容）。没有发过任何 B站 请求，没有跑任何会打接口的命令。凡是需要联网才能确认的值（如 `self.name` 是否等于账号真实昵称）一律写成"待主人确认"并给出离线可做的校验路径。

---

## 0. 结论（先看这四条）

1. **`bili-account` 这个 World 没有 `config.ts`，因此没有声明任何 ConfigGroup。** 目录内只有 `definition.ts / tank.ts / personaAdapter.ts / rhythm 侧文件 / webui/client.ts`；`definition.ts:985` 的 `defaults: () => ({ enabled: false })` 是它唯一的配置声明。框架惯例（`Cortico/AGENTS.md` §3.5「Tunables are declared, never hand-built」）要求每个可调项都是 ConfigGroup 里的一条 JSON Schema，`bilibili`/`qq`/`websearch` 三个 World 都照做了（`src/worlds/bilibili/world.ts:466`、`src/worlds/qq/world.ts:503`、`src/worlds/websearch/world.ts:188` 各自 `config: [<id>ConfigGroup(language)]`）——**唯独 `bili-account` 的 `webUi()` 返回体里没有 `config` 字段**（`definition.ts:376-474`）。所以框架的 `#/config` 页上关于她一条都没有。
2. **dsh 侧真实存在 60 个叶子配置键；页面上能改的只有 6 个**（`policy` 面板 → `tank.ts:132 policySet` 的白名单 `publish.{draftMode,autoDailyCap,autoWindow}` + `permissions.{like,fav,dmReply}`）。其余 **54 个只能编辑 JSON 文件**——这就是主人不接受的交付方式。
3. **她的"名字/称呼"目前有 7 个存储点**（§1.F），其中 5 个在页面上看不见；`owner.displayName` 这一项虽然是今天新加的，但它只在**启动时**被读一次（`definition.ts:480 setOwnerName(ownerNameFromConfig())`），所以改完必须重启她才生效——页面既看不到它，也不知道要重启。
4. **她确实改不了这些配置**（证据在 §2.1），但**任何本机进程都改得了**：`policySet` 除了测试上下文（`tank.ts:136`）之外没有任何鉴权，而 7799 默认免口令。设置页上线时必须同时把写入这条路收紧，否则"页面能改"的另一面是"她借道本地 HTTP 也能改"。

---

## 1. 配置项全量清单（穷举，非抽样）

### 1.A dsh 用户配置：`~/.dsh/bili-whale.config.json`

- 读取顺序：`$BILI_WHALE_CONFIG` → `~/.dsh/bili-whale.config.json` → `DEFAULTS`（`tools/lib/paths.mjs:26`，`tools/lib/config.mjs:12,67-74`）。
- 合并方式：深合并（`config.mjs:57-63`），**数组是整体覆盖，不是追加**；`preferences.dislike` 里删一项就等于删一项，不会回落默认。
- 缓存：`let cache`（`config.mjs:65,68`）——**每个 dsh 子进程读一次**。Cortico 每次工具调用都 `spawn` 新 `bili.mjs`（`definition.ts:281`），所以对 dsh 侧而言"改完下一次调用就生效"≈ 立即。
- Cortico 侧自己也会读同一份文件：`tank.ts:125` `CONFIG_FILE`；`readPolicyLite`（`tank.ts:167-178`）与 dsh 的 `readPolicy`（`tools/lib/publish-policy.mjs:22-33`）是同语义两份实现，**值语义必须一致**（已有测试锁）。

图例：可见性 ✅=页面能改 / 👁=页面只读能看到 / ❌=只能改文件。生效时机：`热`＝下一个 dsh 子进程即生效；`重启`＝必须重启 Cortico 进程；`半`＝dsh 侧热、宿主侧重启。

| 节 | 键 | 现值（用户文件） | DEFAULTS 有声明 | 实际读者（file:line） | 生效时机 | 可见性 |
|---|---|---|---|---|---|---|
| `owner` | `mid` | `233643544` | ✅ | `tools/lib/msgfeed.mjs:13`（同类读法）、comment/comment-await 白名单 | 热 | ❌ |
| `owner` | `name` | `主人` | ✅ | comment/danmaku 正文 `@昵称`；`definition.ts:929 --who` 用的是运行时的 `ownerName()`，不是这个键 | 热 | ❌ |
| `owner` | `displayName` | `鱼片` | ❌ **缺声明** | `tank.ts:162-164` → `definition.ts:480` → `persona-core/src/naming.ts:8-16` | **重启** | ❌ |
| `self` | `mid` | `497080562` | ❌ | `tools/lib/msgfeed.mjs:13`、`tools/commands/fav.mjs:61` | 热 | ❌ |
| `self` | `name` | `恐怖深海鱼` | ❌ | `tools/commands/feed.mjs:247`、`selftest.mjs:37` | 热 | ❌ |
| `preferences` | `like`（5 项） | 助眠/ASMR… | ✅ | `tools/commands/feed.mjs`（命中计分 `:271`） | 热 | ❌ |
| `preferences` | `dislike`（13 项） | 带货/擦边… | ✅ | `feed.mjs:293` 丢弃 | 热 | ❌ |
| `preferences` | `keywords`（6 项） | 助眠… | ❌ | `feed.mjs:88`（搜索词，**只取前 6 条**） | 热 | ❌ |
| `risk` | `minGapMs` | 1500 | ✅ | `tools/lib/traffic.mjs:8,13` | 热 | ❌ |
| `risk` | `readHourly` | 600 | ✅ | `traffic.mjs` settings | 热 | ❌ |
| `risk` | `readDaily` | 3000 | ✅ | 同上 | 热 | ❌ |
| `risk` | `writeHourly` | 12 | ✅ | 同上 | 热 | ❌ |
| `risk` | `writeDaily` | 30 | ✅ | 同上 | 热 | ❌ |
| `risk` | `writeGapSec` | 120 | ✅ | 同上（写间隔=平台疼觉） | 热 | ❌ |
| `risk` | `dmGapSec` | 60 | ✅ | 同上 | 热 | ❌ |
| `quota` | `shareDaily` | 3 | ✅ | `tools/commands/quota.mjs`、`tools/lib/quota-gate.mjs:11` | 热 | ❌ |
| `persona` | `name` | `小鱼` | ✅（默认 `<角色名>`） | debrief/diary 文案 | 热 | ❌ |
| `persona` | `ownerTitle` | `主人` | ✅ | 同上 | 热 | ❌ |
| `persona` | `selfClaim` | `本小姐` | ✅ | 同上 | 热 | ❌ |
| `persona` | `diaryTitle` | 未配（用默认 `今日摘要`） | ✅ | `tools/commands/diary.mjs` | 热 | ❌ |
| `publish` | `draftMode` | `review` | ❌ | `publish-policy.mjs:23`、`tank.ts:171` | 热 | ✅ |
| `publish` | `autoDailyCap` | 0（不限） | ❌ | `publish-policy.mjs:24`、`definition.ts:818` | 热 | ✅ |
| `publish` | `autoWindow` | `""`（不限） | ❌ | `publish-policy.mjs:26,40`、`definition.ts:814` | 热 | ✅ |
| `permissions` | `like` | `self` | ❌ | `publish-policy.mjs:27`、`tools/commands/like.mjs` | 热 | ✅ |
| `permissions` | `fav` | `self` | ❌ | 同上、`tools/commands/fav.mjs` | 热 | ✅ |
| `permissions` | `dmReply` | `direct` | ❌ | `publish-policy.mjs:29`、`definition.ts:921` | 热 | ✅ |
| `share` | `enabled` | true | ✅ | `tools/lib/share-policy.mjs:3` | 热 | ❌ |
| `share` | `via` | `comment` | ✅ | ai-share/comment | 热 | ❌ |
| `share` | `minScore` | 13 | ✅ | `share-policy.mjs:5`（标尺阈值） | 热 | ❌ |
| `share` | `aiCommentGuard` | false | ✅ | ai-share | 热 | ❌ |
| `share` | `aiThreshold` | 30 | ✅ | ai-share | 热 | ❌ |
| `share` | `silentAfterDays` | 3 | ✅ | ai-share | 热 | ❌ |
| `listen` | `comment` | false | ✅ | `tools/commands/comment-await.mjs` | 热 | ❌ |
| `listen` | `commentIntervalSec` | 60 | ✅ | 同上 | 热 | ❌ |
| `listen` | `dm` | true | ✅ | dm-await | 热 | ❌ |
| `listen` | `dmIntervalSec` | 150 | ✅（默认 60） | dm-await | 热 | ❌ |
| `listen` | `scope` | `both` | ✅ | comment/comment-await | 热 | ❌ |
| `listen` | `oncePerPerson` | false | ✅（默认 true） | danmaku-await | 热 | ❌ |
| `listen` | `allDay` | false | ✅ | comment-await | 热 | ❌ |
| `listen` | `live` | false | ✅ | danmaku/danmaku-await | 热 | ❌ |
| `listen` | `liveRoom` | `""` | ✅ | 同上 | 热 | ❌ |
| `listen` | `liveScope` | `owner` | ✅ | 同上 | 热 | ❌ |
| `listen` | `mentionSummary` | true | ❌ | 需确认（`listen.*` 消费者见 comment.mjs/danmaku-await.mjs） | 热 | ❌ |
| `night` | `windows` | `[]`（空=无窗口） | ✅（默认 1 窗口 20:00–24:00） | `tools/lib/night-plan.mjs:16` | 热 | ❌ |
| `night` | `skipChance` | 0.3 | ✅ | `night-plan.mjs:96` | 热 | ❌ |
| `night` | `minGapMin` | 30 | ✅（默认 10） | `night-plan.mjs:79` | 热 | |
| `night` | `maxVideos` | 3 | ✅（默认 5） | `night-plan.mjs:101` | 热 | ❌ |
| `night` | `maxWakesPerDay` | 2 | ❌ | `night-plan.mjs:16`（旧字段回退） | 热 | ❌ |
| `notify` | `type` | `none` | ✅ | `tools/commands/notify.mjs:47-48,173-188`（none/desktop/webhook/command） | 热 | ❌ |
| `notify` | `url` | `""` | ✅ | `notify.mjs:182`（webhook/ntfy topic 地址） | 热 | ❌ |
| `notify` | `template` | `text` | ✅ | notify（text/markdown） | 热 | ❌ |
| `notify` | `cmd` | `""` | ✅ | notify command 分支 | 热 | ❌ |
| `notify` | `topic` | 未配 | ❌ | `notify.mjs:183,92-94` | 热 | ❌ |
| `diary` | `enabled` | true | ❌ | **待确认**：`diary` 字样出现在 `tools/bili.mjs`、`tools/commands/diary.mjs`、`tools/drafts/{compose,store}.mjs`，但 `diary.enabled` 这条键本身没找到明确读者 | 热 | ❌ |
| `diary` | `push` | false | ❌ | **待确认**（疑与 notify 联动） | 热 | ❌ |
| `clock` | `enabled` | false | ❌ | `tools/bili.mjs`、`tools/commands/whale-night.mjs`、`panel/views/tank.html`；**Cortico 宿主下无独立时钟**（`tank.ts:284` 明写"Cortico 宿主：节奏由状态驱动"） | — | ❌ |
| `aliases` | （数组，未配） | — | ✅ | `tools/commands/danmaku-await.mjs:73-78`（历史昵称兜底，当前昵称从 nav 动态读） | 热 | ❌ |
| `home` | | `D:/AI/养鱼` | ❌ | `tools/lib/ai-share.mjs`、`tools/lib/credentials/*`、`tools/lib/kill.mjs`、`comment.mjs`、`dm-await.mjs` | 热 | ❌ |
| `toolsPath` | | `""` | ❌ | 仅 `panel/server.js`（旧独立面板 8447） | — | ❌ |
| `sessionRotateDays` | | 0 | ✅ | **只有 `config.mjs` 自己**（无消费者） | — | ❌ |
| `personaOncePerSession` | | true | ✅ | **只有 `config.mjs` 自己**（无消费者） | — | ❌ |

叶子键合计 **60**（DEFAULTS 声明 46；用户文件另有 14 项未在 DEFAULTS 声明：`owner.displayName`、`self.mid/name`、`preferences.keywords`、`night.maxWakesPerDay`、`publish`×3、`permissions`×3、`clock.enabled`、`toolsPath`、`home`、`diary.enabled/push`、`notify.topic`、`listen.mentionSummary` 中按并集去重后的缺项）。

**死键（建议从用户文件删掉，并在设置页"高级"里显式标灰）**：
- `sessionRotateDays`、`personaOncePerSession` —— 全仓只有 `tools/lib/config.mjs` 出现，没有任何消费者。
- `toolsPath` —— 只被 `panel/server.js` 读，那是移植期遗留的独立面板（`definition.ts:353` 注明面板已收进 WebUI）。
- `clock.enabled` —— 与 Cortico 状态驱动节奏冲突，宿主侧已无时钟（`tank.ts:284`）。
- `night.maxWakesPerDay` —— 已被 `night-plan.mjs:16` 当作旧字段回退读取，新语义是 `windows[].wakes`。
- `share.via`/`aiCommentGuard`/`aiThreshold` —— 插件时代分享型评论链路（`tools/lib/ai-share.mjs`），若主人已决定不走 ai-share，就是死键；**需主人确认后才删**。

### 1.B Cortico 框架/部署侧（`deployments/mybot/config.json`，353 B）

`#/config` 的分组来自 `bot.ts:925-934`：`coreConfigGroup` + Persona 贡献的组 + provider 组；写入在 `bot.ts:1013-1021`（`setConfigPath` 落到部署 config.json），HTTP 面是 `GET/POST /api/config`（`src/web/server.ts:2367,2408`），且 **`POST` 只接受 schema 里声明过的键**（`server.ts:2418` 注释：没声明的键一律忽略）。

| 键 | 现值 | 在哪个组里 | 页面可见 | 生效 |
|---|---|---|---|---|
| `displayName` | `小鱼` | core（`core/config.ts:32-37`，`x-hot:true`） | ✅ | 热 |
| `batching.quietGapMs/minBatchAgeMs/maxBatchAgeMs/maxBatchSize` | 默认 | core（`:40-84`） | ✅ ×4 | 热 |
| `context.keepPastThinking` | 默认 | core（`:85-90`） | ✅ | 热 |
| `logging.file/stdout/areas` | 默认 | core（`:91-106`） | ✅ ×3 | 热 |
| `usage.rates.<code>` | 默认 | core（`:21-27` 按 USAGE_RATES 展开） | ✅ ×N | 热 |
| `context.maxTokens/keepRatio/softRatio/firstTurn` | 256000 / .333 / .85 / false | persona 组 `contextStageConfigGroup('cormini')`（`bots/cormini/persona/config.ts:14-63`） | ✅ ×4 | 热 |
| `worlds.bili-account.enabled` | true | **没有任何 ConfigGroup** | ❌ | 重启 |
| `worlds.console.pin` | `666666` | console World 自己的段（未见 ConfigGroup） | ❌ | 待确认 |
| `web.port` / `web.theme` | 7799（命令行 `--port=7799` 覆盖）/ 默认 | **不在 core 组 schema 里** | ❌ | 重启 |
| `activeProvider` | `opencode-go` | 不在 `#/config` 的 core/persona 组里（在「语言模型」页？） | 待确认 | 热 |
| `tick.intervalMinutes` | null | 见 `bot.ts` tick 配置；cormini `defaults`（`index.ts:79`） | 待确认 | 热（`index.ts:45` 每次 wakeup 读） |

框架侧合计约 **21 个已声明项**（core 9 + usage.rates N + persona 4 + 其余），**另有 4–6 个部署键在页面上没有位置**（`worlds.bili-account.enabled`、`worlds.console.pin`、`web.port`、`web.theme`、`activeProvider`、`tick.intervalMinutes`，其中后三个需主人确认是否由「语言模型/外观」页覆盖）。

### 1.C 硬编码常量：事实上主人会想改，但目前只存在于代码里

「重启」= 一律需要重启 Cortico（除注明 dsh 子进程即时）。

| 常量 | file:line | 现值 | 改了影响哪条判据 |
|---|---|---|---|
| 评估间隔下/上限 | `persona-core/src/rhythm.ts:65,66` | 3 / 7 分钟 | 她多久"看一眼自己想不想动"（`definition.ts:611`） |
| `CHECK_PROB` | `rhythm.ts:51` | 0.05 | 每 5 分钟基准概率 × 驱动强度 → 主动性 |
| `MIN_GAP_MS` | `rhythm.ts:41` | 0（事件驱动） | 行动间最小间隔（`definition.ts:609`） |
| `MAX_ACTIONS_PER_DAY` | `rhythm.ts:49` | ∞ | 每日行动上限（主人裁决"不设上限"） |
| `REST_RECOVERY_PER_HOUR` | `rhythm.ts:58` | 0.005 | 睡着时体力恢复 → 会不会长期疲劳卡门 |
| `ACTION_COST_ENERGY` | `rhythm.ts:60` | 0.05 | 一轮活动的体力代价 |
| `REST_PRESSURE_START_H` / `REST_FULL_HOURS` | `rhythm.ts:62,63` | 12 / 30 h | 歇多久开始"想动"（`rhythm.ts:106`） |
| "睡着"判定 6 h | `definition.ts:541` | 6 h | `asleep` → 恢复只在睡着生效 |
| `ROUND_STALE_MS` | `definition.ts:58` | 12 h | 一轮 feed/debrief 的过期（过期后纪律门重新计数） |
| `STATE_SCHEMA_VERSION` | `personaAdapter.ts:130` | 5 | fields.json 迁移判定 |
| `HISTORY_LIMIT` | `personaAdapter.ts:131` | 200 | 因果链/记忆保留条数（`:182,:190`） |
| `EMOTION_HISTORY_LIMIT` | `personaAdapter.ts:132` | 24 | 情绪历史保留（`:161,:193,:244`） |
| 每轮召回条数 | `definition.ts:196`、`personaAdapter.ts:317,327` | 5 | 她每轮"想起来"几件旧事 |
| 书名号截断 24 字 | `personaAdapter.ts:356` | 24 | 「看过《…》」记忆编码长度 |
| 记忆正文截断 40 字 | `personaAdapter.ts:357` | 40 | 同上（非书名号路径） |
| `recentWatch` 回看天数 | `personaAdapter.ts:384` | 7 | 挑片避重（同题材/同 UP） |
| 最近 UP 展示数 | `personaAdapter.ts:415` | 3 | 同上 |
| `DIARY_STALE_MS` | `gates.ts:22` | 24 h | **超 24 h 没写日记就不许出稿**（`gates.ts:25`，`definition.ts:778`） |
| 违规点名窗口 | `gates.ts:35` | 24 h | 跳过 debrief 的下轮提醒 |
| `DM_REPLY_WINDOW_MS` | `dm-reply.ts:14` | 7 天 | 回信时效门（她能不能回私信） |
| `DM_REPLY_MAX_CHARS` | `dm-reply.ts:33` | 500 | 私信正文长度上限 |
| 候选条数 n 的钳制 | `definition.ts:670` | 1–6，缺省 3 | `bili_feed` 每轮拿几条 |
| debrief 采样参数 | `definition.ts:683` | `--top 3 --comments 3 --bucket 60` | 深读一条视频的粒度 |
| debrief 超时 | `definition.ts:683` | 240 s | 长视频会不会被砍 |
| 通用/审批超时 | `definition.ts:278,831` | 180 s / 300 s | 子进程卡死判定 |
| custom 效果护栏 | `definition.ts:114-124,730` | 7 原子场、\|delta\|≤0.5、≤8 条 | 她能否用 `mood_apply` 把自己刷上头 |
| 日记正文上限 | `definition.ts:851` | 6000 字 | 单次写节上限 |
| 日记标题上限 | `definition.ts:846` | 40 字 | 同上 |
| fav 理由下限 6 字 / 每日 3 条 / 30 天不重复 / 同类 ≤2 | `definition.ts:314,970` | 见左 | 收藏判据（真正执行在 `tools/commands/fav.mjs`，需同步） |
| 回执截断 | `definition.ts:291,697,907` | 12000 / 12000 / 200 字 | 她一次能看到多少 |
| 私信去重账本尾部 | `definition.ts:54` | 200 条 | dm 补确认 |
| 页签轮询 | `webui/client.ts:10` | 20 s | 页面刷新频率（前端，改动要 `pnpm build:web`） |
| feed 打分权重 | `tools/commands/feed.mjs:271`（`×3`/`×4`/`×2.5` 封顶 7.5，注释见 `:218`） | 见左 | 候选排序（dsh 子进程即时） |
| `densityOf` log 底 | `feed.mjs:245` | `log10(1+dm/max(30,d))` | 弹幕密度归一 |
| 搜索词只取前 6 | `feed.mjs:88` | 6 | `preferences.keywords` 有效长度 |
| 去重存储上限 | `feed.mjs:110` | 40 条 | 候选记忆窗口 |
| 每源取前 20 | `feed.mjs:144` | 20 | 拉池深度 |
| `JUNK_PLAY` / `JUNK_DM` | `tools/lib/feed-quality.mjs:13,14` | 300 / 3 | 垃圾内容判定（低播放低弹幕） |
| `BCKET`/`TOP` 默认 | `tools/commands/debrief.mjs:34`（+ `--top` 用法注释 `:5`） | 30 s / 5 | 弹幕分桶宽度与峰数量 |
| `RISK_DEFAULTS`（代码内第二份） | `tools/lib/traffic.mjs:8` | 与 `risk` 同值 | 兜底额度（`traffic.mjs:13-15` 逐键 Number 覆盖） |
| `POLICY_DEFAULTS` | `tools/lib/publish-policy.mjs:14-21` | review/0/''/self/self/direct | 策略缺省（与 `tank.ts:167` 必须同语义） |
| `minScore` 兜底 13 | `tools/lib/share-policy.mjs:5` | 13 | 标尺 |
| 夜间窗口缺省回退 | `tools/lib/night-plan.mjs:16,79,96,101` | 20:00–24:00 / 10 分 / 0.3 / 5 | 作息 |

dsh 子进程侧（feed/debrief/traffic/night）常量改动 = 下一个子进程即生效，不需重启 Cortico；Cortico/persona-core 侧常量改动 = 必须重启她（还要 `pnpm build:web`，如果动了 `webui/client.ts`）。

### 1.D 人设与文案：它们在文件系统里，页面能不能编辑？

框架有两处入口：`#/prompts` 管理页（`GET/POST /api/prompts`、`/api/prompts/reset`，`src/web/server.ts:2169,2182,2211`）与 Persona 的「工作区/版本历史」面板（`bots/cormini/persona/webUiSurface.ts:19,22`）。清单来源：`bot.ts:335-339`——bot 贡献的 `promptDocs`、Persona `webUi().promptDocs`、以及**每个 World 的 `webUi().promptDocs`（scope='world'）**都会进列表。

| 文件 | 是否被声明为 promptDocs | 页面上能否看到/编辑 | 保存落到哪 |
|---|---|---|---|
| `src/worlds/bili-account/ENV_PROMPT.md` | ✅（`definition.ts:466-473`，key `worlds.bili-account.envPrompt`，role `envPrompt`） | 能看到、能编辑（`#/prompts`，占位符 `{{bili.state}}` 有旁注与校验警告 `prompts/view.ts:47-66`） | **写回仓库源文件**：声明里只有 `path`、没有 `deploymentPath`（`core/types.ts:804-810`，`bot.ts:320,359-363`）→ 改一次就脏一次 git |
| `bots/cormini/persona/PREFIX.md` | 未在本次读到的声明里（`core/prefix.ts:71` 只查 role=envPrompt；prefix 角色存在于 `types.ts:815`） | **待确认**（大概率在 `#/prompts` 列表，因 Persona 也报 prefix 角色模板） | 待确认 |
| `bots/cormini/persona/ENV_SECTION.md` | 同上 | **待确认** | 待确认 |
| `bots/cormini/persona/ORIENTATION.md`（包内默认） | 部署侧同名覆盖已存在：`deployments/mybot/prompts/ORIENTATION.md`（`bots/cormini/index.ts:40 orientationOverrideFile`） | ✅ 覆盖文件可编辑，包内文件只读（`bot.ts:424` 对 package 且无 `deploymentPath` 的模板设 `packageReadOnly`） | 部署 prompts/ |
| `bots/cormini/persona/CONSTITUTION.seed.md`（种子） | 由 `index.ts:37 seedConstitution` 注入 | 种子本身不在页面上 | — |
| `deployments/mybot/workspace/CONSTITUTION.md`（她真正的自述） | 不是 promptDocs，但在工作区面板里 | ✅ 可看可编辑（Persona「工作区」面板，原子写 + 冲突检测，`webUiSurface.ts:31-51`） | workspace（Memory 目录，带 Git 历史） |

结论（本节三条疑问已全部复核，见 §4）：**文案类只有一半看得见**。缺的三件：(a) `ENV_PROMPT.md` 没有 `deploymentPath`，主人改一次就改到 git 源文件；(b) `PREFIX.md` / `ENV_SECTION.md` **不在页面上**——`bots/cormini/persona/persona.ts:332,344` 用 `templateFile()` 直接读包内文件，全仓没有 `role:'prefix'` 的 `promptDocs` 声明，所以这两份"系统前缀骨架"只能改代码包；(c) 她的真实自述 `CONSTITUTION.md` 在 Persona「工作区」面板里（可编辑、有 Git 历史），但和 `ORIENTATION.md` 覆盖分属两个入口，主人不知道哪个才是"她的人格"。

### 1.E 她的身份数据（逐个说明生效时机 + 一致性风险）

| 项 | 位置 | 生效时机 | 一致性风险 / 校验建议 |
|---|---|---|---|
| B站 账号昵称「恐怖深海鱼」 | 账号侧真实值（离线不可知）；本地缓存 `self.name`（用户文件 `:self.name`） | dsh 热（`feed.mjs:247`） | **改了她说的话就跟账号名不一致**：`self.name` 只用于 feed 归类与 selftest 文案，真实昵称以 `nav` 为准（`tools/commands/deps.mjs:34`、`comment.mjs:288`）。校验：设置页保存时跑 `node tools/bili.mjs selftest`（`tools/commands/selftest.mjs:37` 已有"她的身份"一行判定）；**412 时不得把"打不通"报成"名字错了"**，回执要区分 `unknown/unreachable` |
| `self.mid` = 497080562 | 用户文件 | dsh 热 | 同上；mid 错会让 `msgfeed.mjs:13` 的"我自己发的"判定失效 → 她会把自己的评论当别人。校验：`fav.mjs:61` 空 mid 即拒 |
| 她的名字（对宿主而言） | `deployments/mybot/config.json` `displayName` = 小鱼 | 热（core 组 `x-hot:true`） | 页面上已经能改（唯一一处），但与 `persona.name` 各存一份 → 必须让二者同源 |
| `persona.name` / `ownerTitle` / `selfClaim` | 用户文件 | dsh 热 | 与 `displayName` 不一致时，控制台里叫小鱼、动态文案里叫别的。建议：`persona.name` 只做"账号内自称"，默认由 `displayName` 填 |
| `owner.displayName` = 鱼片 | 用户文件 | **重启**（`definition.ts:480` 只在 `start()` 注入一次） | 改完不重启→她继续叫旧称呼。这是"5 处散点"迁移后的新单点（`naming.ts:8-16`，上限 24 字） |
| `naming.ts:8` 的代码默认 `'鱼片'` | 代码 | 重启 | 兜底值；`ownerNameFromConfig` 空值不覆盖（`tank.ts:162` 返回 `''` → `setOwnerName` 保留旧名，`naming.ts:12-14`） |
| `aliases`（历史昵称） | 用户文件，未配 | dsh 热 | 改过 B站 昵称后，旧昵称的 @ 会漏判（`danmaku-await.mjs:73-78`）。建议改名时顺手追加 |
| 头像 | `~/.dsh/bili-whale/avatar.png`（`tank.ts:25` + `avatarBinary` `:287-292`，`deployments/mybot/avatar.png` 是 76358 B 同尺寸副本） | 页面每次读文件 → 换文件即热；但**页面上没有上传/换图入口**（`definition.ts:411-414` 只有 `avatar` 读） | 缺 `path` 配置项：目前路径写死。建议加 `identity.avatarFile`（键名按 `AGENTS.md` 命名规则：文件以 `File` 结尾） |
| 序列帧/立绘目录 | `tools/lib/paths.mjs:LEGACY_IMAGES='D:/AI/养鱼/assets/daily'` + `imagesDir()`（`env WHALE_IMAGE_DIR/WHALE_IMAGES` → legacy-if-exists → home），消费方 `tools/commands/dynamic-image.mjs` | 热（子进程）+ env 需重启 | `home=D:/AI/养鱼` 已把 legacy 路径钉死；`draftsDir()` 同理（`paths.mjs:LEGACY_DRAFTS`，Cortico 侧独立复刻在 `definition.ts:167-168`）→ **两个仓各自判一次 exists，容易分叉** |
| 草稿目录 | `WHALE_DRAFTS` → `D:/AI/养鱼/drafts` → `~/.dsh/bili-whale/drafts`（`paths.mjs:59-64`；Cortico 侧 `definition.ts:167`、`tank.ts:24` 各一份） | 热/重启视路径来源 | 现在三份解析并存（宿主两份 + dsh 一份），改目录必须同时改 env，否则页面上的"待审稿"跟她写的不是同一堆 |

---

## 2. 分组方案：把「设置」做成鱼缸页的第 8 个页签

面板 id `settings`，与现有 7 个面板同机制（服务端 `definition.ts:399-407` 的 `panels` + `invoke`；客户端 `webui/client.ts:403-411` 的 `panels` 注册表；`client.ts` 里每个 mount 都调 `ensureStyle`）。**不许手搓控件绕过 ConfigGroup**：分两半放。

- **A 半（她的世界参数）走 ConfigGroup**：新建 `src/worlds/bili-account/config.ts`，导出 `BILI_ACCOUNT_DEFAULTS` + `biliAccountConfigGroup(language)`（`AGENTS.md` §2 前缀惯例），并在 `definition.ts` 的 `webUi()` 返回体里加 `config: [biliAccountConfigGroup(language)]`（照 `bilibili/world.ts:466`）。这一半的键落在 `deployments/mybot/config.json` 的 `worlds.bili-account.*`，由框架 `#/config` 自动渲染 —— 于是 §1.C 里那些 persona-core / Cortico 侧常量从此有了页面位置，且 `x-hot` 自动给出"需不需要重启"的标记（`config/view.ts:403`：`x-hot:false` 显示"需重启 World"，其余"需重启进程"）。
- **B 半（dsh 运行态配置）走 World 面板**：因为它必须留在 `bili-whale.config.json`（dsh 子进程只认那一份，`config.mjs:12`），不能搬进部署 config。这一半就是本规格的主体。

### 2.1 B 半分 6 组（每项：中文名 / 白话解释 / 控件 / 范围与兜底 / 生效 / 写入 / **谁能改**）

写入目标统一为 `~/.dsh/bili-whale.config.json`（`tank.ts:125` 的 `CONFIG_FILE`），除非另有说明。

**组 1 · 她是谁（身份与称呼）**

| 项 | 白话解释 | 控件 | 范围 / 非法值兜底 | 生效 | 键 | 谁能改 |
|---|---|---|---|---|---|---|
| 昵称（她对外的名字） | 她在动态里叫什么 | 文本 | 1–24 字，空=不改（沿用 `naming.ts:12` 语义） | 重启 | `owner.displayName` 同级新增 `persona.displayName`？否：**直接把 `persona.name` 标为"她在 B站 的名字"** | 主人 |
| 她怎么叫你 | 她嘴里"鱼片/主人"这个词 | 文本 | 1–24 字；非法→拒绝并保留旧值 | **重启**（页上就地打「需重启」标） | `owner.displayName` | 主人 |
| 她怎么自称 | "本小姐 / 我" | 下拉（我 / 本小姐 / 人家 / 自定义） | 自定义 1–8 字 | 热 | `persona.selfClaim` | 主人 |
| 她怎么称呼你（persona.ownerTitle） | 文案里的"主人" | 文本 | ≤8 字 | 热 | `persona.ownerTitle` | 主人 |
| B站 账号昵称（真值校验） | 她账号现在真叫什么 | 只读 + 「去 B站 核对」按钮 | 打不通显示"核不上（未联网）"，**不显示红叉** | — | `self.name` | 主人 |
| 她的 UID | 认自己用的号 | 只读文本（数字，10–12 位） | 非法→拒绝 | 热 | `self.mid` | 主人 |
| 历史昵称 | 改过名后仍认得旧 @ | 列表编辑（可空） | 每项 ≤24 字 | 热 | `aliases` | 主人 |
| 头像 | 页面上那张脸 | 选文件 + 路径显示（不内联上传，先给"复制到这里"的命令） | 必须是 `~/.dsh/bili-whale/avatar.png`（或新键指向的文件） | 热 | `identity.avatarFile`（新增；现写死 `tank.ts:25`） | 主人 |

**组 2 · 她喜欢什么（偏好）**

| 项 | 白话解释 | 控件 | 兜底 | 生效 | 键 | 谁能改 |
|---|---|---|---|---|---|---|
| 爱看 | 命中就加分 | 标签列表（增删改，可拖序） | 空=不加权 | 热 | `preferences.like` | 主人（她只能通过日记/意见箱"说"，不能自己写） |
| 不爱看 | 命中就丢 | 标签列表 | 空=不丢 | 热 | `preferences.dislike` | 主人 |
| 会去搜的词 | 她主动搜片用的词 | 标签列表，**显示"只有前 6 个会被用到"**（`feed.mjs:88`） | 空=不搜 | 热 | `preferences.keywords` | 主人 |

**组 3 · 她的一天（节奏与作息）**

| 项 | 白话解释 | 控件 | 范围 | 生效 | 键/位置 | 谁能改 |
|---|---|---|---|---|---|---|
| 醒着的时间段 | 每天哪几段时间她可以活动 | 多窗口编辑（起 HH:MM、止 HH:MM、该窗内最多几次） | `night-plan.mjs:16`；wakes 1–3（硬上限 3，见 `config.mjs:53` 注释） | 热（dsh 侧）；**Cortico 生活循环不看它**（`tank.ts:284`） | `night.windows` | 主人 |
| 多久看她想不想动 | 3–7 分钟随机 | 两个数字 | 1–60 分钟 | **重启 + ConfigGroup** | `rhythm.ts:65,66` → `worlds.bili-account.rhythm.nextCheckMinMs/MaxMs`（`x-hot:false`） | 主人 |
| 主动找他的基准概率 | `CHECK_PROB` | 数字 0.01–0.5 | 非法→默认 | 重启 | `rhythm.ts:51` → `…rhythm.checkProb` | 主人 |
| 一轮活动的累 | `ACTION_COST_ENERGY` 0.05 | 数字 0.01–0.2 | 非法→默认 | 重启 | `rhythm.ts:60` | 主人 |
| 睡着多久回体力 | `REST_RECOVERY_PER_HOUR` 0.005 | 数字 0.001–0.02 | 非法→默认 | 重启 | `rhythm.ts:58` | 主人 |
| "算睡着了"门槛 | 6 小时 | 数字 2–24 h | 非法→默认 | 重启 | `definition.ts:541` | 主人 |
| 每轮想起来几件事 | 5 条 | 数字 1–12 | 非法→默认 | 重启 | `definition.ts:196` | 主人 |
| 记忆保留多少条 | 200 条 | 数字 50–2000 | 非法→默认 | 重启 | `personaAdapter.ts:131` | 主人 |
| 回信有效期 | 7 天 | 数字 1–30 天 | 非法→默认 | 重启 | `dm-reply.ts:14` | 主人 |
| 日记超过多久不许出稿 | 24 小时 | 数字 6–72 h | 非法→默认 | 重启 | `gates.ts:22` | 主人（**这条会拦她**，必须写明白） |

**组 4 · 她能做什么（发送策略与档位）— 主人专属，页面上加"她看不到也改不了"说明**

| 项 | 白话解释（外行） | 控件 | 范围/兜底 | 生效 | 键 | 谁能改 |
|---|---|---|---|---|---|---|
| 发之前要不要你点头 | 默认要；切"自动"她写好就发 | 下拉：人工审核 / 自动 | 枚举外→`review`（`tank.ts:171`） | **热** | `publish.draftMode` | 主人（切 auto 时页面二次确认，并强制写她私有日记留痕：`definition.ts:449-457`） |
| 自动发每天最多几条 | 0=不限 | 数字 0–20 | 非法→0（`tank.ts:172`；失败尝试也计入，`definition.ts:818`） | 热 | `publish.autoDailyCap` | 主人 |
| 只在什么时段自动发 | 空=全天；支持跨午夜 | 时间窗口 | 非法字符串→不限（`tank.ts:173,181-188`） | 热 | `publish.autoWindow` | 主人 |
| 点赞要不要审 | 自发 / 进待审 | 下拉 | 枚举外→`self` | 热 | `permissions.like` | 主人 |
| 收藏要不要审 | 自发 / 进待审 | 下拉 | 枚举外→`self` | 热 | `permissions.fav` | 主人 |
| 回私信 | 直接回 / 先攒着等你 | 下拉 | 枚举外→`direct` | 热 | `permissions.dmReply` | 主人 |
| 私信最多写多长 | 500 字 | 数字 100–1000 | 非法→500 | 重启 | `dm-reply.ts:33` | 主人 |

**组 5 · 安全绳（风控额度 · kill）**

| 项 | 白话解释 | 控件 | 范围/兜底 | 生效 | 键 | 谁能改 |
|---|---|---|---|---|---|---|
| 每小时看多少次 | 读接口额度 600 | 数字 60–2000 | 非法→`traffic.mjs:13` 逐项 Number 兜底 | 热 | `risk.readHourly` | 主人 |
| 每天看多少次 | 3000 | 数字 500–10000 | 同上 | 热 | `risk.readDaily` | 主人 |
| 每小时写几次 | 12 | 数字 1–60 | 同上 | 热 | `risk.writeHourly` | 主人 |
| 每天写几次 | 30 | 数字 1–200 | 同上 | 热 | `risk.writeDaily` | 主人 |
| 两次写之间隔多久 | 120 秒 | 数字 30–3600 | 同上 | 热 | `risk.writeGapSec` | 主人 |
| 私信写间隔 | 60 秒 | 数字 30–3600 | 同上 | 热 | `risk.dmGapSec` | 主人 |
| 全局最小请求间隔 | 1500 ms | 数字 200–10000 | 同上 | 热 | `risk.minGapMs` | 主人 |
| 每天最多分享几条 | `quota.shareDaily` 3 | 数字 0–20 | 非法→默认 | 热 | `quota.shareDaily` | 主人 |
| kill | 一按全停（写操作全拦） | 开关（现有：文件存在=开，`tank.ts:122`） | — | 立即 | `~/.dsh/bili-whale/control/kill` 文件 | 主人（`runNodeAsync` `definition.ts:279` 直接拒发子进程） |

**组 6 · 提醒与系统**

| 项 | 白话解释 | 控件 | 兜底 | 生效 | 键 | 谁能改 |
|---|---|---|---|---|---|---|
| 有事先通知你 | 弹窗/网页推送/跑一条命令/不通知 | 下拉 + 条件字段（url/topic/template/cmd） | type 未知→`none`（`notify.mjs:48`） | 热 | `notify.*` | 主人 |
| 她要不要写日记 | 开关（`diary.enabled` 读者待确认，先只展示） | 开关 | — | 热 | `diary.enabled` | 主人 |
| 日记要不要一起推送 | 开关（同上待确认） | 开关 | — | 热 | `diary.push` | 主人 |
| 她的家（数据目录） | 草稿/图片/日记落哪 | 只读 + 「改请用环境变量」提示 | 空→`~/.dsh` | 热（子进程）；改 env 需重启 | `home` + `WHALE_HOME/DSH_HOME` | 主人 |
| 监听（评论/私信/直播） | 各开关 + 间隔 + 范围 | 子分组：开关×5 + 数字×2 + 下拉×3 | `listen.*`（`config.mjs:52`） | 热 | `listen.*` | 主人 |
| AI 分享链路的标尺 | `share.*` 6 项；若已不用 ai-share，整组标"疑似停用" | 开关 + 数字 + 下拉 | `share-policy.mjs:5` 阈值兜底 13 | 热 | `share.*` | 主人 |
| 高级：本文件里页面没认出来的键 | 死键清单（`sessionRotateDays`、`personaOncePerSession`、`toolsPath`、`clock.enabled`、`night.maxWakesPerDay`）**逐个给"删掉/留着"两个按钮** | 卡片列表 | 删=从用户文件移除该顶层键 | 热 | 对应顶层键 | 主人 |

### 2.2 「谁能改」这一列的证据（不是假设）

1. **她手上根本没有写配置的工具**。`bili-account` 暴露给她的 13 条工具声明在 `definition.ts:301-315`：`traffic/feed/debrief/diary_read/mood_read/mood_apply/draft_dynamic/diary_append/dm_read/dm_reply/feedback/like/fav`。没有任何一条能写 `bili-whale.config.json`。`describe` 摘要同表（`:988-1002`）。
2. **她的文件工具被锁在 Memory 目录**。Persona（cormini）的 `read_file/write_file/edit_file/append_file/delete_file/move_file/list_files/glob_files/grep_files`（`bots/cormini/persona/workspaceTools.ts:128,145,160,179,192,214,234,249,265`）一律先过 `memory.insideWorkspace(...)` 再 `join(memory.memoryDir, rel)`（同文件 `:70,88,123,405,495,513`）→ 到不了 `~/.dsh/`。她没有 exec/bash 工具（persona 声明里只有 `end_turn`，`persona.ts:75`）。
3. **`bili_diary_append` 写不了配置**：`book` 是枚举 `public|private`，路径在 `definition.ts:853` 写死为两本日记。
4. **`bili_mood_apply` 的自定义效果有硬上限**：只收 7 个原子场、`|delta|≤0.5`、≤8 条，且来源强制 `custom`，不接受模型自报 `masterReplied`（`definition.ts:114-127,707-710`）。
5. **但写入路径本身没有鉴权**：`policySet`（`tank.ts:132-153`）唯一的守卫是 `NODE_TEST_CONTEXT`（`:136`）。7799 免口令时**任何本机进程 POST 一次就能把她切成 auto**——`definition.ts:447`、`ENV_PROMPT.md:11` 都在讲这件事。设置页上线时必须：
   - 写入口径收敛到"带 operator 凭据的路由"（框架已有 `web.password` / `~/.dsh/panel.token`），
   - 每次写入在 `causal` 记 `kind:'config-set'` + `by:'owner'`（复用 `definition.ts:446` 的 `causal()`），
   - 切 auto / 抬 `writeDaily` / 关 kill 这三类额外做二次确认 + 写她私有日记（沿用 `exportPolicyNotice`，`definition.ts:179-189`）。

**明确"她不能放宽"的项**：`publish.*`、`permissions.*`、`risk.*`、`quota.shareDaily`、kill、`dmReply`、`DIARY_STALE_MS`（日记门）。页面上主人可改，工具面永远不声明对应写工具；如需"她可以请求"，走意见箱（`bili_feedback`，`definition.ts:312`）而不是改配置。

### 2.3 需要重启的项怎么标 / 能不能从页面重启她

- 标法（照框架惯例，不新造）：A 半分进 ConfigGroup 后由 `x-hot:false` 自动显示"需重启"（`src/core/config-schema.ts:7,31`；渲染判定 `src/web/client/features/config/view.ts:5,403`）。B 半在设置面板里每项自带 `effective: 'hot' | 'restart'` 元数据，客户端在控件右侧打「需重启她」。已知必须重启的：**`owner.displayName`**（`definition.ts:480` 只在 `start()` 注入）、§1.C 全部 Cortico/persona-core 常量、`web.port`、`worlds.bili-account.enabled`。
- 能从页面触发：框架已有 `POST /api/run/restart`（`src/web/server.ts:1890`）与 `/api/run/shutdown`（`:1881`），但两者都看 `deps.run.supervised`——非监督启动时只回"退出/不可用"文案。现在她是 `scripts/start-cortico.mjs` 以 detached + pid 文件（`~/.dsh/bili-whale/control/cortico.pid`）拉起的，`restart` 到底会不会真的重生成新进程**必须实测**（证伪命令见 §4 挑刺 3）。
  - 规格要求：设置页的"重启她"按钮 = 先 `POST /api/run/restart`；若响应表明非监督（文案含"supervised"类提示），页面降级为**一条可复制命令**：`node E:/WorkSpace_Qoder/dsh-bili-whale/scripts/start-cortico.mjs`（该脚本自身幂等：活着就只发 resume）。按钮旁固定显示提示：**重启前不要跑 `pnpm build:web`；反之 `pnpm build:web` 必须在她停着的时候做**（`Cortico/AGENTS.md` §6：跑着的 WebUI 正在服务被覆盖的 bundle）。

### 2.4 改坏了要能回来

1. **原子写**：沿用 `tank.ts:147-151` 的 tmp+rename，但必须补两点——(a) 写入前 `fs.copyFileSync(file, file + '.bak-' + yyyyMMddHHmmss)`（现存的手动备份 `bili-whale.config.json.bak-20261027` 说明主人已经在人肉做这件事）；(b) 加跨进程锁，复用 `tools/lib/traffic.mjs:34-63` 的 `stateFile + '.lock'` + 10s deadline 模式。理由：dsh 子进程与 Cortico 都在读同一文件，而 `cache` 是进程级的（`config.mjs:65-73`）。
2. **非法值：拒绝而不是静默收敛**。现状 `readPolicyLite` 把非法枚举折回默认（`tank.ts:171-177`）——对主人是坑（写了 `auto5` 结果存成 `review`，还不知道）。规格：新增 `validateConfigPatch()`（建议放在 dsh `tools/lib/config-write.mjs`，供 Cortico 动态 import，同 `tank.ts:39-55` 的 `warm()` 机制），规则为
   - 枚举项：不在白名单 → `400 {error:'「发之前要不要你点头」只认 人工审核/自动'}`，不落盘；
   - 数字项：`Number.isFinite` 且落在声明区间，越界 → 拒绝（不 clamp）；
   - 字符串项：`trim()` 后按 §2.1 上限截断**并回显截断后值**（`naming.ts:12` 的 24 字截断就是"静默"，页面必须显示"已截到 24 字"）；
   - 数组项：每项非空、去重、单项 ≤40 字；
   - 未声明的顶层键：白名单外一律拒绝（避免再把 `sessionRotateDays` 这类死键写回去）。
3. **"恢复默认"的语义 = 写回 `DEFAULTS` 的值，不删键**。三条理由：(a) 用户文件是"所有配置都看得见"的事实源，删了键页面上就只剩默认值，主人看不到自己改了什么；(b) `config.mjs:57-63` 的深合并里"没写"和"写了同样的值"对 dsh 是等价的，但对页面显示不等价；(c) 数组是整体覆盖，删键会**凭空恢复 4 条默认 like/dislike**，主人会以为"我没加过这些"。
   - 交互：每项右侧「改回默认」= 写回 `DEFAULTS[节][键]`；组右侧「整组改回默认」；§2.1 组 6 的死键卡片走**另一个动作**「从文件删掉」（语义不同，必须分开命名）。
   - 全局兜底：设置页顶部一个「打开配置文件看原文」只读视图 + 「导出当前配置为备份」；恢复默认前先落 `.bak-*`。

---

## 3. 落地顺序（每阶段可独立上线）

约定：`build:web` 只在**她停着**的时候跑（`Cortico/AGENTS.md` §6）；只动 `client.ts` 的阶段 = 前端 + 一次 build；动 `definition.ts`/`tank.ts` 无需 build（服务端）；动 `src/web/**` 会撞 `tests/web/acceptance-zero-diff.test.ts` —— 本方案刻意**不碰 `src/web/**`**（§3.5 零差异要求）。

| 阶段 | 内容 | 改动面 | 需要 build:web | 风险 |
|---|---|---|---|---|
| **P0 先补声明（半天）** | ① `tools/lib/config.mjs` 的 `DEFAULTS` 补齐用户文件已有的 14 个缺项（`owner.displayName`、`self.*`、`preferences.keywords`、`publish.*`、`permissions.*`、`notify.topic`、`listen.mentionSummary`、`diary.*`、`clock.enabled`），中性默认值，不含个人信息；② 死键标 `@deprecated` 注释；③ 确认 `diary.enabled/push`、`listen.mentionSummary` 的真实读者，无读者就进死键清单 | dsh 1 文件（+ 可选 `docs/`） | 否 | 低。风险点：`merge` 会用新默认值覆盖语义（数组仍整体覆盖，无影响）；上线后跑一次 `node tools/bili.mjs selftest` |
| **P1 只读总览（1 天）** | `tank.ts` 加 `configSnapshot()`：读用户文件 + `DEFAULTS`，逐项输出 `{节,键,现值,默认值,是否等于默认,生效时机,谁能改}`；`definition.ts` 加面板 `settings`（`getMethods:['state']`）；`client.ts` 加 `mountSettings()` 只读渲染 + 死键区 | Cortico 3 文件（tank.ts / definition.ts / webui/client.ts）+ 新增 `settings` 文案 | **是** | 低。只读，不写盘；风险在 `client.ts` 体积与面板注册（`client.ts:403-411`）。主人当场就能看到全部 60 项 |
| **P2 可写 · 白名单（1–2 天）** | dsh 新增 `tools/lib/config-write.mjs`（`validateConfigPatch` + 锁 + 原子写 + `.bak`）；Cortico `tank.ts` 把 `policySet` 泛化成 `configSet(patch)`，白名单=组 4+5 全部 + 组 1 的 `owner.displayName`；写入记 `causal` | dsh +1 文件、Cortico 2 文件（tank.ts/definition.ts） | 是（若面板控件同步改） | 中。风险：与 dsh 侧 `readPolicy`/`traffic` 双实现漂移（`tank.ts:167` vs `publish-policy.mjs:22`）；对策：写与读都走 `config-write.mjs`，TS 侧只 import 不再镜像。`NODE_TEST_CONTEXT` 守卫必须保留（`tank.ts:136`） |
| **P3 常量入 ConfigGroup（2–3 天）** | 新建 `Cortico/src/worlds/bili-account/config.ts`：`BILI_ACCOUNT_DEFAULTS` + `biliAccountConfigGroup('zh'|'en')`，把 §1.C 的 Cortico/persona-core 常量按 `worlds.bili-account.{rhythm,limits,gates}.*` 声明（时长键带 `Ms/Sec/Minutes`，目录 `Dir`，文件 `File`，上限 `max<Noun>`，见 `AGENTS.md` §2），`definition.ts` 的 `webUi()` 加 `config:[…]`；`rhythm.ts`/`gates.ts`/`dm-reply.ts`/`personaAdapter.ts` 改为接受注入参数（默认值 = 现常量，纯函数签名不变，测试仍可断言导出的默认） | Cortico 6 文件（新 config.ts、definition.ts、rhythm.ts、gates.ts、dm-reply.ts、personaAdapter.ts） | 否（服务端；但若加页签描述则同 P1 一起 build） | 中。风险：`rhythm.ts` 属 `persona-core`，别的世界/测试也在用 → 必须保持"不注入时行为与今天逐字节一致"；`STATE_SCHEMA_VERSION`（`personaAdapter.ts:130`）不动，只加读侧参数 |
| **P4 偏好与文案（1 天）** | 组 1、2 接入写（沿用 P2 的 `configSet`）；给 `ENV_PROMPT.md` 加 `deploymentPath: deployments/mybot/prompts/ENV_PROMPT.md`（`definition.ts:466-473`），首次保存生成部署覆盖；实测 `PREFIX.md`/`ENV_SECTION.md` 是否已在 `#/prompts`（§1.D），缺的补 `promptDocs` 声明（含 `role`） | Cortico 1–2 文件 + 1 个新部署 prompts 文件 | 是（设置页文案） | 中。风险：改 `promptDocs` 声明会让 key 重复检查触发（`extensions/dry-mount.ts:220-221`）；覆盖文件不存在时 `path` 读空（`core/types.ts:804-807`），必须 seed |
| **P5 重启与鉴权（1–2 天）** | 设置页「重启她」按钮 + `/api/run/restart` 探测 + 降级命令文案；写入口加 operator 凭据校验；`config-set` 全部进 `causal` 与（涉及 auto/额度时）私有日记 | Cortico 2–3 文件（definition.ts、tank.ts、webui/client.ts） | 是 | **高**（碰鉴权与进程生命周期）。放最后：前面每步都能独立验收，这步坏不影响配置可见性 |
| P6 收尾 | 序列帧/立绘目录（`identity.imagesDir`）与草稿目录收敛：三份解析（`paths.mjs:59-72`、`definition.ts:167-168`、`tank.ts:24`）统一由宿主显式传 env/`--drafts`；头像换图入口 | dsh 1–2 + Cortico 2 | 是 | 中。改目录会让"页面上的待审稿"与"她写的草稿"换堆，必须同一次发布里一起改 |

---

## 4. 自我挑刺：三条怀疑的复核结果，以及仍未结清的三处

下面三条原本是我这份规格里最可能错的结论，已逐条取证复核（复核用的命令一并留下，主人可自己重跑）。

1. **"页面只能改 6 项"要加作用域：只对 7799（Cortico WebUI）成立。** 复核结果：旧 dsh 独立面板（8447）**确实有设置区**——`dsh-bili-whale/panel/views/tank.html:123` 标题写着「养鱼设置（bili-whale.config.json · 与 DSH/daemon 同一份文件）」，`:221` 把整个 textarea 原文 `POST /api/settings`，另有 `:224 POST /api/persona`、`:226 POST /api/notify-test`。**但那是"一个 JSON 文本框"，不是配置项**：键名、取值、影响面仍要主人自己知道——正是他被拒绝的那种交付。而且它免鉴权、能整份覆写配置文件，比 §2.2 第 5 条更严重的洞。
   → 对规格的影响：主数字不变（7799 上仍只有 6 项可改、54 项只能改文件），但 **P2 必须同时收口 8447 的 `/api/settings`**：要么关掉，要么让它走 `config-write.mjs` 的校验+锁，两处不能各写各的。
   复核命令：`grep -n "养鱼设置\|/api/settings\|writeFileSync" dsh-bili-whale/panel/views/tank.html dsh-bili-whale/panel/server.js`
2. **`PREFIX.md` / `ENV_SECTION.md` 不在页面上（原判断偏乐观，已下调为 ❌）。** 复核结果：两者只被 `bots/cormini/persona/persona.ts:332,344` 用 `templateFile()` 读包内文件；全仓搜不到 `role: 'prefix'` 的 `promptDocs` 声明，而 `#/prompts` 的列表只收 `bot.ts:335-339` 三处 `promptDocs`（bot 贡献 / Persona `webUi()` / 各 World `webUi()`）。于是"她的系统前缀骨架"（哪几块、什么顺序、用什么分隔）在页面上无处调整。
   → 对规格的影响：P4 范围增加一条——给这两份模板补 `promptDocs`（含 `role` 与 `deploymentPath`），或明确降级为"高级：只读展示 + 改文件后需重启"。
   复核命令：`grep -rn "PREFIX.md\|ENV_SECTION.md\|role: 'prefix'\|promptDocs" Cortico/bots/cormini/`；硬证据：`pnpm dev:webui` 打开 `#/prompts` 数列表（不联网）。
3. **"从页面重启她"有现成机制，但按现在的启动方式会退化成"关机"。** 复核结果：`supervised` 来自 `Cortico/src/bot.ts:1075` 的 `isSupervised()`（定义在 `src/boot.ts:19`，从环境变量判）；框架扩展页已有重启按钮并内置两套文案：`src/web/client/features/extensions/index.ts:1462-1475`（`restartNoLoop` / `restartManual`）与 `src/web/strings.*.ts:10` 的 `exitUnsupervised`＝"未检测到启动器循环，需要手动重启"。`scripts/start-cortico.mjs` 是 `detached` 起进程 + 写 pid 文件（`:57-62`），不是启动器循环。
   → 对规格的影响：P5 **不新建按钮**，复用框架既有电源动作与其降级文案；设置页顶部常驻一行「改完这些要重启她：`node E:/WorkSpace_Qoder/dsh-bili-whale/scripts/start-cortico.mjs`」（该脚本幂等：已在跑只发 resume，见 `:33-45`）。
   复核命令：`grep -rn "export function isSupervised" -A 12 Cortico/src/boot.ts`（看它认哪个变量），再对照 `start-cortico.mjs` 传给子进程的 `env` 里有没有它。

**复核之后仍然没结清、会在实现时打脸的三处**（不是已写死的结论，是必须先查的待办）：

- `diary.enabled` / `diary.push` / `listen.mentionSummary` 没找到明确读者——`tools/lib/config.mjs` 的 `DEFAULTS` 里根本没有这三条。要么被 `feed.mjs`/`diary.mjs` 间接消费（我未逐行读 `tools/commands/diary.mjs`），要么就是写进文件没人看的死键。**P0 必须先查实**，否则"恢复默认"会把死键当活键写回。命令：`grep -rn "diary\.push\|diary\.enabled\|mentionSummary" dsh-bili-whale/tools dsh-bili-whale/scripts`。
- 组 3 的"记忆保留 200 条 / 每轮召回 5 条"入 ConfigGroup 后有语义坑：`personaAdapter.ts:130` 的 `STATE_SCHEMA_VERSION = 5` 和 `fields.json` 里已按 200 条尾截写入的历史，改小 = 立刻"忘掉"，不是"以后少留"。改这组前先定"已被截断的历史怎么办"。命令：`grep -n "HISTORY_LIMIT\|STATE_SCHEMA_VERSION" Cortico/src/worlds/bili-account/personaAdapter.ts`。
- §1.B 的"框架侧约 21 项"是带区间的估数：`usage.rates.<code>` 的条数＝`Object.keys(USAGE_RATES).length`，我没数（见 `src/core/config.ts:21-27`）。不影响"54 项只能改文件"这个主数字。命令：`grep -n "USAGE_RATES" -A 12 Cortico/src/core/config.ts`。

---

## 附录 A · 控件与校验对照（可照抄）

- 控件类型只有 5 种：`switch` / `select(enum)` / `number(min,max,step,suffix)` / `text(maxLen)` / `list(maxLen 每项)`。ConfigGroup 侧对应 `type/enum/minimum/maximum/multipleOf/x-suffix/x-hot`（见 `core/config.ts:40-106`、`persona/config.ts:29-61`）。
- 键名规则（`Cortico/AGENTS.md` §2）：时长带单位后缀 `Ms|Sec|Minutes`；目录 `Dir`；文件 `File`；开关在组件对象内叫 `enabled`；上限叫 `max<Noun>`。新增 `identity.*`、`rhythm.*`、`limits.*`、`gates.*` 四节按此命名。
- 每个 number 必须显示：现值 / 默认值 / "改了要不要重启" / "她能不能改"（后者恒为"不能"，除 §2.2 白名单外无例外）。
- 文案禁术语：不出现 ConfigGroup、schema、token、mid（写"B站 UID"）、endpoint（写"推送地址"）、hot-reload（写"不用重启"/"要重启她"）。
