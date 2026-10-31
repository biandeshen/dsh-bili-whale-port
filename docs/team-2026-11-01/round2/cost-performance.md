# 小鱼 · 第二轮研究 · 成本与性能席

产出：成本与性能分析（只读研究，不改代码）。数据截至 2026-11-01 凌晨，观察窗口 2026-10-26 ~ 10-31。
所有数字标注来源；初稿已按第 14 拍前要求落盘，后续修订只动本文。

## 1. 一天的真实开销

### 1.1 LLM 调用（来源：`Cortico/deployments/mybot/data/usage.jsonl` 逐条聚合，与 WebUI `GET /api/usage` 序列一致）

| 日期 | 行动回合(runs) | LLM 请求数 | 输入 tokens | 其中缓存命中 | 未命中输入 | 输出 tokens |
|---|---|---|---|---|---|---|
| 10-26 | 15 | 67 | 886,032 | 830,336 (93.7%) | 55,696 | 5,883 |
| 10-27 | 15 | 32 | 1,235,411 | 1,107,072 (89.6%) | 128,339 | 5,022 |
| 10-28 | 3 | 25 | 646,448 | 542,464 (83.9%) | 103,984 | 2,290 |
| 10-29 | 32 | 72 | 2,880,188 | 2,487,936 (86.4%) | 392,252 | 8,524 |
| 10-30 | 3 | 68 | 3,169,717 | 2,908,928 (91.8%) | 260,789 | 19,343 |
| **10-31（活跃日）** | **9** | **109** | **11,431,652** | **10,479,488 (91.7%)** | **952,164** | **32,356** |
| 合计（6 天） | ~99 个 run 目录 | 373 | 20,249,448 | 18,356,224 (90.6%) | 1,893,224 | 73,418 |

- 一次"行动回合"= 一个 run，实测每 run **8–12 次 LLM 请求**（usage.jsonl 中 run→请求数，如 `r-20261031-203135-aaa1`=12、`r-20261031-200202-e5ca`=8）。
- **平均每请求输入 ≈ 54K tokens（10-31 当天 ≈ 105K/请求），平均输出仅 197 tokens**。输入/输出比 ≈ 353:1（10-31）。会话历史逐轮重放是绝对大头，但 `opencode-go` 前缀缓存命中率 90.6–91.7%，把重放压成了缓存读。
- 真金白银的"新输入"（cacheMiss）10-31 为 952K tokens/天，输出 32K/天。
- 费用：日志显示 `"cost":0`，走本地/代理网关（opencode-go 记账 `list_cost` 示例单请求 0.00061 USD）。若按 list 价折算 10-31 全天约 **0.07 USD/天量级**——钱不是瓶颈，**网关吞吐、延迟与本地 CPU 驻留才是**。
- 缓存膨胀证据：末次请求 promptTokens 已达 **141,438**（其中 cacheHit 141,056），逼近 `context.maxTokens=256000, keepRatio=0.333`（`deployments/mybot/config.json`），说明压缩/淘汰机制在兜底，但会话文件 `session-main.jsonl` 592KB、`runs/` 3.3MB 仍在涨。

### 1.2 B 站请求（来源：`~/.bili-ai/traffic-state.json`、`~/.bili-ai/api-requests.log`）

- 10-31 全天主账号（3d4a…）**readDay=165、writeDay=1**；配额上限 read 600/h、3000/天（`tools/lib/traffic.mjs:8` RISK_DEFAULTS），**实际用量仅为配额的 5.5%/天，远未触顶**。
- 全窗口 `api-requests.log`：**NET 202 次 / HIT 66 次**（缓存拦截率仅 24.6%）。按端点分：
  - `/x/web-interface/nav` **NET 120 次（占全部 NET 的 59%）**——最大重复来源；
  - `/x/player/wbi/v2` NET 29；`/x/v2/reply` NET 27；`/x/web-interface/wbi/view` NET 23。
- nav 缓存 TTL 仅 **10 分钟**（`tools/lib/bili-api.mjs:49` `NAV_TTL_MS`，理由：wbi 密钥轮换）。观察序列（10-31 日志）：每个 debrief 触发一次 nav NET + 两次 HIT，节奏 ≈ 每轮一次。

### 1.3 进程与轮询

- 生活循环每 **3–7 分钟**一次评估（`persona-core/src/rhythm.ts:128` `nextCheckDelay`；启动日志 `life loop armed（每 3–7 分钟…）`，`cortico.log 20:31:36`）。多数评估轮 → 直接产出一次 run（8–12 次 LLM 请求）。
- 常驻：Cortico 宿主（node）+ WebUI(7799) + 面板(8448) + `scripts/action-watch.mjs`、`scripts/day-watchdog.mjs`；每次工具调用再 fork 一个 Node CLI 子进程（`tools/commands/*.mjs`）。**进程 RSS 本机实测取不到**（tasklist 过滤无输出、无历史采样埋点）；数量级判断：宿主 + 3 个脚本常驻约 4 个 node 进程，每进程 100–300 MB 量级，子进程短命但每个要全量 parse 5.9MB 的 api-cache（见 W5）。
- 生活循环 tick 本身是本地计算（`definition.ts:472` 调 `decideAction`，启发式，不必然产生 LLM 请求）；实际 LLM 开销集中在"想做点什么"触发的 run（10-31 全天 9 个 run、109 次请求，即 run 均 12 次请求）。
- **取不到的数据（缺埋点）**：① 每次 tick 的决策分布（行动/继续待命，日志无计数）；② 工具级 token 归因（usage.jsonl 只到请求粒度，无 per-tool 分摊）；③ 子进程峰值内存与图片/字幕落盘日增量（`~/.dsh/bili-whale/media` 现 8.2MB、`feed/` 144KB，未做按日统计）。建议补"每 run 一行 cost record"埋点。

## 2. 浪费点排序（证据 → 原因 → 省法 → 代价 → 预计节省）

**W1｜feed/debrief 各自裸取 nav，绕过缓存 —— 最肥的重复读**
- 证据：`api-requests.log` 全窗口 `/x/web-interface/nav` **NET 120 次，占 NET 总数（202）的 59%**。`feed.mjs:57` 用 `guardedFetch` 直取 nav（该路径不经过 `bili-api.mjs` 缓存）；`debrief.mjs:69` 虽走 `apiGet`，但 `NAV_TTL_MS = 10 分钟`（`bili-api.mjs:49`），生活循环 3–7 分钟一轮（`rhythm.ts:65-66`），每轮 TTL 基本已过期 → 每 run 1–2 次 nav NET。
- 现在为什么这么做：nav 携带 wbi 签名密钥，官方会轮换，作者按"最保守 10 分钟"设 TTL；feed 的 nav 是历史遗留直连。
- 省法：feed 的 nav 改走 `apiGet`；NAV_TTL 放宽到 30–60 分钟（实测密钥轮换频率远低于此，轮换失败时回退强刷一次即可）。
- 代价：**零**（纯机械缓存，不碰人格）。
- 预计节省：约 **15–18 次读请求/天**（≈ 全天 B 站读的 10%），每 run 少 0.5–1s 网络往返。

**W2｜同一视频重复 debrief，四路全量重抓**
- 证据：`runs/*/toolcalls.jsonl` 聚合，22 次 `bili_debrief` 中 **20 个唯一 BV**：`BV12S4y1A782` 10-26/10-27 各一次、`BV1Sw41187j4` 10-29/10-30 各一次，且两次 receipt 均 1783 字符（输出逐字节相同 → 纯重复劳动）。`debrief.mjs:92-115` 封面下载、字幕拉取**无 `existsSync` 短路**（字幕其实已落盘 `shots/subs/<bvid>-debrief.txt`），弹幕 XML（:130）与热评（:201）每次都重抓。
- 现在为什么这么做：弹幕/热评确属动态内容，缓存规则（`bili-api.mjs:42`"只缓存静态元信息"）禁止缓存它们——规则本身生效（HIT 全部集中在 nav/view/player），但封面/字幕这类**发布后即静态**的资产被误伤，连带动态部分一起重抓。
- 省法：封面/字幕按 bvid 落盘复用（存在即跳过网络，加 `--refresh` 例外）；对 48h 内已 debrief 的 BV，默认只增量刷弹幕+热评两路。
- 代价：几乎为零；她"重看老视频有新弹幕"的体验靠弹幕/热评增量保留。
- 预计节省：debrief 网络请求约 **-25%**（22 次 × 2 路 ≈ 44 次静态抓取），消除逐字节相同的整轮重复（每月约 2–3 个无效回合）。

**W3｜feed 每轮四路全量拉 + 全池重排**
- 证据：`toolcalls.jsonl` 中 26 次 `bili_feed`，**平均耗时 9,256 ms/次**（合计 240.7s 纯等待）；receipt 显示默认来源即"搜索 + 热门 + 排行 + 关注"（feed.mjs:131-167）。搜索路有缓存（`feed.mjs:96-111`，`feed-search-cache.json` 仅 7 键/上限 40，工作正常），但 **popular/ranking/following 三路裸 fetch 无 TTL**（:135/:142/:150），且 :270-272 每轮对全池重打分重排。
- 现在为什么这么做：热门/排行本身小时级变化，作者选择"每次现拉保新鲜"。
- 省法：popular/rank 加 30–60 分钟文件缓存；following 每 2–3 个 run 拉一次即可；候选池快照（feed 已写快照行 :314-315）命中时只做增量重排。
- 代价：她"发现新热视频"的时效从 ≤7 分钟变为 ≤1 小时——**观察影响很小**（她的行动频率本就低于轮询频率）。
- 预计节省：feed 读请求 **-3 次/轮**（约 27 次 feed → 全窗口 -81 次），feed 平均耗时 9.3s → 3–4s。

**W4｜`bili_traffic` 独立工具每轮被调用，查一个远未触顶的额度**
- 证据：26 次调用、平均 912 字符/次（合计 23.7K 字符进上下文）；而 `traffic-state.json` 显示 10-31 readDay=165 / 3000（**用量 5.5%**），写 1/30。额度几乎从不构成约束，她却每轮"看一眼余额"。
- 现在为什么这么做：把额度当行为护栏，让模型自觉节制——设计意图正当，但执行成了每轮例行体检。
- 省法：额度摘要并入 feed/debrief receipt 头部一行（"今日读 165/3000"），仅当越过 50%/80% 阈值时才作为独立提醒注入。
- 代价：零，节制人格仍在（阈值触发反而更像"人注意到紧巴巴"）。
- 预计节省：约 **-24K 字符/窗口**（每 run 少一次子进程 + 900 字符），少一类工具声明的调用惯性。

**W5｜`api-cache.json` 无界膨胀，每个 Node 子进程冷启动全量 parse**
- 证据：文件 **5.87 MB / 25 键**（≈235KB/条，`bili-api.mjs:30`；feed-search 缓存有 40 键上限，api-cache 未见剪枝）。debrief/feed 每次 fork CLI 子进程都要 read+parse+回写整个文件。
- 省法：按条数/字节上限 LRU 剪枝；大 payload（view 全量 JSON）落独立键文件。
- 代价：零。
- 预计节省：每个工具子进程毫秒级→省 100–300ms 启动 + 内存峰值从 ~2×5.9MB 降到 <1MB（对 11G 显存/32G 内存的机器是数量级安全，但消除毛刺延迟）。

**（次级）** `bili_diary_read` 平均 **7,780 字符/次**、17 次共 132K 字符，是单次工具输出最大块（见 §3）；`console_send` 16 次、`end_turn` 71 次属正常。取不到的数据：工具调用无逐条 LLM token 归因（缺 per-tool cost record 埋点）。

## 3. 上下文体积（她每轮被喂多少）

10-31 平均每 LLM 请求输入 **104.9K tokens**（= 11.43M/109，usage.jsonl），按中英混合 ≈1.5 字符/token 折算 **约 15–16 万字符/请求**，但其中 **91.7% 是缓存命中的会话历史重放**，真正"新长出来"的是每轮 tool receipt + 注入段。拆开看：

| 注入块 | 体积 | 证据 | 评价 |
|---|---|---|---|
| ORIENTATION.md | 3,502 B | `deployments/mybot/prompts/` | 该花：人格锚，全缓存命中 |
| CONSTITUTION.md | 1,011 B | `mybot/workspace/` | 该花 |
| describeState（情绪+场值+5 条因果+3 条记忆） | ≈0.5–1K 字符/轮 | `personaAdapter.ts:325-332`，截断规则齐全 | 该花且已克制 |
| annotateFeed | ≈0.2K | `personaAdapter.ts:341-351` | 设计正确 |
| **会话历史重放（含历轮 tool 输出）** | **~140K tokens 封顶**（末次请求 141,438；`config.json` maxTokens 256K、keepRatio 0.33） | usage.jsonl 末条 | 最肥块①：缓存后钱不多，但**每轮首 token 延迟随历史线性涨** |
| **bili_diary_read 全文尾** | **7.8K 字符 × 17 次** | toolcalls.jsonl 聚合 | 最肥块②：单工具最大注入，日记只增不折 |
| debrief 六路报告 | 1.4K 字符/次 × 22 | 同上 | 已高度压缩（六路→1.4K 是好样板） |

**压缩方案（保人格）**：① 历史重放——把 keepRatio 压缩从被动触发改为每 run 结束时主动"入睡前整理"（把当日 tool 细节压成日记，diary 即压缩层，这正好符合她的记忆观）；② `bili_diary_read` 默认返回"昨日 400 字 + 近 7 天各一句 + 按需全文"；③ fields.json 因果链已截 200 条（`personaAdapter.ts:131`），注入只用 5 条，无需动。

## 4. 降配/升配选项

| 选项 | 省多少 | 坏什么 | 判定 |
|---|---|---|---|
| 模型换更小/更便宜的 | ≈0 真金（网关 cost=0，list 价全天 ~0.07 USD 量级，usage.jsonl `list_cost`） | 人格一致性、长会话follow-through 直接受损 | **不换**。她的成本瓶颈是延迟与重复 I/O，不是推理单价 |
| 评估频率 3–7min → 8–15min | run 数近似减半（10-31 为 9 run/天），LLM 请求 ~-50% | 对私信/回信响应变慢；"间歇性想动一动"的节奏感是人格的一部分 | **慎动**。建议只对夜间降频（day-watchdog 已有作息概念），白天保留 |
| W1–W5 纯浪费清理 | B 站读 -30~40%、feed 等待 -60%、每 run 少 1 子进程 | 无 | **全做**，与人格零冲突 |
| 日记入睡前主动压实 | 历史重放增速放缓，长 run 首 token 延迟下降 | 若压实丢失细节会伤回忆真实感——保留"原文按 bvid/日期可回读"即可 | 值得试点 |
| 升配（埋点） | 不省 | — | **加 per-run cost record**（LLM 请求数、cacheMiss、B 站 NET/HIT、子进程时长各一行），当前缺工具级 token 归因与进程 RSS 采样 |

## 5. 该花的 vs 白花的

| 类别 | 项 | 定性 |
|---|---|---|
| 该花 | 3–7 分钟生活循环的本地评估（CPU-only，不触发 LLM 就不算钱） | 像人的成本，保留 |
| 该花 | 每 run 8–12 轮的多工具 agent 会话、ORIENTATION/CONSTITUTION/describeState 注入 | 人格表现力本体，缓存已把重放压到 0.07 USD/天量级 |
| 该花 | debrief 六路互补（1.4K 字符收口 6 路素材） | 性价比标杆 |
| 白花 | nav 每轮裸取 120 次（W1） | 纯浪费 |
| 白花 | 同 BV 全量重 debrief、封面/字幕重复下载（W2） | 纯浪费 |
| 白花 | popular/rank/following 每轮全量裸拉（W3） | 大半是浪费 |
| 白花 | 额度充裕时每轮例行 `bili_traffic` 体检（W4） | 仪式感可以留，独立调用可并行走 |
| 半白花 | 无上限的 5.9MB api-cache 全量 parse（W5）、diary_read 全尾注入 | 工程债，不是人格债 |

**三条立即可做（低风险，dev 可做）**
1. `feed.mjs:57` 的 nav 改走 `apiGet`，`bili-api.mjs:49` NAV_TTL 10min→30min。（预计 -15~18 读请求/天，两行改动，有 `--status` 自检可验证）
2. `debrief.mjs` 封面/字幕加 `existsSync` 短路 + 48h 内同 bvid 只增量刷弹幕/热评。（消掉逐字节重复的 debrief）
3. popular/ranking 加 30–60 分钟文件缓存（照抄 `searchCached` 现成模式，`feed.mjs:98-111`），`bili_traffic` 摘要并入 feed/debrief receipt 头部一行。

*数字来源汇总：`usage.jsonl`/`GET /api/usage`（LLM）、`traffic-state.json`+`api-requests.log`（B 站）、`runs/*/toolcalls.jsonl`（工具次数/字符/耗时）、`cortico.log`（循环节奏）。缓存拦截率 24.6%（66 HIT/268 记录）。*
