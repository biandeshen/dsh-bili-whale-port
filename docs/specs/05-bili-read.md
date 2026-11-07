# 05 · B 站读路

> 只写成立的机制；案卷在 `docs/attic/`，不作施工依据。

## ① 现在是什么

四路收件箱 + 内容读路两半。

**收件箱**（2026-11-06 才把"节拍器"补回来）：`pullInbox()`（`packages/cap-bilibili/src/client/bili-inbox.ts`）拉
`x/msgfeed/reply|at|like` 与私信（`session_svr/get_sessions` → 只取主人那一个会话 → `svr_sync/fetch_session_msgs`）；
`BiliInboxListener`（`packages/cap-bilibili/src/domain/inbox-listener.ts`）按 `listen.*` 的节奏定时拉，
首轮只建基线、窗口→暂停→间隔（顺序不能调）、连败倍增至 15 分钟封顶、**她自己的私信不叫醒她自己**。
新条目写进 `data/bilibili/inbox-items.json`，并真发 `bili-account.inbox` 事件——这个事件在 describe.json 里声明了很久，此前没有任何生产者。

**内容读路**：`bili_feed` / `bili_search` / `bili_debrief` / `bili_subtitles` / `bili_comments` / `bili_watch`，
凭据现读（`liveCredentials()` 每次读文件，换 cookie 不需重启）。

## ② 真值在哪

| 参数 | 定义 | 配置键 | 面板控件 |
|---|---|---|---|
| `comment` | `packages/cap-bilibili/src/domain/inbox-listener.ts`（`DEFAULT_LISTEN`） | `worlds.bili-account.listen.comment` | 收件箱/设置页 |
| `commentIntervalSec` | 同上 | `listen.commentIntervalSec` | 同上 |
| `dm` / `dmIntervalSec` | 同上 | `listen.dm` / `listen.dmIntervalSec` | 同上 |
| `scope` | 同上 | `listen.scope`（`both` / `reply`） | 同上 |
| `allDay` | 同上 | `listen.allDay` | 同上（**当前是空旋钮，见 ⑤ 第 3 条**） |
| `dislike` / `keywords` | `packages/cap-bilibili/src/client/inbox.ts`（`DEFAULT_WATCH_PREFS`） | 无（落盘为准） | 看片偏好台 |
| `minDurationSec` | 同上 | 无（落盘为准） | 看片偏好台 |
| `sessdata` / `bili_jct` / `buvid3` | `packages/cap-bilibili/src/client/bili-read.ts`（`liveCredentials`） | 部署目录 `.env` | 连接与凭据页 |

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
   它**不是失踪功能**，别再有人去"实现它"。复现：`grep -rn "prefs.like\|preferences.like" packages/cap-bilibili/src | grep -v webui` → 无打分路径；`node scripts/audit-config-migration.mjs` 的 `like` 归到「不动」。
2. **`dislike` 与 `minDurationSec` 只贴标签、不丢弃候选**：`packages/cap-bilibili/src/index.ts:602-607` 只往标题追加 `命中屏蔽词「x」` / `短于N分钟：跳过`，没有 filter/continue/skip。
   她那七轮"门上写着冥想、屋里是游戏广告"的诉求至今写在门上。**主人已拍板不升级成真拦**（2026-11-07 原话："为什么要真拦呢？……这只是个标签而已"），
   所以本条**不是待修的实现缺口**，而是要把"标了词她是否真不看"量化出来：`PrefHitCounters.samples` 字段已有、今天还没有真样本。
   复现（标题拼接处只加字、不筛掉候选）：`grep -n "命中屏蔽词\|短于" packages/cap-bilibili/src/index.ts` ＋ `node --test packages/cap-bilibili/tests/pref-hits.test.mjs`（锁的是"命中要计数"，不是"命中要丢弃"）。
3. **`allDay` 是空旋钮**：`inWindow` 在 bili-account 这侧恒返回"醒着"，所以 `allDay=false` 等价于全天守；今天已把部署值改成与实际一致的 `true`（不再骗人），**接线仍未做**（负责人：本任务；批次 #56/#64）。复现：`grep -rn "inWindow" packages/cortico-world-bilibili/src packages/cap-bilibili/src/index.ts`。
4. **「收到的赞」曾被解析推翻**：真实形状是 `data.latest.items` + `data.total.items`（`data.items[].notices` 是错的），按错形状解永远 0 条，而 0 条看起来像"真没人赞她"。已改并有两条测试。复现：`node scripts/verify-inbox-live.mjs --raw`（真凭据、只读、不写盘、不进存储）。
5. **like / mention 只验了形状，没验过"真有"**：2026-11-06 实读 `at=0 条`、`like=0 条`。
   复现：`node scripts/verify-inbox-live.mjs`（只读探针，真凭据、不写盘；等一次真 @ 或真点赞之后再看它的计数才叫"验过真有"）。
6. **收件箱历史上长期为空**：`data/bilibili/inbox-items.json` 曾恒为 `[]`——不是没人找她，是**没有生产者**（`ingestItems()` 的调用者全仓只剩一个测试）。复现：`node scripts/outward-evidence.mjs --date=2026-11-06` 的账本对照 + `node scripts/token-anatomy.mjs --date=2026-11-06`（当日窗口里没有任何 `bili_*` 回灌）。
7. **探针不要连打四个端点**：本仓探针第二轮连敲触发 `-509`，熔断把请求暂停了（正确行为，但会让随后几分钟的实读全变红）。
   复现：`node -e "const fs=require('fs'),os=require('os'),p=require('path');const f=p.join(os.homedir(),'.dsh/bili-ai/traffic-state.json');const j=JSON.parse(fs.readFileSync(f,'utf8'));console.log('until=',j.until,new Date(j.until).toISOString(),'· last=',JSON.stringify(j.last))"`（`until>now` 就是还在暂停）。
