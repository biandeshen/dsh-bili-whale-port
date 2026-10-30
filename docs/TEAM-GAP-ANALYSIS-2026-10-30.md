# 六席短板分析与设计裁决（2026-10-30）

> 触发：主人问“目前使用体验是什么样、她怎么度过时间”，并要求团队分析后续短板、给出设计，同时核查 DSH/大肥鱼开源插件。
> 参与：产品、架构、运行、安全、挑刺、生态六席（只读分析，未改码、未发布）。
> 输入：`CURRENT.md`、`MODULARITY-2026-10-30.md`、`PLUGIN-INTEGRATION-PLAN-2026-10-30.md`、`OBSERVATION-PROTOCOL.md`、10-30 实机数据、相关代码与 GitHub 元数据。
> 本文是**团队建议**；标“待拍板”的没有替主人做决定。

## 0. 今天已发生的事实

- 10-30 动态 `dyn-20261030-741fdf` 已发：B 站 id `1264923003190247429`（17:07）。10-28/29 两条旧稿未发。
- 她 10-30 只有 1 次自然 action（11:11），之后 5 个多小时待机；10-29 也是 1 次，10-28 无 action。
- 当前主人看到的 7799 是 Cortico 操作台；8447 鱼缸面板未运行；动态稿不在面板；无通知；B 站私信是唯一真实互动通道。
- 已发稿复核发现：正文有一个未闭合 `**`，书名被截成《…高效补》；生成器 `snippetOf` 截断 + `buildText` 选错小节是直接原因。

## 1. 六席结论

### 产品席
最伤的是“她的一天”没有可看的地方：`panel/data.js:13-14` 读 `whale-log.jsonl`（最后 10-25），而 Cortico 写 `causal.jsonl`；8447 还没起。第二是待审稿不可见：三条队列分散，面板只读 go-gate；10-30 稿发出前没人看出格式 bug。第三是零通知，私信最坏等一天。建议：只读“她的一天”页（五段：醒→看片→日记→出稿/不发→私信）+ 三队列只读列表 + 可选 ntfy 通知；**审批只给可复制的 CLI，不做一键发送**。

### 架构席
M1 不能把 6 个 P0 塞进一个“行为等价”门：渲染器适配会改输出，panel 只读接线不会，混在一起会互相掩盖。资产根问题是**数据所有权**不是配置：`draft-dynamic.mjs:19-20`、`dynamic-approve.mjs:13-14`、`definition.ts:153-154`、`pick-image.mjs:28` 各有一套路径，`WHALE_IMAGES` 与 `WHALE_IMAGE_DIR` 还不一致。M1 应先收 `tools/lib/paths.mjs` 的 `draftsDir()/imagesDir()`，再谈 media 拆分。凭据不要搬 B 站 cookie；MiMo 只加独立 provider。panel 先定 `causal.jsonl` 投影，不 import `scripts/ack.mjs`。

### 运行席
tick 只能证明看门狗活着，不等于她行动；10-30 已有 100+ 条 tick，只有 1 条 action。日界有双口径：`g3b-check.mjs:73-75` 用 `Date.parse(today)`（UTC 零点）再 `logicalDay`，只在 UTC+8 成立；日记 10-30 内容落进 `## 2026-10-29` 已经实证。跨日收尾只在看门狗亲历 04:00 时写 `state.end`，关机重启不回补；10-28 的 end 缺失且无 flag。`action-watch` 目前已是 `--follow`（12:55 起，96h），这一点推翻旧结论；但 G3b 仍会被“她想不想动”卡住。建议观测后：幂等日终、外置心跳、每日 causal 切片备份、g3b 日期枚举改 `logicalDay(now - i*86400e3)`；观测期不改冻结脚本。

### 安全席
**“一键审批”是最大后门**：`core/api/routes.js:219-241` 只凭 id 放行，重放 `go-gate` 里模型可控的 argv 并补 `--go`；展示的 message 不等于执行的命令。token 事实上会进模型上下文：`ack.mjs:37` 明文与 hash 同文件，`dynamic-approve.mjs:143`/`dm-approve.mjs:112` 把 token 打到 stdout；动态审批缺正文绑定（DM 有 `textHash`）。kill 只在 dynamic-approve 查，panel 路径不查。红线：审批对象=执行对象；token 不进 stdout/日志/模型；所有 B 站写入口共用 kill；动态审批补 textHash+draftId；AI 平台声明与叙事正文分开。

### 挑刺席
G3b 的日期表述要精确：10-31 是最后一个**数据日**，门最早 11-01 才能过；“G3b 等 10-31”不能写成 10-31 当天通过。canary 3/3 读的是 `control/canary.json` 的字符串，C2 是优雅停止 + 杀看门狗，不是断电恢复；这是已裁决口径，不再回滚，但别把它吹成“断电证明”。K1/K2/K3 测的是阈值和字数，不是“她活得好”；K3 受过阈值 0.25→0.2 的影响。V1 是本地 smoke，不是上线；16:9 封面文字压脚边未修。最低体验门槛应是：连续 7 天私信有来有回、成稿能对上当日情绪、不再有日期错位；现在还没有任何一个指标在测体验。

### 生态席
DSH/大肥鱼插件生态确实大，但绝大多数是 **DSH 宿主插件**，不能直接装进 Cortico；能借的是设计。最相关的是 `minedalang/dsh-dafeiyu-life`（MIT，5★，10-30 活跃）：自主刷 B 站、三层人生记忆、情绪衰减、关系成长、**大肥鱼的一天**时间线、权限/额度/去重、日常动态默认审核——几乎是我们缺口的参照物。`c1overzz/dsh-bili-scroll`（MIT，1039★）每天刷 B 站写日报，但会自动评论并 @ 人，**不能直接装**；`MeteorNOX/DeepSeek-Balance-Whale-Widget`（MIT，6554★）和 `PC2005-cloud/dsh-pet`（MIT，4966★）是桌宠/视觉参照；`Phant0Meow/dsh-meow-memory`（MIT，337★）是跨会话记忆参照；`ppy-web/dsh-plugin-xiaomi-mimo-tts`（MIT，38★）是 MiMo TTS 的 DSH 封装，我们已直连 API；`huguangyu666/dsh-plugin-notify`（MIT，3★）可借通知形状。`dsh-plugin-dayflow`、`dsh-stamina-pet`、`dsh-whale-maid` 许可不明/NOASSERTION，不接。详见 `PLUGIN-RADAR-2026-10-30.md`。

## 2. 共识（按优先级）

### P0-1 先把“她的一天”和“待审稿”变成可见的只读面
- 新 `panel/causal.mjs`：读 `causal.jsonl`，kind 白名单、时间归一（action 用 `atMs`，diary 用 `at`，draft-result 用 `at`），按逻辑日分组。
- 新 `panel/drafts.mjs`：只读合并 `D:/AI/养鱼/drafts`、`control/dm-drafts.json`、`~/.bili-ai/pending-replies.json`；显示正文、图、时间、状态。
- 改 `panel/data.js:13-14` 的时间线源、`/api/pending` 的展示；bubble 的 pending 数改“全部队列”。
- **不做一键发送**：只显示“预览 + 复制 CLI 命令”。审批仍在 `dynamic-approve.mjs` / `dm-approve.mjs`，token/kill 不经过 panel。
- 这一项不改变她的行为，是 M1 最安全的第一步。

### P0-2 修内容完整性，别让坏稿再出门
- 日记：同一日期下出现两个 `## 想说`（10-30 实证），`看过` 表混入 10-29 行；`buildText` 用第一个「想说」，所以 10-30 稿用了 09:12 的 Yoga Nidra，而不是 11:11 的雷雨 283 桶。
- 生成器：`snippetOf` 截断到 20 字，导致《…高效补》；`buildText` 的 `**` 未闭合，已发稿实证。
- 修法：`upsertDiarySection` 按“日期段内唯一 heading”替换、标题匹配去空白；`buildText` 只取目标日期段；`snippetOf` 不截断书名或关闭 markdown；加单测（重复 heading、跨日、未闭合强调、书名截断）。
- **不擅自改已发稿/日记**；如果要修已发动态，先 `edit-dynamic.mjs` 预演 + 主人确认（待拍板）。

### P0-3 审批安全先于“体验优化”
- 不做 panel 一键审批；审批对象必须从展示字段重建 argv，只允许白名单命令；token 不进 stdout/日志/模型；动态审批补 `textHash`+`draftId` 绑定；kill 在 `traffic.mjs` 入口统一检查。
- 在这些修完之前，任何“待审稿按钮”都不做。

### P0-4 观测证据别单点
- 保持 `action-watch --follow`；每日把 `causal.jsonl` 当天切片只读复制到 `days/<D>/causal-slice.jsonl`（新脚本，不改冻结件；观测期是否执行由主人拍板）。
- 观测后：日终幂等（记录 derivedFromLastTick/age，超 2h 标 stale 不写假 end）、外置心跳、G3b 日期枚举改为 `logicalDay(now-i*86400e3)`；这些是 M1 之后。
- 观测期（11-01 起）不改码；当前只记录缺陷。

### P1 体验层
- 通知：只推“新私信/新草稿/她醒了”，不带正文/凭据；默认关或显式开。
- 私信闭环：显示最近来信、草稿 pending/sent、冷却；标注“她下次醒来才看到”。
- 控制台/伴侣面分离：7799 保留运维；新增“她的一天/信箱/她的东西”只读视图；运维折叠到二级。
- 记忆/成长：借 `dsh-dafeiyu-life` 的三层记忆（精确经历/待反思/身份级长期记忆）与“大肥鱼的一天”时间线；不直接装插件。
- 视觉/语音/视频：桌宠/鲸鱼挂件参考；MiMo TTS 已直连；V1 视频待接 World。

## 3. 分歧与裁决

| 分歧 | 裁决 |
|---|---|
| 产品要“待审稿一键批” vs 安全说这是后门 | **安全胜**：只预览+复制 CLI；一键审批要等 token/argv/textHash/kill 全部修完后再单独裁决 |
| 运行席想在观测前补日终/心跳 vs 挑刺席说别碰证据 | **冻结优先**：观测期不改行为代码；只允许只读证据副本/记录；日终幂等放观测后 |
| “G3b 等 10-31” vs “最早 11-01” | **表述统一**：10-31 是最后数据日，门最早 11-01 04:05 之后；不把两者混写 |
| 生态席建议借 dsh-dafeiyu-life vs 是否安装 | **只借设计，不装插件**：它是 DSH 宿主插件，装进来等于第二宿主；我们没有第二个运行时的需求 |
| 挑刺席质疑 C2/K 指标 | **记录保留意见，不改判据**：C2 已按裁决 PASS，K1/K2/K3 是观测协议的一部分；不因质疑回填数据 |

## 4. 建议的 M1 拆分（替代原来的“6 个 P0 一个门”）

| 子阶段 | 内容 | 门 |
|---|---|---|
| M1d 内容完整性 | 日记 heading/日期、buildText 选段、snippetOf/markdown；单测 | 同一日期不再出现重复「想说」；30 号稿不再引用 29 号段；书名/强调闭合 |
| M1e 审批加固 | token 不进 stdout、argv 重建、textHash+draftId、kill 全覆盖 | 注入一条伪造 message 不能改变执行命令；list 不打印 token |
| M1a 资产根 + 可观测 | `paths.draftsDir/imagesDir`，panel causal/drafts 只读，bubble 全队列 | 换机器不依赖 `D:/AI/养鱼`；面板能显示当天 action/diary/draft；有 pending 稿时 bubble 不再说“没事” |
| M1b 凭据 | MiMo provider；B 站 `loadCred` re-export；secret 不出 provider | 缺 key fail-closed；stdout/日志无 secret；B 站 cookie 位置不漂移 |
| M1c 媒体 | TTS/BGM/studio 适配层、config.media | 现有 20s 样片命令继续可跑；换 provider 不改 CLI |

顺序建议：**M1d → M1e → M1a → M1b → M1c**。先停止产生坏内容，再保证审批不被绕过，再让主人看得见，最后才是媒体供应商拆分。

## 5. 观测期动作（现在到 11-01）

1. 不改代码、不重启、不 `--force`；10-31 是 G3b 最后数据日。
2. 保持 action-watch `--follow`（12:55 起，96h）；不要再起第二个 watcher。
3. 11-01 04:05 后跑 `g3b-check`；全绿才 `observation-start`，否则记录 pending，不绕过。
4. 观测期如需主人互动（发私信/审批），按 `OBSERVATION-PROTOCOL.md` 提前一天写 `planned-interaction.md`。
5. 已发 10-30 稿的格式问题：先记录，不擅自编辑；要改走 `edit-dynamic.mjs` 预演 + 主人确认。

## 6. 行动密度诊断：无限 token 为什么还是“懒洋洋”

先把两件事分开：

- **已拆掉的**：`MAX_ACTIONS_PER_DAY=Infinity`、`MIN_GAP_MS=0`（2026-10-30 主人裁决）。这两项只取消“每日次数上限”和“两次行动最小间隔”。
- **没拆的**：`CHECK_PROB=0.05`、三条驱动阈值（刺激<0.45 / 连接<0.45 / 距上次行动 12h 起休息压力）、体力门。它们才是当前“懒”的直接原因。

用 10-30 17:52 的实测场值算：

| 项 | 值 | 对行动的影响 |
|---|---|---|
| 刺激 | 0.863 | `explore=0`（不无聊） |
| 连接 | 0.4245 | `connect=(0.45-0.4245)/0.45≈0.057`（刚跌破线，欲望很弱） |
| 距上次行动 | 6.7h | `restPressure=0`（23:11 才开始） |
| 体力 | 0.647 | `tired=0`（不是累） |
| 单次评估 | `urge=max(...)=0.057`；`0.057×0.05≈0.00285` | 约每 5 分钟 0.28% 概率；12 次/小时 → 约 0.034 次/小时 |

所以按当前模型，白天不动是**数学期望**，不是 token 不够。真正的下一次更可能在 23:11 之后休息压力起来，或连接继续掉、刺激掉到 0.45 以下。

还有三个更根本的原因：

1. **驱动只有三条**：节奏只看刺激/连接/休息压力；她的好奇 0.83、创造 0.52、社交 0.46 都不参与“要不要行动”。好奇高不会让她想做事。
2. **没有输入**：主人不发私信、没有评论/直播输入，连接只降不升；她没有“想回应的人”，自然没有 connect 行动。
3. **行动=整轮 B 站活**：一次 action 就是 feed/debrief/日记/草稿，成本高、可见；两次 action 之间没有任何“存在感”输出，所以看起来像消失。

### 建议（观测后做，不现在改）

- **Drive v2**：加 `create`（好奇/创造高 → 写东西、做视频、整理日记）和 `social`（私信/评论/直播输入）两条驱动；仍不设每日上限。
- **分离“存在感”与“行动”**：两次 B 站 action 之间，用低成本微行为（状态句、窗边、翻日记、想他）让她“在”；不刷 B 站、不烧 token。面板显示“她现在”而不是空白。
- **概率门改造**：不要只把 `CHECK_PROB` 从 0.05 拉到 1（会变成每几分钟评估一次、行动仍受阈值限制）；改成“欲望累积到阈值才触发”，或按驱动强度缩放，保留自然间隔。
- **观测先行**：11-01 前不改 rhythm；否则 G3b/观测基线变了。观测后用 10 天模拟对比“当前 / Drive v2 / 仅提高概率”，看 actions/day、B 站读取量、体力曲线，再定阈值。
- **不要用 token 当行动频率**：无限 token 只保证“想做就能做”，不制造“想做”。要她活泼，得改驱动和输入，不是加预算。

## 7. 待主人拍板

1. 已发 10-30 动态的 `**`/书名截断：编辑修正、删除重发，还是保留并只修生成器？（团队建议：只修生成器，已发稿不擅自改；要改先预演）
2. 10-28/29 两条旧稿：继续压着、补发一条、还是丢弃？（团队建议：继续压着，避免补作业）
3. AI 平台声明：叙事正文不写，但平台侧是否加“AI 生成”标签？这是合规问题，不是文风问题。
4. 形象素材：是否接受 CC BY-NC-SA 的非商用限制；如果账号将来商业化，不能默认用溟月/桌宠素材。
5. 一键审批：安全修完后是否要；团队默认不做。
6. 是否要“她的一天”只读页先做在 7799 控制台里，还是等 8447 重做鱼缸？（团队建议先做只读页，不改 8447）
