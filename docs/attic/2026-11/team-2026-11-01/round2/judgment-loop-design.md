# 判断闭环设计（judgment loop）

所有者：`dsh-bili-whale/tools/commands/feed.mjs` + `Cortico/src/worlds/bili-account/definition.ts`。
状态：设计提案，未实施。本文档不改动任何代码。

## 0. 一句话结论

她的「判断」目前是一条**只有写入端、没有读取端**的通路；意见箱的**写入端是通的，但 14 天内没有任何一次成功写入**，而它的**读取端有一个计数 bug**。
最小可执行设计 = 新增一张「判断卡」记录（append-only jsonl，字段白名单，不含任何权限语义）+ 主人一键采纳落到 `bili-whale.config.json` 的新命名空间 `preferences.judgments` + `feed.mjs` 只把它当**追加硬拦（avoid）与有界加权（prefer）**。合并当天行为为零，第一条采纳卡生效。

---

## A. 现状查实（逐条带证据）

### A1. `bili_feedback` 的写路径：单一实现、路径一致、模块可加载；文件确实不存在

| 事实 | 证据 |
|---|---|
| 落点常量 | `dsh-bili-whale/tools/commands/feedback.mjs:23` `const FILE = dshPath('bili-whale','control','feedback.jsonl')` |
| `dshPath` 的 home 语义 | `tools/lib/paths.mjs:24` `WHALE_HOME \|\| DSH_HOME \|\| HOME/.dsh`；`paths.mjs:21` `HOME = USERPROFILE \|\| HOME \|\| os.homedir()` |
| 绝对路径（本机） | `C:/Users/Administrator/.dsh/bili-whale/control/feedback.jsonl` |
| 写入函数 | `feedback.mjs:49-67` `appendFeedback()`，实际落盘在 `:64-65`（`mkdirSync` + `appendFileSync`）；`resolveFeedback()` 在 `:69-77`，只追加 `kind:'feedback-resolved'` 行 |
| CLI 路由存在 | `tools/bili.mjs:51` `feedback: ['commands/feedback.mjs', ...]`；`feedback.mjs:81` 的 isMain 判定在 spawn 子进程下成立（`process.argv[1]` 以 `tools/commands/feedback.mjs` 结尾） |
| 宿主工具入口 | `Cortico/src/worlds/bili-account/definition.ts:814-833`（`add` 走 `runAsync(['feedback','add','--issue',…])`，`runAsync` → `definition.ts:257` → `runNodeAsync(BILI,…)`，`BILI` = `definition.ts:24` `ROOT/tools/bili.mjs`，`ROOT` = `definition.ts:23` `E:/WorkSpace_Qoder/dsh-bili-whale`） |
| 面板读的是不是同一份 | 是。`tank.ts:47` 加载 `panel/feedback.mjs`，而 `dsh-bili-whale/panel/feedback.mjs:5` 是 `export { listFeedback, resolveFeedback } from '../tools/commands/feedback.mjs'` —— **同一实现、同一 FILE**，不是双源 |
| 文件是否真的不存在 | 实测 `ls -la ~/.dsh/bili-whale/control/` 返回 30 个文件，**无 `feedback.jsonl`** |
| 模块是否坏了 | 实跑只读探针：`node --input-type=module -e "import('./tools/commands/feedback.mjs')"` → 导出 `appendFeedback,listFeedback,resolveFeedback`，`listFeedback()` → `{"ok":true,"openCount":0,"items":[],"total":0}`。含 `feedback.mjs:21` 对 `scripts/day-snapshot.mjs:30 logicalDay` 的跨目录 import，**加载不报错** |

**发现的真实缺陷（读取端，不是写入端）**：`tank.ts:80-90 openFeedbackCount()` 按 id 折叠后判 `!e.resolved`，但写入端**从来不在 `kind:'feedback'` 行上写 `resolved` 字段**——解决是另一条 `kind:'feedback-resolved'` 行（`feedback.mjs:74`）。由于 resolved 行同 id 且后写，`tank.ts:85` 的 `byId.set()` 会把原始 feedback 行**覆盖掉**，替换成不含 `resolved` 字段的记录，于是**任何一条历史反馈被 resolve 后仍然永久计入「未解决」灯**。今天文件为空所以看不出来，一旦有量就会显形：面板计数与 `listFeedback()`（`feedback.mjs:31-47`，折叠正确）会互相打脸。

**第二处路径口径差**：`tank.ts:17` 自己算 home：`process.env.WHALE_HOME \|\| path.join(process.env.USERPROFILE \|\| '', '.dsh')`，**不认 `DSH_HOME`**（`paths.mjs:24` 认）。当前部署两者相同所以无实际分叉；但只要用 `DSH_HOME` 起进程（`core/index.js`、`panel/server.js:16` 走 `paths.mjs` 语义），`tank.ts:21 FEEDBACK_FILE` / `:18 FIELDS_FILE` / `:20 KILL_FILE` 会与工具链读到**不同目录**。这是潜在双源，不是既成事实。

**她有没有被提示去用**：有，而且写得很具体——`Cortico/deployments/mybot/prompts/ORIENTATION.md:27`：「遇到工具/系统的缺陷或别扭，不要忍：调 `bili_feedback`（add --issue …；你自己能绕开的加 --self --note …）。修复仍由鱼片动手——你负责记录、复核、resolve。」该文件是 git 跟踪文件（`git ls-files` 命中），由装配层（`Cortico/src/bot.ts` 引用 `prompts` 目录）注入。**所以「她从没被提示」这个假设不成立。**

**她有没有用过**：在一切可观测窗口内没有成功过。`~/.dsh/bili-whale/causal.jsonl` 共 103 行，kind 直方图实测：`diary` 53、`watched` 19、`action` 4、`inbound` 3、`draft-result` 1、`draft-result-consumed` 1 —— **`kind:'feedback'` 0 条**。注意这条 causal 只在 `r.status === 0` 时才写（`definition.ts:821`），所以它证明的是「没有成功写入」，**不能证明「没有尝试过」**（失败的 `add` 不留 causal 痕迹，工具回执直接透传 `r.out`，`definition.ts:829`）。

**时间线约束**（解释为什么 0 条不算反常）：意见箱代码 `feedback.mjs:2` 自述创建于 2026-10-31，文件 mtime `2026-10-31 01:24:58`；`ORIENTATION.md` mtime `2026-10-31 03:12:23`；观测基线 `scripts/hashes.json:2` `frozenAt = 2026-10-31T00:30:17Z`。也就是**通道与指令都比观测冻结点还新**，`cortico.log`（99 KB，起点 10-31 20:31）里 `bili_feedback` 出现 0 次，覆盖窗口不足 1 天。

### A2. 私人日记的判断小节：自由文本，无结构化字段，小节标题不稳定

| 事实 | 证据 |
|---|---|
| 写入工具 | `bili_diary_append`，声明 `definition.ts:267`（`book: public\|private`、`heading`、`text`，示例标题里就写着「本轮留下的判断」），处理函数 `definition.ts:723-748` |
| 目标文件 | `definition.ts:33` `PRIVATE_DIARY = path.join(WHALE,'whale-diary-private.md')` → `C:/Users/Administrator/.dsh/whale-diary-private.md`（51 KB，mtime 10-31 23:29）；选择逻辑 `definition.ts:733` |
| 落盘结构 | `src/worlds/bili-account/diary.ts:21-49 upsertDiarySection()`：私人那本用 `### 标题`，挂在 `## YYYY-MM-DD` 日期块下（`diary.ts:22`）；`upsert` 语义 = 同日同标题**整节替换**，回执见 `definition.ts:746` |
| 标题约束 | `definition.ts:726-729`：去 `#`、去换行、截 40 字、**不许是日期**；正文不许出现日期标题（`definition.ts:729`） |
| 判断小节数量 | 实测 `grep -n "^#{1,4} .*判断"` → 17 处命中，其中 `:86 ### 情绪系统与我的判断不一致` 不是判断小节，**16 个判断小节**（行 8, 52, 72, 105, 144, 152, 169, 187, 201, 216, 232, 260, 278, 295, 313, 332, 354） |
| 标题字面不稳定 | 16 个里有 **13 个带括号后缀**：`本轮留下的判断（补记：草稿）`、`（Yoga Nidra）`、`（雷雨声 283 桶）`、`（词表漏风实证）`、`（同 UP 第 5 条 · 91.9）`、`（63 秒 · 筐越大门类越杂）`… 任何按精确标题匹配的解析器会静默漏掉 81% |
| 可解析字段 | **没有**。实测样例（`whale-diary-private.md:10-19`）：`**收了** \`BV1ji4y1Y77p\`（归类：想再看）。理由链：…`、`以后遇到「高播放 + 低命中 + 弹幕纯符号」，直接判为噪声，不看。`。今天唯一机器可取的锚：BV 号（`/\bBV[0-9A-Za-z]{10}\b/`）、粗体动词 收了/没收/跳过。**没有立场字段、没有作用域（哪个工具）、没有强度、没有失效期** |
| 读取端 | `bili_diary_read`（`definition.ts:264`，处理在 `definition.ts:611`：把两本日记返回给**她自己**）→ 只进上下文，不进控制流。`feed.mjs:33` 读的是**公开那本** `dshPath('whale-diary.md')`，用途只有两处：`feed.mjs:43-45` 取 `- **爱看**：`（**仅在配置没给偏好时兜底**）、`feed.mjs:46` 抽 BV 号进 `seen` 防重复。仓内唯一命中「本轮留下的判断」字符串的测试是 `tests/contract/m1a-observability.test.mjs:44-47`，它只把标题拼进 causal 的 `note` 显示串。另 `Cortico/tests/issue27.test.mjs:42` 断言轮换新会话的注入文本里出现 `whale-diary-private.md`（**注入证明，非消费证明**） |

### A3. feed 的候选过滤链：三层的先后与叠加方式

按 `tools/commands/feed.mjs` 实际执行顺序：

1. **偏好与否定词从配置读**（`feed.mjs:38-39`）：`config().preferences.like` / `.dislike`。`tools/lib/config.mjs:67-73 config()`：读 `configPath`（`paths.mjs:28`）→ `merge(DEFAULTS, user)`（`config.mjs:57-63`）。每次 `bili_feed` 是**新子进程**（`definition.ts:257` → `tools/bili.mjs` spawn），故配置改动**下一次 feed 立刻生效**，无需重启。
2. **日记兜底**（`feed.mjs:41-47`）：`^- **爱看**：` 只在 `prefs.length === 0` 时才覆盖 `prefs`（`:45`）；同日抽 BV 号进 `seen`（`:46`）。公开日记的 `~/.bili-ai/commented-videos.md` 也并入 `seen`（`:49-50`）。
3. **候选生成**：搜索关键词由 `prefs.slice(0,6)` 切出（`feed.mjs:70-87 searchKeywordOf`），加热门/排行/关注三路（`feed.mjs:134-167`）。**注意：这一层决定了「她去搜什么」，只吃配置偏好词，别的都不吃。**
4. **硬过滤（会丢候选）**：`feed.mjs:257-269`，顺序为 dedup → 排除 `seen/likedBVs/favBVs` → 排除自己（`:259`）→ **dislike 命中即丢**（`:261-264`，`feed-quality.mjs:72-80 dislikeHit`：按分隔符+`与和及向的类` 切词、≥2 字、小写子串命中）→ **质量下限即丢**（`:265-269`，`feed-quality.mjs:23-27 keepCandidate`：`play<300 && dm<3` 丢，`kw==='关注'` 例外）。
5. **加权（只改排序，不丢候选）**：`feed.mjs:270 scoreOf = log10(1+dm/max(30,d))*3 + hitsOf*4 + boostOf`。`boostOf` 来自 `feed.mjs:210-213`，输入是 `tools/lib/feed-feedback.mjs:32-39 collectLearnedTokens()` 抽出的主题词（被赞事件 / 她的收藏 / **status==='sent'** 的动态草稿，`feed-feedback.mjs:15-29 learnTokens` 的 3-4 字中文 n-gram + 拉丁词），**每命中 +2.5、封顶 7.5**（`feed.mjs:213`）。
6. **多样性与出榜**：`feed.mjs:274-286`（同一命中组合最多 `PER`，零命中最多 3）→ `feed.mjs:294-302` 取前 N。
7. **候选快照**：`feed.mjs:305-322` 原子写 `~/.dsh/bili-whale/feed/<day>.json`，形如 `{at, day, prefs, pool, kept, dropped, rows}`，`rows` 字段见 `feed-quality.mjs:30-45 snapshotRow`（title/up/kw/play/dm/seconds/hits/score/keep/why/rank）。**本机现存 4 天**：`feed/2026-10-28.json`、`10-29`、`10-30`、`10-31`。

**结论**：真正生效的偏好通路只有 `preferences.like`（决定搜索词 + 排序权重）、`preferences.dislike`（硬拦）、`feed-feedback` 的 learned tokens（软加权，上限 7.5）。`dislike` 曾「只在 `feed.mjs` 读进变量、从未参与筛选」，2026-10-31 才修好（`feed-quality.mjs:70` 注释自述）——这正是她日记里「词表未生效」（`whale-diary-private.md:260`）的字面根因。

---

## B. 三个方案

### 方案 A：判断卡 + 主人采纳落新命名空间（推荐）

**数据契约**（新文件 `~/.dsh/bili-whale/control/judgment.jsonl`，append-only，与意见箱同构）

```
add     → {id:'j-<hex6>', kind:'judgment', at, atMs, day,
           scope:'feed'|'draft'|'dm'|'any',
           stance:'prefer'|'avoid'|'noise',
           tokens:[string,...],          // 1-6 个，每个 2-12 字，切词规则复用 feed-quality.mjs:72-80
           reason:string,                 // ≤200 字，给人看的理由链
           bvid?:string,                  // 触发这条判断的那条片
           evidence?:{play?,dm?,hits?,count?},
           expiresAt?:number,
           status:'proposed'}             // 写入时唯一合法值
adopt   → 追加 {kind:'judgment-adopted', id, at, by:'owner', appliedTo:'preferences.judgments'}
reject  → 追加 {kind:'judgment-rejected', id, at, by:'owner', why}
```

采纳后写进 `bili-whale.config.json` 的**新命名空间**（不污染主人手写的 `preferences.like/dislike`）：

```json
"preferences": {
  "judgments": [
    { "id":"j-ab12cd", "scope":"feed", "stance":"avoid", "tokens":["助眠","白噪音"],
      "adoptedAt":"...", "expiresAt":1790000000000 }
  ]
}
```

**改哪些文件的哪些函数**

| 位置 | 改动 |
|---|---|
| 新增 `dsh-bili-whale/tools/lib/judgment.mjs` | `appendJudgment/listJudgments/adoptJudgment/rejectJudgment`，直接照 `tools/commands/feedback.mjs:25-77` 的读折叠 + 原子追加形状写；折叠函数抽成共用（顺手解决下面「前置修复」的同类 bug） |
| `dsh-bili-whale/tools/commands/judgment.mjs`（新增） | CLI；isMain 判定照 `tools/commands/feedback.mjs:81` |
| `dsh-bili-whale/tools/bili.mjs:10-55` map | 加一行 `judgment: ['commands/judgment.mjs', '她的判断卡：add/list（只读本地）；adopt/reject 只有面板能调']` |
| `dsh-bili-whale/tools/lib/config.mjs:36-39` | `DEFAULTS.preferences.judgments = []`（缺省空数组 = 合并后行为与今天逐位相同） |
| `dsh-bili-whale/tools/commands/feed.mjs:38-39` | 读 `cfg.preferences.judgments`，拆成 `jAvoid/jPrefer`；`feed.mjs:261-264` 的 dislike 判定追加 `jAvoid` 命中即丢；`feed.mjs:213 boostOf` 改为 `Math.min(7.5, learnedHits*2.5 + Math.min(2.5, preferHits*2.5))` |
| `dsh-bili-whale/tools/commands/feed.mjs:87` | **不动**：`searchKeywords` 仍只取 `prefs.slice(0,6)`，判断卡不得改变搜索词 |
| `dsh-bili-whale/tools/commands/feed.mjs:305-322` | 快照对象加 `judgments: {avoid:[],prefer:[],conflicts:[]}` 一个键（`feed/<day>.json` 新增字段，老读取方按 key 取数不受影响） |
| `Cortico/src/worlds/bili-account/definition.ts:258-273` DECLS | 新增 `bili_judgment`（`action: add/list`，**不含 adopt/reject**）；处理函数照 `definition.ts:814-833` 的 feedback 形状，成功时 `causal({kind:'judgment', ...})` |
| `Cortico/src/worlds/bili-account/definition.ts:362-391` PanelDecls + `webUi()` invoke | 加 `judgment` 小节：`state`（列表）与 `adopt`/`reject`（**只有这里能被主人点**，模式同 `definition.ts:391` 已有的 `method === 'resolve'`） |
| `Cortico/deployments/mybot/prompts/ORIENTATION.md:20` 后 | 追加一句：判断要落成卡（`bili_judgment add`），字段是 立场/词/理由；日记里的判断仍是叙事，不是配置 |

**前置修复（3 行，独立一个 `fix` commit，方案 A 依赖它）**
- `Cortico/src/worlds/bili-account/tank.ts:80-90 openFeedbackCount()`：按 `kind:'feedback-resolved'` 行折叠，改为委托 `mods.feedback.listFeedback()` 的 `openCount`（`tank.ts:111-117` 已经在用这个模块，别再自己解析一遍）。
- `tank.ts:17 WHALE` 补 `DSH_HOME` 兜底，与 `paths.mjs:24` 对齐，消除第二路径口径。

**红线（硬性体现在设计里）**
1. `judgment.jsonl` 的 schema **不存在** `risk` / `quota` / `approvalTier` / `pause` / `minScore` 任何字段；校验器白名单外键直接丢弃并不报错给模型——与 `definition.ts:117`（`custom[].source` 一律改写为 `custom`，「不接受模型自己填的 source」）同一先例。
2. `adopt`/`reject` 只挂在世界页 invoke（`definition.ts:389-391` 那条通道），**没有任何 `bili_*` 工具能触达**；主人身份由 WebUI 会话决定。
3. 判断卡只能**追加**硬拦（`avoid` → 并入 dislike 判定），**永远不能删**主人写的 `preferences.dislike`/`like`，也不能改 `searchKeywords`（`feed.mjs:87`）。
4. 额度闸与风控无写入面：`tools/commands/quota.mjs:329-336` 已把 `set`/`allow` 当死代码删除（`save()` 只持久化 `{log}`），`tools/lib/traffic.mjs:20-21` 对 `minGapMs`/`writeGapSec` 有硬下限钳制，kill 灯是 `traffic.mjs:6 isKillOn` + `tank.ts:109`。本设计不新增任何写入口。
5. 权限配置的落盘仍只有两处能写 `bili-whale.config.json`：安装器 `scripts/setup.mjs:36` 与测试夹具（`tests/contract/launcher.test.mjs:17`）。**adopt 走的是面板服务端这一个新写入者**，且只允许 `merge` 进 `preferences.judgments` 一个 key，其余 key 拒写。

**失败模式与冲突裁决**
- 判断卡与 `preferences.dislike` 冲突（卡说 prefer、配置说 dislike）→ **配置赢**，卡被跳过并在 `feed/<day>.json` 的 `judgments.conflicts` 里留痕；她下次 `bili_diary_read` 能读到「你这条我按主人的词表让了」，这是她修正措辞的反馈回路。
- 卡与卡冲突（同词既 prefer 又 avoid）→ **avoid 赢**（硬拦优先于加权，与 `feed.mjs:261-269` 早于 `scoreOf` 的结构一致）。
- 主人词表与 learned tokens 冲突 → 现状不变（tokens 只加权 ≤7.5，`feed.mjs:213`）。
- `tokens` 为空 / 全是停用词 / 超 6 个 → `add` 直接返回可读错误（照 `feedback.mjs:51-52` 的 `issue 是空的` / `太长` 回执风格），不写盘。
- jsonl 半行损坏 → `readEntries` 的 try/catch 丢该行继续（`feedback.mjs:27` 现有行为），判断链退化为「无卡」= 今天的默认行为，**fail-open 到旧行为而非 fail-close 到不 feed**。
- 快照写失败 → 现状已是吞异常打印（`feed.mjs:322`），新增键跟着一起失败，不影响出榜。
- 卡片无限堆积 → `listJudgments` 默认只取最近 N 条未过期；`expiresAt` 到期后 `feed.mjs` 不再采纳（自然遗忘）。过期天数默认值需要主人拍板（见 D）。

**怎么证伪（"第二天 feed 真的不一样了"）**

三层，都不碰网络（B 站对我们回 412）：
1. **确定性离线回放（最强）**：把过滤/打分链从 `feed.mjs` 抽成可注入的纯函数（输入 = 快照 `rows` + `prefs` + `judgments`，输出 = 出榜 BV 列表 + 每条 keep/why）。新测试 `dsh-bili-whale/tests/contract/judgment-loop.test.mjs`：读真实快照 `feed/2026-10-30.json` 的 `rows`，同一份输入跑两遍，一遍 `judgments:[]`、一遍 `judgments:[{stance:'avoid',tokens:['助眠']}]`，断言 (a) 出榜 BV 集合**确有差**，(b) 差集里的行在旧版 `keep=true`、新版 `keep=false`，(c) 差值只由判断卡引起（`prefs` 两次相同）。这直接在数据上区分「通路存在」与「通路真生效」。
2. **生产可观测（不改脚本）**：`feed/<day>.json` 新增的 `judgments` 键 + 既有的 `prefs/kept/dropped` 键，天然给出日环比；主人 `diff` 两天即可判定。意见箱侧：`causal.jsonl` 的 `kind:'judgment'` 计数从 0 起跳（与 `diary` 53 条同表对照）。
3. **反向断言（防假阳性）**：卡片为空时，`feed.mjs` 输出必须与合并前逐位一致——由测试 1 的第一遍覆盖。

**为什么满足「14 天观测期结束后一次合并生效」**
- `scripts/hashes.json:3-14` 冻结的 12 个文件（day-report / day-snapshot / day-watchdog / counterfactual / **run-mjs-tests** / check-consumers / g3b-check / observation-start / goal-audit / c2-offline / observation-status / tests/contract/voice）**一个都不在改动清单里**。
- `run-mjs-tests.mjs:22` 用 `readdirSync` 发现测试，**新增测试文件不需要改这个被冻结的 runner**。
- Cortico 侧无哈希清单，测试跑 `vitest run`（`Cortico/package.json:19`），按 glob 发现；新增 `tests/worlds/**` 无需登记。
- 不新增/修改 `src/web/**`：世界页走 `PanelDecls` + `webUi()` invoke 的既有声明通道（`definition.ts:362-391`），符合 `Cortico/AGENTS.md` §3.5「Adding a World leaves `src/web/**` byte-identical」。
- 合并当天行为恒等：`DEFAULTS.preferences.judgments = []`，`config.mjs:57-63 merge` 后 `feed.mjs` 读到的判断集为空，硬拦与加权都是空操作。真正生效发生在主人点下第一张「采纳」的那一刻——不需要重冻哈希、不需要改验收脚本、不需要迁移已有数据。

### 方案 B：先把意见箱闭环做实，判断暂时寄存在意见箱里

只修 A1 的读取 bug 与 home 口径（见「前置修复」），再在 `ORIENTATION.md:27` 后补一句「判断卡也用 `bili_feedback`，`--self` 表示你已对治」，让 `feedback.jsonl` 先有内容；feed 侧把 `severity==='high' && selfHandled` 的记录当作临时 dislike 来源。

- 改动面最小（`tank.ts:80-90`、`feed.mjs:261` 一处），但语义是**挪用**：`feedback` 记录的是「工具坏了」（`definition.ts:270` 的工具描述 "report a tool/system problem"），不是「我下次要往哪儿偏」。把偏好校准塞进缺陷通道，会让主人的运维队列和她的品味共用一个字段空间，`severity` 一词两义。
- 数据契约缺失：`feedback.mjs:53-63` 的字段里没有 `tokens/stance/scope`，`note` 只有 300 字自由文本（`feedback.mjs:41`），feed 只能靠切词猜——退化成方案 C 的解析脆弱性。
- **不做为独立终态的理由（具体）**：它无法给出「第二天 feed 不一样」的可证伪证据（B 的唯一效果指标是文件从 0 行变成 N 行，与 feed 行为无因果链）；且 `feed.mjs` 要读 `feedback.jsonl` 就必须把「她报的缺陷」当成「她的口味」，第一张「feed 太慢」的高危卡会把「慢」这类词永久变成硬拦。前置修复部分已被吸收进方案 A。

### 方案 C：让 feed 直接解析私人日记的判断小节（无中间结构）

在 `feed.mjs:38-50` 追加读 `whale-diary-private.md`，用 `feed-feedback.mjs:15-29 learnTokens` 抽近 7 天 `### …判断` 小节的主题词，只进 `boostOf`。

- 改动确实最小（1 个文件，约 10 行），也符合 `Cortico/AGENTS.md` §1「minimal priors」的字面。
- **不做的三条具体理由**：
  1. **命中率不可控**：16 个小节里 13 个带括号后缀（A2 实测），按精确标题匹配静默漏 81%；改成像 `feed.mjs:43` 那样用正则宽匹配，又会把 `### 情绪系统与我的判断不一致`（`:86`）这类非判断小节也吞进来。
  2. **没有立场，只能加权**：文本里没有 prefer/avoid 标记（样例 `whale-diary-private.md:10-19` 里「以后遇到…直接判为噪声」的「噪声」是叙述词，不是字段）。而「以后别只看助眠类」要的恰是**硬拦**——只进 `boostOf`（封顶 7.5，`feed.mjs:213`）改不动 `keepCandidate`/dislike 的丢弃决策，也就改不动「她到底看到什么」，只改排序，闭环仍然是断的。
  3. **回路耦合在 prompt 上，验收期无法归因**：她怎么写（标题后缀、粗体与否、`ORIENTATION.md:20` 的措辞）决定解析命中率。观测期内任何一次 prompt 或写作风格漂移都会让「判断没生效」与「判断没被解析出来」两种原因不可区分——正是本轮六席研究需要排除的那类歧义。51 KB 日记每次 feed 全量重扫也是无上限成本。

---

## C. 推荐

**推荐方案 A。** 判断卡（结构化、字段白名单、无权限语义）→ 主人采纳 → `preferences.judgments` → feed 的硬拦与有界加权；前置修复 `tank.ts` 的计数 bug 与 home 口径顺带把意见箱变可信。

- 方案 B 不做独立终态：缺陷通道与品味通道共用一个字段空间，且拿不出「feed 行为变化」的因果证据；它的有价值部分（读取端修复）已并入 A。
- 方案 C 不做：精确标题匹配实测漏 13/16，无立场字段所以只能软加权（软加权改不动丢弃决策），且失效原因与 prompt 措辞纠缠，在 14 天窗口内不可归因。
- A 的成本集中在**一次面板改动**（世界页 `judgment` 小节 + 一个采纳动作）与**一次 feed 过滤链接口化**（把纯函数抽出来才能写离线回放测试）。这两处都不碰 `scripts/hashes.json` 的 12 个冻结文件，也不需要改 `run-mjs-tests.mjs`（readdirSync 发现）或 `src/web/**`。

---

## D. 需要人拍板 / 我不确定的地方

以下都不是既定结论，是待决项：

1. **`bili_feedback` 为什么 0 条，我没有定论。** 已排除的：路径不一致（同源，A1）、模块加载坏（实跑 import 成功）、从没被提示（`ORIENTATION.md:27` 明写）。未排除的：她尝试过但 `add` 失败（失败不留 causal，`definition.ts:821` 只在 `status===0` 时记）、通道比观测冻结点还新（`hashes.json:2` 10-31 00:30 vs `feedback.mjs` 10-31 01:24）。要判定得翻会话逐字记录，我没读。**请拍**：是先按「通道太新、等一张卡」观察，还是现在就补一条失败留痕。
2. **判断卡要不要主人逐条采纳，还是给个「自动采纳 low 档」的口子。** 我按「全部人工」设计（红线最小化）。自动采纳会让她写的词直接变成硬过滤，与「权限配置只能主人改」的精神有张力。
3. **`expiresAt` 默认时长**（7 天 / 30 天 / 永不过期）与**卡片上限条数**——影响她的旧判断多久失效，属于角色一致性设定，不是技术默认值。
4. **`scope: 'draft' | 'dm'` 的执行端我没设计。** 本轮只做 feed。她的判断里明显有跨工具的（如「同 UP 第 4 条」「词表漏风」），只接 feed 会让她觉得「卡只治了一半」。要不要一并把 `draft` 作用域接到 `scripts/draft-dynamic.mjs` 的取材，需要拍。
5. **主人手写词表与判断卡的表达冲突是否要显式提示她。** 我的设计是留痕在快照 `conflicts` 里（她可 `bili_diary_read` 读到），但「她读到之后该改判断还是等主人」没有答案，属教育性问题，不适合我用代码替她决定。
6. **`ORIENTATION.md` 的实际注入时点**我只验到它是 git 跟踪文件、`src/bot.ts` 引用 `prompts`，**没验到 10-31 那次 mtime 改动是否已进入观测期的会话**。这直接决定第 1 条的解释。
7. **改 `feed.mjs` 的过滤链是否要抽函数**取决于验收侧对 `feed.mjs` 的依赖强度。我确认了 `scripts/hashes.json` 不含 `feed.mjs`，但**没扫过 day-report / goal-audit / counterfactual 里是否有对 `feed.mjs` 文本或 stdout 形状的断言**。合并前应实扫一次；若有断言，则把「抽纯函数」降级为「新增并行模块 + `feed.mjs` 内部调用」以保持原 stdout 逐位不变。
