# 席位四：B 站内容生产与外部工具链

数据基线：仓库 `E:\WorkSpace_Qoder\dsh-bili-whale`（HEAD `a617b62`）；数据目录 `C:/Users/Administrator/.xiaoyu-home/xiaoyu/data/`。本席只读，未调用任何写接口/7799/B 站。三档标记：**[已验证]**=有落盘凭据或代码原文可查；**[仅自述]**=文档/日志声称但未核到执行；**[无证据]**=搜过但未实现。

---

## ① 核心判断

1. **「她想发 → B 站真多了一条内容」这条链，只有一环拿到过真实回执，而且是旧路径留下的。** `causal.jsonl` 里唯一一次真实发布 `auto-publish ok:true`（2026-11-02T17:26:33Z）内嵌了完整回执：`HTTP 200 code=0` + `image_url=http://i0.hdslb.com/bfs/new_dyn/…png 1024x1536` + `✅ 已发布 dyn_id=1266164923068579846` + `https://t.bilibili.com/1266164923068579846`。**[已验证]**（数据文件真实值）。但当前源码里 **搜不到任何 `auto-publish` 事件的产生处**（`grep -rln "auto-publish" packages core` → 0 命中，见命令记录），说明这条真实回执来自一个已被删除/重构的旧发布路径，不在新交付的「统一闸门」链路上。

2. **最近交付的 WriteGate「统一待放行队列」在产线上零真实写回执——只有测试。** 判据三条并发：① `causal.jsonl` 里 `"kind":"dynamic"`（WriteGate.execute 成功必写这一 kind）计数 = **0**；② `WriteGate.execute` 成功路径写的 `dynId:` 字段全文件计数 = **0**；③ 写闸自己的 `data/bilibili/traffic-state.json`：`lastWriteAt:0`、`seenFingerprints:[]`（这两个值非日切重置，只有成功写过才会置位）。**[已验证]**（代码 `write-gate.ts:649-664` + 数据实况）。即新架构 = 代码+测试，产线无痕迹。

3. **账号绑定操作面「存在且当前已绑定」，这与「旧架构有 /api/cookie、新架构是否有等价能力」的疑问相反——有。** `connection` 面板有 get/bindCookie/unbindCookie 三个方法（`index.ts:1317-1352`，注释明写「旧 /api/cookie 的能力复位到这里」）。凭据落 `…/xiaoyu/.env`，当前 `BILI_SESSDATA` 值长 222、`BILI_JCT` 32、`BUVID3` 46（脚本按长度测量，未回显值）。**[已验证]**。换号不需重启（`liveCredentials` 每次现读文件）。

4. **内容质量闭环在「她自己发的东西效果如何」这一侧根本没接线。** 全仓读到的播放/点赞/粉丝数字，要么是别人视频（`bili-debrief.ts` 的 `stat`），要么是别人账号（`bili-profile.ts whois` 的 `fans`）；`bilibili-audience/ledger.json` 是空壳（`{viewers:{}, openStream:null}`）。**[无证据/未实现]**。结论：**她发了，但她不知道自己发得怎样**。

5. **读配额面板口径与真护栏是同一个数（对得上）；但 usage.jsonl 与读配额无关，拿去核会是错的。** `read-quota.ts` 读的是护栏账 `~/.dsh/bili-ai/traffic-state.json` 的 `accounts[].readDay/readHour`，上限 600/3000——护栏 `traffic.mjs` 用的也正是这两个数。**[已验证]**（同一文件）。而 `usage.jsonl` 7676 条 **全是 `model:mimo-v2.6-flash`**（`grep -oE '"model":"[^"]*"' | uniq -c` → 7676 全同），是 **LLM token 账**，不是 B 站读接口计数，二者不同账本。

---

## ② 链路逐环证据表（环 / 位置 / 档位 / 凭据）

| 环 | 实现位置 | 档位 | 凭据 |
|---|---|---|---|
| 内容生成（候选稿） | `WriteGate.requestNewDraft`/`onDraftRequested`（`write-gate.ts:512`）；候选由模型产出 | **模型候选**（非执行完成） | `causal.jsonl` `draft-result` 记 `dyn-20261103-9aca38 → result:sent`；生成本体走 mimo（`usage.jsonl` 7676 条），属内心活动不认作完成 |
| 草稿/待放行队列 | `WriteGate.enqueue`→`data/bilibili/pending-queue.json`（`write-gate.ts:407`） | **代码+测试** | `pending-queue.json` 实值 = `[]`；默认 `policy.draftMode:"auto"`（`policy.json`）故常态不入队。测试 `auto-publish-tiers.test.mjs` |
| 人工放行 | `WriteGate.release`（`write-gate.ts:453`，含过期再确认 stale:339） | **代码+测试+1 条历史回执** | `causal.jsonl` `draft-result-consumed applied:["draftApproved"]`（11-02）；`write-gate.ts:453-493` |
| 上传/提交（动态） | `executeDynamic`（`bili-write-extra.ts:42`，type=4 纯文本，走 `guardedFetch`） | **旧路径真实回执；新闸门路径=仅测试** | 11-02 `auto-publish` 回执（见①1）；新 `WriteGate` 无 `kind:dynamic` 成功（①2） |
| 上传/提交（图文/带图） | 动态纯文本无图；带图 opus/draw **无验过形状**（`bili-write-extra.ts:36-41` 自述） | **未实现** | 注释明写「带图/带长文的形状…没有验过的请求形状，不在这儿编一个」 |
| 上传/提交（评论/弹幕/赞/藏） | `executeComment/Danmaku/Like/Fav`（`bili-write.ts:219-340`） | **代码+测试** | 单测 `bili-write.test.mjs`；产线 `fav` 有 1 条 11-01 但无平台 code（见下），`comment/danmaku` 无回执 |
| 上传/提交（私信） | `executeDmReply`（`bili-write-extra.ts:159`） | **仅自述** | `causal.jsonl` `dm-out/dm-auto-sent`（10-31/11-01）只记 `toMid/charLen/inboundKey`，**无平台 msg_id/code 回执**；`fav` 同理只记 `bvid` |
| 回执与状态回写 | `writeCausal` 成功写 `{kind,dynId,rpid}`（`write-gate.ts:658`）；队列项→`status:released`（`:489`） | **代码+测试**（产线动态 kind 0 条） | `dynId:` 全文件 0 命中；released 迁移逻辑在 `release()` |
| 失败重试与配额 | 412→30min 熔断（`write-gate.ts:636-643`）；`guardedFetch` 指数退避+超时（`traffic.mjs:150,168`）；读预算超限抛 `TrafficError`（`traffic.mjs:122`） | **代码+1 条真实风控命中** | `bili-ai/traffic-state.json` 实况 `reason:"HTTP 200 / code -509"`、`streak:1`、`until:…`、`riskEndpoint:"/session_svr/v1/session_svr/get_sessions"`——真实风控回退 **[已验证]** |

---

## ③ 账号绑定与凭据管理现状 + 可行手工路径

**绑定面（存在，已验证）**：`connection` 面板（`index.ts:1317-1452`）
- `get`：登录体检，只给指纹（sha1 前 6 位，`bili-read.ts:161`）+ `checkLogin`(nav) 探当前号 + `lastKnown` 上次绑定。
- `bindCookie`（POST，需 `confirm:true`）：粘 cookie → `parseCredentials` 解析 → **先向 B 站 nav 验身份，验不过一个字节不写**（`index.ts:1386-1400`「先验后写」）→ `saveCredentials` 落盘 → 写 `identity.selfMid` + 连接记录。**[已验证]**。
- `unbindCookie`（POST，需 `confirm:true`）：`saveCredentials(file,{sessdata:'',bili_jct:'',buvid3:''})` 删这三键、其他键不动、`delete identity.selfMid`（`index.ts:1434-1449`）。

**凭据存储**：`credentialsFile = path.join(botDir,'.env')`（`cortico-world-bilibili/src/index.ts:132`）→ 实文件 `C:/Users/Administrator/.xiaoyu-home/xiaoyu/.env`。
- 格式：`BILI_SESSDATA=/BILI_JCT=/BILI_BUVID3=` 一行一个（`bili-read.ts:183-208`），**保留文件其他行**；写时 mode `0600`（Windows 忽略）、先备份 `.pre-bind-<ts>`、再 `renameWithRetry`（`:210-220`）。
- 读优先级：**进程 env `BILI_SESSDATA` > 文件**（`liveCredentials`/`envFirst`，`:145-158`）。故若同名 env 变量存在会盖过文件——手工排错时注意。
- 值只进文件，不进日志/返回/异常（`describeCredentials` 只回指纹）。**[已验证]**。

**解绑换号的可行手工路径（按成本从低到高，均为只读观察所得，本席未执行）**：
1. 面板连接页粘新 cookie →「校验通过才写」→ 自动更新 selfMid，**不需重启**（换号即时生效，`liveCredentials` 每次现读）。
2. 直接改 `…/xiaoyu/.env` 的三行 `BILI_*=`（无面板时）。改后不需重启；但 **env 里若也设了同名变量会压过 .env**（`bili-read.ts:148-156`）。
3. 解绑=连接页 unbindCookie，或删 .env 三行；删后她退回匿名、写闸会挡下她的对外动作。

**未核到**：`readConnectionRecord(dataDir)` 写的「上次绑定是谁」记录文件——`find data -iname "*connect*"` 未命中，**[假设/未核实]**（只影响展示，不影响绑定功能）。

---

## ④ 外部依赖失败行为矩阵

| 依赖 | 缺失/异常时的行为 | 抛错 / 静默 / 污染账本 | 证据 |
|---|---|---|---|
| ffmpeg 缺失 | `render.ts` 合成前置 `if(!ffmpeg) return fail('找不到 ffmpeg…')`；能力面板 `ffmpegReady:false` 且页面挂「找不到 ffmpeg，出不了片」黄条 | **返回 fail（不静默、不 throw 崩）** | `render.ts:137-138`；`cap-media-studio/src/index.ts:138-139`；`webui/client.ts:32,36-37` |
| TTS 缺凭据 | 能力面 `tc.tts.mimoKey==='missing'` → 显示「缺凭据」 | 展示层可见；**具体 TTS 调用处是否抛错未逐一核**（仅看到状态位） | `cap-media-studio/src/webui/client.ts:33` **[仅自述/代码]** |
| B 站 412 风控 | WriteGate：置 `pausedUntil=now+30min`+`pauseReason`，写 `…-failed stage:transport reason:http_412`，返 `exit:4 cooldown` | **降级不污染**：失败单独记 `-failed`，不扣额度 | `write-gate.ts:636-643` |
| B 站 -509 / 退避 | `guardedFetch` 记 `streak`+`until` 指数退避（上限 30min），`AbortSignal.timeout(30000)` 兜超时 | 真实命中在账里（`until/streak/reason`） | `traffic.mjs:168,150`；实况 `-509`（见①1） |
| 读配额耗尽 | 护栏 `throw TrafficError('已达到本地读取预算…')`；面板 `read-quota` 报 `exhausted`+`resetsAt`（恢复点） | **抛错**（明确失败，非静默跳过） | `traffic.mjs:122`；`read-quota.ts:139-160` |
| 护栏状态文件损坏 | `TrafficError('请求保护状态损坏…已停止网络请求')` | **抛错并全线停网** | `traffic.mjs:37` |
| Windows EPERM 改名 | `renameWithRetry` 对 `EPERM/EACCES/EBUSY` 退避重试 8 次（`25*(n+1)ms`），**非这三类错误立即 break**；`atomicWriteFile` 同款 8 次（`persona-core/atomic-write.ts:42-50`）。8 次后仍失败→`saveCredentials` catch 返 `{ok:false,error}` | **不掩盖真失败**：有界重试+最终显式回错，非静默吞 | `bili-read.ts:35-48,221-223`；`atomic-write.ts:36-50` |

对「偶发故障兜法会不会掩盖真失败」的判断：EPERM 重试 **只针对占用类错误**、有 8 次上限、耗尽后仍显式报错并落 `…-failed` 回执——**不会把真失败洗成成功**。唯一需盯的是 `atomicWriteFile` 终态失败是否残留 temp 文件（见⑥）。

---

## ⑤ 最该先做的 3 件事

1. **把「真实写回执」补上可核验的 `msg_id/rpid/code`**：现在私信/收藏的 `causal` 只有意图（`toMid/charLen`、`bvid`），动态唯一真回执还来自已删的旧路径。执行器（`executeDmReply`/`executeFav`）已能拿到 `j.code`/`meta`，但没进账——把平台 `code` 与返回 id 落进 `writeCausal`，才符合本仓「真实活动完成只认实际执行回执」。
2. **接通自己发布内容的效果回读**（补一个 own-channel/own-dynamic stat 读）：目前 `debrief`/`whois` 只读别人。至少把 `dyn_id`/`bvid` 的 view/like/comment/fans 变化拉回来、写进 `bilibili-audience`（现在是空壳），她才知道发得怎样、才谈得上用效果调下一步。
3. **收敛写侧两套额度口径**：`quota.json` 现 `selfCap/shareCap=99`，而护栏 `writeDaily=30/writeHourly=12`（`traffic.mjs:8`）实际生效更小；面板只显读配额。要么统一，要么把「写侧真实上限=护栏那份」显出来，别让 99 变成又一个空旋钮。

---

## ⑥ 我没查清的东西

- `readConnectionRecord` 落盘文件未找到（`find` 0 命中）——绑定历史是否真持久化，**未核实**。
- TTS 缺凭据时 `render.ts`/`mimo` 调用点到底抛错还是返空：**只看到状态位**，未追到调用处代码原文。
- `atomicWriteFile` 8 次重试耗尽后的终态（temp 文件是否残留/是否 swallow）：读了重试主体，**未读最终 return/throw 分支**。
- 「新闸门是否已接入实际发布触发器、还是发布仍走另一条 auto-publish 线」：`grep auto-publish` 在源码 0 命中，强烈暗示旧路径独立于 `WriteGate`，但**未逐行确认当前运行时发布触发链**（禁写/禁重启限制下无法跑一遍取证）。
- `risk.json`（覆盖 600/3000 的配置）是否存在于 `~/.dsh/bili-ai`：`read-quota.ts:107-111` 兜默认，**未核是否有覆盖值**。
