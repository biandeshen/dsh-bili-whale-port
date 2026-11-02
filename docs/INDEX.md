# INDEX · docs 的唯一入口与真相源仲裁

> owner：本文件。新增/退役 `docs/` 下的 md 都要回来登记一行。
> 立此文件的原因（2026-11-01 实测）：`docs/` 顶层 **37** 个 md（不含本文）、`docs/evidence/` **32** 个、`docs/team-2026-11-01/` **21** 个（`ls docs/*.md | wc -l`），此前**没有任何索引**；且改前的 `BLUEPRINT.md:1` 自称"架构与能力的唯一真相源"、`CURRENT.md:4` 把读者指向 BLUEPRINT、`PRODUCT.md:4` 同样指向 BLUEPRINT —— 三份文档互抢"唯一"，而分层名与代码不符（见 `ARCHITECTURE-2026-11.md` §8 第 2 条）。这三处已就地改掉，行号指的是改前位置。
> 从本文件起：**一件事只有一个真相源**，其余文档只有"历史证据/已废弃/专项"三种身份。

## 1. 真相源（其余全部让位）

| 你要问的是 | 真相源 | 锚点（它凭什么权威） |
|---|---|---|
| **架构**：代码里现在怎么跑、谁写哪个文件、安全边界在哪 | [`ARCHITECTURE-2026-11.md`](./ARCHITECTURE-2026-11.md) | 首行就声明 owner 是 `Cortico/src/worlds/bili-account/definition.ts` + `dsh-bili-whale/tools/bili.mjs`（`:1`）；每条箭头带 `file:line`；与旧文档的十条出入集中在 §8 |
| **现状**：到哪了、接下来做什么、一分钟怎么起来 | [`CURRENT.md`](./CURRENT.md) | 按日期倒序的进度台账；每条带提交号/命令/证据卡路径 |
| **任务推进**：这一轮改什么、按什么顺序、凭什么算做完 | [`ARCHITECTURE-DECOUPLING-2026-11-01.md`](./ARCHITECTURE-DECOUPLING-2026-11-01.md) | §8 是带依赖与验收命令的总任务单（25 步）；§0 定落哪条代码线；§7 定验收口径 |
| **产品**：她该是什么、北极星、拍板过的产品口径 | [`PRODUCT.md`](./PRODUCT.md) | 产品定义，不是实现说明；北极星第六条见 2026-11-01 `d83dc95` |
| **判据**：怎么算"活过来"、观测期红线、开窗顺序 | [`OBSERVATION-PROTOCOL.md`](./OBSERVATION-PROTOCOL.md) + [`evidence/G3B-DECISION-2026-11-01.md`](./evidence/G3B-DECISION-2026-11-01.md) | 协议定义 K1/K2/K3/K4 与污染；判定卡记 G3b 机器 PASS 的真实边界与"接入日"决定 |
| **版本与变更**：这一版包含什么 | 根 [`../CHANGELOG.md`](../CHANGELOG.md) + `package.json` 的 `version` + git tag `port-0.5.2` | 里程碑级；规矩见本文 §4 |

> **2026-11-02 补记**：上表原本是"五份"，缺"任务推进"这一栏。后果实测过——本索引 0 次提到
> `DECOUPLING`，而这两天实际在照它干活；同时 `CURRENT.md` 的测试数字停在 11-01 的
> 321 pass / 60 文件（现为 399 pass / 73 文件）。**任务单与执行账都进不了册，索引就等于一份过期目录。**
> 现在补上，并把三份 DECOUPLING 文档按角色分开登记（见下表）。

**这三份的关系，别搞混**：

| 文件 | 角色 | 会不会每天改 |
|---|---|---|
| `ARCHITECTURE-DECOUPLING-2026-11-01.md` | **任务单**：25 步、依赖、验收命令、卡住怎么办 | 只在计划变更时改 |
| `DECOUPLING-BASELINE-2026-11-01.md` | **落线声明**：改在哪条代码线、当时五条门的实测 | 只追加 |
| `DECOUPLING-STATUS-2026-11-02.md` | **执行账**：每步做了没有、拿哪条命令证明、哪些判断被推翻过 | 每轮追加 |
| `ARCHITECTURE-TARGET-2026-11-03.md` | **重写方案（唯一依据）**：现架构六处耦合的实测清单 + 目标四包边界（bot / world / persona-core / 部署）+ 五阶段迁移与回滚；§5 末另挂三条**待收**（第六席缺失、P2 门禁 runner 说错、P1 门禁非命令判定） | 方案变更时改；它不改代码，代码改完要回来对一次。**它是方案不是排期：主人看过之前不构成开工凭据** |
| ~~`PLAN-2026-11-03.md`~~ | **已废止（2026-11-03 删除）**：原本是"六席合并成一份推进依据 + 六阶段排期"，但它是**未经主人审阅就落仓并触发开工**的排期表，不是方案。三条冲突裁决已归位到 `ARCHITECTURE-TARGET-2026-11-03.md` §4（配置落点唯一 owner）/§5（门禁口径）/§6（粒度＝业务域） | 不再登记；原文 `git show 36147ed:docs/PLAN-2026-11-03.md` |

**不再自称真相源、但仍有效的那两份**：

- [`BLUEPRINT.md`](./BLUEPRINT.md) —— 架构部分**已被 `ARCHITECTURE-2026-11.md` 取代**（L1–L5 分层名与代码不符，且文件自己承认三版并存）。仍然有效的是**四域 50 项能力坐标**（§3，作为清单，不作现状）与**改动纪律**（§1 开头三条：坐标必须当天实测、"弃/不做"必须附主人原话与时间戳）。§9 是更正记录，只追加不改。
- [`ARCHITECTURE.md`](./ARCHITECTURE.md)（v1，2026-10-28 方案）—— M0–M4 的**设计意图与裁决表**仍是历史依据；其中"现状"类断言（§0 的 `buildText` 只吃日记）已过期，就地标了废止，指向 `ARCHITECTURE-2026-11.md` §8 第 1 条。

## 2. 全部文档登记表

状态词：**现行** = 每天会被引用的活文档 · **历史证据** = 只追加、内容不改 · **已废止** = 结论被取代，看指向 · **专项** = 一次性研究/模拟，结论看引用处。

### 顶层 · 现行

| 文件 | 用途 / 注意 |
|---|---|
| `INDEX.md` | 本文，docs 入口 |
| `CURRENT.md` | 现状真相源；**日期开头的条目是台账，不是现状数字**，数字按 §3 复跑 |
| `ARCHITECTURE-2026-11.md` | 架构真相源 |
| `PRODUCT.md` | 产品真相源 |
| `OBSERVATION-PROTOCOL.md` | 判据真相源（协议原文，10-30 主人裁决已并入 §2/§3/§6） |
| `ISSUES.md` | 问题台账：`OPEN/DOING/FIXED/BLOCKED/NEED-USER`；改 FIXED 必须附命令输出或 `文件:行号` |
| `RUNBOOK.md` | 给 AI 执行的真机部署手册 |
| `DEPLOY.md` | 人工部署清单（DSH / OpenCode / 面板 / Termux） |
| `CORTICO-RUNBOOK.md` | Cortico 侧进程、端口、单一调度器约束 |
| `CORTICO-PATCHES.md` | Cortico 侧改动清单 |
| `STOP-RUNBOOK.md` | 判停时执行什么；触发条件引 `DECISION-2026-10-28.md` §3.3 与 `ROADMAP-2026-10-29.md` §5 |
| `TEAM.md` | 常设编制与议事规则（挑刺组是固定席位） |
| `BASELINE.md` | 移植前行为冻结 + 路由清单 —— **被 `tests/contract/routes.test.mjs:54` 当作断言源**，路由表不许随手改 |
| `TERMUX.md` | 手机部署 |
| `CREDITS.md` | 素材许可（鲸鱼娘 CC BY-NC-SA、vendor MIT、AMpath 私有无 LICENSE） |
| `REUSE-MATRIX.md` | 供给盘点（许可/分支/成本）；原则出处在 `BLUEPRINT.md` §4 |
| `ARCHITECTURE-DECOUPLING-2026-11-01.md` | **任务推进真相源**：§8 的 25 步总任务单（依赖 / 验收命令 / 降级方案）；§0 落线、§7 验收口径 |
| `DECOUPLING-BASELINE-2026-11-01.md` | 落线声明（只追加）：改在哪条代码线、当时五条门的实测 |
| `DECOUPLING-STATUS-2026-11-02.md` | 执行账（每轮追加）：每步做了没有 + 复验命令 + 被推翻的判断 |

### 顶层 · 已废止（指向 X）

| 文件 | 状态 | 看哪里 |
|---|---|---|
| `BLUEPRINT.md` | 架构部分废止（能力坐标与纪律仍用） | `ARCHITECTURE-2026-11.md` |
| `ARCHITECTURE.md` | v1 方案；现状类断言废止，§6/§9 的 M0–M4 与待拍板仍是被引用的设计 | `ARCHITECTURE-2026-11.md` §1/§2/§7 |
| `ROADMAP-2026-10-29.md` | 排期已跑到 11-01 接入日；D 序号≠日期 | `CURRENT.md` 顶部 + `ISSUES.md` |
| `PLAN-REVIEW-2026-10-28.md` | 18 处分歧裁决已并入 `ARCHITECTURE.md` 与实现 | `ARCHITECTURE-2026-11.md` |
| `CLOSEOUT.md` | 2026-10-25 那次"冻结"说明；项目随后被移植工程复活 | `CURRENT.md`、`../CHANGELOG.md` |
| `PROJECT-HISTORY-2026-10.md` | 10-24→10-28 对话梳理，历史叙述 | —— |
| `PR-port-core-opencode-panel.md` | port-0.1.0 时点的 PR 描述（含当时的 122 项） | `../CHANGELOG.md` 的 port-0.5.0 段 |
| `E-CORTICO-02-BRIEF.md` / `E-CORTICO-03-BRIEF.md` | 立项卡，已执行完 | `ISSUES.md` |

### 顶层 · 专项（一次性研究/快照，别当现状读）

`AMPATH-ABSORB-2026-10-30.md`、`AMPATH-BRANCH-STUDY-2026-10-30.md`、`PLUGIN-ECOSYSTEM-AUDIT-2026-10-30.md`、`PLUGIN-INTEGRATION-PLAN-2026-10-30.md`、`PLUGIN-RADAR-2026-10-30.md`、`MODULARITY-2026-10-30.md`（M1a–M1e/M2 已落 live，剩余批次看 `CURRENT.md`）、`TEAM-GAP-ANALYSIS-2026-10-30.md`、`DRIVE-V2-SIM-2026-10-31.md`（只比数，**未采纳**，live rhythm 未动）、`PRODUCT-ROADMAP-2026-10-31.md`（纸面对齐，拍板项见文末）、`GOAL-AUDIT-2026-10-29.md`（11-01 已作废的时点快照，判据看真相源）、`HANDOFF-2026-10-29-NIGHT.md`、`DECISION-2026-10-28.md`（G0 选 P5′；§3.3 判停条件仍被 `STOP-RUNBOOK.md` 引用，那一节算现行）。

### 历史证据类（**只追加，不改内容**）

| 目录/文件 | 性质 |
|---|---|
| `evidence/*.md`（32 个） | 单次裁决/演练/上线的原始证据卡（D0–D39、M*、G3a、G3b、C2、PERM-TIER、OPS-FIXES、V1、DYNAMIC、backup-2026-10-29/*）。过期了也不改——它是"当时成立"的凭证 |
| `SEGMENT-2026-10-27-1341.md` | 逐轮对话梳理。**当前有别的席的未提交改动，不要 add、不要 checkout** |
| `team-2026-11-01/**`（21 个，含 round2/round3） | 六席研究产出与逐条判定表；`round3/four-questions-decisions.md`、`round3/proxy-surface.md` 目前是**未跟踪文件**，归属主人与其它席 |
| 根 `AI-SHARE-TRIAL.md`、`DM-HISTORY-FIX.md`、`VISION.md`、`NOTICE.md` | 上游 0.4.x 时期的记录与原作者意图；`VISION.md` 是上游作者原话，不重写 |

### 不属于 docs/ 的两处

`tools/docs/*.md`（5 个，B 站接口/富文本节点速查，owner 是 `tools/`）；`adapters/opencode/README.md`、`assets/bgm/README.md`（组件自带说明）。

## 3. 数字的复跑口径（文档里不许多处硬编码结果）

任何"全量绿了"的话，写法是**命令 + 本文写作时的读数 + "数字会随提交变化"**。2026-11-01 本机复跑：

| 门 | 命令 | 本次输出 |
|---|---|---|
| dsh 全量 | `node scripts/run-mjs-tests.mjs` | `ℹ tests 321`、`pass 321`、`fail 0`、`EXECUTED=60`（60 个 `.mjs` 测试文件） |
| 验收脚本哈希 | `node scripts/check-hashes.mjs` | 12 行 `OK` + 最后一行 `一致`，exit 0 |
| 生产调用检查 | `node scripts/check-consumers.mjs` | `全部有生产调用`，exit 0 |
| 观测窗状态 | `node scripts/observation-status.mjs` | `观测尚未开始：G3b 通过后创建 control/observation.json（{startDay, days:14}）` |
| 目标完成审计 | `npm run audit:goal` | 逐项对账，不接受"测试全绿"替代 |
| 全部门禁 | `npm run gates` | 上面几项 + **Cortico 侧套件**（`--root ../Cortico`）；Cortico 目录由另一席维护，本文不代跑也不抄它的数 |
| 行为冻结 | `bash scripts/evaluate.sh quick` / `full` | 快速/完整验收剧本 |

已按本口径处理掉旧硬编码的 **6 处 `122`**：`RUNBOOK.md` 第 0 节、判据行、第 5 节共三处，`DEPLOY.md` 共同前提一处，`PR-port-core-opencode-panel.md` 概要表与验证块各一处。现在留下的 "122" 全部带"port-0.1.0 那一版的数"这个限定词，**没有任何一处把条数当判据**——判据统一是 `fail 0`。

## 4. 版本与 tag 的规矩

1. **版本线只有一条**：上游 `v0.4.6`（2026-10-24，tag 在）之上的移植工作用 `port-0.x.y`，`package.json` 的 `version` 是产品版本号（现 `0.5.2`），两者一起走。历史遗留的 `v0.1.x–v0.4.6` 是上游轻量 tag，不动、不重打。**已知不一致**：`port-0.5.1` 打了 tag 但没 bump `package.json`（停在 `0.5.0`），`0.5.2` 起两者重新对齐——旧 tag 不重打。
2. **什么时候打 tag**：一个**能被 `node scripts/run-mjs-tests.mjs` 全绿复现**的里程碑收口时（不是每个提交、也不是每条 dev 分支）。tag 前必须复跑并把真实数字写进 `CHANGELOG.md`。
3. **谁打**：改动的那一席在本地打**附注 tag**（`git tag -a`），message 里写"这一版包含"+ 可验证物（commit 号、文件、命令）。
4. **不 push**：本仓的 tag 与提交默认**只留本地**；`private` 远端（`biandeshen/dsh-bili-whale-port`）只在主人明说"推"的时候推，`upstream`（`Alterssss/dsh-bili-whale`）是公开仓，**不推**（AMpath 借用件与 CC BY-NC-SA 素材未清干净，见 `CREDITS.md`、`CURRENT.md` 约定节）。
5. **CHANGELOG 写法**：里程碑级条目，每条带日期与可验证物；不逐提交流水，不抄本文 §3 的数字。

## 5. 改文档的四条纪律

1. 现状数字必须当天复跑得到，写命令与读数；抄旧文档要在旁边标"（未复跑）"。
2. 一件事只允许一个真相源；要换真相源，改本文 §1，别在两份文件里各写一个"唯一"。
3. 历史证据类（`evidence/*`、`SEGMENT-*`、`team-2026-11-01/*`、根目录上游记录）**不改内容**，需要更正就在新增段落或本文里指向它。
4. 结论被推翻时，旧文档就地标废止 + 指向新出处，不删（删了就没人知道当初为什么那样定）。
