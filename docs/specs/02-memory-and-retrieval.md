# 02 · 记忆与检索

> 只写成立的机制；案卷在 `docs/attic/`，不作施工依据。行数按 2026-11-07 工作区核对。

## ① 现在是什么

**两套记忆池并存，互不同步**，这一点写文档时不能含糊：

- **卡片仓**（本体）：四层 Markdown + git 工作树。`core / active / archived / voided`
  （`packages/cap-memory/src/card-store.ts:26-27`，目录布局注释在 `:4-8`，实际落在 `<workspace>/memo/<tier>/<id>.md`）。
  她自己的工具（`memory_remember` / `memory_recall` / `memory_void`）与主人面板都只动这一套。
- **JSON 状态池**：`PersonaState.memories`（`packages/cap-state-rhythm/src/state-store.ts:23-31`），
  每拍状态描述里注入的是它（`state-store.ts:371-378` → `:410`「记得：…」）。

每拍进上下文的只有两小块：**core 常驻**（按"新→旧"排序后 `slice(0, residentCap)`，
`packages/cap-memory/src/index.ts:175`）与**本轮关联记忆**（`onMessageDelivery` 召回 3 条主槽 + 1 条意外槽，
`index.ts:198-217`）。检索是纯函数四因子加权（`packages/persona-core/src/retrieval.ts:182-183`）：
关键词 0.40、鲜活 0.30、情绪 0.15、新鲜 0.15；意外槽只从"≥7 天、从没被想起过、非 flashbulb"里挑
（`retrieval.ts:196-200`）。归档只在**睡着且当日未结算**时发生一次（`packages/cap-state-rhythm/src/dream-tick.ts:115-120`
→ `card-store.ts:390-410`），回滚走 git annotated tag + `reset --hard`（`packages/cap-memory/src/workspace-git.ts:396-419`）。

## ② 真值在哪

| 参数 | 定义与执行点 | 配置键 | 面板控件 |
|---|---|---|---|
| `residentCap` | `packages/cap-memory/src/index.ts:65`（默认 8）；执行 `:175` 截断、`:536-542` 新建拒、`:571-581` 置顶拒 | `memory.residentCap`（`packages/cortico-bot-xiaoyu/src/memory-config.ts:23`；部署 `config.json` 实值 8） | 宿主「配置」页（`memory-config.ts:51-62`） |
| `activeCap` | `index.ts:66` + 钳位 `:86`，**无执行语义**（见 ⑤ 第 1 条） | `memory.activeCap`（实值 40） | 配置页有滑块（`memory-config.ts:63-72`） |
| `archiveThreshold` | `index.ts:67` → `cortico-persona.ts:410` → `dream-tick.ts:120` → `card-store.ts:390-396` | `memory.archiveThreshold`（实值 0.35） | 配置页 |
| `keyword` / `vivid` / `mood` / `recency` | `packages/persona-core/src/retrieval.ts:61-66`（`RECALL_WEIGHTS`），求和 `:182-183` | 无键 | 无控件，只随召回解释回显（`packages/cap-memory/src/index.ts:369` → `webui/client.ts:325-326`） |
| `k` / `surprises` | `retrieval.ts:140-141` 钳位（k≤8、surprises≤4）；调用点写死 3/1（`packages/cap-memory/src/index.ts:204-205`）与 `args.k ?? 5`（`:274`） | 无键 | 无 |
| `accessCount` | 想起即 +1（`card-store.ts:374-381`）；意外槽判据用它（`retrieval.ts:197`） | 无键 | 随审阅台显示（`packages/cap-memory/src/index.ts:420-421`） |
| `pinned` | 进 core 即置真（`card-store.ts:228`），衰减免疫（`packages/persona-core/src/memory.ts:28`），settle 跳过（`card-store.ts:396`） | 无键 | 面板「置顶/移入 core」 |
| `vividness` | 基线衰减 0.02/天（`packages/persona-core/src/memory.ts:16`）、来源倍率 `:7-14`、flashbulb 0.2（`:4`）、回忆回血梯度 `:94-105` | 无键 | 无（只能看） |
| `FADED_VIVIDNESS` | `retrieval.ts:84`（0.35，与 `archiveThreshold` 同值但是**两个独立常量**） | 无键 | 无 |
| `staleDays` | `packages/cap-memory/src/index.ts:403`（默认 14） | 无键 | 审阅台按钮固定传 `undefined`（`webui/client.ts:69`）→ 恒 14 |

## ③ 失败与边界

- **卡片读盘坏 JSON / 目录缺失**：`readAll` 逐目录容错，缺目录当空层——所以「archived 目录不存在」与「归档真的为空」在面板上不可区分（实测部署里 `archived` 目录尚未长出）。
- **git 提交失败静默降级**：`card-store.ts:116-121` 吞错，只在 `status()` 里留 `commitError`（`workspace-git.ts:241-244`、`:426`/`:432`）；**账不落、主人默认看不见**。
- **作废要唯一匹配**：理由少于 6 字被拒（`card-store.ts:289-291`）、命中多条时报候选而不是猜（`:297-303`）；原文进 `voided/` 永不进召回（`retrieval.ts:147`），可一键恢复（`card-store.ts:321-339`）。
- **回滚是破坏性动作**：`reset --hard` + `clean -fd`（`workspace-git.ts:412-419`），服务端强制 `confirm:true`（`packages/cap-memory/src/index.ts:653-673`），出厂基线 `checkpoint0` 不可删（`workspace-git.ts:408`）。
- **归档只在睡梦中发生**：醒着的人不会忘记；`dream-tick` 同日不重复结算（`dream-tick.ts:118`）。
- **超额要在上下文里说**：core 多于 `residentCap` 时回执里带「本轮只带前 N 条」（`packages/cap-memory/src/index.ts:185-187`）——这条不许被删，它是"数字对、含义空"的唯一解药。
- **两套池子会互相打脸**：卡片仓说 75 条、JSON 池说另一套条数，注入与面板各自引用一套；改记忆前先确认改的是哪套。

## ④ 操作面

面板（`packages/cap-memory/src/webui/client.ts`）能做：看四层与规模、列卡、新建/改层/置顶、作废与恢复（带确认）、
召回解释（四因子原值与贡献分摊开，最多 200 条）、核心常驻审阅台（`审一下` → 逐条「退下来」）、打存档点与回滚。
配置页能改：`residentCap`、`activeCap`、`archiveThreshold`（现读，不需重启；`core-cap.test.mjs:97` 锁的就是这条）。
**只能改文件（无面板入口）**：四因子权重、`k`/`surprises`、`FADED_VIVIDNESS`、所有衰减与回血速率、审阅台 `staleDays`、JSON 状态池的条目。

## ⑤ 已知缺陷与验证方式

1. **`activeCap=40` 是空旋钮**：全仓除钳位与 schema 声明外**没有任何执行点**，实测部署 active 已 45 条。
   复现：`node -e "const fs=require('fs'),os=require('os'),p=require('path');const r=p.join(os.homedir(),'.xiaoyu-home','xiaoyu','workspace','memo');for(const t of ['core','active','archived','voided']){const d=p.join(r,t);console.log(t,fs.existsSync(d)?fs.readdirSync(d).length:0)}"`（负责人：批次负责人；批次 #66 之后的记忆收口）。
2. **`memory_remember` 绕过上限直接进 core**：上限只在面板方法里查（`packages/cap-memory/src/index.ts:536-542`），
   工具路径 `:236-255` 直调 `store.create`/`rememberFirst`，而 `rememberFirst` 首次命中即 `tier:'core'`（`card-store.ts:240-252`）——所以 core 实测 21 > 8。
   复现：同第 1 条（core 那行），并对照 `grep -n residentCap packages/cap-memory/src/index.ts` 的三个执行点没有一处落在工具上；
   测试 `packages/cap-memory/tests/core-cap.test.mjs:89` 走的是**面板** `create`，不是工具，别把它当成已覆盖。
3. **四因子权重无依据**：0.40/0.30/0.15/0.15 自地基提交未调过，文档里唯一的出处是**仓外**的 AMpath `computeWarmScore`。
   复现：`node --input-type=module -e "const m=await import('./packages/persona-core/src/retrieval.ts');console.log(JSON.stringify(m.RECALL_WEIGHTS))"`（在仓根跑）；仓内无 AMpath（`grep -rn AMpath packages | wc -l` → 0）。
4. **60% 的分数与查询无关**：`vivid+mood+recency` 三项共 0.60 只看卡片自身（`retrieval.ts:172-175`），
   无关但新鲜的事能顶掉相关的；且 `kw = hit/maxIdf`（`:176-181`）单点罕见词即饱和。
   复现：`node --test packages/persona-core/tests/retrieval.test.mjs`（11 项全用 2–3 条合成卡验算术，任改一权重立刻红）。
5. **检索没有任何评测集**：无 query→期望命中 id 的样本，因此"改权重是变好还是变坏"今天无法回答。
   复现：`grep -rln "expect.*recall\|期望命中" packages/persona-core/tests packages/cap-memory/tests` → 无。
6. **可达性黑洞①（最老的 core 掉出常驻）**：排序新→旧（`card-store.ts:184`）+ `slice(0, residentCap)`（`index.ts:175`），
   超额时先丢的正是最老的那几张。2026-11-07 实测：**core 21 条、只带 8 条、13 条躺在常驻层不进上下文，
   被丢的最老一张建于 `2026-10-30T03:11Z`**（`2026-10-31` 之前的全部在外）。
   复现：`node -e "const fs=require('fs'),os=require('os'),p=require('path');const d=p.join(os.homedir(),'.xiaoyu-home','xiaoyu','workspace','memo','core');const a=fs.readdirSync(d).map(f=>{const m=fs.readFileSync(p.join(d,f),'utf8').match(/^createdAt:\s*(\S+)/m);return m?m[1]:''}).sort((x,y)=>y.localeCompare(x));console.log('core 条数',a.length,'· 带的最老',a[7],'· 掉出去',a.slice(8).length,'条，最老',a[a.length-1])"`
   —— 现有测试只验"带几条"（`packages/cap-memory/tests/core-cap.test.mjs:36`），**没验"带哪几条"**。
7. **可达性黑洞②（被想起过又归档＝自动召回永不再碰）**：主槽池不含 archived（`card-store.ts:352`），
   意外槽又硬性要求 `accessCount === 0`（`retrieval.ts:197`），而"被想起过"就是 `accessCount ≥ 1`（`card-store.ts:374-381`）。
   复现：`grep -n "accessCount === 0" packages/persona-core/src/retrieval.ts` + `grep -n "coreAndActive = " packages/cap-memory/src/card-store.ts`。
8. **`packages/persona-core/src/types.ts:109-123` 的 `CONFIG` 是空镜像**：`MEMORY_DECAY_PER_DAY`、`FLASHBULB_DECAY_FACTOR`、
   `RECALL_BOOST`、`ENCODING_PEAK_STIMULATION` 四项无人读，真正生效的是 `memory.ts` 里的同名本地常量——改这里不生效。
   复现：`grep -rn "MEMORY_DECAY_PER_DAY\|FLASHBULB_DECAY_FACTOR\|ENCODING_PEAK_STIMULATION" packages | grep -v types.ts` → 0 行。
9. **75 条规模下不做向量检索是决定的现状**，不是欠账；不要因为"别人有"就立项。
   差距要紧度排序（本仓实测口径）：评测集 ＞ 双时态失效 ＞ 多样性 ＞ importance 打分 ≫ 向量检索。复现：`node scripts/check-doc-hygiene.mjs`（② 的四列不许空转）。
