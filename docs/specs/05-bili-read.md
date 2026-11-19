# 05 · B 站读路

> 只写成立的机制；案卷在 `docs/attic/`，不作施工依据。

## ① 现在是什么

四路收件箱 + 内容读路两半。

**收件箱**（2026-11-06 才把"节拍器"补回来）：`pullInbox()`（`packages/capabilities/cap-bilibili/src/client/bili-inbox.ts`）拉
`x/msgfeed/reply|at|like` 与私信（`session_svr/get_sessions` → 只取主人那一个会话 → `svr_sync/fetch_session_msgs`）；
`BiliInboxListener`（`packages/capabilities/cap-bilibili/src/domain/inbox-listener.ts`）按 `listen.*` 的节奏定时拉，
首轮只建基线、窗口→暂停→间隔（顺序不能调）、连败倍增至 15 分钟封顶、**她自己的私信不叫醒她自己**。
新条目写进 `data/bilibili/inbox-items.json`，并真发 `bili-account.inbox` 事件——这个事件在 describe.json 里声明了很久，此前没有任何生产者。

**内容读路**：`bili_feed` / `bili_search` / `bili_debrief` / `bili_subtitles` / `bili_comments` / `bili_watch`，
凭据现读（`liveCredentials()` 每次读文件，换 cookie 不需重启）。

**看片史标注（2026-11-19 接上，#88 对账补的洞）**：`bili_feed` 的候选标题会带 `近 7 天看过` / `同UP第N条：不深读`。
她 10-30 / 10-31 在私人日记里立的两条规矩（看过的不再深读、同一个 UP 第 N 条不深读），此前**算得出但送不到**——
`annotateFeed` / `recentWatch` 在 `state-store.ts` 里零生产调用者。现在走注入：`recentWatch?: () => {bvs, ups, upCounts}`
由**转接头层**供给（`cortico-world.ts` 用 `watchedFromMemories(loadState(fieldsFile).memories, now, 7)`），
`cap-bilibili` 本身不反向依赖 state-rhythm。读不到就只标偏好、不报错。回执里带 `recentWatch.seenCount` 与 `ups`（前 3 个）。

## ② 真值在哪

| 参数 | 定义 | 配置键 | 面板控件 |
|---|---|---|---|
| `comment` | `packages/capabilities/cap-bilibili/src/domain/inbox-listener.ts`（`DEFAULT_LISTEN`） | `worlds.bili-account.listen.comment` | 收件箱/设置页 |
| `commentIntervalSec` | 同上 | `listen.commentIntervalSec` | 同上 |
| `dm` / `dmIntervalSec` | 同上 | `listen.dm` / `listen.dmIntervalSec` | 同上 |
| `scope` | 同上 | `listen.scope`（`both` / `reply`） | 同上 |
| `allDay` | 同上 | `listen.allDay` | 同上（**当前是空旋钮，见 ⑤ 第 3 条**） |
| `dislike` / `keywords` | `packages/capabilities/cap-bilibili/src/client/inbox.ts`（`DEFAULT_WATCH_PREFS`） | 无（落盘为准） | 看片偏好台 |
| `minDurationSec` | 同上 | 无（落盘为准） | 看片偏好台 |
| `sessdata` / `bili_jct` / `buvid3` | `packages/capabilities/cap-bilibili/src/client/bili-read.ts`（`liveCredentials`） | 部署目录 `.env` | 连接与凭据页 |
| `recentWatch`（看片史注入） | `packages/capabilities/cap-bilibili/src/index.ts`（`BilibiliCapabilityOptions.recentWatch`）← `packages/adapters/cortico-world-bilibili/src/cortico-world.ts`（`watchedFromMemories`） | 无（由 `fieldsFile` 派生） | 无（只体现在候选标题与 `bili_feed` 回执） |
| `fieldsFile` | `packages/adapters/cortico-bot-xiaoyu/src/index.ts`（bot 侧）/ `packages/adapters/cortico-world-bilibili/src/index.ts:139`（world 侧，`definition.create` 里） | 无（`<botDir>/data/persona/fields.json`） | 无（内部账本路径） |

## ③ 失败与边界

- **每一路独立成败**：坏的那路写进 `sourceFails`，事件正文里带「有路数没拉到：reply=code=-352」这样的原话——**"风控拦住"与"真没人找她"必须分开**，两者处置完全不同。
- **空信箱不是失败**：`messages: null` 当"真没消息"处理（旧事故 bb263b8 就是这么误判的）。
- **字段语义不可靠**：`item.title` 不总是别人新写的那句，正文优先级是 `target_reply_content > source_content > title`，要正文得回读楼层（`resolveLatestReply`）。
- **翻页重叠**：cursor 会把同一条报两遍（实测每条出现两次），一律按 key 去重。
- **身份缺失**：拿不到 `selfMid` 时私信这一路**明说跳过**（不猜 mid，否则她自己的回信会把自己叫醒）；补齐纪律是"没凭据一次网络都不敲"（与 07 的同一条规矩）。
- **熔断不绕**：412/-509 时 `guardedFetch` 自行暂停；探针也被它拦下过（`.dsh/bili-ai/traffic-state.json` 的 `until`），没人手工绕过。

## ④ 操作面

监听开关与间隔：面板/设置页改，现读生效（`listenConfig()` 每次取），**不需重启**。
cookie 绑/解/换号：连接与凭据页（见 07）。词表（`dislike` / `keywords`）与时长阈值：看片偏好台，改完落 `data/bilibili/watch-prefs.json`。
读配额余量与安全闸：「安全闸、配额与风控总控台」面板。
**没有面板入口的**：`resolveLatestReply` 的楼层回读深度、`bili_debrief` 的抽帧参数走 08；历史 inbox 的清理只能改文件。

## ⑤ 已知缺陷与验证方式

1. **`prefs.like` 读取点为 0，且这是 by design**——主人 2026-11-06 拍板「我不决定她看什么，想看什么都行」，所以不做加权排序；VISION 里那句"feed 打分权重最高"已按实情改掉。
   它**不是失踪功能**，别再有人去"实现它"。复现：`grep -rn "prefs.like\|preferences.like" packages/capabilities/cap-bilibili/src | grep -v webui` → 无打分路径；`node scripts/audit-config-migration.mjs` 的 `like` 归到「不动」。
2. **`dislike` 与 `minDurationSec` 只贴标签、不丢弃候选**：`packages/capabilities/cap-bilibili/src/index.ts:608-625` 只往标题追加 `命中屏蔽词` / `短于N分钟：跳过` / `近 7 天看过` / `同UP第N条：不深读`，没有 filter/continue/skip。
   （旧的 `annotateFeed`（同文件 :676-682）还留着 `命中屏蔽词「${hitWord}」` 那种带词的写法，但**它零调用者**，线上走的是上面那段。）
   她那七轮"门上写着冥想、屋里是游戏广告"的诉求至今写在门上。**主人已拍板不升级成真拦**（2026-11-07 原话："为什么要真拦呢？……这只是个标签而已"），
   所以本条**不是待修的实现缺口**，而是要把"标了词她是否真不看"量化出来：`PrefHitCounters.samples` 字段已有、今天还没有真样本。
   复现（标题拼接处只加字、不筛掉候选）：`grep -n "命中屏蔽词\|短于\|近 7 天看过\|同UP第" packages/capabilities/cap-bilibili/src/index.ts` ＋ `node --test packages/capabilities/cap-bilibili/tests/pref-hits.test.mjs`（锁的是"命中要计数"，不是"命中要丢弃"）。
3. **`allDay` 是空旋钮**：`inWindow` 在 bili-account 这侧恒返回"醒着"，所以 `allDay=false` 等价于全天守；今天已把部署值改成与实际一致的 `true`（不再骗人），**接线仍未做**（负责人：本任务；批次 #56/#64）。复现：`grep -rn "inWindow" packages/adapters/cortico-world-bilibili/src packages/capabilities/cap-bilibili/src/index.ts`。
4. **「收到的赞」曾被解析推翻**：真实形状是 `data.latest.items` + `data.total.items`（`data.items[].notices` 是错的），按错形状解永远 0 条，而 0 条看起来像"真没人赞她"。已改并有两条测试。复现：`node scripts/verify-inbox-live.mjs --raw`（真凭据、只读、不写盘、不进存储）。
5. **like / mention 只验了形状，没验过"真有"**：2026-11-06 实读 `at=0 条`、`like=0 条`。
   复现：`node scripts/verify-inbox-live.mjs`（只读探针，真凭据、不写盘；等一次真 @ 或真点赞之后再看它的计数才叫"验过真有"）。
6. **收件箱历史上长期为空**：`data/bilibili/inbox-items.json` 曾恒为 `[]`——不是没人找她，是**没有生产者**（`ingestItems()` 的调用者全仓只剩一个测试）。复现：`node scripts/outward-evidence.mjs --date=2026-11-06` 的账本对照 + `node scripts/token-anatomy.mjs --date=2026-11-06`（当日窗口里没有任何 `bili_*` 回灌）。
7. **探针不要连打四个端点**：本仓探针第二轮连敲触发 `-509`，熔断把请求暂停了（正确行为，但会让随后几分钟的实读全变红）。
   复现：`node -e "const fs=require('fs'),os=require('os'),p=require('path');const f=p.join(os.homedir(),'.dsh/bili-ai/traffic-state.json');const j=JSON.parse(fs.readFileSync(f,'utf8'));console.log('until=',j.until,new Date(j.until).toISOString(),'· last=',JSON.stringify(j.last))"`（`until>now` 就是还在暂停）。
8. **看片史标注走了生产入口才被证明（2026-11-19，#88）**：`tests/feed-watch-chain.test.mjs` 从两边**真入口**跑——
   她那边 `createXiaoyuBotDefinition().build()` → `declareSessions()[0].tools()`（闸门 + Cortico 形状），
   世界那边 `WorldDefinition.create()`；全程离线、零凭据、不起 `start()`。
   做法：先删掉 `fieldsFile` 那一行，测试两例俱红；恢复即绿——证明它靠的是那行，不是巧合。
   复现：`node --test tests/feed-watch-chain.test.mjs`。
9. **两条装配路曾经给出两个她（已修，2026-11-19）**：全仓只有 `definition.create`（宿主走的那条）给了
   `credentialsFile` / `judgmentFile` / `fieldsFile`；`createBiliWorldAdapter`（宿主无关那条）一个都没给，
   而且这条函数**此前零测试**。症状不响亮：凭据永远空（写动作要等被前置条件拒才发现）、看片史永远不标。
   现在两处共用 `botPaths(botDir)` 一处推导，`tests/world-adapter-wiring.test.mjs` 两条（adapter / definition.create）
   各验一遍"凭据读得到 + 近 7 天看过标得上"，并做了变异检查（停用 adapter 那段 → 只有 adapter 那条变红）。
   复现：`node --test tests/world-adapter-wiring.test.mjs` ＋ `grep -n "botPaths" packages/adapters/cortico-world-bilibili/src/index.ts`。
10. **`recentWatch` 的类型声明曾经写错地方（已修，2026-11-19）**：原来声明在 `BilibiliReadHandlers`
   （读侧回调表）里，实际消费点却是 `opts.recentWatch`——`readHandlers.feed` 存在时 `bili_feed` 直接返回，
   根本走不到标注段，所以那份声明是"没有任何代码会读"的死声明。已挪到 `BilibiliCapabilityOptions`。
   这类错本仓**没有任何门禁能拦**（无 tsconfig / 无 tsc 脚本），只能靠人读到。复现：
   声明现在应只在 `BilibiliCapabilityOptions` 里——
   `node -e "const t=require('fs').readFileSync('packages/capabilities/cap-bilibili/src/index.ts','utf8');const rh=t.slice(t.indexOf('interface BilibiliReadHandlers'),t.indexOf('interface BilibiliCapabilityOptions'));console.log('ReadHandlers 里有:',/recentWatch/.test(rh))"`（应为 `false`）。
