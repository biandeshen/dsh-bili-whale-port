# ISSUES —— 问题台账

> v1 · 2026-10-28 · 本文件记录**所有未解决问题、待拍板事项、已知缺陷与环境约束**。
> 与 `BLUEPRINT.md` §9（历史更正）区分：那里记"写错过的结论"，这里记"还没解决的事"。
> 状态词表：`OPEN` 未动 · `DOING` 在做 · `FIXED` 已修有证据 · `BLOCKED` 前提缺失 · `NEED-USER` 待主人拍板 · `DECIDED-NO` 主人明确不做 · `WONTFIX` 判断不该做
> **任何条目改成 FIXED 必须附证据（命令输出/文件:行号/run id），否则留在 OPEN。**

## 0. 一句话现状

真实自主唤醒 **1 次**（10-27 15:49:27，`wake: restless`），完整"一天"链条**0 次**；人格状态**未接入产物**；记忆**只写不读且不衰减**；`connection` **只减不增**。前四项是 M0–M3 的全部内容。

---

## 1. 致命缺陷（阻断"活着"）

| ID | 问题 | 证据 | 影响 | 期 | 状态 |
|---|---|---|---|---|---|
| D-01 | **人格状态与产物零耦合**：`buildText()` 只吃日记文本，不读 fields/chain/memories/npc/rhythm | 红队1 F1；`scripts/draft-dynamic.mjs:44`；`drafts/2026-10-28.md` 与 `whale-diary.md:123` 逐字相同 | 情绪/主动表达/自我修正在产出路径结构性失效：被拒 100 次，第 101 条一字不变 | M0 | OPEN |
| D-02 | **记忆永不衰减**：`applyEffects` 用 `lastAppliedAt` 算天数，而生活循环每 3–7 分钟重置它 → `days>=1` 恒假 | 红队3 F6；`personaAdapter.ts:159-162,191`；实测 90 天后 vividness 仍 0.9 | "记性"不成立，重要的事不会变淡 | M0 | **FIXED**：按真实毫秒折成小数天逐步衰减（`decayMemory(m, days)`），5 分钟一跳也会累积；测试：288 次 5min 结算后 vividness 下降且一天约 0.02 |
| D-03 | **"记得"永远是最早三条**：`describeState` 按 vividness 排序取 top3，全部 0.9 → 稳定排序 | 红队3 F6；`personaAdapter.ts:335`；50 条记忆实测返回 `["video #1","video #2","video #3"]` | 长期记忆形同虚设 | M0/M4 | **FIXED**：新增 `memorySalience`（鲜活度 0.7 + 30 天新鲜度 0.3），`describeState` 与 `voiceBrief` 共用；同分按 createdAt 新的优先。**M4 追加**：`persona-core/src/retrieval.ts` 确定性召回（关键词 idf 0.40 / 鲜活 0.30 / 情绪 0.15 / 新鲜 0.15 + ≥7 天未被想起的意外槽），`describeState` 以"最近因果 + 公开日记尾部"为情境，`voiceBrief` 以今天日记为情境；草稿对 `score>0.5` 主槽记忆带出处回扣。证据：`retrieval.test.mjs` 7/7；`tests/core.test.mjs` 情境排序 + feed 标注；`voice.test.mjs` A4/A4c/A4e；真实状态预览 `preview-recall.mjs`（雨声记忆 keyword 100%、score 0.965） |
| D-04 | **`connection` 只减不增 → 必然 `cold_war` 且不可恢复**：8 个工具无任何读私信/互动的；`masterReplied` 唯一来源是模型自己填参数；6 个 preset 中只有它加 connection | 红队3 F5/S2；`definition.ts:199-208`、`personaAdapter.ts:40-48`、`decay.ts:27,37` | 关系机五态实为三态；30 天模拟 `connection=0.00` 是数学必然 | M3 | **FIXED（只读入站）**：新增 `bili_dm_read`（`dm-await --json --peek`），入站 → preset `inbound`（mood +0.06 / connection +0.07 / social +0.02，source=inbound 预算 0.20/天），`userJustMessaged` 建立接触证据；`masterReplied`/`inbound` 只能由传感器触发，模型调用被拒。证据：`tests/dm.test.mjs` 4/4；`adapter.test.mjs`「入站私信」；真实 API 探测 `{"hit":false}` exit 1；世界内调用 `bili_dm_read` → `[dm] 没有新私信`。注：`messages:null` 空信箱曾误判为读取失败，已修 `dm-history.mjs` 并有回归测试 |
| D-05 | **五态里 `reunion` 不可达、`missing/repairing` 窗口 8.3e-5**：`trust` 是 `connection` 别名，进 reunion 需 `c0<0.2`，单步最多给到 0.25 | 红队3 F5；`npc-state-machine.ts`；5.7 万模拟年 `reunion NEVER REACHED` | "关系五态"名不副实 | M1 | **FIXED**：`trust` 别名删除；新增 `npcState.bond.level`（每条用户消息 +0.1）；cold_war → missing → repairing → reunion 可达；无接触证据时 `current='unjudged'`，不判冷战。证据：`persona-core/tests/core.test.mjs`「道歉后 missing → repairing → reunion 可达」「没有接触证据不判冷战」；`adapter.test.mjs` 3 例 |
| D-06 | **情绪塌缩**：`readMood` 只读 4/7 场，97.2 万网格只出 13 标签，"平静" 56.7%；`source='action'` 无分支 → 180 天 229/229 次 mood_read 全是"平静" | 红队3 F1–F3；`personaAdapter.ts:243-324`、`definition.ts:260` | "有情绪成因"这条北极星特征不成立 | M1 | **FIXED**：`emotion-projection.ts` 15 情绪全 7 维投影；`readMood` 主标签来自投影，成因只做 0.2–0.6 加成；强度用 `emotionHistory` 滑动参照；`action` 有成因分支。证据：`persona-core/tests/emotion.test.mjs`（10,000 点 → 15 标签、最高频 14.6%）；`tests/core.test.mjs` preset 标签断言；`draft-dynamic` 的 15 标签 A1 全绿 |
| D-07 | **场值钉死**：mood 单调到 ±1、creativity 恒回 0.300；三条硬耦合全为单向下压，无"托起来"的手 | 红队3 F4/S1；`decay.ts` | 情绪永久冻结；旧实现在线 168h vs 离线 12h = 14× | M1 | **FIXED（mood/耦合）**：删 `COUPLING_CAP_MS`，硬耦合改 24h `MAX_SETTLE_MS` 封顶（衰减跑满真实时长）；正向耦合 `social>0.6 → mood +0.01/天`、`connection>0.6 → 体力恢复 ×1.5`。证据：`persona-core/tests/core.test.mjs` 21/21；30 天模拟 seed 42/7（`cd Cortico && node --import tsx ../dsh-bili-whale/scripts/simulate-rhythm.mjs`）mood 日均 [-0.01, 0.17]、体力 0.31–0.80 随行动/睡眠起伏，不再贴边。creativity 恒基线另立 D-29 |
| D-08 | **持久任务缺失**：唤醒排程只活在内存 `setTimeout`，进程重启即丢 | 红队4 §2；`definition.ts` rhythmTick | 一次崩溃=当天不再醒 | M2 | **FIXED**：新增 `control/queue.json` + `src/worlds/bili-account/task-queue.ts`；唤醒提示先落盘再推送（at-least-once），失败重试 5 次进 dead，pending 超 24h 作废，启动补投；`life-status.json` 暴露 `queuePending/queueDead`。证据：`tests/task-queue.test.mjs` 6/6；运行时构造 stale pending → 重启后 `status=dead`、`queueDead=1`、未推送 |
| D-09 | **无醒/睡状态变量**：`rest` 恢复每 tick 无条件应用 → 体力恒满，作息没有代价 | 红队3 S5；`definition.ts` lifeTick | "作息"缺少最基本的睡/醒语义 | M1 | **FIXED**：`asleep = now - lastActionAt >= 6h`，恢复只在睡着时生效，并写进 `life-status.json`；恢复速率 0.003→0.005/h（0.003 时 30 天模拟体力卡在 0.15–0.2，`energy<0.2` 耦合把 mood 钉到 -1；0.005 时 0.55–0.65 稳定）。证据：`persona-core/tests/rhythm.test.mjs` 11/11；`simulate-rhythm.mjs` seed 42/7 |
| D-29 | **creativity 恒回基线 0.300**：只有出稿/被拒事件 ±0.03，之后按 -0.0005/h 回 0.3，没有任何持续创作行为 | 30 天模拟未建模；`decay.ts:24-32`、`personaAdapter.ts:60-72` | 创作欲永远是背景值，生活活动接上后才可能有非基线波动 | M1（生活活动） | OPEN |
| D-30 | **`custom` 效果无上限**：模型可在一天内反复 `mood_apply`，每次 |delta|≤0.5，人格状态可被刷到任意值 | PLAN-REVIEW §2 裁决 7；`definition.ts` sanitizeEffects + applyEffects | 情绪可被外部输入覆盖，"状态驱动"失效 | M1 | **FIXED**：新增 `persona-core/src/budget.ts`，`(source,field)` 按天封顶、余额不足时部分生效；`custom` 0.15/天、`action` 0.20、`silence` 0.15，账本存 `fields.json.budget`（schema v4）。证据：`persona-core/tests/budget.test.mjs` 6/6；`adapter.test.mjs`「custom 一天最多推动 0.15」 |
| D-31 | **feed 质量下限可被"多偏好命中"绕过**：`looksLikeJunk` 只挡 `play<300 && dm<3`，命中 ≥2 个偏好词就放行 → 连续多天推播放 1、弹幕 0 的当日新片 | 她自己 2026-10-28 公开日记「想说」第 2–3 条（"播放是 1""我看的不是视频，是标题"）；`tools/commands/feed.mjs` `looksLikeJunk` + `uniq.filter` | 她的"判断"退化成读标题；长期记忆里全是无从判断的片子 | M4 后 | **DECIDED-TEAM 2026-10-29**：收回「多命中 ≥2 免检」（300/3 是 10-22 既有规则，未新增数值；关注流豁免），判定抽到 `tools/lib/feed-quality.mjs` 并加契约测试；新增 `feed/<day>.json` 候选快照补审计缺口。实测 120→96 条、丢 15 条碎屑、仍出满 5 条。`play>=50`/`dm>0` 等**新准入阈值挂起为 Q-10**。见 `evidence/D-31-RULING-2026-10-29.md` |

## 2. 严重缺陷（可信度与安全）

| ID | 问题 | 证据 | 影响 | 期 | 状态 |
|---|---|---|---|---|---|
| D-10 | **`npm test` 执行 0 条自研测试**：`vitest.config.ts:16` 只 include `tests/**/*.test.ts`，我们全是 `.mjs` | 红队2 F3、红队5 §2 | 45 个测试一个都不跑；`rhythm.test.mjs`（11/11）覆盖的"再也不醒"bug 无门禁守护 | M0 | OPEN |
| D-11 | **`tsc 0 错误`口径失实**：`Cortico/tsconfig.json` 的 include 不含 `persona-core/`；`dsh-bili-whale` 是纯 JS 无 TS 工具链 | 红队5 §1 | "类型安全"只覆盖上游代码 | M0 | OPEN |
| D-12 | **测试抓不到"写了没生效"**：drill 33 项全在 `mkdtemp` 沙箱 + 5 行假 CLI，真实网络/home/CLI 触达 0/33；每项直接 `await tools.X.handler()`，绕过 `lifeTick` | 红队5 §3；`drill-gate.mjs:21-26,128` | 33/33 全绿与"她再也不会醒"可同时成立 | M0 | OPEN |
| D-13 | **22 个零引用导出**（`causal-chain` 6/6、`effect-bus` 3、`runner.makeRunner` 等） | 红队5；`CORTICO-PATCHES.md:9` 把 `makeRunner` 列为交付物 | 死代码继续增长（刚删 266 行又长回来） | M1 | OPEN |
| D-14 | **L3/L4 倒挂**：`PRESETS`/`readMood`/`describeState` 住在 World；`persona-core/tests/adapter.test.mjs:6` 反向 import World | 红队2 F1 | L3 无法独立测试/移植；"换 adapter 即可"被证伪（需改约 920 行） | M1 | OPEN |
| D-15 | **`persona-core` 不是包**：无 package.json，不在 workspace/tsconfig/vitest | 红队2 F2 | "平台无关"是注释不是约束 | M0 | OPEN |
| D-16 | **`Cortico/` 无版本控制**，约 2300 行自研代码不可回滚；上游已 0.2.8（本地 0.2.7） | 红队2 F4、红队5 §4；`cortico.log` 每次启动告警 | 升级=手工重做；改坏只能重写 | M0 | OPEN |
| D-17 | **多会话并发写同一批文件**（10-27 06:50–17:34 两会话同时活跃 11 小时，正是 P0 修复窗口） | 红队5 §5；`c2a52024.txt:7615` 自认"我改到一半撞车" | 修复互相覆盖 | 流程 | OPEN |
| D-18 | **状态 4 根目录、5 写者、0 锁**：`~/.dsh`、`~/.bili-ai`、`D:\AI\养鱼`、`Cortico/deployments/*/data` | 红队2 S4；全仓 grep `flock|lockfile` 零命中 | 备份/迁移易漏；后写覆盖 | M0 | OPEN |
| D-19 | **两套人设并存无主从**：`~/.bili-ai/persona.md` vs `deployments/mybot/prompts/ORIENTATION.md` | 红队2 S4 | 改一处不生效，排查困难 | M1 | OPEN |
| D-20 | **`--force` 可擦除 `sent` 状态 → 同日重复发布**（按日期命名整文件覆盖，审批闸读的就是该字段） | 红队4 致命2；`definition.ts:207`、`draft-dynamic.mjs:80-101` | 绕过审批的唯一屏障 | **主人 2026-10-28 决定不做**（与 AI 标识一并撤） | DECIDED-NO |
| D-21 | **一次性令牌明文落盘**（token 与 tokenHash 同文件） | 红队4 致命3；`ack.mjs:37` | 安全性依赖"工具面恰好没有文件读" | 同上 | DECIDED-NO |
| D-22 | **kill switch 不覆盖 tools 层**，直接 `bili.mjs --go` 可绕过 | 红队4 S2 | 急停不可靠 | 同上 | DECIDED-NO |
| D-23 | **成功判定是装饰**：`/dyn_id|dynamic|成功/` 里 `dynamic` 任何运行都出现 | 红队4 S1；`dynamic-approve.mjs:111` | 失败可能被记为成功 | M0 | OPEN |
| D-24 | **`ack.release` 在"已发出但进程被杀"时会把令牌退回** → 重试产生第二条 | 红队4 S1 | 重复发布 | M1 | OPEN |
| D-25 | **记忆只在测试里衰减/归档**——上游 AMpath 也一样（`batchDecayVividness` 生产零调用） | AMRESEARCH/02 | 不能靠"上游有"来证明我们该有 | 认知 | FIXED（认知已更正） |
| D-26 | **flashbulb 分支不可触发**：`note` 路径 intensity 硬编码 0.5；watch 路径饱和后几乎必然 | 红队3 M2 | "重要的事记得牢"不成立 | M1 | **FIXED**：`mood_apply(note)` 的 intensity 改用当时的 stimulation（>0.8 才 flashbulb，符合高唤醒语义），sender 改为 `npc`（是她自己留的话，不是主人说的）。watch 路径原本就用 stimulation 强度 |
| D-27 | **凭据缺 `dedeuserid`**：`tools/lib/cred.mjs:33-37` 只返回 sessdata/bili_jct/buvid3；而 bili-cli `dm.py:172` 靠 `dedeuserid` 判 `from` | 研讨组4 实测 | 缺了它会把"她发的"全判成"主人发的" → `connection` 假上涨、M3 假通过 | **M3 前置** | OPEN |
| D-28 | **`bili dm read --mark-read` 是写操作**（`POST update_ack`，`dm.py:182-186`），不是只读 | 研讨组4 实测 | 误用会改变远端状态（主人端未读消失） | M3 | OPEN |
| D-32 | **行动账本会被覆盖**：10-28 22:21 日志有 `action: restless`，但 `control/life.json` 的 `actionsToday=0`；同一晚 01:35–02:04 出现 5 次「已接管实例锁」，多实例并发写同一文件是首要嫌疑 | `cortico.log:549` 与 `control/life.json`；E-09 并发会话 | `day-report`/C2 的「单日行动 ≤3」会少算；观测期可能漏记唤醒 | 观测前 | **MITIGATED（部分）**：每次行动已补写 append-only `causal.jsonl {kind:'action'}`（Cortico `definition.ts` lifeTick），复盘以 causal 为准；多实例写锁（D-18）未做，根因未复现 |

## 3. 待拍板（NEED-USER）

| ID | 事项 | 背景 | 选项 | 状态 |
|---|---|---|---|---|
| Q-01 | **EmergentDimension（涌现维度）做不做** | AMpath 自列核心壁垒；但 **2026-10-28 三路盘点确认：`AMPath-WorldModel` 是离线训练管线、`AMPath-MEE` 明确不含涌现维度——上游没有任何可用实现** | A 从零做（成本最高）/ B 不做（接受"人格不生长"）/ C 暂缓到 M4 后（推荐：先跑通 M0–M4 再评估） | NEED-USER |
| Q-02 | **Coopanion 是否进 L5** | 你 10-25 原话"完全能满足需求，甚至比当前项目更先进"；无弃用指令。盘点结论：`Cyrene-Agent`（MIT）的渲染层是许可干净的首选，`desktop-pet` 受 Live2D 重分发条款限制不可发布 | A 接 Cyrene 式渲染层 / B 保持 WebUI / C 先不决定 | NEED-USER |
| Q-03 | **A/C（MemoryWeaver 精华）范围与时机** | 10-27 05:52 已出职责切分；前提"先看 AMpath 的 memory/retrieval 多完整"**现已查明**。另有新选项：`ai-trpg-engine` 的确定性召回（210 行、无向量库、可复现）比 MemoryWeaver 更贴合 200–2000 条规模。**主人 2026-10-28 已同意"能做插件就做插件"** | A M4 先落 ai-trpg 式确定性召回，图谱/演化后置（推荐）/ B MemoryWeaver 以**子进程插件**形态接入（JSON-lines，不做代码级适配）/ C 只抄检索不抄图谱 | NEED-USER（团队建议 A：算法须进程内可单测；插件只治协议） |
| Q-04 | **视频/直播的启动时机** | 是能力不是非目标（10-27 04:58 原话）。**新供给**：`dsh-video-studio`（MIT，核心零耦合）可库级引入；`dsh-bili-workbench` 的 `bili-op/` 可子进程跑（默认不自动发布） | A M4 之后先做视频（有现成插件）/ B 与 M4 并行 / C 等 7 天自运行达成 | NEED-USER（团队建议 A + 只 vendor video-studio 核心，不采 bili-op 整链；直播独立立项） |
| Q-05 | **AI 内容标识** | 红队4 认定为法律风险；你 2026-10-28 明确"不要这个第 0 项" | 已按你的决定不做 | DECIDED-NO |
| Q-06 | **`connection` 的语义与符号** | 上游 `embodiment/temporal-rates.ts:90-104` 在"长时间无互动"时给 `connection **+**0.001×lonelyUnits`（孤独→连接上升）；但 `npc-state-machine.ts:75-91` 又把 `connection<0.3` 当作冷战条件。两者可能语义冲突：若 connection 是"连接感"，孤独不该让它上升；若是"渴望连接"，则冷战条件反了 | A 按"连接感"（孤独下降，需外部输入回补）/ B 按"渴望"（孤独上升，冷战另立阈值）/ C 先只做状态机、不加孤独项 | NEED-USER（团队建议：connection 保持存量 + 新增 `npcState.bond` 承载关系；无接触证据不判冷战） |
| Q-07 | **是否采用上游的昼夜节律项** | 上游按小时窗口结算（23–5 睡、6–9 晨、13–15 午后低谷，`temporal-rates.ts:84-92`），与我们"作息由状态决定、不设时间表"的决定可能冲突 | A 只作缓慢背景漂移，不参与醒/睡决策 / B 完全不用 / C 用但要可配置 | NEED-USER（团队建议：只进 night_mood/morning_curiosity/loneliness_mood 三项；挡三项 energy 与 loneliness_connection） |
| Q-08 | **是否允许 DSH 作为"视频/语音侧车"** | 部分 DSH 插件（`dsh-voice`、`dsh-autocut` 入口）绑 DSH 运行时，剥不干净。跑第二个宿主能直接用，但代价是双宿主/双模型/双状态 | A 不引入第二宿主，只用能剥出的库（推荐）/ B 允许 DSH sidecar 专做视频语音 / C 等 P2 再定 | NEED-USER（团队建议 A） |
| Q-09 | **批准排期修订**：拆 `G3a`（D3 进度门）/ `G3b`（D11 转段门）；kill 阈值 12/14→**11/14**、10/14→**9/14**；观测改绝对日期 11/10–11/23；日界 04:00；D8–D10 加 canary（重启/关机/410） | 排期组实测 D0–D3 最多 8 会话、现实需 18.75；D3 转段门必然失败并空转 11 天；12/14 从建设期起算数学上不可达 | A 按 `ROADMAP-2026-10-29.md` 批准（推荐）/ B 保留 D3 单门并整体顺延 / C 只改阈值不改门 | **APPROVED 2026-10-29（主人）；排期生效，D0 已完成** |
| Q-10 | **feed 要不要新的准入阈值**：产品席建议 `dm>0`（有没有人验过）二值门；风控席建议硬下限；两者都会改 feed 契约，且贴着 10-20 的否决 | 她 10-28 日记「没人验过的东西，我不打分」；团队已收回多命中免检（D-31），未加新数 | A 只收回免检，不加新阈值（**团队已按此落地**）/ B 加 `dm>0`（关注流豁免），未验过的少量留作「无从判断」/ C 加 `play>=50` | **NEED-USER**：①10-20 否的是「播放量进排序」还是「任何播放量门槛」？②选 A/B/C |

## 4. 环境与流程约束（BLOCKED / 需处理）

| ID | 问题 | 现状 | 影响 | 状态 |
|---|---|---|---|---|
| E-01 | GitHub 443 不通，**12 个提交未推**（含 `c6eb06e`、`de02d9f`、`b25d6d0`、`dbe5f13`） | `git status -sb` = ahead 12 | 远端与本地不一致，换机即丢 | BLOCKED（网络） |
| E-02 | archify 装不上（`npx skills add` 被墙、gh tarball 0 字节） | 已用 mermaid 出替代图（`ARCHITECTURE.md` §2.1） | 无交互式架构图 | BLOCKED（网络）/ 有替代 |
| E-03 | GitHub Actions 额度不足 | 不上 CI | 无自动门禁 | 改用本地 `npm run gates` + pre-push |
| E-04 | 文档 17 份、互相矛盾 10 组、docs 占 21% churn | 目标砍到 4 份（CURRENT/BLUEPRINT/ARCHITECTURE/PROCESS）+ archive | 每次改代码前要先分辨哪份为准 | OPEN |
| E-05 | 三个 scheduler 遗留检查 | DSH 插件 `clock.enabled=false`、HKCU `WhaleDraft` 已删、`nightly-scheduler.mjs` 进程已杀并标注停用 | 遗留进程已清 | FIXED |
| E-06 | `causal.jsonl` 1 条旧场值记录（trust/boredom/fulfillment） | `scripts/migrate-causal.mjs --dry` 预览，等你确认才改写真实状态 | 历史回读会看到不存在的场 | NEED-USER（低风险） |
| E-07 | Cortico 上游 0.2.8 已发布，本地 0.2.7 | 无 git，无法 merge | 升级=手工重做 | OPEN（随 D-16） |
| E-08 | 本机 AMpath 快照停在 10-07 | 已浅克隆最新 `8465cbb` 到 `~/.qoder/tmp/ampath-latest` | 旧快照会误导判断 | FIXED |
| E-09 | 两个会话同时改同一批文件 | 10-28 又出现并发提交（`9613fc6`） | 改动互相覆盖 | OPEN（需定单 Writer） |
| E-10 | `life.json` 出现 `lastKind: forced` 与 `FORCE_ACTION` | 强制轮与自然轮混在一起，统计口径失真 | 会污染"自主性"证据 | **FIXED**：强制轮只写 `manualForcedAt` + 队列 `kind='manual'`，不写 `lastKind`、不占 `actionsToday`/`lastActionAt`（2026-10-29） |
| E-11 | **B 站动态拿不到阅读数**（接口只给赞/评/转 `module_stat`） | 已核实；`ARCHITECTURE.md` §4.6 已改口径 | #21 内容效果复盘只能用互动率，不能用曝光 | FIXED（口径已更正） |
| E-12 | **P2 投稿的上传协议不在 bili-cli 仓库里**：它只是封装 `bilibili-api-python==17.4.2`，而该依赖上游已归档 | 已核实（`src/bili_cli/commands/dm.py` 同仓库结构，投稿走库内部） | P2 视频要么重写 upos 上传，要么换实现；是 P2 的头号风险 | NEED-USER |
| E-13 | **`dsh-video-studio` 的 `exports` 只有 `"."` 与 `"./package.json"`**，子路径 import 会抛 `ERR_PACKAGE_PATH_NOT_EXPORTED` | 研讨组4 实测包内 `package.json` | 不能 `npm i` 后 import 内部路径；必须 vendor 6 个核心文件 + LICENSE + SHA256SUMS | FIXED（方案已定：vendor） |

## 5. 已修复（留档，防止回退）

| ID | 问题 | 修法 | 证据 |
|---|---|---|---|
| F-01 | ack 路径穿越 | `ID_SHAPE` 白名单 + resolve 前缀校验 | drill 33/33 含 6 种穿越 |
| F-02 | 频率门吞效果 | 删除 `FrequencyGate`，同源效果全部生效 | 20 次 `masterReplied` → connection 累加 |
| F-03 | 场值离线穿基线 | `decayAtomicFields` 截断到基线 | 365 天与 21 天结果一致 |
| F-04 | 崩溃清空记忆 | 原子写 + `.bak` + schemaVersion + 坏文件留档 | 实测 `bakRecovered true` |
| F-05 | 令牌不可用 | 完整 token + `wx` 认领 + 常量时间比较 + TTL 12h | drill 四种拒绝路径 |
| F-06 | 门禁 2 小时自动放行 | 删除后门，`canDraft` 只认 `debriefed===true` | drill "未 debrief 被拒" |
| F-07 | 日记冻结导致重复文案 | `bili_diary_append` + 24h 新鲜度闸 + 当天日期块 + 跨日同文去重 | 10-28 日记含三个日期块 |
| F-08 | 审计结果不回写 | `draft-result` → `consumeDraftResults` 代码结算 | track-a 11/11 |
| F-09 | 记忆不写入 | debrief 成功后 `rememberWatch` | drill "debrief 后写入长期记忆" |
| F-10 | 硬耦合无上限 | `COUPLING_CAP_MS=12h` 分步结算 | persona 17/17（**但见 D-07：这个修法本身有问题**） |
| F-11 | 蓝图中 13 处曲解 | v2 更正 + 纪律第 3 条 | `BLUEPRINT.md` §9 |
| F-12 | 离线时 `/api/framework/release` 返回 500 并打 ERROR，每次启动都刷一条假故障 | 路由内降级：查不到 Release 只回 `{currentVersion}`，日志降为 warn；`readCurrentVersion` 单独可测 | 重启后 HTTP 200 `{"currentVersion":"0.2.7"}`；日志 `WARN 查框架 Release 失败,跳过更新提示` |
| F-13 | C2 跨日判定用小时采样，04:00 后不足一小时开机漏判；契约测试固定"21h 前"会随运行时刻翻转 | 改为精确算下一个 04:00 边界是否落在 `[armedAt, now]`；测试以最近日界 −9h 造 arm | `tests/contract/c2-offline.test.mjs` 1/1；gates 26+11 全过 |

## 6. 复发型教训（每次改代码前读一遍）

1. **"测试全绿"不能证明任何事**——门禁与测试同批写＝循环论证。三次外审抓到的全是"写了但没生效"。
2. **自评系统性虚高**（11→8.5→2/10）。任何"完成"必须附 run id / 命令输出 / 文件行号。
3. **抄旧值会制造事实错误**（v1 的"唤醒 0 次""日记冻结"）。坐标必须当天重测。
4. **用残缺证据下结论比原错误更严重**：v1 曾把用户消息截 400 字、助手截 1500 字，再在截断文件里 grep 词频当结论。证据必须完整、读上下文。
5. **不要把主人的优先级/限定条件写成否决**（BLUEPRINT §9 的 13 条）。无原话出处的"弃/非目标"一律标"助手判断·待拍板"。
6. **一个状态文件一个写者**；跨进程写必须锁 + 原子写。

## 7. 与 ARCHITECTURE.md 的对应

| ARCHITECTURE 期 | 覆盖本台账条目 |
|---|---|
| M0 止血 | D-01 D-02 D-03 D-10 D-11 D-12 D-15 D-16 D-18 D-23 E-09 |
| M1 情绪与场值 | D-05 D-06 D-07 D-13 D-14 D-19 D-24 D-26 Q-01 |
| M2 运行时 | D-08 D-09 E-10 |
| M3 传感器 | D-04 Q-03 Q-04 |
| M4 记忆改行为 | D-03（检索侧）D-26 |
| 持续 | E-01 E-02 E-04 E-06 E-07 |
