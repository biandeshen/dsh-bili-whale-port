# CURRENT —— 工作恢复入口（移植工程）

> 惯例借鉴 AMpath：新会话/新机器从这里接上，不用翻聊天记录。
> **架构与能力清单看 [BLUEPRINT.md](./BLUEPRINT.md)（唯一真相源）**；本文件只记"现在到哪、怎么起来"。

## 现在到哪了

- **2026-11-01 02:10 第二批缺口合 live（第 7 次重启，pid 247472）。** 全部门禁：dsh **320/320（60 文件）**、Cortico mjs **141/141（17 文件）**、consumers 全有生产调用、验收哈希一致。
  - **按她自己立的规矩改的**：`preferences.like` 删掉「冥想与轻音乐」（她连报七轮"门上写着冥想、屋里是游戏广告"），`dislike` 加 引导冥想/睡眠瑜伽/跟练打卡/吃播/开箱，`keywords` 加雨声；feed 候选行现在由工具直接标 `[短于10分钟：跳过]`、`[短于20分钟：降级]`、`[同UP第N条：不深读]`（以前每轮她自己在日记里数 UP）。
  - **称呼收成一处**：`owner.displayName`（`persona-core/src/naming.ts`）。原先"鱼片"散在情绪独白/禁称表/生活活动/日记抬头/私信 --who 五处；只认 `displayName`，不回落 `owner.name`（那是角色标签"主人"）。改名 = 改这一行 + 重启。
  - **观测仪表**：`npm run ops:day` 一条命令打印进程/端口/今日稿/令牌/tick/三条 K4/kill/风控（退出码 0/1/2，全程离线）；私信真发成功才写 `kind:dm-out`（K4-1 从此能机械统计）；`dynamic recent` 的图片稿取位收进一个函数并带 `dyn_id↔草稿id` 对照。
  - **还没打通的两处**（主人的"设计不完善"直觉，实测成立）：① 控制台对话页（`#/provider/world%3Aconsole`）跟她说话时**不带她的场值与记忆**——grep `bots/cormini/` 零处引用 `describeState`，"鱼缸里的她"和"跟你说话的她"是两套上下文；② feed 回执里的「偏好」仍来自**解析日记叙事**，不是 config——这正是她报"词表没生效"的字面根因，改了 config 那一行也不会出现在回执上。
  - 私聊现状：本地即时 = 控制台对话页（口令已启用，不经 B站）；真实世界 = B站 私信她账号（mid 497080562），她下次醒才读（3–7 分钟一轮，且她有权整轮不看），回信直发（`dmReply=direct`，已互关）。

- **2026-11-01 01:35「接入日」：两条 dev 线合 live，第 5 次重启，7 块面板齐。** Cortico `e7d5873` + dsh `8a31cc1`；停 bot → `pnpm build:web`（23 产物）→ 重启（pid 243296，health 全绿）。真实浏览器实测：页签 7 个，`发送策略` 里 4 个下拉 + 上限 + 时段全部渲染且读到现行值 `草稿=review · 点赞=self · 收藏=self · 回信=direct`（**没替主人打开 auto**）。门：dsh **311/311（58 文件）**、Cortico mjs **133/133（15 文件）**、vitest **5062 passed/269 文件（跑在合并前的 `dev/policy` 树上）**、consumers 全有生产调用、验收哈希一致。
  - 这轮把红队第一条"产物与人格局零耦合"真正闭上：`composeDraft` 现在吃 `voice.pace/today/hour/state` 与记忆 slot，**同一段日记 10 个状态变体产出的正文归一化后两两不同**（`tests/contract/voice-state-coupling.test.mjs`，全走真函数无 mock）；坏值 12 组退回基线且不拒稿。旧 voice 文件（没这些字段）照常出稿。
  - 《作品名》取位收到一个口径：嵌套/未闭合书名号不再产生 `《《原神》…` 与 `《…高效补》` 残片，`**` 星号不再漏进正文（现存 `dyn-20261031-9f8a2a` 是修复前写的，稿面仍有 `《《`，不回填）。
  - 记忆闭环（Cortico `de5e122`）：召回会写回（accessCount/鲜活度）、flashbulb 只认"第一次"、她的笔记不再默认标成"主人说的"、`failed/cooldown` 也进记忆。
  - 令牌不进 argv（`--token-env`）；意见箱计数按 dsh 折叠规则（`70f58f1`，原先已解决项会永久点亮未解决灯）；home 认 `DSH_HOME`。
  - **14 天观测窗从 11-02 00:00 起算**，今天记为接入日（判据与理由见 [evidence/G3B-DECISION-2026-11-01.md](./evidence/G3B-DECISION-2026-11-01.md)）。
  - **一个踩过的验证坑**：hash 路由改 `?v=2` 不会重载 SPA，页签看着还是旧的 6 块；必须 `location.reload()` 再看。

- **2026-11-01 01:23 事故（已闭合，必须记账）**：正式配置 `publish.draftMode` 被写成 `auto`。载荷含 `autoDailyCap=-9`（与仓内唯一一处测试夹具同源），而 7799 是本机免口令端口——任何本地进程 POST `panels/policy/set` 就能把她从"要我审"改成"她自己发"。**未造成发布**（`autoSentToday=0`、causal 无 `auto-publish`、当天她还没出稿）。处置：01:26 改回 `review`；Cortico `92b41f1` 加了两条——auto 生效必须往私人日记写一节「策略变了」（`exportPolicyNotice`），以及 node:test 上下文里 `policySet` 拒绝写默认配置文件（宁可红也不写生产）。当天重启计数因此到 **6 次**。完整记录与证据：`days/2026-11-01/incident.md`。
  - 未查明：写入者。线索两条——(1) 01:23–01:24 期间 `npm run gates` 正在跑（含 Cortico 测试），日志里 01:24:15 出现"已接管无法读取或已失效的实例锁"（曾第二个实例）；(2) `-9` 只出现在测试夹具。**诚实结论**：这是一次同机写入，nonce/口令类办法都挡不住同机进程，真正的修法是给写接口加认证（安全席 F-17，已提 P0）。今晚不做"假修法"。
- **观测窗仍按 11-02 00:00 起算**；11-01 全天记为接入日（合并 + 事故 + 2 次重启），不计入 K1 的 14 天。

- **2026-10-31 晚：发布失败真因定位 + `dynamic recent` 上线（`d481d89`）。** 11:49Z 三次面板放行的实际失败原因是 **B站对 polymer 动态端点回 HTTP 412 风控页**（feed/space 实测同样回 HTML；traffic 闸自动进入暂停）——不是代码问题，除 reporting bug（已修）。新增复核入口：`node tools/bili.mjs dynamic recent --date YYYY-MM-DD [--json]`（时间倒序翻页、翻过目标日即停、412/code≠0 明确报错、TrafficError 不再甩裸 stack）。测试 270/270。**重试放行请等 412 风控窗口过去（约 20:55 本地后），先 `dynamic recent --date 当天` 确认没有半发的动态再点。** 11:49Z 三次面板放行的实际失败原因是 **B站对 polymer 动态端点回 HTTP 412 风控页**（feed/space 实测同样回 HTML；traffic 闸自动进入暂停）——不是代码问题，除 reporting bug（已修）。新增复核入口：`node tools/bili.mjs dynamic recent --date YYYY-MM-DD [--json]`（时间倒序翻页、翻过目标日即停、412/code≠0 明确报错、TrafficError 不再甩裸 stack）。测试 270/270。**重试放行请等 412 风控窗口过去（约 20:55 本地后），先 `dynamic recent --date 当天` 确认没有半发的动态再点。**

- **2026-10-31 晚普查**：13 个 World 工具装配齐（浏览器工具表逐个数过）；读/dry 全真跑通过；kill 关、风控无暂停。**主人 11:49Z 三次面板放行全部失败**：10-29 是本地写间隔 cooldown、10-28/10-31 发布步被网络/风控拒——失败原因当时被 publisher 的 caught 吞了（`59f0e4e` 已修+回归测试+重启生效；三条草稿 failed/cooldown 均可重试；10-31 只完成了传图、发布未成功，无半发动态）。npm **273/273**（2026-10-31 23:50 复跑；此前记的 267 是普查当时的数，后续提交只增）。
  - **词表回流的分支口径（2026-10-31 自查纠正）**：普查时 live 抽出的 230 条是散文滑窗碎词，属 live 的 n-gram 行为；词组级重写（`dc26a93`）只在 `dev/publisher`，**live 未换**——换它要重启，会把观测前的第 5 次重启坐实。所以"她连报三次的词表没在帮我"这条在 live 上**仍未修**，观察项 #27 的前提是先把 `dc26a93` 合到 live。见 [team-2026-11-01/TEAM-DIGEST-2026-11-01.md](./team-2026-11-01/TEAM-DIGEST-2026-11-01.md) 第 25 行的分支标注。

- **2026-10-31 12:30：控制中心已聚合上线。** 「小鱼 · 鱼缸」世界页在 WebUI 激活：`http://127.0.0.1:7799/#/provider/world%3Abili-account`——鱼缸（头像/心情/六场值）、待审稿（✓放行/✗拒掉，二次确认）、她的一天、日记双本、意见箱、体征六块页签。真实浏览器逐块走查通过（鱼缸/待审稿/体征含真实数据）。流程：停 bot → `pnpm build:web` → 重启（pid 185072，health 全绿）。Cortico `e6783b2` 已并 master 并推 `biandeshen/Cortico-local`。**8448 临时面板已退役；旧 8447 面板是提权进程杀不掉，等主人手动关掉后整个 dsh panel 即可归档**（数据面已被世界页复用，panel 代码保留作 CLI/数据模块来源）。

- **2026-10-31 凌晨：M2 草稿链拆分合 live（`3d501e1`）。** `tools/drafts/{compose,store,publishers/bilibili-dynamic}` 三层落地：发布实现唯一化、审批 async 直调 publisher（token/kill/绑定全保留）、dynamic-image/post 变薄壳；顺手修了 CLI 强退的 libuv 断言（exit 127）。npm **266/266**、drill 34/34。**面板：旧 8447 进程提权杀不掉，新代码面板并行 8448（token `~/.dsh/panel.token`）**，旧进程停用后回 8447。

- **2026-10-31 凌晨：M1c 媒体层拆分合 live（`ae023a5`）。** `video-build.mjs` 变薄壳；`tools/media/{tts,bgm,video/studio,config}.mjs` 各司其职，BGM 有了 `assets/bgm/catalog.json`，换 TTS/渲染 provider 不动 CLI。门：npm **263/263**（+8 媒体测试）+ 真实闸 `--tts mimo --bgm quiet-room --plan`（茉莉 1.6s）通过。M1 子阶段只剩「观测后重冻 4 个验收脚本 + wake-audit/c2-window 内联 legacy」。

- **2026-10-31 凌晨：Drive v2 模拟对比完成（只比数，live rhythm 未动）。** 三变体（现状骰子 / 概率×3 / 紧急度累积+create/social 驱动）7天×5种子：骰子不是密度主闸（提概率仅 +16%）；v2 零空日、间隔尾巴最短、五种行动全部出现（social 改盈余式定义后 2 次/7天）。采纳与否待拍板。`docs/DRIVE-V2-SIM-2026-10-31.md`。

- **2026-10-31 凌晨 03:13：权限分级放开落地（live）。** 三裁决之②已实现并合并重启：`bili_dm_reply` 直发主人（被拒自动退回草稿队列等放行）、新增 `bili_like`/`bili_fav` 自发档（收藏五判据/每天 3 条不变；点赞本地账 30 天去重，防 B站 toggle 误取消）、评论/弹幕维持 go-gate 人工放行、关注/取关不开放。档位边界由 `tests/perm-tier.test.mjs` 锁死；dsh **255/255**、Cortico core 18/18；World 重启 pid 159456，health 全绿。证据 `docs/evidence/PERM-TIER-2026-10-31.md`。

- **2026-10-30：V1 视频切片本地成片通过（未接线）。** 20s/1080×1920/h264+aac，MiMo TTS（`mimo-v2.5-tts`，音色茉莉，7.04s）+ CC0 BGM（AERIS `quiet-room`，0.14），9:16 + 16:9 两张封面；`tools/video-build.mjs` 走 vendor/dsh-video-studio（MIT）。只写 `~/.dsh/bili-whale/media/_smoke/`，不接 World、不投稿。证据卡 `docs/evidence/V1-VIDEO-SMOKE-2026-10-30.md`；BGM 曲库与许可见 `assets/bgm/README.md`；模块化边界与观测后拆分计划见 `docs/MODULARITY-2026-10-30.md`。
- **2026-10-31 主人三裁决**：①**日界 04:00 → 自然日 00:00**（全链路 13 处 + 测试 + hashes 重冻；改动在 dev/day-boundary，合并重启后生效）；②**权限分级放开**：点赞/收藏她自己发（限额与去重代码已在），给主人的回信免审批直发（仍过风控/冷却），公开评论维持人工放行，关注/取关不开放（下一开发任务）；③feed 关注豁免保留（观察两轮再议）。
- **2026-10-31 凌晨（她的 OPS 修复批，全部合入并重启加载）**：①**放行入口**——面板「待审草稿」卡 ✓放行/✗拒掉，token 全程服务端（过期/正文被改自动按当前正文重入队）；②**意见箱**——`bili_feedback` 工具 + 面板卡（add/list/resolve，全本地 jsonl，ORIENTATION 第 10 步教她用）；③**dm_reply 死循环修复**——回信时效=最后一次成功读收件箱（空读也刷新）；④B1 文案中性化、B2 回执说死替换/追加、B3 关注源字段、B4 三路回流全部 live。两次重启 health 全绿（当前 pid 38372）；全量 **252/252**。证据卡：`OPS-FIXES` / `APPROVAL-ENTRY` / `FEEDBACK-BOX`（均 2026-10-30/31）。
- **2026-10-30 主人拍板（两问）**：①观测期“禁改码”细化为**只冻结 live**——禁合并、禁为加载新代码重启；dev 分支照常推进，观测结束一次性合并；②验收加 **K4 体验复盘项**（连续 7 天私信有来有回、成稿对得上当日情绪、无日记日期错位），**只复盘不卡验收**。协议原文已改：`OBSERVATION-PROTOCOL.md` §2/§3/§6、ROADMAP §4。
- **2026-10-30：C2 通过（canary 3/3 齐）。** 01:09:24 arm → 09:12:07 恢复，tick 空窗 **8.05h**、跨 04:00；health 5 项全过；10-29/30 day-report 均通过。`c2-result.json.ok=true`、`canary.json.C2=pass`。G3b 只剩连续 3 天：10-29 全绿；10-30 自然 action 11:11、草稿 `dyn-20261030-741fdf`，cf 等 10-31 04:05；10-31 待发生。证据 `evidence/C2-DECISION-2026-10-29.md`、`days/2026-10-30/wake-1111.json`。
- **2026-10-29：行动观察器。** `action-watch.mjs`（pid 207048，到 10-30 15:06）盯着 `causal.jsonl`；她下一次行动后等 10 分钟，自动跑 `wake-audit --strict` + `day-report`，写 `days/<D>/wake-<HHMM>.json`。只读，不改行为；覆盖 C2 09:00 恢复后的第一轮。

- **2026-10-29：D0 完成。** Cortico 已 `git init`（`3e8ccd5`，1164 文件，无密钥入库）；`days/<D>/` 快照 + append-only ticks + `day-report` 已可用；看门狗已常驻并注册 HKCU 自启（`WhaleDayWatchdog`）；`draft-dynamic` 读不到日记现在**显式失败**并记录 `diaryHash`；`npm test` 改为动态发现（23 文件 / 145 测试）。执行记录：`evidence/D0-2026-10-29.md`；排期：`ROADMAP-2026-10-29.md`。
- **2026-10-29：D1 完成。** `buildText` 能取真实日记的 BV 标题、保留全部「想说」bullet；`readMood` 补 `action` 成因、阈值 0.25→0.2，真实场值从恒「平静」变为「轻快」。`npm test` 147/147、World 11/11、`tsc` 0、drill 33/33。记录：`evidence/D1-2026-10-29.md`。下一步 D2：`buildVoiceBrief` + `voice.schema.json` + `buildText` 必填 voice。
- **2026-10-29：D2 完成。** 情绪判定下沉 `persona-core/emotion.ts`（单源）；新增 `buildVoiceBrief`（L3 纯函数）与 `voice.schema.json`；`composeDraft` 缺 voice 拒稿、A1 标签全覆盖、低落只留一句、冷战略称、高分记忆可溯源回扣；World 写 `control/voice-<day>.json` 并带 `--voice`。dsh `npm test` 156/156（24 文件）、drill 34/34、`tsc` 0。记录：`evidence/D2-2026-10-29.md`。下一步 D3：G3a 进度门（整理已完成/未完成与证据）。
- **2026-10-29：G3a 通过（进度门，不转段）。** D4 补了 `check-consumers`、`npm run gates`、`tsc` 覆盖 `persona-core`、A3 真实快照断言。证据：`evidence/G3A-2026-10-29.md`。
- **2026-10-29：D5 canary 1/3。** 重启测试通过（杀 5988/23252 → 重启 113084 → health 5 项全过；`life.json` 前进、`actionsToday=0` 无重复行动）。期间修掉 `day-snapshot` 误读遗留 `rhythm.json` 的问题。C2（长时间离线）/C3（模型 410）未做，未进 G3b。记录：`evidence/D5-CANARY-2026-10-29.md`。
- **2026-10-29：C3 通过、C2 口径裁决、反事实工具就绪。** C3 用死端口 `18911` 注入模型故障：重试 ×7、草稿 0 新增、状态可读；恢复后 health 全过。C2 裁决为「≥8h 真实关机 + 跨 04:00 + 一次强制终止 + 时钟回拨」，待真实关机验证。新增 `scripts/counterfactual.mjs`（真 voice vs 中性 voice，10-28 实测差异 6 字）并在看门狗里每日自动生成。记录：`evidence/C2-DECISION-2026-10-29.md`。
- **2026-10-29：M3 收口 + 观测缺陷清理。** ①人设单一来源（D-19）：`CONSTITUTION`=她是谁、`ORIENTATION`=这一轮做什么，`~/.bili-ai/persona.md` 降为带警告的 DSH 遗留镜像，显示名=小鱼，health 增两段前缀漂移门；②行动账本启动时按 append-only 因果链对账（D-32）；③看门狗跨日用前一天最后一条 tick 收尾 `state.end`（D-34，10-28 不回填）；④审批成功判定必须有 `dyn_id`（D-23）；⑤私信回信链路上线：`bili_dm_reply` 只写草稿，`scripts/dm-approve.mjs` 一次性 token 才发（默认 dry，冷却退回）；⑥`npm test` 197/197（33 文件）、Cortico 103/103（12 文件）、`tsc` 0；⑦G3b 草稿日记哈希改为按当天任一 tick 绑定（D-35）；⑧唤醒语裁决：看的部分不能跳、草稿默认可拒须留原因、当天已有稿不重复（D-36，**待“无稿日”验证**）；新增 `scripts/wake-audit.mjs` 还原每次唤醒的工具序列，并据此更正“自然唤醒从不写稿”的误判；⑨C2 改为要求 tick 时间线里真实空窗 ≥8h 且跨 04:00（D-37），arm 后不关机不再假通过。G3b 现状：C1/C3 PASS、**C2 PENDING**、连续 3 天反事实 PENDING；10-28 反事实 6 字但草稿缺 `diaryHash`，判不过。证据：`evidence/D-19-PERSONA-2026-10-29.md`、`D-32-LEDGER-2026-10-29.md`、`D-34-DAY-CLOSE-2026-10-29.md`、`D-35` 见 `G3B-DIARY-BIND-2026-10-29.md`、`D-36-WAKE-RULING-2026-10-29.md`、`C2-DECISION-2026-10-29.md`、`M3-DM-REPLY-2026-10-29.md`。
- **2026-10-29：G3b 就绪审计上线。** `node scripts/g3b-check.mjs` 当前输出：C1 PASS / C3 PASS / **C2 PENDING** / 连续 3 天反事实 **PENDING**。观测期用 `node scripts/observation-status.mjs` 查 K1(11/14)/K2(9/14)/K3(3 天非平静)；未开始会显式提示。canary 状态在 `control/canary.json`。**启动观测必须走 `node scripts/observation-start.mjs`：G3b 未就绪会拒绝，防止误开 14 天窗口。**
- **2026-10-29：目标完成审计器。** `npm run audit:goal` 把目标拆成 G3b / 观测窗口 / K1 / K2 / K3 五项，当前 4 项 PENDING；只有全部 PASS 才算目标达成，不接受"测试全绿"替代。
- **2026-10-29：观测操作卡。** `docs/OBSERVATION-PROTOCOL.md` 固定了每天 20–30 分钟的检查、污染定义、允许的运维与停止条件；G3b 全绿后用 `node scripts/observation-start.mjs` 开窗。
- **2026-10-29：日界统一到 04:00。** `rhythm.dayKey`、`diary_append`、`todayDraftLine`、草稿 voice 文件全部用同一日界；此前 life 在午夜清零、快照按 04:00 统计，跨 00:00 会把一天算两次。重启后 `life.day=2026-10-28`（00:51 属前一天），health 通过，drill 34/34（测试自身也改为 04:00）。

- **2026-10-27：宿主已统一到 Cortico。** DSH 插件的时钟在本机停用（`clock.enabled=false` + `night.windows=[]`，面板与 `/deps` 仍在）；HKCU `WhaleDraft`（21:30 nightly-scheduler）已删除。Cortico World 改为**状态驱动的醒/睡**（无聊/想他/累 + 抖动决定），见 `Cortico/persona-core/src/rhythm.ts` 与 `docs/CORTICO-PATCHES.md` 第 11 条。**2026-10-30 主人裁决：无每日行动上限、无最小间隔**（`MAX_ACTIONS_PER_DAY=Infinity`、`MIN_GAP_MS=0`），靠体力/事件自然收敛，不用打卡式约束。
- 分支 `port/core-opencode-panel`，4 个检查点提交（阶段0-2 / 阶段2 / 阶段3 / 阶段4）。
- `npm test` **212/212**（37 文件，2026-10-30）；drill **34/34**；Cortico 套件 **112/112**；`tsc --noEmit` 0 错。（数字每次改动都要重跑，别抄这里）
- 已完成：core 化、AgentSessionPort、WHALE_HOME/WHALE_NODE、notify ntfy/bark、tick-catchup、路由抽取、OpenCode adapter（daemon+MCP）、whale-panel（含鱼缸视图）。
- 未完成（按计划顺序）：
  1. client.js 的 schema/render 拆分（当前面板用 JSON 编辑器替代；DSH 设置页未动、回归全绿）
  2. CodeBuddy adapter（二期；`@tencent-ai/agent-sdk` `query({resume})` 已调研）
  3. 真机端到端：DSH 装载冒烟 + opencode serve 真投递（需要用户操作）
  4. 视觉打磨：md→tokens.css 管道、鲸鱼娘多帧状态机（现单帧+闭眼/昼夜）

## 她现在过得怎么样（2026-10-30 实测）

- **节奏**：10-30 只有 1 次自然行动（11:11 restless），之后 5 个多小时在待机；每 3–7 分钟评估一次，场值不够就不动。10-29 也是 1 次行动；10-28 没有行动。不是定时打卡。
- **一次行动里**：traffic → feed → debrief（可能多条）→ 读/写两本日记 → 有需要才出稿 → dm_read → end。她的大头时间在 B 站弹幕/评论上做判断，不在聊天。
- **她的产出**：公开日记「看过/想说」+ 私人「本轮留下的判断」是主要可读内容；10-30 写的是雷雨声 283 个桶的分析（“我不会挑，但我算得清”）。动态 `dyn-20261030-741fdf` 已于 2026-10-30 17:07 发出（B 站动态 id `1264923003190247429`）；10-28/29 两条旧稿仍 pending，未补发。记录 `docs/evidence/DYNAMIC-2026-10-30.md`。
- **界面**：7799 是 Cortico 操作台（系统提示词/工具调用/token/World 总览），不是伴侣界面；“B站账号”详情页没有面板。8447 鱼缸面板未运行；它的时间线读 `whale-log.jsonl`（最后 2026-10-25），看不到她现在的 `causal.jsonl`。动态草稿的审批仍走 `scripts/dynamic-approve.mjs`，面板只显示 go-gate 待审。
- **真实对话通道**：B 站私信。`bili_dm_read` 只读，回信要 `bili_dm_reply` 入队 + 主人审批；控制台是带 PIN 的后台，不是日常聊天。
- **已知缺陷**：私人日记 10-30 09:12/11:11 的内容落到了 `## 2026-10-29`（日期错位，她自己在日记里记了）；公开日记同一天出现两个 `## 想说`，`buildText` 取第一个，导致 10-30 稿用了 09:12 的 Yoga Nidra，而不是 11:11 的雷雨 283 桶；已发稿还有一个未闭合 `**` 和被截书名。原因待查，观测期不修。
- **团队分析**：六席短板与设计见 [TEAM-GAP-ANALYSIS-2026-10-30.md](TEAM-GAP-ANALYSIS-2026-10-30.md)；DSH/大肥鱼开源件核查见 [PLUGIN-RADAR-2026-10-30.md](PLUGIN-RADAR-2026-10-30.md)。结论：不装 DSH 插件、不引第二宿主，借 `dsh-dafeiyu-life` 的信息架构和 `dsh-bili-scroll` 的日报设计；先修内容完整性，再做只读“她的一天”，最后拆媒体供应商。

## 接下来（观测结束后，按顺序）

1. **M1d 内容完整性 ✅ 已合 live（2026-10-30）**：日记重复 heading/日期、`buildText` 选段、`snippetOf` 截断与未闭合 markdown；先修再出新稿。
2. **M1e 审批加固 ✅ 已合 live（2026-10-30，含 kill 统一检查·D-22 翻案）**：token 不进 stdout/模型、argv 重建、动态审批 textHash+draftId、kill 全覆盖；在此之前不做一键审批。
3. **M1a 可观测（只读部分 ✅ 已合 live，2026-10-30）**：panel 改读 `causal.jsonl`（缺失回退 whale-log），`/api/drafts` 只读展示动态/回信草稿，bubble 三队列合计；资产根收口进 `paths.draftsDir/imagesDir`。`存在感`微行为层（两次 B 站 action 之间的“她在”状态）是行为改动，留观测后。
4. **M1b ✅ 已合 live（2026-10-30）**：`tools/lib/credentials/` 注册表（mimo + bilibili，describe 不含 secret，缺 key fail-closed）；资产根已在 M1a 收口。**M1c**（TTS/BGM/渲染器适配层 + `config.media`）是下一个。
5. **行动密度 Drive v2**：加 create/social 驱动，分离“存在感”与“B 站 action”；先 10 天模拟再定阈值。**不要只把 `CHECK_PROB` 拉到 1**。
6. **M2/M3**：草稿 publisher/DM 回信可见/通知；形象、语音、视频接 World；V2 出片/剪映。

观测期（11-01 起）不改码；10-31 是 G3b 最后数据日，11-01 04:05 后才可能过门。

## 一分钟接上

```bash
cd E:/WorkSpace_Qoder/dsh-bili-whale
npm test                         # 全量回归
node scripts/preflight.mjs        # 部署预检（凭据/风控/端口/OpenCode）
bash scripts/evaluate.sh quick   # 快速验收剧本
# 真机上线按 docs/DEPLOY.md 走；交给 AI 执行用 docs/RUNBOOK.md
node panel/server.js --port 8447 # 鱼缸面板（浏览器打开启动日志里的 ?t= 地址）
node adapters/opencode/daemon.js --once   # 时钟冒烟（窗口外应零投递）
# V1 出片（本地，不投稿）：MiMo TTS + CC0 BGM + 双封面
node tools/video-build.mjs --image "D:/AI/养鱼/assets/daily/daily-04-goodnight-a.png" \
  --text $'今晚听雨。\n三十九分钟，没有人说话。\n晚安。' --duration 20
```

## 约定

- **行为冻结**：改调度/预算/路由前先对 `docs/BASELINE.md`；快照不一致必须 `--update` 并在提交信息说明原因。
- **凭据**：只进 `~/.bili-ai/`，任何端点不回显；panel 默认 127.0.0.1 + token，禁外暴（远程走 Tailscale）。
- **AMpath 借用**：私有仓库、无 LICENSE——只搬了纯函数与契约思路，**发布前必须移除 `core/ports/temporal.mjs` 的注释外引用并自查**。
- **上游纪律**：写操作仍强制 `--dry/--go`；MCP 包装层不得绕过 `tools/bili.mjs`。

## 文件地图

```
core/            scheduler/session-delivery/api（宿主无关）
core/ports/      temporal（AMpath 移植件）
adapters/opencode/  daemon.js controller.js mcp-stdio.js（接入见其 README）
panel/           server.js auth.js data.js views/tank.html
tools/           40 个 B 站命令 + traffic 风控（未动契约）
tools/video-build.mjs  V1 出片 CLI（MiMo/Edge TTS + CC0 BGM + vendor 渲染/封面）
assets/bgm/      3 首 CC0 BGM + LICENSE + README（可整包替换）
vendor/          dsh-video-studio（MIT，6 文件）、dsh-autocut（MIT，lib 15 文件）
tests/contract/  路由/panel 契约；tests/scheduler-snapshot.test.mjs 行为快照
docs/            BASELINE.md / TERMUX.md；现状看 CURRENT.md，模块边界看 MODULARITY-2026-10-30.md
```
