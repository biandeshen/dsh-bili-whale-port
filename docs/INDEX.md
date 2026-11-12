# INDEX · docs 的唯一入口

> **日常只读这个目录下的 [`specs/`](./specs/)。** 十份功能详设，一份一个功能，只写"现在是怎么设计的"。
> **`attic/` 只用于考古，不许作为施工依据。** 那里按原日期保留 2026-10、2026-11 的过程案卷（含负结果），
> 里面的路径、行号、数字都可能已经过期——它记录的是"当时以为是什么"，不是"现在是什么"。

立这份文件的因由（主人 2026-11-07 拍板）：`docs/` 从当日中午 59 篇到晚上 131 篇，**12 小时翻倍**；
全仓 157 个 `.md` 里，"某功能现在是怎么设计的"这一类 **0 份**。
后果不是难看，是因果：**改代码时没有规格可对照，只有案卷可翻**，于是同类坑反复来
（`core.log` 形状炸三处、家目录读错骗过只读评审、`check-state-roots` 报分叉却 EXIT=0、断言一个不存在的 `go-gate.mjs`）。

## 1. 十份详设（唯一日常入口）

| 功能 | 文件 |
|---|---|
| 作息与自主行动 | [`specs/01-rhythm-and-autonomy.md`](./specs/01-rhythm-and-autonomy.md) |
| 记忆与检索 | [`specs/02-memory-and-retrieval.md`](./specs/02-memory-and-retrieval.md) |
| 反思与判断卡 | [`specs/03-reflection-and-judgment.md`](./specs/03-reflection-and-judgment.md) |
| 日记两本 | [`specs/04-journal-two-books.md`](./specs/04-journal-two-books.md) |
| B 站读路 | [`specs/05-bili-read.md`](./specs/05-bili-read.md) |
| B 站写路 | [`specs/06-bili-write.md`](./specs/06-bili-write.md) |
| 账号与凭据 | [`specs/07-account-and-credentials.md`](./specs/07-account-and-credentials.md) |
| 视觉管线 | [`specs/08-vision-pipeline.md`](./specs/08-vision-pipeline.md) |
| 音视频出片 | [`specs/09-media-output.md`](./specs/09-media-output.md) |
| 控制面总则 | [`specs/10-control-surface.md`](./specs/10-control-surface.md) |

每份**固定五节，不许加节**：

```
① 现在是什么（一段话 + 状态机/数据流图，只写成立的事，不写历史）
② 真值在哪（参数名 → 定义 file:line → 配置文件键 → 面板控件，四者必须对齐）
③ 失败与边界（每个失败路径写清：谁看得见、账落不落、会不会污染 ②）
④ 操作面（主人能改什么、改了要不要重启、没有面板入口的明确写"只能改文件"）
⑤ 已知缺陷与验证方式（可判定的复现命令，不许写"待观察"）
```

## 2. 维护规矩（四条，由门禁守着）

门禁：`node scripts/check-doc-hygiene.mjs`（实现见 [`../scripts/check-doc-hygiene.mjs`](../scripts/check-doc-hygiene.mjs)）。

1. **功能变了吗 → 就地改那十份，不许再开一本。** R1 直接拒绝 `docs/*-YYYY-MM-DD.md`
   和 `docs/(HANDOFF|CLOSEOUT|STATUS|BATCH|AUDIT|PLAN|REVIEW|DECISION)-*` 这类新文件；
   白名单只有 `specs/`、`evidence/`、`attic/`，另有一份例外：[`CURRENT.md`](./CURRENT.md)（已降级为台账，见 §3）。
2. **文档里写到的路径必须存在。** R2 扫所有活文档（attic 与 evidence 除外——attic 的规矩是不改写，
   拿会要求改写的门禁去卡不许改写的文件只会逼人绕过整条门禁）。
3. **② 节点名的参数必须有读取点。** R3 grep 取值使用；零读取点即红。
   这条是 `prefs.like`、`activeCap=40`、`lastKind`、`context.maxTokens` 这类"旋钮存在但没人读"的克星
   ——`context.maxTokens` 空转到 2026-11-07 才被 A 刀量出来，见 [`CURRENT.md`](./CURRENT.md) 的 A 刀条目。
4. **⑤ 节每条缺陷必须带一条能跑的复现命令。** R4 查五节齐 / 无第六节 / 命令 / 「待观察」总数 ≤ 3。

## 3. `docs/` 根目录剩下的这几篇（≤ 12，是硬上界）

| 文件 | 身份 |
|---|---|
| [`INDEX.md`](./INDEX.md) | 本页，唯一入口 |
| [`CURRENT.md`](./CURRENT.md) | **台账，不是现状。** 按日期倒序记"到哪了"；自 2026-11-07 起停止追加新条目，"现在是什么"归 specs |
| [`CORTICO-RUNBOOK.md`](./CORTICO-RUNBOOK.md) · [`STOP-RUNBOOK.md`](./STOP-RUNBOOK.md) | 运维：起（宿主链路）、停 |
| [`QQ-SETUP.md`](./QQ-SETUP.md) | QQ 通道 |
| [`OBSERVATION-PROTOCOL.md`](./OBSERVATION-PROTOCOL.md) | 判据协议（K1–K4 与污染口径） |
| [`CREDITS.md`](./CREDITS.md) | 素材与代码来源、许可署名（合规件，不是案卷） |

`evidence/` 是门禁消费的机器产物（带日期的报告与哈希），**不是案卷**，留在原位。
`attic/2026-10/`、`attic/2026-11/` 是 76 篇过程文档的归宿，按原日期保留、未改写、未删除。

**2026-11-12 退役三份运维文档**：`DEPLOY.md`、`RUNBOOK.md`、`TERMUX.md` 原样搬进
[`attic/2026-11/`](./attic/2026-11/)。它们写的是 DSH 插件 / OpenCode daemon / 独立面板（8447）/ Termux
这四条接入线，而那四棵代码树（`core/`、`panel/`、`adapters/`、`vendor/dsh-autocut/`）已在同批删除。
现在的起停与部署只看 [`CORTICO-RUNBOOK.md`](./CORTICO-RUNBOOK.md) 与 [`specs/10-control-surface.md`](./specs/10-control-surface.md)。

**读 attic 的一条口径（2026-11-13 补）**：attic 里引的**上游**路径不是本仓路径，别照着去开文件。
实例：`attic/2026-10/ARCHITECTURE.md` §12.1 引 `emotion-projection.ts`、§12.3 引 `life-generator.ts`，
两处带的前缀是上游 AMpath 的 `shared` / `server` 两棵目录——**本仓与宿主都没有那两棵**
（2026-11-13 实测 `ls packages/shared packages/server` 与宿主侧同名目录均不存在）。
落地的实现分别是本仓 `packages/persona-core/src/emotion-projection.ts` 与 `packages/persona-core/src/life-activities.ts`
（后者改了名，7 类活动与文案轮换在里面）。**attic 原文一个字不改**，映射写在这里。

**读 attic 的第二条口径（2026-11-13 补）：设计裁决 ≠ 验收结论。**
`attic/2026-11/ARCHITECTURE-TARGET-2026-11-03.md` §2.1 铁律2 写着「**核心资产 100% 宿主无关（连 Cortico 本身也是可插拔插座）**……
将来 Cortico 升级契约或彻底换掉 Cortico 底座，5 个能力包一行代码不用动」，§2.2 的三层图也标着「100% 宿主无关，零 Cortico 依赖」。
**那是 2026-11-03 主人拍板的设计方向，不是已经验过的事实**（而且当时是 5 个能力包，现在是 6 个）。
2026-11-13 实测：接口层确实干净（整个 `packages/` 树 0 个 `cortico/*` 说明符），但
①「模型由宿主发起」有一处反例（配音自己打 MiMo）；② 装载层有三处真耦合（宿主绝对路径 link、构建借隔壁 esbuild、本仓无 `engines`）。
**当前对外口径以 [`specs/10-control-surface.md`](./specs/10-control-surface.md) ⑤ 第 14 条为准**（本仓唯一的跨宿主验证登记处），
读数见 [`evidence/host-claim-downgrade-2026-11-13.md`](./evidence/host-claim-downgrade-2026-11-13.md)。
**attic 原文一个字不改**；谁要拿铁律2 当「已经可插拔」的依据，先去看那三条判据跑没跑。
