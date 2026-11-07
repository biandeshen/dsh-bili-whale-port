# docs 目录说明与文档治理（唯一入口）

> 本页是 `dsh-bili-whale/docs/` 的**目录说明与维护规则**。它不承载事实，只回答三件事：一份文档该放哪、谁是真源、改了代码要动哪几页。
> 事实性的"现在是什么状态"在 `STATUS-2026-11-01.md` 与 `CURRENT.md`；技术结构在 `ARCHITECTURE-2026-11.md`；改造方案在 `ARCHITECTURE-DECOUPLING-2026-11-01.md`。

## 1. 现状：38 份文档、42 万字符，四类重复

2026-11-01 实测：`docs/*.md` 共 **38 份 / 423,135 字符**。其中 17 份提到"架构"、33 份提到"状态"、19 份提到"问题"、13 份提到"部署"——同一个主题在三四份文件里各写一遍，改一处就要记得改三处。

重复有三种形态，处理方式不同：

| 形态 | 例子 | 处理 |
|---|---|---|
| **同主题多版本**（后写的替代先写的） | `ARCHITECTURE.md`(v1 设计意图) / `ARCHITECTURE-2026-11.md`(现状真相源) | 保留两份但明确分工，标题里写清"v1 设计意图"与"现状" |
| **同主题平行副本**（都自称权威） | `BLUEPRINT.md` §1 五层架构 / `MODULARITY-2026-10-30.md` / `ARCHITECTURE-DECOUPLING-2026-11-01.md` | 合成一份：架构=ARCHITECTURE-2026-11；解耦=DECOUPLING；BLUEPRINT 只留"能力清单"，架构章节改指针 |
| **按日期的过程档**（计划/复盘/交接） | `PLAN-REVIEW-2026-10-28`、`HANDOFF-2026-10-29-NIGHT`、`GOAL-AUDIT-2026-10-29`、`SEGMENT-2026-10-27-1341`… | 不删不改内容；只在本文登记"归档，不再更新" |

## 2. 文档分层（每份文档只属于一层）

```
第 0 层  入口与规则：    README.md（本页）  INDEX.md（真相源仲裁）
第 1 层  真相源（会变，改代码就改它）：
           STATUS-2026-11-01.md   未决问题/决策/模型选型/上游  ← 运营唯一真源
           CURRENT.md             移植工程现状
           ARCHITECTURE-2026-11.md 系统结构与数据流（技术唯一真源）
           ISSUES.md              问题台账（编号唯一空间）
第 2 层  方案（描述"要怎么改"，不描述"现在是什么"）：
           ARCHITECTURE-DECOUPLING-2026-11-01.md   解耦/模块化/可插拔改造
           PRODUCT.md / PRODUCT-ROADMAP-2026-10-31.md  产品目标与功能规划
           ROADMAP-2026-10-29.md   推进顺序
第 3 层  运维手册（照做就行）：
           RUNBOOK.md / STOP-RUNBOOK.md / DEPLOY.md / OBSERVATION-PROTOCOL.md / BASELINE.md
第 4 层  过程档（只读历史，不再更新）：
           SEGMENT-* / PLAN-REVIEW-* / HANDOFF-* / GOAL-AUDIT-* / DECISION-* /
           AMPATH-* / DRIVE-V2-SIM-* / E-CORTICO-0x-BRIEF / CLOSEOUT / PROJECT-HISTORY /
           PLUGIN-* / REUSE-MATRIX / MODULARITY-2026-10-30（已被 DECOUPLING 取代）
```

规则：**第 1 层只许有一份说同一件事**；第 2 层不得复述第 1 层的事实（用指针）；第 4 层不改内容，只允许在文件顶部加一行"归档于 YYYY-MM-DD，见 <替代文档>"。

## 3. 六条维护规则（写进评审，违反即视为缺陷）

1. **一份事实一个家**：某个数字/状态只在第 1 层出现一次；别处引用写路径，不抄数值。
   （现状反例：门禁数字 354/363/103/1231 在不同文档里并存。）
2. **文档不抄可重跑的命令输出**：写"跑 `npm run gates`，结果存 `docs/evidence/gates-<日期>.json`"。
3. **改代码必须改对应页**：每页首行写明 owner（哪个文件变了就改本页）。`ARCHITECTURE-2026-11.md` 已有此约定，其余页补齐。
4. **过程档追加，不修改**：复盘/交接/计划只要定稿就冻结；新结论写进第 1 层，不回头改旧档。
5. **归档要在本文登记**：新增过程档必须在本页第 5 节加一行，否则视为散档。
6. **过期就删行，不留"曾经"**：第 1 层只写"现在还欠什么"；已解决的事实进 git/CHANGELOG。

## 4. 这次整理做了什么、没做什么

**做了**：
- 建立本页作为目录说明与规则；
- 给每份文档定层（第 5 节表格），标出 4 份平行副本并指定唯一保留者；
- 把 A 方案（状态根单一化）的迁移步骤展开进 `ARCHITECTURE-DECOUPLING-2026-11-01.md`。

**没做（故意的）**：
- **没有合并或删除任何既有文档**——42 万字符里含着大量 incident 证据与决策过程，压缩会丢细节；这次只做"归属与指针"。
- **没有改 `INDEX.md`**——它是真相源仲裁页，改动应与第 1 层同步在一个 commit 里做。
- **没有动 Cortico 仓的 `docs/`**（上游英文文档 14 份 + 我们加的 `WEBUI-AUTH-2026-11.md`）：那批是框架文档，另有 owner。

## 5. 全部文档清单与归属（38 份）

| 文档 | 层 | 职责一句话 | 动作 |
|---|---|---|---|
| `README.md` | 0 | 本页：目录说明与治理规则 | **新建** |
| `INDEX.md` | 0 | 真相源仲裁（哪份说了算） | 保持；与第 1 层同批更新 |
| `STATUS-2026-11-01.md` | 1 | 未决问题 / 决策 / 模型选型 / 上游 | **运营唯一真源**，只增删第三节 |
| `CURRENT.md` | 1 | 移植工程现状 | 删掉与其他页重复的架构叙述，改指针 |
| `ARCHITECTURE-2026-11.md` | 1 | 系统结构、数据流、端口、状态清单、安全边界 | **技术唯一真源** |
| `ISSUES.md` | 1 | 问题台账（编号空间） | 保持；`EXECUTION` 的 #NN 应并入此处 |
| `ARCHITECTURE-DECOUPLING-2026-11-01.md` | 2 | 解耦/模块化/可插拔改造方案（含 A–F 展开） | **本日扩充** |
| `PRODUCT.md` | 2 | 北极星与 6 条标准 | 保持 |
| `PRODUCT-ROADMAP-2026-10-31.md` | 2 | 发送控制面 + 全量功能规划 | 保持 |
| `ROADMAP-2026-10-29.md` | 2 | 推进顺序 | 与 `STATUS` 第三节去重（只留顺序，不留状态） |
| `RUNBOOK.md` | 3 | 日常运维 | 保持 |
| `STOP-RUNBOOK.md` | 3 | 判停流程 | **需改**：kill 覆盖面的表述与代码不符（审计 P0-5） |
| `DEPLOY.md` | 3 | 换机/新部署 | 需补"全新机器 bootstrap"一节（审计发现缺失） |
| `OBSERVATION-PROTOCOL.md` | 3 | 观测口径 | 保持；14 天窗不再冻结改动 |
| `BASELINE.md` | 3 | 基线冻结（被 3 处代码引用） | **不可改名**（`grep docs/BASELINE.md` 有 3 处引用） |
| `CORTICO-RUNBOOK.md` | 3 | Cortico 宿主运维 | 与 `RUNBOOK.md` 合并候选（下一轮） |
| `CORTICO-PATCHES.md` | 3 | 我们对上游的补丁清单 | 保持（上游认亲后要重写） |
| `ARCHITECTURE.md` | 4 | v1 设计意图与 M0–M4 规格 | 顶部加"设计意图，现状见 ARCHITECTURE-2026-11" |
| `BLUEPRINT.md` | 2/4 | 50 项能力清单 | 架构章节改指针到 ARCHITECTURE；能力清单保留 |
| `MODULARITY-2026-10-30.md` | 4 | 早期模块化边界 | 已被 DECOUPLING 取代 → 顶部加归档行 |
| `EXECUTION-2026-11-01.md` | 2 | 当日执行清单 | 完成后并入 ISSUES/STATUS，本页冻结 |
| `SEGMENT-2026-10-27-1341.md` | 4 | 历史分段记录 | 冻结（已由主人要求不得改动） |
| `PROJECT-HISTORY-2026-10.md` | 4 | 项目史 | 冻结 |
| `PLAN-REVIEW-2026-10-28.md` | 4 | 计划评审 | 冻结 |
| `DECISION-2026-10-28.md` | 4 | 决策记录（判停判据） | 冻结；新决策进 STATUS |
| `GOAL-AUDIT-2026-10-29.md` | 4 | 目标审计 | 冻结 |
| `HANDOFF-2026-10-29-NIGHT.md` | 4 | 交接 | 冻结 |
| `AMPATH-ABSORB-2026-10-30.md` | 4 | AMpath 吸收结论 | 冻结 |
| `AMPATH-BRANCH-STUDY-2026-10-30.md` | 4 | AMpath 分支研究 | 冻结 |
| `DRIVE-V2-SIM-2026-10-31.md` | 4 | Drive v2 模拟 | 冻结 |
| `E-CORTICO-02-BRIEF.md` / `E-CORTICO-03-BRIEF.md` | 4 | 外部评审 brief | 冻结 |
| `REUSE-MATRIX.md` | 4 | 可复用资产矩阵 | 冻结（复用决策进 DECOUPLING §4E） |
| `PLUGIN-ECOSYSTEM-AUDIT-2026-10-30.md` | 4 | 插件生态审计 | 冻结 |
| `PLUGIN-INTEGRATION-PLAN-2026-10-30.md` | 4 | 插件接入计划 | 冻结；接入结论进 DECOUPLING §4E |
| `PLUGIN-RADAR-2026-10-30.md` | 4 | 插件雷达 | 冻结 |
| `CLOSEOUT.md` | 4 | 收口记录 | 冻结 |
| `PR-port-core-opencode-panel.md` | 4 | PR 说明 | 冻结 |
| `PRODUCT-ROADMAP-2026-10-31.md` | （见上） | — | — |

## 6. 三件整理任务（全部展开，按此顺序执行）

三件都只动文档，不动代码行为；每件一个 commit，做完跑 `node scripts/check-hashes.mjs` 确认没碰冻结文件。

---

### 6.1 合并两份 runbook（实为分层，不是删一份）

**实测现状**：两份讲的是**不同东西**，直接合并会丢内容。

| | `RUNBOOK.md`（31 处引用） | `CORTICO-RUNBOOK.md`（10 处引用） |
|---|---|---|
| 章节 | 开场自检 / DSH 部署 / whale-panel(已退役) / OpenCode / Termux / 统一验收证据 / 故障速查 / 给 AI 的启动指令 | 进程与地址 / 人设单一来源 / Provider / World:bili-account / 每轮流程 / 审批 / 纪律 / 排障 |
| 描述的是 | **多宿主移植期**（DSH 桌面端 / OpenCode / Termux 三条跑法） | **当前唯一宿主**（Cortico）的日常 |
| 读者 | 要把这套搬到别的宿主的人 | 每天运维的人 |

结论：**不是合并内容，是分层与改名**——把"Cortico 日常"提到正门，把"多宿主移植期"降为附录。

**步骤**
1. `git mv CORTICO-RUNBOOK.md RUNBOOK.md` 前先做反向：新建 `RUNBOOK-CORTICO.md`（正式名），把现 `CORTICO-RUNBOOK.md` 内容整体移入，**不加不改一字**。
2. 现 `RUNBOOK.md` 改名为 `RUNBOOK-MULTIHOST.md`，文件顶部加一行：
   `> 归档 2026-11-01：DSH/OpenCode/Termux 移植期手册。当前宿主看 RUNBOOK-CORTICO.md。`
3. **改引用**：31 处 `RUNBOOK.md` 里，逐条判断指哪一份——
   - 讲"每天怎么起停她、端口、审批" → 指向 `RUNBOOK-CORTICO.md`
   - 讲"部署到 DSH/Termux、Termux 安装" → 指向 `RUNBOOK-MULTIHOST.md`
   - 判定不了的一律指向 `RUNBOOK-CORTICO.md`（当前宿主优先），并在该行加注释标原文件。
   引用点分布（实测）：`docs/` 内 10 处、`scripts/` 与 `tools/` 里若干，全部用 `grep -rn "RUNBOOK.md"` 逐条改。
4. `README.md`（本页）第 5 节表格同步更新两份的层与职责。
5. 用 `grep -rn "docs/RUNBOOK\.md\|docs/CORTICO-RUNBOOK\.md"` 收尾，确认无悬空指向。

**验收**：`grep -rc "CORTICO-RUNBOOK"` = 0（旧名彻底消失）；所有 `RUNBOOK*` 引用都能落到实际存在的文件；新入口一页能回答"她怎么起来、端口多少、审批在哪"。
**规模**：0.5 天。**风险**：改名断引用——所以步骤 3 必须在同一次 commit 里完成，且改完跑一次 `node scripts/run-mjs-tests.mjs`（有测试会读文档路径）。

---

### 6.2 编号并轨（#NN / D-Q-E-F / ISSUE-xxx 三套并存）

**实测现状（三套，互不相认）**

| 空间 | 位置 | 形态 | 数量 | 状态词 |
|---|---|---|---|---|
| ① 执行号 | `EXECUTION-2026-11-01.md` | `#26`…`#58` | 33 个唯一 | 无（靠"已完成/待办"文字） |
| ② 台账号 | `ISSUES.md` | `D-01`…`D-40` / `Q-01`…`Q-10` / `E-01`…`E-13` / `F-01`…`F-13` | **76 条** | `OPEN/DOING/FIXED/BLOCKED/NEED-USER/DECIDED-NO/WONTFIX`（**FIXED 必须附证据**） |
| ③ 总账号 | `STATUS-2026-11-01.md` §3 | `51/61`、`26`、`34`…（裸数字） | 13 行 | 无 |

`ISSUES.md` 已经比另外两套严格（有状态词表、FIXED 必附证据、§7 有"M 期→ID"映射），所以**以它为唯一空间**，不是新建第四套。

**一个必须先解决的重名**：`ISSUES` 的 `F-01…F-13` 表示**已修复**；`ARCHITECTURE-DECOUPLING` 的 `F1/F2/F3` 表示**结构断层**。同一个字母两种含义。

处理：解耦文档里的断层改称 **`FR-1/FR-2/FR-3`**（Fracture），一次全文替换（3 处定义 + 6 处引用），并把 `ISSUES` 的 F- 段标题从"已修复"改成"**已修复（FX-）**"以免与新号空间混淆——两个改动都只改文档，不改代码。

**并轨目标结构**（`ISSUES.md` 变为唯一台账，保留原四段）

```markdown
## 1. 致命缺陷（阻断"活着"）
| ID | 问题 | 证据 | 影响 | 期 | 状态 | 旧号 |
| D-01 | … | … | … | M0 | FIXED（证据…） | #56 |
```

**新增一列 `旧号`**，把 `#NN` 与 STATUS 的裸数字全部写进去；ID 一律沿用现有 `D-/Q-/E-`，**不重新编号**（重新编号会让 git 历史、提交说明、会话记录全部对不上）。

**迁移步骤**

1. **建映射表（dry，不写盘）**：`scripts/merge-issue-ids.mjs --dry`
   输入：`EXECUTION` 的 33 个 `#NN`（附其标题）、`STATUS` §3 的 13 行、`ISSUES` 的 76 个 ID（附标题/状态）。
   输出：`docs/evidence/id-map-<日期>.csv`，三列 `canonical_id, old_ids, title`。
   匹配规则（按优先级）：① 标题关键词完全一致 ② 同一文件:行 证据 ③ 人工判定。
2. **人工过一遍**（这一步不可省）：`#53+#45` 这种合并号要拆；`#31/#33/#51/#52/#57/#58` 在 ISSUES 里都已经有对应 D-/E- 条目，只需在"旧号"列写上；`#26`（通知）与 `Q-xx` 可能有对应。
3. **只改 ISSUES.md**：加 `旧号` 列；对确实没有对应条目的 `#NN`，新增一行（该问题的描述从 EXECUTION 原文搬，不重写）。
4. **冻结另外两处**：
   - `EXECUTION-2026-11-01.md` 顶部加 `> 编号已并入 ISSUES.md（见"旧号"列）。本页冻结，不再更新。`
   - `STATUS-2026-11-01.md` §3 的编号列改成 `D-xx（旧 #NN）`，并指向 `ISSUES.md`。
5. **防复发**：`scripts/check-issue-ids.mjs` 进 `gates`——`docs/*.md` 里出现 `#\d{1,3}` 形式的**新**引用即报错（允许在"旧号"列与冻结页出现）。

**验收**
- 任一 `D-/Q-/E-` 能在 `ISSUES.md` 唯一定位一行；
- 任一 `#NN` 都能在"旧号"列找到（`grep -c` 覆盖 33/33）；
- `STATUS` §3 与 `ISSUES` 对同一问题给出同一 ID；
- `check-issue-ids.mjs` 绿；
- 没有新增编号空间（`ISSUE-xxx` 这个想法作废——用现有 D-/Q-/E- 即可）。

**规模**：1–1.5 天（映射与人工核对占大半）。**风险**：`#53+#45` 这类合并号、以及同一问题在两个编号空间描述不同——所以第 1 步只出 dry CSV，第 2 步必须人看；**不重新编号**是为了保住历史可追溯。

---

### 6.3 给第 1–3 层补 owner 首行

**实测**：12 份核心文档里，**只有 `STATUS-2026-11-01.md` 写了 owner**，其余 11 份缺。缺 owner 的后果已经在发生：`ARCHITECTURE.md` 与 `ARCHITECTURE-2026-11.md` 都讲架构，没人知道该改哪份。

**统一格式**（放在标题下一行，第二行起用引用块）：

```markdown
# <标题>
> Owner: `<相对路径或接口>` —— 这个文件变了就改本页；次级 owner：`<路径>`（可选）
> 层：1 真相源 | 本页回答：<一句话> | 不回答：<一句话>
```

**逐份要写的 owner**（按实际代码归属定，不是猜）：

| 文档 | Owner |
|---|---|
| `CURRENT.md` | `Cortico/src/worlds/bili-account/definition.ts` + `dsh-bili-whale/tools/bili.mjs` |
| `ARCHITECTURE-2026-11.md` | 已有（保留，补"层/回答什么"两行） |
| `ISSUES.md` | `~/.dsh/bili-whale/control/feedback.jsonl` + `docs/EXECUTION-*.md`（来源） |
| `PRODUCT.md` | `Cortico/src/worlds/bili-account/ENV_PROMPT.md` + `Cortico/bots/cormini/persona/*` |
| `RUNBOOK-CORTICO.md`（新名） | `scripts/start-cortico.mjs` + `deployments/mybot/config.json` |
| `RUNBOOK-MULTIHOST.md`（新名） | `scripts/setup.mjs` + `adapters/opencode/*` |
| `STOP-RUNBOOK.md` | `tools/lib/kill.mjs` + `tools/lib/traffic.mjs` |
| `DEPLOY.md` | `scripts/setup.mjs` + `scripts/preflight.mjs` |
| `BASELINE.md` | `scripts/check-hashes.mjs` + `tests/contract/*`（**不可改名**） |
| `OBSERVATION-PROTOCOL.md` | `scripts/observation-*.mjs` + `scripts/g3b-check.mjs` |
| `ROADMAP-2026-10-29.md` | 无代码 owner（顺序约定）→ 标"层 2，不回答状态" |
| `PRODUCT-ROADMAP-2026-10-31.md` | `tools/lib/publish-policy.mjs`（发送控制面部分） |
| `ARCHITECTURE-DECOUPLING-2026-11-01.md` | `tools/lib/paths.mjs`（A）+ `src/worlds/bili-account/definition.ts`（C） |

**步骤**
1. 先只在**层 1**（4 份）补，跑一次"owner 指向的文件是否存在"的检查脚本。
2. 再补层 2（5 份）、层 3（4 份）。
3. 新增文档必须带 owner，否则 `scripts/check-docs-owner.mjs` 报错（把这条加进 `gates`）。

**验收**：`grep -L "Owner:" docs/*.md` 里只剩过程档；`check-docs-owner.mjs` 通过；任取一份文档，其 owner 路径 `ls` 得到。
**规模**：0.5 天。**风险**：owner 写错比不写更糟——所以第 1 步先验证路径存在。

---

### 6.4 三件的执行顺序与相互依赖

```
6.3 补 owner（先做：它让后两件有归属可查）
   ↓
6.2 编号并轨（依赖 6.3 确定的 ISSUES owner）
   ↓
6.1 runbook 改名（最后做：改引用面最大，前面已把文档结构稳定下来）
```

做完三件，`README.md` 第 5 节表格要按新文件名重写一次；`INDEX.md` 同批更新（它是仲裁页，不能滞后）。

## 7. 整理之后怎么不让它再散（四条机制）

整理只做一次，复发是常态。四条机制按"能不能被机器拦住"排序：

| 机制 | 做法 | 拦住什么 | 成本 |
|---|---|---|---|
| **M1 文档 owner 检查** | `scripts/check-docs-owner.mjs`：层 1–3 的 `.md` 首 5 行必须有 `Owner:`，且 owner 路径存在；进 `gates` | 新文档没归属、owner 指向已删文件 | 0.5 天 |
| **M2 单事实源检查** | 一条测试：`gates` 数字、`测试总数`、`提交数` 这类数值只允许出现在 `docs/evidence/*.json`；`.md` 里出现即红 | "354/363/103/1231 四处并存"这类漂移 | 0.5 天 |
| **M3 归档登记检查** | `scripts/check-docs-index.mjs`：`docs/*.md` 每份都必须在本页第 5 节表格里出现，否则报"未登记文档" | 散档重新长出来 | 0.5 天 |
| **M4 每月一次对账** | 每月第一天跑 `npm run docs:audit`：列出"层 1 文档里 30 天未改但对应代码已改"的页 | 文档停在旧状态却看不出来 | 已在 M1/M2 里，无需额外 |

四条都不引入依赖，只用 node 读文件与 grep。M1–M3 的失败信息要写成"该改哪一行"，不是"检查失败"。

## 8. 整理工作的分期与出口

| 期 | 内容 | 出口标准 |
|---|---|---|
| D1 | 6.3 补 owner（层 1 → 层 2 → 层 3） | `grep -L "Owner:" docs/*.md` 只剩过程档；owner 路径全部 `ls` 得到 |
| D2 | 6.2 编号并轨 | 任一 `ISSUE-xxx` 唯一定位一行；`#NN` 只出现在"出处"别名列 |
| D3 | 6.1 runbook 分层改名 | 旧名 0 引用；两份新 runbook 各自能单独回答它那一类问题 |
| D4 | M1–M3 三条检查进 gates | `npm run gates` 里能看到三条文档检查的 OK 行 |
| D5 | `README.md` 第 5 节 + `INDEX.md` 重写 | 两份入口对新结构给出一致答案 |

**不做**：不做全站文档生成（那是知识库的活）；不把过程档转成 HTML/站点；不追求"每份文档都有目录"（层 4 不需要）。

## 9. 与代码改造的关系（避免两件事互相踩）

文档整理（D1–D5）与 `ARCHITECTURE-DECOUPLING` 的 A–F 有交叉点，顺序要避开：

- **A（状态根）会改 `RUNBOOK`/`DEPLOY` 里写的路径** → 先把 D3 做完再动 A，否则 runbook 改两遍。
- **C（World 瘦身）会改 `ARCHITECTURE-2026-11.md` 的 owner 指向** → D1 里那份的 owner 先写"definition.ts（瘦身后拆为四个）"，等 C 落地再改精确。
- **F（观测）会新增 `docs/evidence/*.json`** → M2 的单事实源检查要在 F 之后才能全覆盖（先允许缺省，缺省即视为没落盘）。

建议合并成一条实施顺序：
**D1 → D2 → D3 → A → B → D4 → C → D → E → F → D5**。
理由：D1/D2/D3 便宜且让后面每一步都有归属可查；A/B 是地基且不改文档结构；D4 把文档纪律上锁；C/D 动 World 结构（最容易踩文档 owner）；E/F 收尾。
