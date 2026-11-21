# 02 · 记忆与检索

> 只写成立的机制；案卷在 `docs/attic/`，不作施工依据。行数按 2026-11-07 工作区核对。

## ① 现在是什么

**两套记忆池并存，互不同步**，这一点写文档时不能含糊：

- **卡片仓**（本体）：四层 Markdown + git 工作树。`core / active / archived / voided`
  （`packages/capabilities/cap-memory/src/card-store.ts:26-27`，目录布局注释在 `:4-8`，实际落在 `<workspace>/memo/<tier>/<id>.md`）。
  她自己的工具（`memory_remember` / `memory_recall` / `memory_void`）与主人面板都只动这一套。
- **JSON 状态池**：`PersonaState.memories`（`packages/capabilities/cap-state-rhythm/src/state-store.ts:23-31`），
  每拍状态描述里注入的是它（`state-store.ts:371-378` → `:410`「记得：…」）。

每拍进上下文的只有两小块：**core 常驻**（按"新→旧"排序后 `slice(0, residentCap)`，
`packages/capabilities/cap-memory/src/index.ts:175`）与**本轮关联记忆**（`onMessageDelivery` 召回 3 条主槽 + 1 条意外槽，
`index.ts:198-217`）。检索是纯函数四因子加权（`packages/kernel/persona-core/src/retrieval.ts:182-183`）：
关键词 0.40、鲜活 0.30、情绪 0.15、新鲜 0.15（**这四个数是本仓自定的，无外部依据**：没有评测集、没有调参记录，
不是从某个论文或平台指标抄来的，见 ⑤ 第 3 条）；意外槽只从"≥7 天、从没被想起过、非 flashbulb"里挑
（`retrieval.ts:196-200`）。归档只在**睡着且当日未结算**时发生一次（`packages/capabilities/cap-state-rhythm/src/dream-tick.ts:115-120`
→ `card-store.ts:390-410`），回滚走 git annotated tag + `reset --hard`（`packages/capabilities/cap-memory/src/workspace-git.ts:396-419`）。

## ② 真值在哪

| 参数 | 定义与执行点 | 配置键 | 面板控件 |
|---|---|---|---|
| `residentCap` | `packages/capabilities/cap-memory/src/index.ts:65`（默认 8）；执行 `:175` 截断、`:536-542` 新建拒、`:571-581` 置顶拒 | `memory.residentCap`（`packages/adapters/cortico-bot-xiaoyu/src/memory-config.ts:23`；部署 `config.json` 实值 8） | 宿主「配置」页（`memory-config.ts:51-62`） |
| `activeCap` | `index.ts:66` + 钳位 `:86`，**无执行语义**（见 ⑤ 第 1 条） | `memory.activeCap`（实值 40） | 配置页有滑块（`memory-config.ts:63-72`） |
| `archiveThreshold` | `index.ts:67` → `cortico-persona.ts:410` → `dream-tick.ts:120` → `card-store.ts:390-396` | `memory.archiveThreshold`（实值 0.35） | 配置页 |
| `keyword` / `vivid` / `mood` / `recency` | `packages/kernel/persona-core/src/retrieval.ts:61-66`（`RECALL_WEIGHTS`），求和 `:182-183`。**数值无外部依据、本仓自定**（2026-11-12 主人拍板要求标明；自地基提交未调过，无评测集） | 无键 | 无控件，只随召回解释回显（`packages/capabilities/cap-memory/src/index.ts:369` → `webui/client.ts:325-326`） |
| `k` / `surprises` | `retrieval.ts:140-141` 钳位（k≤8、surprises≤4）；调用点写死 3/1（`packages/capabilities/cap-memory/src/index.ts:204-205`）与 `args.k ?? 5`（`:274`） | 无键 | 无 |
| `accessCount` | 想起即 +1（`card-store.ts:374-381`）；意外槽判据用它（`retrieval.ts:197`） | 无键 | 随审阅台显示（`packages/capabilities/cap-memory/src/index.ts:420-421`） |
| `pinned` | 进 core 即置真（`card-store.ts:228`），衰减免疫（`packages/kernel/persona-core/src/memory.ts:28`），settle 跳过（`card-store.ts:396`） | 无键 | 面板「置顶/移入 core」 |
| `vividness` | 基线衰减 0.02/天（`packages/kernel/persona-core/src/memory.ts:16`）、来源倍率 `:7-14`、flashbulb 0.2（`:4`）、回忆回血梯度 `:94-105` | 无键 | 无（只能看） |
| `FADED_VIVIDNESS` | `retrieval.ts:84`（0.35，与 `archiveThreshold` 同值但是**两个独立常量**） | 无键 | 无 |
| `staleDays` | `packages/capabilities/cap-memory/src/index.ts:403`（默认 14） | 无键 | 审阅台按钮固定传 `undefined`（`webui/client.ts:69`）→ 恒 14 |

## ③ 失败与边界

- **卡片读盘坏 JSON / 目录缺失**：`readAll` 逐目录容错，缺目录当空层——所以「archived 目录不存在」与「归档真的为空」在面板上不可区分（实测部署里 `archived` 目录尚未长出）。
- **git 提交失败静默降级**：`card-store.ts:116-121` 吞错，只在 `status()` 里留 `commitError`（`workspace-git.ts:241-244`、`:426`/`:432`）；**账不落、主人默认看不见**。
- **作废要唯一匹配**：理由少于 6 字被拒（`card-store.ts:289-291`）、命中多条时报候选而不是猜（`:297-303`）；原文进 `voided/` 永不进召回（`retrieval.ts:147`），可一键恢复（`card-store.ts:321-339`）。
- **回滚是破坏性动作**：`reset --hard` + `clean -fd`（`workspace-git.ts:412-419`），服务端强制 `confirm:true`（`packages/capabilities/cap-memory/src/index.ts:653-673`），出厂基线 `checkpoint0` 不可删（`workspace-git.ts:408`）。
- **归档只在睡梦中发生**：醒着的人不会忘记；`dream-tick` 同日不重复结算（`dream-tick.ts:118`）。
- **超额要在上下文里说**：core 多于 `residentCap` 时回执里带「本轮只带前 N 条」（`packages/capabilities/cap-memory/src/index.ts:185-187`）——这条不许被删，它是"数字对、含义空"的唯一解药。
- **两套池子会互相打脸**：卡片仓说 75 条、JSON 池说另一套条数，注入与面板各自引用一套；改记忆前先确认改的是哪套。

## ④ 操作面

面板（`packages/capabilities/cap-memory/src/webui/client.ts`）能做：看四层与规模、列卡、新建/改层/置顶、作废与恢复（带确认）、
召回解释（四因子原值与贡献分摊开，最多 200 条）、核心常驻审阅台（`审一下` → 逐条「退下来」）、打存档点与回滚。
配置页能改：`residentCap`、`activeCap`、`archiveThreshold`（现读，不需重启；`core-cap.test.mjs:97` 锁的就是这条）。
**只能改文件（无面板入口）**：四因子权重、`k`/`surprises`、`FADED_VIVIDNESS`、所有衰减与回血速率、审阅台 `staleDays`、JSON 状态池的条目。

## ⑤ 已知缺陷与验证方式

1. **`activeCap=40` 是空旋钮**：全仓除钳位与 schema 声明外**没有任何执行点**，实测部署 active 已 45 条。
   复现：`node -e "const fs=require('fs'),os=require('os'),p=require('path');const r=p.join(os.homedir(),'.xiaoyu-home','xiaoyu','workspace','memo');for(const t of ['core','active','archived','voided']){const d=p.join(r,t);console.log(t,fs.existsSync(d)?fs.readdirSync(d).length:0)}"`（负责人：批次负责人；批次 #66 之后的记忆收口）。
2. **`memory_remember` 绕过上限直接进 core**：上限只在面板方法里查（`packages/capabilities/cap-memory/src/index.ts:536-542`），
   工具路径 `:236-255` 直调 `store.create`/`rememberFirst`，而 `rememberFirst` 首次命中即 `tier:'core'`（`card-store.ts:240-252`）——所以 core 实测 21 > 8。
   复现：同第 1 条（core 那行），并对照 `grep -n residentCap packages/capabilities/cap-memory/src/index.ts` 的三个执行点没有一处落在工具上；
   测试 `packages/capabilities/cap-memory/tests/core-cap.test.mjs:89` 走的是**面板** `create`，不是工具，别把它当成已覆盖。
3. **四因子权重无外部依据、本仓自定**（2026-11-12 主人拍板要求在 ① 与 ② 都标明）：0.40/0.30/0.15/0.15 自地基提交 `8d7fc8e` 未调过，
   无评测集、无调参记录。名义出处是 [`attic/2026-10/BLUEPRINT.md:156`](../attic/2026-10/BLUEPRINT.md)「搬 AMpath `computeWarmScore` 四项权重」，
   但同一行写着 AMpath 的 `retrieval.ts` **未搬**（原样搬需 SQLite+FTS5），本仓 `retrieval.ts` 是自写的——
   所以这四个数**不是**从某个可核对的上游实现抄来的，也没有任何实验支撑，就是本仓定的。
   复现：`node --input-type=module -e "const m=await import('./packages/kernel/persona-core/src/retrieval.ts');console.log(JSON.stringify(m.RECALL_WEIGHTS))"`（在仓根跑）；
   `grep -rn computeWarmScore . --include=*.md` → 只命中 BLUEPRINT 那行与本条。
   **口径纠正（2026-11-13）**：本条原写「仓内无 AMpath（`grep -rn AMpath packages | wc -l` → 0）」——那个 0 只证明
   *字符串* AMpath 没出现在 packages 里，**不证明仓内没有 AMpath 代码**：`packages/kernel/persona-core/` 就是 AMpath 移植，
   `types`/`effect-bus`/`causal-chain`/`memory`/`npc-state-machine` 五份原样搬或抽符号（见 [`CREDITS.md`](../CREDITS.md)、`NOTICE.md`），
   对外发布前必须重写或取得授权。`retrieval.ts` 不在那五份里，这才是"权重与 AMpath 实现无关"的正确判据。
4. **60% 的分数与查询无关**：`vivid+mood+recency` 三项共 0.60 只看卡片自身（`retrieval.ts:172-175`），
   无关但新鲜的事能顶掉相关的；且 `kw = hit/maxIdf`（`:176-181`）单点罕见词即饱和。
   复现：`node --test packages/kernel/persona-core/tests/retrieval.test.mjs`（11 项全用 2–3 条合成卡验算术，任改一权重立刻红）。

### 功能域对标（2026-11-21，与 Mem0 / Zep / Letta 逐项对照后新增）

对照方法：先从代码提取工具/面板/字段（不靠印象），再只看竞品一手文档。结论分三类——**我们更深的 / 我们缺的 / 我们不该抄的**。

**我们更深的**（竞品没有）：四因子确定性召回且四因子的原始值与贡献都可查（竞品基本黑盒）；
作废不删原文（`content` 永不删除，只盖章移出召回）；核心常驻有人工退位审阅台。

**我们缺的（下面 5–7 条已修，8 条未修）**：

5. ~~无时间有效性~~ **已修（2026-11-21）**：`Memory` 新增 `validFrom/validUntil/supersededBy`；
   召回时已失效/被取代的**乘 `SUPERSEDE_WEIGHT`（0.25）降权**而不是排除——过期不等于假，
   归零等于抹掉"我以前以为…"那段历史。回执会注明「已失效——这是过去的」。
   `content` 仍永不删除。复现：`node --test tests/memory-validity.test.mjs`（10 项）。
   改这个时踩过一个坑：第一版排序测试让两条内容完全相同、靠 id 升序蒙对，变异（拆掉降权）仍绿；
   现已改成"让过期那条各项都更占优、id 反而排前面"，变异立刻红。

6. ~~无冲突消解~~ **已修（2026-11-21，只做提示）**：`memory_remember` 写入时用关键词重叠找可能矛盾的旧记忆
   （`supersedeCandidates`，阈值 0.34），**只提示不覆盖**——回执写「哪条算数要你定」。
   显式覆盖走新工具 `memory_supersede(id|match, byId)`：只标 `supersededBy`，不删原文。
   与 `memory_void` 的语义区分写在代码注释里：void = 当初就记错了；supersede = 当初对、现在有新说法。
   复现：`node --test tests/memory-conflict-chain.test.mjs`（5 项，走真实工具链）。
   **改这个时抓到一个真 bug**：`serializeMemoryCard` / `parseMemoryCard` 漏了这三个新字段，
   表现是「标记成功、返回值里有 supersededBy，但重新读盘就没了」——半成功最坏，
   调用方以为记下了，下一轮召回完全当它没发生。

7. ~~无容量水位~~ **已修（2026-11-21，只做可见）**：面板 `watermark` 方法数各层张数与字节，
   给 `ok / watch / full` 三级；阈值跟 `activeCap` 同一把尺子（watch = cap/4、full = cap*3/4），不另发明刻度。
   **不做自动摘要**：那要调模型、要定"压什么留什么"，是独立一批活。
   复现：`node --test tests/memory-watermark.test.mjs`（5 项）。
   踩坑：我手写 `readdirSync(store.memoRoot)` 与既有 `store.tierSize()` 口径不一致，
   空库能过、写过卡的反而数到 0；已改成复用 `tierSize()`。

8. **仍缺 procedural memory（她"学会的做法"）**：`ORIENTATION.md` 里的流程是硬写在提示词里的，
   她没法把"我发现更合适的顺序"记成一条可复用的方法。Mem0 对此的解法很轻（`agent_id` 分组 + `infer=False`），
   我们已有 `tags` 与四层，加一个「流程」类型不难，但**要定"学到的流程什么时候生效、和提示词里的冲突听谁的"**，
   属语义变更，需先提案。复现：`grep -rn "procedur\|routine" packages/capabilities/cap-memory/src/ packages/kernel/persona-core/src/memory.ts` → 0。

**我们不该抄的**：知识图谱（Zep/Graphiti）。它的收益在多跳、计数、枚举、否定查询——
那是企业知识库的需求，我们是单个个体。`native-first-oss-adoption` 那条讲"别把成熟整套拆成低配自研"，
反向也成立：**别为了对标完整度而引入用不上的复杂度**。
向量检索同理（`retrieval.ts:3-5` 已写明理由：不可复现、要外部依赖、解释不了"为什么想起这条"）。
5. **检索没有任何评测集**：无 query→期望命中 id 的样本，因此"改权重是变好还是变坏"今天无法回答。
   复现：`grep -rln "expect.*recall\|期望命中" packages/kernel/persona-core/tests packages/capabilities/cap-memory/tests` → 无。
6. **可达性黑洞①（最老的 core 掉出常驻）**：排序新→旧（`card-store.ts:184`）+ `slice(0, residentCap)`（`index.ts:175`），
   超额时先丢的正是最老的那几张。2026-11-07 实测：**core 21 条、只带 8 条、13 条躺在常驻层不进上下文，
   被丢的最老一张建于 `2026-10-30T03:11Z`**（`2026-10-31` 之前的全部在外）。
   复现：`node -e "const fs=require('fs'),os=require('os'),p=require('path');const d=p.join(os.homedir(),'.xiaoyu-home','xiaoyu','workspace','memo','core');const a=fs.readdirSync(d).map(f=>{const m=fs.readFileSync(p.join(d,f),'utf8').match(/^createdAt:\s*(\S+)/m);return m?m[1]:''}).sort((x,y)=>y.localeCompare(x));console.log('core 条数',a.length,'· 带的最老',a[7],'· 掉出去',a.slice(8).length,'条，最老',a[a.length-1])"`
   —— 现有测试只验"带几条"（`packages/capabilities/cap-memory/tests/core-cap.test.mjs:36`），**没验"带哪几条"**。
7. **可达性黑洞②（被想起过又归档＝自动召回永不再碰）**：主槽池不含 archived（`card-store.ts:352`），
   意外槽又硬性要求 `accessCount === 0`（`retrieval.ts:197`），而"被想起过"就是 `accessCount ≥ 1`（`card-store.ts:374-381`）。
   复现：`grep -n "accessCount === 0" packages/kernel/persona-core/src/retrieval.ts` + `grep -n "coreAndActive = " packages/capabilities/cap-memory/src/card-store.ts`。
8. **`packages/kernel/persona-core/src/types.ts:109-123` 的 `CONFIG` 是空镜像**：`MEMORY_DECAY_PER_DAY`、`FLASHBULB_DECAY_FACTOR`、
   `RECALL_BOOST`、`ENCODING_PEAK_STIMULATION` 四项无人读，真正生效的是 `memory.ts` 里的同名本地常量——改这里不生效。
   复现：`grep -rn "MEMORY_DECAY_PER_DAY\|FLASHBULB_DECAY_FACTOR\|ENCODING_PEAK_STIMULATION" packages | grep -v types.ts` → 0 行。
9. **75 条规模下不做向量检索是决定的现状**，不是欠账；不要因为"别人有"就立项。
   差距要紧度排序（本仓实测口径）：评测集 ＞ 双时态失效 ＞ 多样性 ＞ importance 打分 ≫ 向量检索。复现：`node scripts/check-doc-hygiene.mjs`（② 的四列不许空转）。
