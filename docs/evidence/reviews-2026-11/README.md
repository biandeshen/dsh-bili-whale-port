# 第三方评审案卷（2026-11 批次）· 索引

> **这里是什么**：外部第三方评审组对本仓做的只读评审报告与施工单，共 **17 份 / 2265 行**。
> 它们是**评审方的判断**，不是本仓的自述，也**不是现状**——现状只看 [`../../specs/`](../../specs/)。
>
> **搬家记录（2026-11-18）**：原位置 `spark-output/analysis/2026-11-06/`，**未入 git**（`git status` 长期显示 `?? spark-output/analysis/`）。
> 主人 2026-11-18 指示「收进去吧」，遂整批搬进 `docs/evidence/reviews-2026-11/`。
> **17 份正文一字未改**（含其中已过期的路径、行号、数字）；本索引是新增的唯一文件。
> 放 `evidence/` 而不是新开 `docs/reviews/`，是因为文档卫生门禁 R1 的白名单只有 `specs/`、`evidence/`、`attic/`
> （`scripts/check-doc-hygiene.mjs:52`）；`evidence/` 已有散文分析报告的先例（`host-claim-downgrade-2026-11-13.md`，438 行）。
>
> **读这批文件的三条口径**：
> 1. **证据档位是评审方自己标的**：`已验证`＝该组自己跑出数字或读到实现；`仅自述`＝文档/commit 声称但该组未独立复核；`无证据`/`未查清`＝查过但证据不足。引用时不得把 `仅自述` 升格成 `已验证`。
> 2. **里面的路径可能已消失**。这批报告写于 11-02～11-14，而 11-13 的退役批（`b2e9fe7`）删掉了 `core/`、`panel/`、`adapters/opencode/`、`vendor/dsh-autocut/` 四棵树 79 个文件。照报告里的路径去开文件会开不到，**这不是报告写错，是代码后来动了**。
> 3. **旧路径的映射写在 [`../../INDEX.md`](../../INDEX.md)**，不改 attic 原文（attic 的规矩是按原日期保留、不改写）。

---

## 一、总判决与全面报告（先读这两份）

| 文件 | 报告内标注日期 | 行数 | 是什么 |
|---|---|---:|---|
| [`00-VERDICT.md`](./00-VERDICT.md) | 2026-11-06 | 152 | **六席并行评审总判决**。一句话：为修「她太安静」拆掉所有变相节流后，掉进 6 小时 226 笔、86% 重复的自我重读循环，当日输入 5.2 亿 token，被 402 停 7.5 小时，而系统没有一处把这条因果链显示给主人看；「唯一节流阀是体力」当天被实测证伪。 |
| [`10-FULL-RESEARCH-REPORT.md`](./10-FULL-RESEARCH-REPORT.md) | 2026-11-14 | 302 | **全面分析研究报告 v1**（第二轮）。33 把工具 / 7 个能跑通的功能 / 786 次零报错调用；病灶不在功能多少，在三处接管层：模型看不见 B 站、一件小事拆十几轮、每轮背 71 万 token。§8 自记本轮犯过两次「我搜不到＝不存在」。 |

## 二、七席分席报告（`00-VERDICT.md` 的分席依据）

| 席位 | 文件 | 行数 | 覆盖面 |
|---|---|---:|---|
| 一 · 架构与可插拔性 | [`s1-architecture.md`](./s1-architecture.md) | 178 | 静态 import 图全量统计 + `--experimental-strip-types` 实际加载试验 |
| 二 · 自主循环 | [`s2-autonomy-loop.md`](./s2-autonomy-loop.md) | 124 | 唤醒/节流/重复循环 |
| 三 · 记忆与检索 | [`s3-memory-retrieval.md`](./s3-memory-retrieval.md) | 212 | 分层、召回、常驻上限 |
| 四 · B 站内容生产 | [`s4-bilibili-content.md`](./s4-bilibili-content.md) | 88 | 读写工具链、账号绑定面（凭据**只量长度未回显值**） |
| 五 · 控制面 | [`s5-control-surface.md`](./s5-control-surface.md) | 241 | 逐页签/逐控件 |
| 六 · 工程质量 | [`s6-engineering-quality.md`](./s6-engineering-quality.md) | 285 | 测试层级、门禁、可回溯性 |
| 七 · 红队 | [`s7-redteam.md`](./s7-redteam.md) | 160 | 反证与挑刺 |

> 分席报告正文里出现的第一个日期有的是**数据基线日期**（如 s4 的 HEAD `a617b62`），不是评审日期；
> 评审日期以 `00-VERDICT.md` 的 2026-11-06 为准。

## 三、施工单（HANDOFF / PLAN 系列，按时间顺序）

| 文件 | 报告内标注日期 | 行数 | 交付给谁、要做什么 |
|---|---|---:|---|
| [`01-DECISION-AND-NEXT.md`](./01-DECISION-AND-NEXT.md) | 2026-11-06 | 65 | 拍板项与施工顺序 |
| [`02-HANDOFF-TO-MAIN.md`](./02-HANDOFF-TO-MAIN.md) | 2026-11-06 | 54 | 交主会话的总交接 |
| [`03-HANDOFF-DOCS-AND-SPECS.md`](./03-HANDOFF-DOCS-AND-SPECS.md) | 2026-11-07 | 98 | 文档体制改制 + 补齐十份详设（→ 已落成 `docs/INDEX.md` 与 `specs/`） |
| [`04-HANDOFF-RETIRE-CORTICO-CLONE.md`](./04-HANDOFF-RETIRE-CORTICO-CLONE.md) | 未标日期 | 35 | **摘除第二宿主克隆的前置指令，明写「禁止直接删除」**。指出 `Cortico` 不是冗余克隆，直接删会毁掉回滚能力并静默打断一批脚本。 |
| [`05-PLAN-BECOME-REAL-PLUGIN.md`](./05-PLAN-BECOME-REAL-PLUGIN.md) | 未标日期 | 62 | 「怎么变成真正的插件」：把**独立运行**与**插件形态**两个目标拆开，给可验收路线 |
| [`06-HANDOFF-CLEAN-CLAIM-STUBHOST.md`](./06-HANDOFF-CLEAN-CLAIM-STUBHOST.md) | 2026-11-07 | 71 | 删旧代码 → 改文档宣称 → 假宿主验证（三连） |
| [`07-HANDOFF-REMAINING.md`](./07-HANDOFF-REMAINING.md) | 2026-11-13 | 62 | 剩余项只读复核（P1 stub / P2 可见面 / P3 旧家摘除） |
| [`08-HANDOFF-402-STOPLOSS.md`](./08-HANDOFF-402-STOPLOSS.md) | 2026-11-14 | 76 | 判定「P2 只做了看见，没做止损」——本仓复核后认定**对了一半**，见下 |

## 四、本仓对这批评审的回应（已入库，不在本目录）

评审不是终点，逐条回应落在这些文件里：

| 评审说法 | 本仓回应 | 结论 |
|---|---|---|
| `08`：P2 只做了看见没做止损 | [`../402-stoploss-2026-11-14.md`](../402-stoploss-2026-11-14.md) | **对了一半**：止损代码一直在，被「假恢复」判定缺陷废掉 |
| `10`：上下文从不裁剪是病灶 | [`../stop-burn-2026-11-14.md`](../stop-burn-2026-11-14.md) | **接受「压缩不是病灶」**，改判病灶为一件事被记四遍；验收只留一个数：每笔行动模型调用 ≤ 3 |
| `07`：三处事实 | [`../liveness-and-orphan-2026-11-14.md`](../liveness-and-orphan-2026-11-14.md) | 先纠正复核方三处事实，再做 P2/P3 前置 |
| `06`：宿主无关宣称 | [`../host-claim-downgrade-2026-11-13.md`](../host-claim-downgrade-2026-11-13.md) | 先量后写，降级为「只验证过 Cortico」 |
| `04`：禁止直接删 `Cortico` | [`../one-repo-plan-2026-11-18.md`](../one-repo-plan-2026-11-18.md) | **这条说对了**：三个目录共用 `Cortico/.git`，删它会打断线上宿主仓。单仓改走 subtree 路线 |

## 五、入库前的安全检查（2026-11-18 实测）

- **凭据值**：全批扫 `SESSDATA|bili_jct|api_key|sk-…|password|Bearer …`，命中 6 处**全部是机制描述与长度测量**（如「`BILI_SESSDATA` 值长 222、`BILI_JCT` 32、`BUVID3` 46，脚本按长度测量，未回显值」），**无任何凭据明文**。
- **个人路径**：`C:/Users/Administrator` 出现于 **5 份**（`s2`/`s3`/`s4`/`s5`/`s7`），`E:/WorkSpace_Qoder` 出现于 **7 份**（`00`/`04`/`06`/`10`/`s1`/`s2`/`s6`）。
  同类路径在**已入库的 docs 文档**里早已大量存在（`E:/WorkSpace_Qoder` **40 份**、`C:/Users/Administrator` **17 份**，含 `STOP-RUNBOOK.md`、`attic/2026-11/*`），
  本次入库**不新增暴露面**。
  > 勘误：本条初稿写「各出现于 1 份」，那是 `grep -o … | sort -u -t: -k3` 把多文件命中折叠成一行造成的读数错误，已按 `grep -lF` 逐文件重数改正。
- 仓库 `private`（biandeshen/dsh-bili-whale-port）为私有；**不推 `upstream` 公开仓**。

## 六、旧路径 → 新位置映射（attic / evidence 原文不改，映射只写在这里）

| 原文里的旧路径 | 现位置 | 谁引了它 |
|---|---|---|
| `spark-output/analysis/2026-11-06/00-VERDICT.md` | `docs/evidence/reviews-2026-11/00-VERDICT.md` | `docs/attic/2026-11/DEEP-AUDIT-2026-11-05.md:1589` |
| `spark-output/analysis/2026-11-06/01-DECISION-AND-NEXT.md` | `docs/evidence/reviews-2026-11/01-DECISION-AND-NEXT.md` | 同上 |
| `spark-output/analysis/2026-11-06/`（其余 15 份，含 `s1`–`s7`、`02`–`08`、`10`） | `docs/evidence/reviews-2026-11/`（同名） | 本目录 §一–§三 |
| `docs/ONE-REPO-PLAN-2026-11-18.md` | `docs/evidence/one-repo-plan-2026-11-18.md` | 无（2026-11-18 当日新增即搬） |
| `spark-output/analysis/2026-11-06/`（作为「工作区唯一未跟踪项」被提及） | 已入库，该项不再存在 | `docs/evidence/host-claim-downgrade-2026-11-13.md:6`（**当时的真实读数，不改写**） |

> 为什么映射表不放 `docs/INDEX.md`：R2 要求**活文档**里写到的路径必须存在，而映射表天生要写一个已不存在的旧路径。
> `evidence/` 与 `attic/` 豁免 R2（`scripts/check-doc-hygiene.mjs:114-117`），所以映射表放这里才不逼下一个人绕门禁。