# 能力面盘点（能力席 · 2026-11-03）

只读盘点，未改任何代码，未联网。所有数字来自 2026-11-03 本机实测。

**三个数**：CLI 命令 **43** · 她的工具 **18** · Cortico 侧无生产调用方的命令 **32**（其中 25 条连 dsh 侧也没有调用方，整条能力是死的）。

## 0. 实测命令（数字都现跑）

| 数字 | 命令 |
|---|---|
| CLI = 43 | `node tools/bili.mjs help` → `sed -n '/^命令:/,/^$/p' \| grep -E '^  [a-z]' \| wc -l` = 43。事实源是 `tools/bili.mjs:10-57` 的 `map`，键数与 help 输出逐条一致 |
| 工具 = 18 | `node -e "readFileSync('tool-decls.ts').match(/name: '(bili_[a-z_]+)'/g)"` = 18（`Cortico-up/src/worlds/bili-account/tool-decls.ts:30-49`，`DECLS.length`=18，`TOOL_SUMMARIES` 18 条） |
| `bili_comment`/`bili_danmaku` = 0 | `grep -rn "bili_comment\|bili_danmaku" Cortico-up/src/` → 0 命中 |
| Cortico 侧 0 调用方 = 32 | 见 §1「生产调用方」列的判定规则与逐条证据（11 条有 + 32 条无 = 43） |
| 两仓都 0 = 25 | 同上，dsh 侧也算进去 |

**装配关系**：`tool-decls.ts` 只出 schema；`definition.ts:556-1031` 的 `tools()` 按下标 `mk(DECLS[n], handler)` 装配 18 个。改工具 = 改 DECLS 数组 + 改下标引用。

**「生产调用方」判定标准**：在 dsh 运行路径（`core/`、`panel/`、`adapters/`、`scripts/`、`tools/commands/`、`tools/lib/`）或 Cortico `src/` 里**真的把该命令当命令调起来**（`runAsync` / `execFileSync` / `spawn` / import 兄弟脚本）。**提示词字符串里提到某命令不算调用方**（`core/scheduler.js` 里大段 `node bili.mjs xxx` 只是给人看的操作指引）。

**本表三种标记与「32」的对应关系**：
- ✅（11 条）= Cortico 侧有 CLI 级调用方 → 不计入 32。
- ⚠️（3 条：watch-video / diary / dynamic）= Cortico 侧**没有**调用这条 CLI，但**有等价能力**（`bili_look` 读抽帧产物；`bili_diary_read/append` 直接读写日记文件；出稿与发布走 `scripts/draft-dynamic.mjs` + `scripts/dynamic-approve.mjs`）→ **计入 32**。
- ❌（29 条）= Cortico 侧既无调用方也无等价能力 → 计入 32。

32 = 3 + 29。

**dsh 侧另有一条平行链路**：`core/scheduler.js` 是 dsh 旧 CLI 宿主的调度器，它自己 `pullFeed` 收件箱、自己 spawn 命令。这条链与 Cortico World **互不相通**：Cortico 的 World 不 import `core/`，dsh 也不 import Cortico。本表的「生产调用方」列把它单列，因为主人今天跑的是哪条链，本轮没有证据（见 §5-1）。

---

## 1. 完整能力矩阵（43 条 CLI 全覆盖）

| # | CLI 命令 | 它做什么（一句话） | 她的对应工具 | 生产调用方（grep 证据） | 主人能在 WebUI 操作 | 缺什么 | 优先级 |
|---|---|---|---|---|---|---|---|
| 1 | `traffic` | 读请求预算/熔断状态，人工核查后恢复 | `bili_traffic` | ✅ Cortico `definition.ts:559`（`runAsync(['traffic','status'])`）。dsh 侧各写命令 import 的是 `tools/lib/traffic.mjs`（闸模块，同名非 CLI） | ✅ 能看（灯 + 体征页额度条）；「人工核查后恢复」无按钮 | 恢复按钮 | P2 |
| 2 | `session` | 确认凭据属于哪个 B 站号 | 无 | ❌ 两仓 0 | 只能看（政策页名字行有 `host`/`remote`，不是 session） | `bili_session` 或并入 `bili_capabilities` | P2 |
| 3 | `thread` | 导出一条评论的完整楼中楼结构 | 无 | ❌ 两仓 0 | 不能 | `bili_thread`（读） | P2 |
| 4 | `check-comment` | 按 rpid 复核评论是否存在 | 无 | ❌ 两仓 0 | 不能 | `bili_check_comment` | P2 |
| 5 | `check-dynamic` | 看动态的结构化内容（类型/图片/节点） | 无 | ❌ 两仓 0 | 不能 | `bili_check_dynamic` | P2 |
| 6 | `check-mention` | 确认动态里的 @ 是不是真提及（查 opus 页） | 无 | ❌ 两仓 0 | 不能 | `bili_check_mention`（与「@我的」入站配套） | P1 |
| 7 | `watch` | 盯一条评论的楼中楼等新回复 | 无 | ❌ 两仓 0 | 不能 | `bili_watch` | P2 |
| 8 | `comment-await` | 评论版「叫我起床」：守「回复我的」，命中即退出叫醒 agent | 无 | ❌ 两仓 0（只有它自己） | 不能 | 工具 + 她的入口（§2） | **P0** |
| 9 | `comment-digest` | 「回复我的」+「@我的」两个收件箱汇总（只读） | 无 | ❌ Cortico 0。dsh `tools/commands/quota.mjs:211`（`execFileSync comment-digest.mjs --json`）——只用来数主人回了几条 | 不能 | `bili_comment_digest`（读） | **P0** |
| 10 | `recon` | 发评论前的侦查：BV→aid + 评论区状态 + WBI 材料 | 无 | ❌ 两仓 0 | 不能 | `bili_recon` | P1 |
| 11 | `video` | 不点开视频也能还原它讲什么（简介/字幕/弹幕/评论） | 无 | ❌ 两仓 0 | 不能 | `bili_video`（`bili_debrief` 只覆盖同类内容，可不做） | P2 |
| 12 | `subtitles` | 拉官方字幕全文（带时间戳） | 无（间接：`bili_debrief` 内部 `debrief.mjs:140` 直接打 `x/player/wbi/v2` 取字幕，不走这条 CLI） | ❌ 两仓 0 | 不能（`bili_look` 给的是字幕条**图**，不是全文） | `bili_subtitles` | P2 |
| 13 | `watch-video` | 取直链→下载→ffmpeg 抽帧拼九宫格 | 间接：`bili_look` 只读已存在的图 | ⚠️ Cortico 0；dsh `tools/commands/debrief.mjs:276-281`（`execFileSync bili-watch.mjs`）→ 她调 `bili_debrief` 时这条路会跑 | 不能 | `bili_watch_video` 或让 `bili_look` 触发抽帧 | P2 |
| 14 | `debrief` | 看懂一条视频一条龙：封面+简介+字幕+弹幕热区+热评+抽帧 | `bili_debrief` | ✅ Cortico `definition.ts:571-592` | 不能（只有她能跑） | 主人自己跑一条视频的入口 | P2 |
| 15 | `ai-share` | 分享前评论抽样与模型评估 | 无 | ❌ Cortico 0；dsh 侧 `tools/commands/comment.mjs:1` 与 `comments.mjs:1` import 的是 `tools/lib/ai-share.mjs`（共享模块），**CLI 本体无调用方** | 不能 | `bili_ai_share` | P2 |
| 16 | `comments` | 热评 / 最新评论（只读，匿名可读） | 间接：`bili_debrief` 内部 `debrief.mjs:184` 直接拉 `comment.bilibili.com/{cid}.xml`，不走这条 CLI | ❌ Cortico 0；dsh `tools/commands/ai-share.mjs:26`（`execFileSync comments.mjs --json`） | 不能 | `bili_comments` | P2 |
| 17 | `feed` | 选题器：照「爱看」捞候选，默认排除已看项 | `bili_feed` | ✅ Cortico `definition.ts:560-570` | 不能 | 手动触发一轮的入口（§3-7） | P2 |
| 18 | `quota` | 限额闸（status/check/record/set/allow） | 无 | ❌ Cortico 0。dsh 侧额度闸是 `tools/lib/quota-gate.mjs`（被 comment/danmaku 调用）；`quota` CLI 本身无外部调用方 | ✅ 能看（体征页四条额度条，`tank.ts:475` `vitalsState`） | `quota set --daily N` / `allow` 的页面控件 | P1 |
| 19 | `likes` | 谁赞了她（「收到的赞」通知流） | 无 | ❌ Cortico 0。dsh `tools/commands/quota.mjs:226`（`execFileSync likes.mjs --owner --json`）——只用来算「主人赞过什么」 | 不能 | `bili_likes`（读） | **P0** |
| 20 | `selftest` | 启动测试（配置/凭据/登录态/目录/ffmpeg） | 无 | ❌ 两仓 0（`core/scheduler.js:131` 只在提示词里提） | 不能 | `bili_selftest` 或设置页「体检」按钮 | P1 |
| 21 | `deps` | 依赖体检（cookie/ffmpeg/Node/数据目录） | 无 | ❌ 两仓 0（`core/scheduler.js:138` 同上） | 不能 | 同上 | P1 |
| 22 | `diary` | 她的一天：show/log/tail | `bili_diary_read`（只读）+ `bili_diary_append`（写） | ⚠️ Cortico 侧**不走 CLI**：直接读写 `whale-diary.md`（`definition.ts:597-637` 读、`:797-822` 写）。CLI 的 `diary show/log/tail` 两仓 0 | ✅ 能看（世界页「日记」页，两本全文） | `diary log`（结构化事件落盘）在 Cortico 侧无等价入口 | P2 |
| 23 | `notify` | 通知分发（stdout/file/webhook/command） | 无 | ❌ Cortico 0。dsh `core/api/routes.js`、`tools/commands/comment.mjs`、`ai-share.mjs`、`reply-draft.mjs`、`tools/lib/report.mjs` | ❌ 不能（`config.notify` 只在配置总览里显示可改，但 Cortico 链路里没人调 `notify`） | `bili_notify`，或把「自主发言必须报备」接进 Cortico 事件通道 | **P0** |
| 24 | `night` | 生物钟：plan/clock/mark/status | `bili_alarm`（持久队列闹钟，机制不同） | ❌ 两仓 0 | ✅ 能设（`bili_alarm`），不能列/不能取消 | 闹钟列表 + 取消按钮 | P2 |
| 25 | `search` | 按关键词搜视频（WBI 签名） | 无 | ❌ 两仓 0 | 不能 | `bili_search` | P2 |
| 26 | `covers` | 抓视频元信息 + 封面图存到 covers/ | 无（`bili_look` 只读已有封面） | ❌ 两仓 0 | 不能 | `bili_covers` | P2 |
| 27 | `whois` | 按 mid 查昵称（@ 人前核准名字） | 无 | ❌ 两仓 0 | 不能 | `bili_whois`（@ 人前置条件） | P1 |
| 28 | `dm-await` | 私信监听（只认主人；命中打印 DM_HIT） | `bili_dm_read` | ✅ Cortico `definition.ts:824`（`dm-await --json --peek`）、`:838`、`:856`（`--ack`） | ✅ 能看（私信回信走待审稿页 dm 队列） | 无（这条是入站主干，已通） | — |
| 29 | `fav` | 收藏（五判据强制、每天 3 条上限） | `bili_fav` | ✅ Cortico `definition.ts:917-928` | ❌ 不能（收藏没有列表页） | 收藏清单页 | P1 |
| 30 | `like` | 点赞（轻表态，同视频 30 天不重复） | `bili_like` | ✅ Cortico `definition.ts:906-916` | ❌ 不能（看不到点赞账） | 点赞记录页 | P1 |
| 31 | `dm` | 私信（一天锁 1 个收信人；只发主人；必须互关） | `bili_dm_reply` | ✅ Cortico `definition.ts:861-884` → `dmAutoPlan` 产出 `['dm','--msg',t,'--go']`（`dm-reply.ts:79`） | ✅ 能看（`drafts` 页 dm 队列 + 放行/拒） | 无 | — |
| 32 | `dm-draft` | 回信草稿队列（只入队不发送） | `bili_dm_reply` 的回退路径 | ✅ Cortico `definition.ts:880` | ✅ 能看（`drafts` 页 dm 项） | 无 | — |
| 33 | `comment` | 发一条视频评论（带 --root/--parent 即二级回复） | **无** | ❌ 两仓 0。`tools/commands/comment.mjs:100-110` 已实现 `permissions.comment` 档位（默认 `review` → `queueGo` 进 `pending-replies.json`） | ❌ 不能 | `bili_comment` 工具 + 一个能显示 `pending-replies.json` 的页签 | **P0** |
| 34 | `reply-draft` | 待审回复队列（add/list/drop/take） | 无 | ❌ 两仓 0 | ❌ 不能 | `bili_reply_draft` + 页签 | **P0** |
| 35 | `comment-del` | 删除自己发的一条评论 | 无 | ❌ 两仓 0 | 不能 | `bili_comment_del`（写，需二次确认） | P1 |
| 36 | `dynamic` | 动态：recent/post/rm/check | `bili_draft_dynamic`（只出草稿，不发） | ⚠️ Cortico 侧**不走 CLI**：出稿走 `scripts/draft-dynamic.mjs`（`definition.ts:759`），发布走 `scripts/dynamic-approve.mjs`（`:783`）→ `tools/drafts/publishers/bilibili-dynamic.mjs` 自己 POST。CLI 的 `dynamic recent/post/rm/check` 两仓 0 | ✅ 能放行/拒掉草稿 | **「她发过的动态列表」页面**（`dynamic recent` 无对应）；`post/rm/check` 也无工具 | P1 || 37 | `dynamic-image` | 发图文动态（上传图片 + 可带 @节点） | 无 | ❌ 两仓 0 | ❌ 不能 | `bili_dynamic_image` | P1 |
| 37 | `dynamic-image` | 发图文动态（上传图片 + 可带 @节点） | 无 | ❌ Cortico 0；dsh `tools/commands/dynamic-image.mjs:4` import 的是 `tools/drafts/publishers/bilibili-dynamic.mjs`，**CLI 本体无调用方** | ❌ 不能 | `bili_dynamic_image` | P1 |
| 38 | `dynamic-edit` | 编辑已存在的动态（文字/图片，id 不变） | 无 | ❌ Cortico 0；dsh 侧只有 `tools/commands/edit-dynamic.mjs` 自己 | ❌ 不能 | `bili_dynamic_edit` + 页面上「改稿再发」 | **P0** |
| 39 | `feedback` | 她的意见箱：add/list/resolve（本地文件，不联网） | `bili_feedback` | ✅ Cortico `definition.ts:885-905`。dsh `panel/feedback.mjs`（import 同一模块） | ✅ 能看 + 能标已解决（`definition.ts:256`） | 无 | — |
| 40 | `judgment` | 她的判断卡：add/list（采纳只有面板能点） | `bili_judgment` | ✅ Cortico `definition.ts:1013-1030` | ✅ 能看 + 能采纳/驳回（`definition.ts:262-271`，唯一采纳通道） | 主人手写词表只以「冲突 N 条」出现，**看不到内容也改不了**（§3-6） | P1 |
| 41 | `rename` | 改 B 站昵称（真实账号写） | 无（是页面能力不是工具） | ✅ Cortico `definition.ts:314`（`rename --status`）、`:332`（`rename --to … --go`）——只在世界页政策页被调 | ✅ 能改（政策页「改 B站昵称」，二次确认） | `--dry` 预览入口 | P2 |
| 42 | `danmaku` | 直播间弹幕：pre/send/history/live | **无** | ❌ 两仓 0。`tools/commands/danmaku.mjs:96-105` 已实现 `permissions.danmaku` 档位（默认 `review` → `queueGo`） | ❌ 不能 | `bili_danmaku` 工具 + 待审页签 | **P0** |
| 43 | `await` | 直播间「叫我起床」：出现该回的弹幕就退出 | 无 | ❌ Cortico 0；dsh `core/scheduler.js:584`（spawn `danmaku-await.mjs`）——dsh 旧宿主链路 | 不能 | `bili_danmaku_await` | P2 |

**统计**：Cortico 侧有 CLI 生产调用方的 **11** 条（traffic / feed / debrief / dm-await / dm / dm-draft / like / fav / feedback / judgment / rename）；其余 **32 条 0 调用方**（含上表 3 条⚠️——它们只有等价能力，CLI 本身仍无人调）。这 32 条里 7 条在 dsh 侧还有 CLI 级调用方（comment-digest ← `quota.mjs:211`；likes ← `quota.mjs:226`；notify ← `core/api/routes.js:294` 等 5 处；quota ← `lib/quota-gate.mjs:15` + `comment.mjs:68`；comments ← `ai-share.mjs:26`；watch-video ← `debrief.mjs:276`；await ← `core/scheduler.js:584`），**25 条在两仓都 0 调用方**——整条能力在这套系统里是死的。

---

## 2. 入站四路的实测状态

| 路 | 实现有没有 | 调用方有没有 | 她能不能感知 | 主人能不能看 |
|---|---|---|---|---|
| **私信** | ✅ `tools/commands/dm-await.mjs` + `tools/lib/dm-history.mjs` | ✅ Cortico `definition.ts:824`（`bili_dm_read` → `dm-await --json --peek`）、`:856`（`--ack`） | ✅ 收到新私信后加 `connection` 场值 + 写一条记忆（`definition.ts:842-849`）；`bili_dm_reply` 可直发 | ✅ 待审稿页的 dm 队列（`panel/drafts.mjs:48-61` 收集 `dm-drafts.json`） |
| **回复我的** | ✅ `tools/lib/msgfeed.mjs` 的 `pullFeed('reply')`（`msgfeed.mjs:30`）+ `tools/commands/comment-digest.mjs` / `comment-await.mjs` | ❌ **Cortico 侧 0**。dsh `core/scheduler.js:478` 确实 `pullFeed('reply', …)`，但那是 dsh 旧 CLI 宿主链路，**Cortico World 完全不读这条路** | ❌ | ❌ 无收件箱页 |
| **@我的** | ✅ `tools/lib/msgfeed.mjs` 的 `pullFeed('at')`（同文件）+ `comment-digest.mjs:8` | ❌ **Cortico 侧 0**。dsh `core/scheduler.js:480` 在 `scope!=='reply'` 时拉 at，同属旧宿主链路 | ❌ | ❌ |
| **收到的赞** | ✅ `tools/commands/likes.mjs`（`GET x/msgfeed/like`，`likes.mjs:41`） | ❌ **Cortico 侧 0**。dsh `tools/commands/quota.mjs:226` 会调它——只为了数「主人赞了什么」 | ❌ | ❌ |

**「msgfeed 无调用方」这条判断要修正**：它不是完全无人调用。`grep -rn msgfeed E:\WorkSpace_Qoder`（排除 node_modules）显示——`tools/commands/comment-await.mjs:23`、`tools/commands/comment-digest.mjs:18`（两个 CLI 命令在用）、`core/scheduler.js:26`（dsh 旧调度器在用）、`Cortico-up/src/**` **0 命中**。**真正无人调用的是 Cortico World 这条生产链路**。

---

## 3. 主人操作缺口清单

| # | 他今天做不到的事 | 要什么才能做到 |
|---|---|---|
| 1 | **看收件箱**（谁回复了她、谁 @ 了她、谁赞了她） | ① 只读工具 `bili_inbox`（或分别 `bili_comment_digest` / `bili_likes`），内部调 `comment-digest` / `likes`；② WebUI 加「收件箱」页签，或体征页放「未读回复/@/赞」计数。`msgfeed.mjs` 已能用，只差接线 |
| 2 | **让她发评论** | ① `bili_comment` 工具（`bvid`/`message`/可选 `root`/`parent`）；② 走 `permissions.comment='review'` 默认档 → `queueGo` 进 `pending-replies.json`；③ **一个能显示 `pending-replies.json` 的页签**——`tools/lib/pending-queue.mjs` 有 `listPendingQueue/releaseOne/dropMany`，但 `grep -rn "listPendingQueue\|pending-queue" panel/ Cortico-up/src/` = **0 命中**，队列在任何 UI 里都看不见 |
| 3 | **让她发弹幕** | ① `bili_danmaku` 工具（`pre`→`send` 两步，`permissions.danmaku='review'` 进同一队列）；② 同一个待审页签要能显示弹幕条目；③ 直播房间号从哪来要定（`config.listen.liveRoom`，实测本机配置里存在该键） |
| 4 | **看 / 改她的记忆** | ① WebUI 加「记忆」页签，或把 `fields.json` 的 `memories` 渲染出来——现在 `tank.ts:160` `tankLocal()` 只返回 `fields` + `mood`，**不含 `memories`**；② 改记忆要一条主人可点的写通道（今天只有 `bili_memory_void`，而且只有**她**能调） |
| 5 | **看判断结果** | 部分已有：世界页「判断卡」页签能看卡 + 采纳/驳回。缺的是**判断在 feed 上实际产生了什么**——`tools/commands/feed.mjs:324` 只在 stdout 打印「avoid N 词 / prefer N 词 / 冲突 N 条」，`tools/lib/feed-quality.mjs:39` 的 `hits` 不落盘、不回 WebUI，Cortico 侧无任何工具能读到这次 feed 的命中详情 |
| 6 | **看词表与命中** | ① 主人手写词表在 `~/.dsh/bili-whale.config.json` 的 `preferences.like/dislike`（实测本机：`like` 5 条、`dislike` ≥7 条）；Cortico 侧只把它当配置总览里「口味词表」分组的标量行，**看不到词条之外的命中情况**；② 需要「偏好与命中」视图：当前生效词表 + 最近一次 feed 的命中词 + 被拦下的原因。`feed-quality.mjs` 的 `hits` 要落盘并暴露 |
| 7 | **手动触发一轮** | 今天唯一入口是环境变量 `BILI_ACCOUNT_FORCE_ACTION=1`（`definition.ts:506`，要重启进程），**WebUI 没有任何按钮**。需要：World 暴露「立即跑一轮」方法 → 「鱼缸」页签加按钮 → 跑 `mood_read → traffic → feed → debrief → 日记 → draft_dynamic → mood_apply` 这条链（`definition.ts:511` 已有现成提示词文本） |
| 8 | **改稿再发** | ① `dynamic-edit`（`tools/commands/edit-dynamic.mjs`）能改已发动态，但**没有工具**；② 更常见的「草稿改完再发」被 `scripts/dynamic-approve.mjs:50-56` 的**正文哈希校验**卡死：入队后改稿 → 哈希不符 → 拒。需要在「待审稿」条目上给一个编辑框（改草稿源文件 → 重新入队取新令牌），以及 `bili_dynamic_edit` 处理已发动态 |

### 3b. 两个「已补但实际没通」的发现（与既有说法冲突，证据如下）

**发现 A：评论/弹幕档位在页面上改不了。**
`webui/client.ts:474-475` 建了 `selComment` / `selDanmaku` 两个下拉，`:482` 把它们写进保存补丁，`:639` 把现值回填。但 `client.ts:541-553` 的 `card.body.append(...)` **没有 `ui.field('评论档位', selComment)` 也没有 `ui.field('弹幕档位', selDanmaku)`**——两个控件从未挂进 DOM。走通用配置格也不行：`tank.ts:264` `DENY_PREFIX = ['publish.', 'permissions.']` 把 `permissions.comment`/`permissions.danmaku` 排除在 `settingsSet` 之外，而 `tank.ts:193` `POLICY_KEYS` 又把它们标成 `editVia:'policy'`（页面标注「在上方发送策略里改」），可那个「上方」正好没有它们。
→ **结论：档位在页面上只读不可改。** 状态行 `client.ts:636` 会显示 `评论=${p.comment} · 弹幕=${p.danmaku}`，值本身在配置文件里（实测 `~/.dsh/bili-whale.config.json:115-116` = `review`/`review`），但主人改不了。**P0。**

**发现 B：档位放开也没有放行按钮。**
`permissions.comment/danmaku = 'review'` 时，`tools/commands/comment.mjs:104-110` 与 `tools/commands/danmaku.mjs:102-103` 都走 `queueGo` → `tools/lib/pending-queue.mjs` 的 `pending-replies.json`。该模块导出了 `listPendingQueue`（`:38`）、`releaseOne`（`:72`）、`releaseMany`（`:96`）、`dropMany`（`:126`），**但没有任何 UI 渲染它**（`panel/` 与 `Cortico-up/src/` 两侧 grep = 0 命中）。「待审稿」页签只收两类：`panel/drafts.mjs:31`（动态稿目录）与 `:50`（`dm-drafts.json`）。→ **即使她有了评论工具、档位设成 review，主人仍然没有地方点「放行」。P0。**

---

## 4. WebUI 现有页签与每页能改什么

事实源：`Cortico-up/src/worlds/bili-account/definition.ts:219-228`（页签声明）+ `webui/client.ts`（面板实现）+ `tank.ts`（数据面）+ `config-store.ts`（配置读写）。

| 页签 id | 标题 | 能做什么 | 能改什么 |
|---|---|---|---|
| `tank` | 鱼缸 | 头像、当前心情与成因、6 条场值条（体力/刺激/想念/社交/好奇/创作）、状态描述；20 秒轮询 | **只读** |
| `drafts` | 待审稿 | 列**动态草稿**与**私信回信**两类队列；每条可「✓ 放行发布」「✗ 拒掉」（拒可带理由 → 她会收到 `draftRejected`）。20 秒轮询 | **能放行/拒掉**（改发布状态）；**不能编辑正文**；**不含评论/弹幕条目** |
| `timeline` | 她的一天 | 因果链事件表（时间/事件/谁/内容），可「加载更早」翻页 | 只读 |
| `diary` | 日记 | 公开本与私人本全文 | 只读 |
| `feedback` | 意见箱 | 列出她报的问题（severity 徽标 / 日期 / 是否已绕开 / 是否已解决），可「标已解决」 | **能标已解决** |
| `judgment` | 判断卡 | 列出她提的卡（stance 徽标 / 词 / 作用域 / 理由 / 状态）；顶部一行显示 feed 现在按什么筛（含「与你手写词表冲突 N 条」）；待采纳的可「采纳」「驳回」（驳回要填理由，理由回到她的账上） | **能采纳/驳回**（唯一采纳通道）；不能改词、不能删 |
| `policy` | 发送策略 | ① 草稿档位（review/auto）、auto 每日上限、auto 时段；② 点赞/收藏/回信三个档位（**评论/弹幕两个下拉存在但未挂载**，见 §3b-A）；③ 本机名字与 B 站昵称分开改（B 站那次是真账号写，二次确认，走 `rename --go`）；④ 「全部配置」折叠总览：配置文件里每个标量一项一格，按现值类型给控件（开关=二选一、数字=数字框、名单=逗号分隔、通知渠道=下拉），标「这一格可改 / 在上方发送策略里改 / 只能改文件 / 改后要重启 / 未声明默认值」 | **能改**：三个可见档位、auto 三项、两个名字、配置总览里除 `home`/`toolsPath`/`publish.*`/`permissions.*` 外的全部标量 |
| `vitals` | 体征 | 今日动态条数、今日评论条数、积压项、读/小时·读/天·写/小时·写/天 四条额度条、风控暂停提示 | 只读 |

**页面没有的**：收件箱（回复/@/赞）、记忆、点赞账、收藏清单、词表与命中详情、手动触发一轮、评论/弹幕待审、`pending-replies.json` 队列、草稿编辑框、订阅/搜索/字幕/视频页。

---

## 5. 我不知道 / 证据不足的地方

1. **主人今天跑的是哪条生产链**：dsh 旧 CLI 宿主（`core/scheduler.js`）与 Cortico World 是两条互不相通的链路。dsh 侧 `comment-digest`/`likes`/`notify`/`await` 都有调用方，Cortico 侧都没有。我没有找到「dsh 旧宿主本机是否还活着」的证据——这决定了 §1 里 dsh 侧的调用方算不算「她能用」。
2. **判断卡「采纳后 feed 真按它筛」在 Cortico 侧是否真的生效**：`tools/commands/feed.mjs:51-52` 读 `activeJudgments()` 并合并进 dislike，`bili_feed` 确实调 `feed` 命令——**链看起来是通的**，但我没实跑一次 feed 验证已采纳的卡真的改变了候选（不联网，未实测）。
3. **「全部配置」总览的实际覆盖面**：`tank.ts:251` 读 `readJson(CONFIG_FILE)`，`config-store.ts:20` 定义 `CONFIG_FILE = process.env.BILI_WHALE_CONFIG || path.join(WHALE, 'bili-whale.config.json')`——**`WHALE` 指向 `C:\Users\Administrator\.dsh`**，与本轮 grep 到的 `~/.dsh/bili-whale.config.json` 是同一份，但我没验证运行时 `WHALE` 的实际取值。`declared` 标记还依赖 `mods.cfg.DEFAULTS` 是否预热成功，预热失败时所有项会被标成「未声明默认值」。
4. **记忆到底有几条、能不能被主人改**：本轮没读 `fields.json` 实际内容（同目录另一篇 `03-memory-unify.md` 说 60 条 memories / 68 条 chain）——本篇没有独立复核这个数字。
5. **`permissions.comment` / `permissions.danmaku` 改完是否对 CLI 立即生效**：`comment.mjs:104` / `danmaku.mjs:102` 每次调用现读 `readPolicy(config())`，看起来是即时的，但我没实跑验证（而且页面上改不了，见 §3b-A，这条路今天走不通）。
6. **MCP 适配器那条路**：`adapters/opencode/mcp-stdio.js` 把整个 CLI 包成一个 `bili` 工具（等于「她什么都能干」），但那不是 Cortico 的 World 工具面，我没确认这个适配器本机是否还在用。
7. **`bili_capabilities` 答不了主人这个问题**：`capability.ts` 只列「此刻可调的工具 + 已装扩展 + 部署开关」，**不含 CLI 命令清单，也不含「哪条命令有/没有调用方」**——所以她自己也说不清"那么多东西"里哪些是死的。
8. **直播弹幕的入口条件**：`danmaku` 需要房间号（`config.listen.liveRoom`）+ 限额闸白名单 `room:<房间号>`（`danmaku.mjs:105-107`）；本机配置里 `listen.live` 默认为 `false`（`tools/lib/config.mjs:50`），实际运行时值我没查。
