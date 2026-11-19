# 席位三：记忆、检索与反思质量（2026-11-06）

评审对象：`E:\WorkSpace_Qoder\dsh-bili-whale` · 记忆子系统
数据实读：`C:/Users/Administrator/.xiaoyu-home/xiaoyu/`（只读；未重启进程、未写任何文件）
证据分档：**已验证**（文件:行号 / 命令+输出）· **仅自述**（代码注释或 docs 单方陈述）· **无证据**

---

## ① 核心判断

1. **检索没有任何质量评测基线，四因子权重是"拍出来的"，且出处是一条无法复核的引用。**
   `retrieval.ts` 全仓只有 11 个测试（`packages/kernel/persona-core/tests/retrieval.test.mjs`），全部用 2~3 条**手工合成**记忆验证"确定性/算术/槽位规则"，**不存在任何"查询 → 期望命中卡片 id"的标注集**，也不存在 recall@k / precision 类脚本。`git log -S"0.40"` 显示权重自地基提交 `8d7fc8e` 起未调过一次；唯一出处是 `docs/BLUEPRINT.md:156`「搬 `computeWarmScore` 四项权重」——而 AMpath 源码**不在本仓**（`vendor/` 仅 dsh-autocut、dsh-video-studio，全仓 grep `computeWarmScore` 只命中这行文档）。
   判定：**权重 0.40/0.30/0.15/0.15 = 无依据**（不是"测出来的"，甚至不是"从这个项目拍出来的"，是**继承自一个读不到的外部项目**）。

2. **关键词因子的归一化方式会系统性放大"单点罕见词命中"，且 60% 的分数与查询无关。**
   `retrieval.ts:166` 用查询词里**最贵的那个词**做分母（`kw = hit / maxIdf`），意味着"只撞上一个罕见词"的记忆可以直接拿满 0.40；而鲜活度＋情绪＋新近度合计 0.60 完全不参与相关性判断（`retrieval.ts:182-183`）。**具体错误行为（算术可直接复核，非猜测）**：一条 vividness 0.9、当天写入、情绪贴合的**无关**记忆得 0.30×0.9 + 0.15×1 + 0.15×0.95 ≈ **0.56**；一条关键词只命中一半的相关记忆得 0.40×0.5 ≈ 0.20 起。k=3 时**无关但新鲜的事经常挤掉相关但旧的事**——这与审计文档担心的"注意力被钉住"是同一个病，但方向相反：不是钉在旧结论上，是被新噪声顶掉。

3. **记忆污染事故属于「清理 + 单点可绕过护栏」，未根治；且核心常驻上限"对人有效、对她无效"。**
   护栏在**一个验收脚本**里（`scripts/accept-7798.mjs:47-53`：BASE 命中 live 端口就拒跑，除非加 `--allow-live` 或 `READ_ONLY`），服务端与 `MemoryCardStore.create()` **没有任何来源/标记级阻断**。清理靠 `scripts/purge-acceptance-residue.mjs:112-168` 按标记把卡片搬进 `data/quarantine/`。全仓 grep `allow-live|LIVE_PORT|purge-acceptance` 在 `tests/` 下**零命中** → **没有回归测试**。
   同时实测：`residentCap` 默认 8、core 层实存 **21 条**（见下），面板置顶进核心会被上限拒（`core-cap.test.mjs:75-94`），但模型自己的 `memory_remember → rememberFirst()/create()` 路径（`cap-memory/src/index.ts:236-255`）**既不查上限也不问来源**——这正是 21 > 8 的成因，也是同类污染的现存通道。

4. **「她昨晚真的想了事」这句话目前只有一半是真的。**
   `dreamDigest`（`cap-memory/src/card-store.ts:416-424`）**仍是纯字符串模板，零模型调用**，且模板里写死一句事实主张「原文都还在（git 兜底）」——而 `commit()` 在 git 缺失或提交失败时**静默降级**（`card-store.ts:116-121`），所以这句话可以在"其实没进 git"的情况下由她的口吻说出来。真正的模型反思（`dream-reflection-runner.ts`）默认 `enabled: false`（`dream-reflection.ts:41`），线上 `dream-reflection.json` 有 1 次记录，但该函数记的是**尝试**而非成功（`runner:139` 在 `spawnFork` 之前就 `markDreamReflected`），**不能当作模型真跑过的证据**。

5. **`decay.ts` 不管遗忘；真正的遗忘在 `memory.ts`。而当前归档规则会造出一类"永远召不回来"的记忆。**
   `persona-core/src/decay.ts` 全文是原子场（energy/mood/…）衰减，与记忆无关——**任务描述里的归位需要更正**。记忆衰减 = `memory.ts:27-38`（线性 0.02/天 × 来源系数 × flashbulb 系数，pinned 免疫）。核心身份记忆**不会被忘掉**（`card-store.ts:228` core → pinned:true；`settle()` 另有 `!flashbulb && !pinned` 双保险，`card-store.ts:396`）。
   但存在一处**可达性黑洞**：主召回池只取 core+active（`card-store.ts:352`），archived 只能靠意外槽进来（`card-store.ts:363-372`），而意外槽硬要求 `accessCount === 0`（`retrieval.ts:197`）。于是**"被想起过、后来淡到归档"的那条记忆，从此既不在主池也进不了意外槽 = 永久检索不到**，而它的 `.md` 文件还在、她还会说"原文都还在"。

---

## ② 逐条证据

### Q1 检索评测基线：不存在（已验证）

| 检查 | 命令 | 结果 |
|---|---|---|
| 评测集 | `ls packages/kernel/persona-core/tests/fixtures` | 仅 `fields-real-20261029.json`（场值快照，与检索无关），**无 query→期望卡片 的 fixture** |
| 检索测试面 | `Read packages/kernel/persona-core/tests/retrieval.test.mjs` | 11 个 test，池子规模 2~3 条合成记忆；断言是"顺序稳定""分数=四贡献分之和""意外槽资格"，**无一条断言"该命中的那张有没有被命中"** |
| 权重出处 | `git log --oneline -S"0.40" -- packages/kernel/persona-core/src/retrieval.ts docs` | 命中 8 条，全是搬运/摊开展示/文档转述，**无调参提交、无 before/after 指标** |
| 权重出处（引用链） | `grep -rn computeWarmScore .` | 只命中 `docs/BLUEPRINT.md:156`；AMpath 源码不在仓内、未 vendor |
| 文档复述 | `docs/ARCHITECTURE.md:210`、`docs/DEEP-AUDIT-2026-11-05.md:119,301` | 三处**原样转述同一个公式**，均未给出测得依据 |
| 唯一相关旋钮 | `cap-memory/src/index.ts:344-383` `recallExplain` | 四因子底账面板，`writable: false`，**是给人看的诊断台，不是门禁**，无 CI 调用 |

**可复现命令（只读）**：
```bash
cd /e/WorkSpace_Qoder/dsh-bili-whale
grep -rn "computeWarmScore" .                                  # 出处只有一行文档
git log --oneline -S"0.40" -- packages/kernel/persona-core/src/retrieval.ts docs
node --test packages/kernel/persona-core/tests/retrieval.test.mjs      # 11 tests 全绿≠检索质量合格
ls packages/kernel/persona-core/tests/fixtures                         # 无检索标注集
```

### Q2 关键词打分的失效模式（逐条定位到行）

分词：`retrieval.ts:98-107` —— CJK **相邻双字滑窗**＋拉丁 `[a-z0-9_]{3,}`；停用词表 `retrieval.ts:91-95` 手抄 28 个虚词。

| 输入类型 | 行为 | 代码位置 | 后果 |
|---|---|---|---|
| **同义词**（"那只猫" vs 卡片"猫咪日常"） | 查询 bigram 为 `那只/只猫`，卡片为 `猫咪/咪日/日常`，交集**为空** → kw=0 | `tokensOf` `retrieval.ts:101-104` | 完全想不起来。审计文档自己承认：`DEEP-AUDIT:301` 表「同义不同词就想不起来」 |
| **错别字** | 一个错字打断**两个**bigram（前后各一） | 同上 | 4 字关键词错 1 字即丢一半命中；无编辑距离/拼音兜底 |
| **中英混排** | 拉丁词需 **≥3** 字符，2 字母词（`id`、`k`、UP 主简称）被丢；全角未归一，仅 `toLowerCase()` | `retrieval.ts:100,105` | 短英文标识符检索不成立 |
| **否定句** | "不要发这条评论" 与 "要发这条评论" 共享 `要发/发这/这条/条评/评论`；`不`/`别`/`未` 不在停用词也不参与极性 | `retrieval.ts:91-107,179` | **正反两解同分**，她会把"别做 X"当"要做 X"的线索召回 |
| **"这条结论已被撤回" vs "这条结论本身"** | 二者共享结论的全部关键词；`voided` 只挡**被盖章那一条**（`retrieval.ts:147` 过滤 `m.voided === true`；voided/ 目录根本不进池 `card-store.ts:352-353`），挡不住一张**内容写着"X 已撤回"**的正常卡片 | `retrieval.ts:147` + `card-store.ts:352` | **撤回说明卡本身成为该话题的召回磁铁**——审计 §1.5 的"每轮重新想起"会通过更正卡原样复发 |
| **罕见词饱和** | `maxIdf` 取查询词最贵者做分母，含该词即 kw≈1.0 | `retrieval.ts:166,179-180` | 单点误命中可以打败多点正确命中 |

**指标极性验证（67/83/67 vs 人工 0/0/0）的当前状态：既不在门禁里，也不在本仓文档里。**
```bash
grep -rn "83%\|67%\|0/0/0\|复述旧\|指标极性" docs spark-output tests scripts   # → 无输出
grep -rn "机器判\|人工判" docs | head                                          # 只命中 G3b 跨代码窗口议题，与检索极性无关
```
即：那次数值我**在本仓找不到落点**（判定：**无证据**——不是"有但没上门禁"，而是"本仓现在查不到这条记录"）。检索侧唯一被钉住的极性相关行为是"voided 不进召回"，`packages/capabilities/cap-memory/tests/memory.test.mjs:86` 有断言，覆盖的是**作废机制**，不是**"复述 vs 撤回"的语言区分**。

### Q3 写入把关：谁能进核心常驻

| 入口 | 位置 | 进 core 条件 | 把关 | 判定 |
|---|---|---|---|---|
| 模型工具 `memory_remember` | `cap-memory/src/index.ts:222-255` | `milestone:true` 或 `firstTag` 首次出现 → `tier:'core'` + flashbulb + pinned（`card-store.ts:215-216,240-252`） | **无来源校验、无上限校验、无确认**；`source` 硬编码 `'npc_self'`（`index.ts:252`） | 敞口 |
| 面板「⭐置顶进核心」/「塞一条」 | `cap-memory/src/index.ts:535,573`；`webui/client.ts:194` | 显式 | **查 residentCap，超了拒**（`core-cap.test.mjs:75-94` 断言） | 唯一真闸（只对人） |
| `memory_void` | `index.ts:282-297` → `card-store.ts:283-319` | 不进（移出） | 理由 ≥6 字（`card-store.ts:289`）＋多条命中必须指定唯一 id（`297-303`） | 有摩擦，但**只校验字数，不校验真伪** |
| 睡前反思 fork | `dream-reflection-runner.ts:142-148` | 走**她自己的 `memory_remember`** | 提示词软约束"一次最多写三条"（`dream-reflection.ts:155`）＋默认关 | **与敞口同源**，等于把敞口交给模型夜里用 |
| 每日结算 | `card-store.ts:390-410` | 只往下沉（active→archived），不会升 core | — | 安全 |
| 验收脚本 HTTP 写 | `scripts/accept-7798.mjs` | 经面板/接口 | **仅脚本内 BASE 端口判断**（`:47-53`），`--allow-live` 一键绕过 | 单点、可绕过、无测试 |

**根治 vs 仅清理：判为「仅清理 + 单点护栏」。** 三点依据（全部已验证）：
- 阻断不在存储层：`MemoryCardStore.create()`（`card-store.ts:199-238`）对 content 只做 `String().trim()`，**无标记黑名单、无 provenance 校验、无 dry-run 隔离**。
- 护栏可被至少三条路绕过：①`--allow-live`（`accept-7798.mjs:53`）②任何直连 live 端口的 HTTP 客户端 ③模型自己的 `memory_remember`（连上限都不查）。
- 无回归测试：`grep tests/ → allow-live / LIVE_PORT / purge-acceptance` 零命中。
- 现存物理证据：`data/quarantine/acceptance-memo-20261105T001715`（17 张）＋ `...T001833`（2 张）＝**19 张已搬走的测试卡**，说明清理是"事后搬运"，不是"事前阻断"。

### Q4 反思与做梦

- **触发/频次**：`decideDreamReflection`（`dream-reflection.ts:90-111`）三道门：`enabled`（默认 **false**，`:41`）、`maxPerDay` 默认 1、`minSleepHours` 默认 3；轮数 `maxRounds` 默认 2，runner 再夹到 1..4（`runner:137`）。
- **成本**：一次 `spawnFork` ≤2 轮（`runner:142-148`）。注释称走同一套用量账（`runner:13`）——**仅自述**，本次未核到用量记录。
- **账本语义偏差**：`markDreamReflected` 在调用模型**之前**执行（`runner:139`，注释写明"记一次尝试不是成功"），所以失败与未配置同样吃额度；`days` 只保留 30 天（`dream-reflection.ts:120-125`）。
- **产物去处**：真写进记忆卡与日记（经她自己的工具）；最后那段话经 `injectInternal(...,'dream')` 回填（`runner:152-154`）。
- **`core.log` 炸点已修**：`safeLog`（`runner:103-111`）先认对象形状再兜函数、任何情况不抛；提交 `d5db2c1`（反思路径）与 `311c7c7`（persona 另一处同坑）。**已验证**（代码＋两条提交）。
- **`dreamDigest` 仍是模板，零模型调用（核实结果：属实）**：
  ```
  card-store.ts:416-424 → return `夜里结算记忆：${items}${more} 想不太清了，只剩个轮廓。原文都还在（git 兜底）…`
  ```
  其中「git 兜底」是**可假的事实主张**：`commit()` 无 git 或失败时静默返回（`card-store.ts:116-121`）。
- **同类"称模型产出、实为拼接"的系统扫描**：模式 `return \`…我想/夜里…\`` 在 `packages/*/src/*.ts` 全量 grep → **恰好 1 处命中，即 `card-store.ts:423`**。另有两处同族（第一人称叙事由确定性模板生成，非模型）：`retrieval.ts:125-133` `whyOf()` 产出「刻在心里」「鲜活 0.90」等；`memory.ts:111-126` `getMemoryForPrompt()` 产出「[模糊记忆] NPC开心地说: …」「[模糊印象] 一次开心的对话」。我**未**做全仓穷尽枚举，故这三处为"扫描命中"，非"仅此三处"。
- **线上 `dream-reflection.json` 存在（命令＋输出）**：
  ```bash
  cat /c/Users/Administrator/.xiaoyu-home/xiaoyu/data/persona/dream-reflection.json
  # {
  #   "days": { "2026-11-06": 1 },
  #   "lastAt": "2026-11-06T11:49:57.699Z"
  # }
  ```
  读法限定：这**只证明 11-06 记了一次尝试**（enabled 当时为真），**不证明模型调用成功**，也不证明产生了卡片。

### Q5 遗忘与容量（先报总量，再报样本；不做外推）

**实测量（`C:/Users/Administrator/.xiaoyu-home/xiaoyu/workspace/memo`，`.md` 文件数）**
| 层 | 条数 |
|---|---|
| 合计 | **75** |
| core | **21** |
| active | **45** |
| archived | **0**（目录不存在） |
| voided | **9** |
| 另有隔离区 | 17 + 2 = **19**（`data/quarantine/acceptance-memo-*`） |
| `judgment.jsonl` / `feedback.jsonl` | **3** 行 / **120** 行（`wc -l`） |

**衰减曲线（`memory.ts:27-38`，线性；由常量直接算得，非实测）**
- 速率 0.02/天 × 来源系数（`user_said` 0.9 / `npc_self` 1.0 / `dream` 1.5 / `imported` 1.2 / 语音图片 0.95，`:7-14`）× flashbulb 0.2（`:4`）。
- 0.9 → 归档线 0.35 需要：**npc_self ≈27.5 天**、**dream ≈18.3 天**、**user_said ≈30.6 天**、**flashbulb ≈137 天**。
- 归档阈值 0.35 同时是**淡忘话术阈值**（`FADED_VIVIDNESS`，`retrieval.ts:84`；`card-store.ts:390` 默认值），一个数承担两件事。
- **关键身份记忆不会被忘掉：已验证**（`pinned` 直接 return，`memory.ts:28`；core 建卡即 `pinned:true`，`card-store.ts:228`；`settle()` 再挡一层，`:396`；且 `settle()` **只遍历 active**，`:391`，core 永不衰减）。

**上限与压缩**
- `residentCap` 默认 8（`index.ts:166`）：core 21 条 → 每轮只带 8 条。选取方式 `allCore.slice(0, residentCap)`（`index.ts:175`），而 `readAll` 按 `createdAt` **倒序**排（`card-store.ts:184`）→ **带的是最新 8 条 core，最老的 13 条 core 永不进上下文**。实测 core 的 createdAt 跨度 **2026-10-30T03:11Z → 2026-11-01T15:32Z**（最旧 3 条 / 最新 2 条抽样，命令见下），即 10-30 那批最早的常驻卡是**被挤出去的那一侧**。这是可复现的具体行为错误，不需要外部资料支撑。
- `activeCap` 默认 40（`index.ts:166`）：active 实测 **45 > 40**，且全仓 `grep -rn activeCap packages scripts tests` 仅命中配置声明/解析（`index.ts:41,66,86,146,166`）与测试文件——测试文件头自己写着「`activeCap` 从来没人读」（`core-cap.test.mjs:7`）。**判定：仍是空旋钮（已验证，与 `residentCap` 已在 `367f659`/`fb2aca7` 修好形成对照）。**
- 压缩策略：**未发现**任何合并/去重/摘要压缩；`getMemoryForPrompt`（`memory.ts:111-126`）只压缩**渲染**不压缩**存储**；`isMemoryArchivable`（`memory.ts:131`，阈值 0.05）与 store 的归档路径（0.35）是两套数字，是否被调用**未核实（假设）**。

```bash
W="/c/Users/Administrator/.xiaoyu-home/xiaoyu/workspace/memo"
for d in core active voided archived; do printf "%s " $d; find "$W/$d" -name '*.md' | wc -l; done
for f in "$W"/core/*.md; do grep -m1 '^createdAt' "$f"; done | sort   # 看 core 的时间分布
grep -rn "activeCap" packages scripts tests | grep -v node_modules     # 空旋钮
```

---

## ③ 记忆系统风险清单（含根治判定）

| # | 风险 | 证据 | 档位 | 严重度 | 根治/仅清理 |
|---|---|---|---|---|---|
| R1 | 检索无评测基线，权重不可辩护；任何"调权重"改动都无法判断变好变坏 | Q1 全部命令 | 已验证 | **P0**（阻断后续一切改进） | 未做（连基线都没有，谈不上清理） |
| R2 | 污染事故护栏在服务外：`create()` 无来源/标记阻断，`--allow-live` 与模型工具两条绕过路径敞开，且无回归测试 | `accept-7798.mjs:47-53`；`card-store.ts:199-238`；tests grep 零命中 | 已验证 | **P0** | **仅清理＋单点护栏**（隔离区 19 张卡即物证） |
| R3 | `memory_remember` 可无上限进 core：core 实存 21 vs 上限 8；人走面板被拒、她走工具不受检 | `index.ts:236-255` vs `535,573`；实测 21 | 已验证 | **P1** | 未做 |
| R4 | 否定句/撤回语义在关键词层不可区分；"X 已撤回"的更正卡会成为 X 的召回磁铁，令 §1.5 复发 | `retrieval.ts:91-107,147,179`；`card-store.ts:352` | 已验证（代码机制）／复发幅度**样本仅 3 条，不外推** | **P1** | 部分（voided 机制已上门禁并被 `memory.test.mjs:86` 断言；语言极性**无门禁**） |
| R5 | core 常驻按"最新"截断，不按重要性 → 最早的身份锚定被挤出上下文 | `index.ts:175` + `card-store.ts:184`；实测日期跨度 | 已验证 | **P1** | 未做 |
| R6 | "被想起过→再归档"的记忆永久不可达（主池不含 archived，意外槽要求 accessCount=0） | `card-store.ts:352,363` + `retrieval.ts:197` | 已验证（当前 archived=0，**尚无受害者**，属潜伏） | P2（当前）→P1（一旦开始归档） | 未做 |
| R7 | `dreamDigest` 以她的口吻断言「git 兜底」，而 git 失败静默吞掉。**且这句模板确实会写进她的私人日记**（不止是展示）：`dream-tick.ts:120` 调 `settle(1, 0.35)` → `:123` 调 `dreamDigest` → `cortico-persona.ts:375,378` 接线到真 store | `card-store.ts:416-424` vs `116-121`；调用链已核 | 已验证 | **P1**（原评 P2 偏低：产物进的是长期记忆载体，不是 UI） | 未做 |
| R11 | 判断卡的 `rejected` 状态**只用于计数**，不参与任何召回降权（全仓 grep `rejected` 在检索/过滤语境下仅命中 `judgments-feedback.ts:156` 的统计行）→ 被否决的判断在语义层没有任何抑制 | `cap-journal/src/judgments-feedback.ts:154-156` | 已验证（存在性；影响面**未实测**） | **P1**（与 R4 同族：R4＋R11 合起来说明"被否决"只有一条手工 `memory_void` 通道） | 未做 |
| R12 | `isMemoryArchivable`（阈值 0.05）导出于 `persona-core/src/index.ts:6` 但**全仓零调用方** → 与实际归档线 0.35 构成"两套阈值＋一套死码" | grep 结果：仅 export／定义两处 | 已验证 | P3（误导后来者） | 未做 |
| R8 | 反思账把"尝试"记成额度：模型不通也扣掉今晚唯一一次；`enabled=false` 时面板与实际行为需一致核对 | `runner:139`；`dream-reflection.ts:114-118` | 已验证 | P2 | 有意设计（注释说明），但代价未在她账上显形 |
| R9 | `activeCap` 空旋钮（45>40 无人管），"配置页能改"与"改了生效"之间断层 | `core-cap.test.mjs:7` + grep | 已验证 | P2 | 同类问题 R3 的镜像：`residentCap` 已修，`activeCap` 未修 |
| R10 | 67/83/67 那次极性实测在本仓找不到落点，无法确认它是否曾经形成过文档记录 | 全仓 grep 空 | **无证据**（两个方向都不能断言） | — | — |

**纪律自查（本席位主动挑出的两类错误）**：
- 不把"没有评测集"升格为"检索是坏的"——R1 只主张**无法辩护**，不主张**排序一定错**；要证明排序错必须建 R1 的基线。
- 不把 §1.5 的"3 条重复召回"当作普遍幅度——那是**审计文档记录的一次实测（3 条）**，我只引用其机制，不复用其倍数。
- 不把 archived=0 读成"归档功能坏了"：只读证据显示 `settle()` 未被跑到 / 尚无卡淡到 0.35，**原因未核实**。

---

## ④ 与外部做法的差距：要紧度排序（每条都给"不做会导致哪条具体行为出错"）

| 排 | 外部做法 | 本仓现状 | 不做会错在哪（具体行为） | 判定 |
|---|---|---|---|---|
| 1 | **检索评测集**（MR/KE/ABS 类基准的 30 题微缩版） | 零 | 任何权重/分词改动都无法判断好坏；R1/R2/R4 的修复都无从验收 | **真要紧**，且是所有其它改进的前置 |
| 2 | **双时态失效语义 `valid_at`/`invalid_at`＋新事实作废旧边**（Zep/Graphiti，arXiv 2501.13956；`valid_at`/`invalid_at` 由 LLM 在入图时抽取——已联网核实该设计存在） | 只有手工 `memory_void`；`retrieval.ts:147` 挡已盖章的，挡不住"复述 vs 撤回" | 她记"主人否掉了 A"之后，问到 A 时**仍会把 A 本身端上来**（R4）；这是记忆人格最常见的失信点 | **真要紧**；但要的是**有界版本**（卡片加 `invalidates: id[]` ＋ 召回时跳过被指向者），**不是图数据库** |
| 3 | **召回多样性/已在上下文不再召回**（MMR 类） | 无（审计 `:119` 自认） | 同主题多卡在 k=3 里连轮重复，等价于把她的注意力钉死（§1.5 实测形态） | **真要紧**，改动最小、直接治已观测问题 |
| 4 | **写入时 importance 打分**（Generative Agents） | 无；core 准入靠 `milestone` 布尔与"首次出现的 tag" | 首条 tag 自动点亮核心常驻（`card-store.ts:240-252`）＝**任何新标签都能进 core**，这是 R2/R3 的上游成因 | **要紧**，且比向量检索便宜 |
| 5 | **向量/混合检索（BM25＋embedding）** | 纯 bigram＋idf；`retrieval.ts:4` 明确"刻意不做" | 会漏的是"零 bigram 交集的同义改写"（示例见 Q2 表）。但**总量 75 张卡、面板还有 `memory_recall` 主动翻阅**，且 `recallExplain` 已让"为什么想起"可解释；当前更致命的是 R2/R3/R5 而非语义召回 | **暂不要做**——没有基线（第 1 条）就上向量，等于用一处不确定替换另一处。**先建评测集，再决定**，本仓"不做向量"的注释决定在此规模下**站得住** |
| 6 | **反思按显著性阈值触发**（而非时钟） | 时钟＋`minSleepHours`＋每天 1 次，默认关 | 会错配：平淡的一晚与里程碑的一晚拿同样的反思额度 | **对个人项目不重要**：花钱的东西有硬上限是优点；等有了 importance 分（第 4 条）再谈阈值触发 |
| 7 | 图数据库 / community 层 / 长上下文基准跑分 | 无 | 无具体行为损失 | **不做**，明确不属于本项目规模 |

---

## ⑤ 最该先做的 3 件事

1. **建 30 题记忆检索评测集，并把它接进现有 mjs 测试跑分。**
   产物：`packages/kernel/persona-core/tests/fixtures/recall-eval.json`（`{query, mood?, expectIds[]}`）＋一个 `recall@3 / precision@3` 断言，**从当前线上 75 张卡里取真实卡片做池子**（不要用合成 2 条）。
   通过标准写清楚：**先冻结当前分数作为基线**，不要求一次达标。这一条不做，后面每一条都是猜。
   必含题型（每型都对应 Q2 已定位的失效）：同义改写、错别字、中英混排、**否定句**、**"X 已被撤回" vs "X 本身"**。

2. **把污染护栏从脚本搬进存储层，并补回归测试（R2＋R3 一起收）。**
   `MemoryCardStore.create()` 增加：来源必须 ∈ `MemorySource`；content 命中验收标记（`验收标记-` / `acc*` / `dyn-*` 由配置给）→ **拒写并回执**；`tier==='core'` 的一律过 `residentCap`（把 `core-cap.test.mjs:75-94` 已有的断言扩展到 `memory_remember` 与 `rememberFirst` 路径）。
   配套：删掉 `--allow-live` 的静默语义（要求同时给 `--home` 指向隔离目录）。
   验收：新增 `tests/contract/contamination-guard.test.mjs`，断言"带标记的卡经 API 写 live 端口也被拒"。

3. **修两处已经写死在代码里的"想不起来"（R5＋R6），成本各只有几行。**
   - `index.ts:175` 的 `allCore.slice(0, residentCap)` 改为按 `memorySalience`（`memory.ts:44`）或 `pinned/flashbulb` 优先排序再截断，并保留超额提示行（已有，`index.ts:185-187`）。
   - `retrieval.ts:197` 意外槽的 `accessCount === 0` 与 `card-store.ts:352` 主池不含 archived 这对组合，改为：主池纳入 archived（让低分自然排后），或把意外槽条件放宽为 `accessCount === 0 || tier === 'archived'`。
   同时把 `activeCap` 从空旋钮变成真闸，或在配置页删掉它（`core-cap.test.mjs:7` 已记录它没人读——空旋钮比没旋钮更坏，这是本仓自己的话）。

---

## ⑥ 我没查清的东西

- **67/83/67 那次指标极性实测的原始落点**：`docs/`、`spark-output/`、`tests/`、`scripts/` 全 grep 为空。无法判断是"当时没入库"还是"我搜的词不对"。**不据此断言它不存在**。
- **`spawnFork` 反思是否真调过模型、并产出过卡片**：只看到尝试计数为 1。要证实需读 `workspace` 的 git 提交作者/时间与 session 用量账，我未展开（受只读＋调用上限约束）。`runner:13` 关于"成本走同一套用量账"是**仅自述**。
- ~~`isMemoryArchivable` 是否有调用方~~ → **已查明：零调用方（死码）**，降为 R12 记录。
- ~~archived 层为 0 的原因~~ → **部分查明**：`settle(1, 0.35)` 确实挂在睡眠链上（`dream-tick.ts:120` → `cortico-persona.ts:375`），所以不是"没接线"。合理解释是时长未到：npc_self 卡 0.9→0.35 需 ≈27.5 天，而 active 卡多为 10 月底/11 月初写入。**但这是我由常量算出的推断，不是实测**——未逐条读 45 张 active 卡的实时 vividness 分布。
- **线上 45 张 active 卡的 vividness 实际分布**：未逐条读取统计（守只读与调用上限）。R6"归档后不可达"因此**目前没有受害者**，属潜伏判定，不是已发生事故。
- **`coreReview` 的 `specificEvent` 正则**（`index.ts:435`）在真实 core 21 条上的命中面：我只读了实现，未跑数（跑数要走面板方法＝写接口之外的只读调用，为守调用上限未做）。审阅台"能认出具体事件"这件事目前**只有代码证据，没有实测证据**。
- **judgment/feedback 的极性字段语义**：只核到 `judgments-feedback.ts` 是 JSONL 读写与分页统计（`proposed/adopted/rejected`、`severity`），未追"rejected 是否会反向抑制同话题召回"——若无，则 R4 的影响面比我写的更大。
- **样本限定**：core 卡日期只抽了最旧 3 条＋最新 2 条；quarantine 只数了目录（17/2），未逐条读内容核对标记规则。**不得由这些样本外推总体质量。**
