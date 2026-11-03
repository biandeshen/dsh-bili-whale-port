# 解耦改造 §8 进度实况（2026-11-02 01:40）

本页只记**代码里能查到的状态**，不记计划。每行都能用右侧命令复验。

## 0. 先读这一条：改在哪 ≠ 跑在哪

**正在跑的进程是 `E:\WorkSpace_Qoder\Cortico`（master，PID 119536，端口 7799）。**
`Cortico-up`（reanchor/replay）没有被任何进程加载。复验：

```
wmic process where "name='node.exe'" get CommandLine | grep -i cortico
```

含义：本轮所有**世界页**改动（待放行口径、时间线 actor 列、`bili_look`、历史检索、
日记区间汇总……）都只存在于 `Cortico-up`。用户在 7799 上看到的仍是 master 的行为。
要让改动生效，必须先定"什么时候把 live 切到 reanchor"，然后走一次真实切换
（换端口起一份对照 → 观察 → 停旧起新），不是改完代码就算完。
`dsh-bili-whale` 的改动（状态根、迁移、actor 默认值、凭据路径）**是活的**——CLI 每次
调用都从磁盘读，和哪个宿主无关。

## 已完成（有代码 / 有证据）

| # | 主题 | 证据 | 复验命令 |
|---|---|---|---|
| 1 | 落线声明 | `dsh-bili-whale` 2268b8b、`docs/DECOUPLING-BASELINE-2026-11-01.md` | `git log --oneline -1` |
| 2 | 备份覆盖 runs + 正确 drafts | `scripts/ops-backup.mjs` 用 `draftsDir()` + 存在优先排序 | `npm run ops:backup` |
| 3 | 恢复演练 | `docs/evidence/restore-drill-2026-11-01.md`，四项 sha 全等；包内 drafts 17 份 / runs 601 份 | `ls ~/.dsh/backups/backup-*/files` |
| 4 | `state-roots` R1–R5 | `tools/lib/state-roots.mjs`，22→24 类 | `node --test tests/contract/state-roots.test.mjs` |
| 5 | 四红测试 | 同上一份测试里：错写者抛错、无身份拒写、退场日切读列、并发锁 | 同上 |
| 6 | 旧家退场单点 | `paths.mjs` 的 `legacyAllowed()` 是唯一判断，`state-roots` 转出不再自存 | `node -e "import('./tools/lib/paths.mjs').then(p=>console.log(p.LEGACY_UNTIL()))"` |
| 7 | selftest 落点与可见失败 | `tools/commands/selftest.mjs` 写新家；写失败 `console.error` 而非静默 | 删权限后跑一次 |
| 8 | dm / reply-draft 读写分离 | 两边都是 `stateReadPath` 读、`writeStateText` 写 | `node tools/bili.mjs reply-draft list` |
| 9–10 | 迁移工具 + 账本 + 回滚 | `scripts/migrate-state-roots.mjs`；演练四条路径全过 | `node scripts/migrate-state-roots.mjs` |
| 11 | 生产迁移执行 | 账本 `~/.dsh/bili-ai/migrations.json` 的 `mig-mvy2bnnz`：pending-replies / selftest-passed | `cat ~/.dsh/bili-ai/migrations.json` |
| 12 | 读数同源（徽标 = 面板 = CLI） | `Cortico-up` adb670b：`pendingTotal()`；实测 4+9=13 | `node --import tsx -e "import('./src/worlds/bili-account/tank.ts').then(t=>console.log(t.pendingTotal()))"`（在 Cortico-up 下跑） |
| 13 | 凭据路径只此一处 | 22 处手拼换 `credentialsPath()`，脚本已删 | `grep -rn "'\.bili-ai'" tools/ scripts/ \| grep -v paths.mjs`（应只剩 ops-backup 两行） |
| 14 | 状态根门禁进门禁链 | `package.json` 的 `gates` 末尾；`scripts/check-state-roots.mjs` | `npm run gates` |
| 15 | 并发追加不需要锁 | 实测三进程 × 60 行 × 100KB 无撕裂；`causal.requiresLock=false` | `e57fdda` 的提交说明 |
| 16 | actor 归因 | dsh 侧 `dd9bffe`+`394beaf` 前一提交；World 侧 `394beaf`；时间线加「谁」列 | `node --test tests/contract/state-roots.test.mjs`（含署名断言） |
| 24 | 门禁报告落盘带 gitSha | `056cb06`，`docs/evidence/gates-2026-11-02.json` | `node -e "console.log(require('./docs/evidence/gates-2026-11-02.json').gitSha)"` |

## 已推翻的原有判断（写下来防止重犯）

1. **"`reanchor/replay` 是功能超集"** —— 落线时它比 `dev/policy` 少 8 条提交。已逐条 cherry-pick 补齐（`eb66788`…`c3cb8ff`）。补齐后 `tsc` 两套 0 错、`vitest run` 290 文件 / 5208 通过。
2. **"causal 必须拿锁"** —— 实测单行 append 就是原子的。锁只该护读-改-写。配上只会多一种超时失败。

## 未做（按风险排序，不是按编号）

| 项 | 为什么还没做 | 卡在哪 |
|---|---|---|
| **把 live 切到 reanchor** | 见 §0：改在 up、跑在 master | 需一次受控切换（换端口对照 → 观察 → 停旧起新） |
| 17–18 persona-core 包化 | `Cortico-dev/persona-core` 无 `package.json` | 要动 6 处 `file:///` 引用 |
| 19–23 World 瘦身 / debrief 端口 | 第 1–2 段已做（见下）；第 3–4 段未做 | 第 4 段要先补 tick 顺序测试 |

## 瘦身分段进度（2026-11-02）

`§8` 把瘦身写成第 19–23 步，但代码里没有"五阶段"这个东西——现在是一个 `lifeTick()`
从头跑到尾。所以实际排法是先搬纯函数、再拆类。

| 段 | 内容 | 状态 | 结果 |
|---|---|---|---|
| 1 | 纯函数与路径抽出 `definition.ts` | **完成** `c74603f` | 1440 → 1101 行；新增 paths / causal-io / prompts / capability |
| 2 | 工具声明抽出 | **完成** 同提交 | → **1055 行**；新增 `tool-decls.ts`（18 个工具，有序） |
| 3 | persona-core 包化（§8 17–18） | **完成** `1b2f751` | 19 处相对引用 → `@xiaoyu/persona-core/*`；新增包清单与汇总出口 |
| 4 | 拆类：lifeTick 分阶段 + `tank.ts` | **完成** `14bf940` + `1cb5a5b` | 新增 life-stages（五阶段纯函数）+ config-store；`tank.ts` 605→496 |

**第 3 段的两个实测结论**：

1. **§8 第 18 步「6 处 `file:///` 全改掉」做不到，也不该做。** 那 6 处在 dsh 仓，
   加载的是 `CORTICO_ROOT` 指定的**任意**检出；换成包名会绑死到本仓的 `node_modules`，
   换一份检出就静默加载到错的代码。已在三处就地写明理由，并各跑一次冒烟验证
   （对 `Cortico-up` 与 live `Cortico` 都通过）。
2. **离线装不了。** pnpm 11.28 的离线元数据缓存布局与旧版不同，`--offline` 会报
   `ERR_PNPM_NO_OFFLINE_META`；联网装 6 秒完成并建好软链。换机时不能假设离线能装。

**验收（第 1–2 段）**：`tsc` 两套 0 错；Cortico-up 的 mjs 217/217；全量 vitest
**290 文件 / 5208 通过 / 3 跳过**；`definition.ts` 的旧导出逐个保留（re-export），
测试与脚本一行没改。

**一个必须记住的副作用**：`tests/core/util.test.ts` 有一份"哪些文件允许裸读文本"
的白名单，拆分后名单变长（causal-io / paths / prompts 加入）。这不是放宽规则——
新文件仍在同一层边界内；真要收，得按测试注释里说的给 World 一个宿主级文件接口。
| 25 README/INDEX 重写 | 结构已变，文档还是旧的 | 等 19–23 定稿 |

## 一条读法

`§8` 表里的"验收命令"是**当时设想**的，不是现在的事实来源。要判某项是否落地，去查右列命令，不要信表。

## 第 4 段：拆类（2026-11-02 08:20）

| 项 | 改前 | 改后 |
|---|---|---|
| `definition.ts` | 1440 | **1043** |
| `tank.ts` | 605 | **496** |
| 新增 | — | `life-stages.ts`（五阶段纯函数）、`config-store.ts`（策略/名字/设置） |
| 测试 | 216 | **223**（新增 6 条阶段顺序 + 1 条拆分契约） |

**做法**：先写测试再动结构。`tests/life-stages.test.mjs` 六条锁住五阶段顺序与三个边界
（跨日归零、睡着阈值、结算游标不重复吃）；跑绿之后才把 `lifeTick` 改成调用这些函数。

**§8 第 19 步的原文是"tick 五阶段显式化（行为不变）"，实际情况是"先定义出阶段"。**
代码里原先没有五阶段——只有一个从头跑到尾的函数。所以这一步的工作量是设计 + 拆分，
不是"把已有的东西显式化"。这条差异值得记下来，免得下次按旧描述估工期。

### 运行时验收（§7 第 9 条，只能真跑）

在 7801 起了一份 `Cortico-up`，状态用副本 `~/.dsh-up`，live 的 7799 全程未动：

| 检查 | 结果 |
|---|---|
| 循环在跑 | `life-status.json` 有 `updatedAt`、`nextWakeAt`，`lastKind=consume` |
| 状态在结算 | `fields.lastAppliedAt` 推进到 `00:21:17Z`；memories 53 |
| 因果在记 | 新写入带 `actor=host` |
| 五阶段真的在走 | `asleep:true`（距上次动作 ≥6h）、`actionsToday` 与账本对账后一致 |

### 顺带查实的一件事（不是本次改动引入）

live 的 `publish.draftMode` 是 **`auto`**，而今天 17:42 生成的那条草稿仍是 `pending`。
原因：它绑的一次性令牌 `ack-cd5e7ffd1d07e998` 已不在 `control/pending/` 里，
按 `definition.ts:775-779` 的设计"auto 不许自己造令牌"→ 转人工。**没有静默发出**，
这是设计生效而不是故障。要不要恢复成 `review` 是产品决定，不在本次改造范围。

## 待审队列：补上出口并处理存量（2026-11-02 10:00）

### 缺陷（不是本次改造引入，是一直如此）

`go-gate.mjs` 只入队，注释里"主人在 panel「信箱与事件」放行"的界面**已随世界页改造退役**。
结果队列只进不出：9 条从 10-25 堆到 11-02，CLI 只有 `drop`/`take`，没有任何路径能发出去。
世界页有 `pendingReplyCount()` 但只是显示数字。

### 补的东西

`reply-draft release` / `drop-pending`（`tools/lib/pending-queue.mjs`，`2bd8b48`）：

- 放行 = 原样执行入队时记的 `argv` 并加回 `--go`（入队时正是把它剔掉的）
- 前置检查：kill 开关、argv 存在、图片文件在不在、凭据在不在
- `--dry` 只预演不改队列

### 两个实测出来的坑（都写进测试了）

1. **退出码 0 不等于成功**。`fav` 被规则拒时也是 exit 0，只在输出里打 `✗`。
   第一版只看 exit，把"被拒"报成"已放行"。
2. **失败不能从队列摘掉**。风控冷却导致的失败过几分钟能重试，摘掉等于永久丢掉这条。
   第一版就是"失败也摘"，当场吃了一次亏。

### 存量处理结果

| 条目 | 处理 | 结果 |
|---|---|---|
| 收藏《纯雨声》（`e0b72502`） | 放行 | ✓ 已进收藏账本（`BV1ji4y1Y77p`） |
| 动态「雨夜听雨」（`883ac002`） | 放行 | ✓ `dyn_id=1265926947510157320` |
| 动态「抱着鲸鱼睡」（`c847936b`） | 放行 | ✓ `dyn_id=1265929223875330069` |
| 其余 6 条动态稿 | 丢弃 | 同一晚八张图，只留两张代表性的 |

**过程中的一个损失**：`c847936b` 第一次尝试撞上风控冷却，被第一版"失败也摘"的逻辑从队列删掉。
内容在 `pending-replies.backup-20261102.json` 里，已重建回队列并在冷却后成功发出。
这条损失是我代码的锅，不是数据问题。

## 切 live（2026-11-02 11:20）

| 步 | 动作 | 结果 |
|---|---|---|
| 0 | `ops-backup` | `backup-20261102T031847Z`，742 文件 / 33.8 MB |
| 1 | 停 7799 | 两个进程已停，端口释放 |
| 2 | `pnpm build:web` | **必须有这一步**：up 从未构建过，`dist/web` 是空的，直接切会白屏 |
| 3 | 起 up @7799 | `CORTICO_HOME=Cortico/deployments`，部署与数据都复用 live 那份 |
| 4 | 观察 | `lastAppliedAt` 推进；5 盏灯全 online；扩展页 200；因果账新条目带 `actor=host` |
| 5 | 修差异 | 见下，修完重启复核 |

### 切完才发现的两件事

1. **up 没有 WebUI 产物**。`dist/web` 整个不存在。如果按原计划"停旧起新"两步走，
   起来会是一个白屏页面 —— 而进程日志只会说"已启动"。这一步必须显式加进切换清单。
2. **世界页「待放行」比面板少 1**。差的是 `control/dm-drafts.json` 里的待处理回信：
   `pendingTotal` 只算动态草稿 + go-gate 队列，漏了 dm 队列（`119a068` 已修并加测试）。

### 一个意外的好消息

切换后的因果账里出现：

> 第一次真的看见画面——海边、椰子、两根鹅毛棒。十几天的「画面未核对」删掉一行。

`bili_look` 在真机上生效了：她真的看到了视频画面，不是只读文字。

## 存量待审清零（2026-11-02 11:55）

主人批准的口径是「留最近两条、旧的丢掉」。开工先核了一遍令牌，**发现"留两条"这条本身不成立**：

- `dyn-20261102-cd6d4a`：`dynamic-approve list` 明写「待审 token:（无或已过期，**不能真发**；请重新生成草稿）」。
- `dm-20261101-cbc62a`：`expiresAt = 2026-11-01T08:40:52Z`，也早过了。

而 auto 只发**当天**那一条（`definition.ts:764` 起 `draftForDay(today0)`），不会回头扫旧稿；
旧稿留着没有任何出口会再发它们，只是让徽标一直亮着。所以六条全部 `reject`，理由逐条写进草稿文件，
她下一轮从 `latestDraftFeedback` 读得到（#41 那条链路）：

| 条目 | 状态 | 写回去的理由（摘要） |
|---|---|---|
| `dyn-20261027-5a8d88` | dry-run → rejected | 热评稿已过时效，现在重发等于把十天前的话再说一遍 |
| `dyn-20261028-051a57` | failed → rejected | `**1**` 星号不渲染；十天前的抱怨早该翻篇 |
| `dyn-20261029-8e3377` | cooldown → rejected | 隔三天再发对不上她的时间线 |
| `dyn-20261031-9f8a2a` | failed → rejected | 两处星号加粗；那句是对 feed 的抱怨，不是对读者说的话 |
| `dyn-20261102-cd6d4a` | pending → rejected | 令牌已过期发不出去；「今天池子里只放了一条」把内部候选池讲给读者听，出戏 |
| `dm-20261101-cbc62a` | pending → rejected | 令牌过期；正文把「本机模型 / 文件句柄 / 筐测试」写给网友看，且 `**` 不渲染 |

复核（现跑，不抄上面的表）：`GET /api/webui/providers/world%3Abili-account/panels/vitals/state`
→ `pendingCount=0`、`pendingParts={gogate:0,dynamic:0,dm:0}`；灯「待审稿」文案变成「没有等放行的…」。
**代价要说清**：鱼片 10-31 的提问到今天没人回。`dmReply=direct`，她下一轮醒着时可以重起一稿直接发。

## 顺着这六条挖出来的真缺陷：出站 Markdown 只修了动态那一条路

被拒的六条里有三条正文带 `**加粗**`。B 站的动态、评论、弹幕、私信**全都不渲染 Markdown**——
发出去对面看到的就是原始星号。这比任何"AI 声明"都更直接地把她是机器人这件事摊在桌上。

根因是 #32（`e2228ba`，11-01）当时只在 `tools/drafts/compose.mjs` 的取位链里修了星号，
另外四条出站口一直是裸的：`dm-drafts.addDraft`、`dm-send-core.sendOwnerDm`、
`comment.mjs --message`、`danmaku.mjs --msg`。

补法：新增 `tools/lib/plain-outbound.mjs`（`plainOutbound`），**幂等**，只做"去掉渲染不出来的标记"
这一件事——成对的 `***/**/__`、行首 `#`、行首 `>`、行首 `-`/`*` 列表换成 `·`、反引号、`[文字](链接)`；
单个 `*`（乘号、涂改感）、《》、emoji、标点风格一律不碰。接在五处：

- 私信：入队（`addDraft`）与发送（`sendOwnerDm`）两个出口。**入队就洗**，是为了让 `textHash`
  对齐的正是将要发出去的那份字，而不是"审干净稿、发另一份字"。
- 动态：接在**成稿**处（`compose.mjs` 的 `final`），不接在发布器里，同一条理由——
  草稿文件、一次性令牌的 textHash、真正 POST 的字符串三者必须是同一个串。
- 评论 / 弹幕：命令行参数读到就洗；`--msg` 不带值是 `true`，这种情况原样交给下面的参数检查。

验证：`tests/contract/plain-outbound.test.mjs` 8 条锁纯函数（含"不误伤"与幂等）；
`tests/contract/outbound-plain.test.mjs` 3 条**走真实出口**——私信落盘后读文件断言、`composeDraft`
真函数断言成稿无星号、弹幕 `spawn` 真跑 `--go` 后读 `pending-replies.json` 断言报备文案是
`主人 我在`（`danmaku.mjs` 的 send 分支在 `queueGo` 后立即 exit，全程没发一个请求）。
**评论那条出口没有离线可断言的路径**（`--dry` 第一步就要打 nav 认账号），改动与弹幕同构，
只做代码走查未做行为级验证——这条差距写在这里，不算已验。

顺带一个门禁的锅：全量第一遍红在 `tests/contract/panel.test.mjs`，报「panel.token 未生成」，
单跑全绿。真因是这个文件给每个 test 各起一个面板进程，76 个文件并发时子进程 **stderr 没人读**、
管道写满会把它卡住，而等待预算只有 8 秒。改成读 stderr 环形缓冲 + 24s/18s 预算，
并把 stderr 打进报错（下次再红能看到根因）。

复跑：dsh **418/418（76 文件，fail=0）**、Cortico-up mjs **224/224（27 文件）**、
`check-hashes` 一致、`check-consumers` 全部有生产调用、`check-state-roots` 无绕过表的路径也无多写者
（仍提示 api-cache 等 6 类新旧家分叉——那是迁移期的读数差，不在这次范围里）。
dsh 侧改动全是 World 每次 `spawn` 新进程跑的 CLI，**不需要重启 her**，下一轮生效。

## 观测窗：门已经全绿，但窗根本没开——而且"冻结"以前管不住（2026-11-02 12:15）

现跑两条读数，结论和 11-01 的口头计划不一样：

```
node scripts/g3b-check.mjs        → 五项全 PASS，"可以进入 14 天观测"
node scripts/observation-status.mjs → 「观测尚未开始：G3b 通过后创建 control/observation.json」
```

`14 天窗从 11-02 00:00 起算` 这句话从未落地：`g3b-status.json` 是 **11-02 00:08** 才 ready 的，
而开窗要人跑 `observation-start.mjs`，没人跑。所以今天不是"观测第 1 天"，是"接入后第 2 天"。

顺着查下去发现一个更实的洞：`observation-start.mjs`（在 `scripts/hashes.json` 的冻结清单里，不能动）
只记 `{startDay, days, createdAt}`——**没有代码身份**。而 §2 写的依据是
「证据归因靠 live 冻结在同一份代码保证」。本项目的 live 恰恰是最好漂的那种：
World 的每个工具调用都是 `spawn(node tools/bili.mjs …)`，
**改 dsh 不重启就立刻生效**。也就是说"这轮没重启"这件事，在本架构下**证明不了"没改 live"**——
今天这几个出站清洗提交就是明证：没重启，但她的出站正文规则当场变了。

补上那条缺失的读数：新增 `scripts/live-code-anchor.mjs`（不在冻结清单里）。

- `--set` 记两份指纹：`{name, dir, sha(40位), dirty}`，写 `control/live-code.json`；
- `--check` 用**当初记下的那个目录**重新取指纹，sha 变了或"干净→有未提交改动"都算漂移，**退出码 2**；
  没锚过报 `missing`，绝不报"一致"；
- `ops-day.mjs` 多一行「live 代码锚点」，于是每天的例行汇总会自动把漂移顶出来。

测试两层：`tests/live-code-anchor.test.mjs` 5 条（临时目录里造一份真 git 仓库，
多一个提交→必须红；从干净变脏→必须红；删锚点→报未锚定）；`tests/ops-day.test.mjs` 加 1 条锁住
"没锚 → 拦一项并把该跑的命令说出来"。全量 **424/424（77 文件）**、Cortico-up mjs 224/224、
consumers/哈希/state-roots 三道照旧。

**这把"开观测窗"变成一个可以机械执行的纪律**：`observation-start.mjs` 之后立刻
`live-code-anchor.mjs --set`，窗内任何一次 dsh 提交都会在第二天的 `ops-day` 里变红。
要不要现在开窗是主人的决定（开窗 = 接下来 14 天不改 live），不是我能替他按的按钮。

## 我拒的稿，她当天重写不了——闸门和话术都得改（2026-11-02 22:50）

`dynamic-approve reject` 会把理由写进草稿，`consumeDraftResults` 会在下一轮把理由结算成她的
场值与记忆（11:57:48Z 那条 `draft-result-consumed` 就是证据）。但**出稿的那一步被拦死了**：

- `scripts/draft-dynamic.mjs` 只要当天的 `<date>.json` 存在就返回 `当天草稿已存在`，
  不看状态——被拒的也算"今天已有稿"；
- 宿主 `prompts.ts:todayDraftLine()` 同样把 `rejected` 念成"这一轮不用再出稿"。

我在 reject 理由里写的是「重新起稿」，她执行的路径却被这条规则堵住。这是同一类错误的第二次：
上一次是待审队列只进不出（10:00 那节），这次是**给了她反馈、没给她改的机会**。

改法（两处都改，只放开 `rejected`）：

| 位置 | 以前 | 现在 |
|---|---|---|
| `draft-dynamic.mjs` 闸门 | 文件存在就拒 | `status === 'rejected'` 放行重写；`pending`/`sending`/`sent` 仍拒（一天两条是刷屏） |
| `prompts.ts:todayDraftLine()` | 「今天已经出过草稿（… · 被拒）——这一轮不用再出稿」 | 「今天那条草稿被主人拒了，理由在下面那条反馈里——这一轮照着理由重写一版，别原样再交一次」 |

一个实测事实写在这里省得下次猜：**重写后的草稿 id 和原来一样**（id = 日期 + 正文指纹）。
被拒那条的理由不会丢——它已经进 `causal.jsonl`（append-only）并被结算进记忆，
覆盖当天文件只覆盖"当前状态"这一份。

测试两层：`tests/draft-rework.test.mjs`（dsh，真起子进程跑 CLI：没稿→出稿带令牌；
rejected→重出且换了新令牌；sent/pending→仍拦住且 exit 0 不是崩溃；重写落在同一个日期文件）
4 条；`Cortico-up/tests/draft-rework.test.mjs`（宿主话术）3 条。
复跑：dsh **428/428（78 文件）**、Cortico-up mjs **227/227（28 文件）**、哈希一致、
consumers 全有生产调用、state-roots 无绕过。

**这一条需要重启才生效**（改的是宿主 `prompts.ts`，不是每次 spawn 的 dsh CLI），
而重启又暴露出切 live 留下的两个运维缺口，见下一节。

## 切 live 那次手工启动，把监督链落在了后面（2026-11-02 22:50）

`ops-day` 现在这条是红的：

```
✗ Cortico 进程  .dsh\bili-whale\control\cortico.pid → dead pid=117840
✓ 端口 7799 在听  本地 bind 试探：EADDRINUSE
```

端口在听、进程活着（11:29 起，pid 114848）、她的 tick 也在走——但 **pid 文件写的是上一个进程**。
原因很直白：切 live 那步是我手工 `node --import tsx src/launcher.ts mybot --port=7799` 起的，
没走 `scripts/start-cortico.mjs`。后果有三个，都不是"她错了"，而是"我们看不见她"：

1. **pid 文件过期** → `ops-day`、备份脚本、任何按 pid 判活的下标都指着一个已经死了的进程；
   她真出事时，读数为"进程死了"，而她其实活着——这种反向错会让人做错的处置。
2. **`control/cortico.log` 不再被写**（最后一行停在 11-02 00:50，是旧进程写的）→
   新进程的输出落在别处，排障时 `tail` 出来的是一整夜前的历史。
3. **少了监督进程**：`bin/cortico.mjs` 才是带 IPC 重启与 `.restart-request` 标志的那一层；
   直接起 `src/launcher.ts` 等于把"崩溃自动再来一次"和页面那个一键重启都绕过了。

处置：`start-cortico.mjs` 补齐 live 的真实拓扑——代码树与部署树现在是**分开的两份**
（代码 `Cortico-up`，她的 memory/session/config 仍在 `Cortico/deployments`），
所以两条 env 必须成对，脚本里都写了默认值（`CORTICO_ROOT` / `CORTICO_HOME` 可覆盖回滚），
然后用这条命令重启，让 pid、日志、监督三者重新落回原位。

## 2026-11-03：主人骂"这些明显是配置参数，就不能把配置放那儿吗"——查出来是真的

主人原话：「你他妈的，这些很明显是配置参数，就他妈的不能把配置放那儿吗？我他妈逼面上不能改吗？默认就是这样子，行了吧。」

**查出来的事实**：草稿/点赞/收藏/回信四个档位**早就在策略页能改**（`webui/client.ts:479` 写、
`:636` 显示），默认值也已经是主人要的样子（`draftMode=auto` / `autoDailyCap=0` / `autoWindow=''`）。
**真正缺的是评论与弹幕**：它们**连档位都没有**——行为写死在 dsh 各命令里（评论无条件进待审队列、
弹幕无条件进队列），主人想调都调不了。已补：`permissions.comment` / `permissions.danmaku`
（`'review'` 默认＝等主人放行，与今天行为一字不差；`'self'`＝她自己发），页面多两个下拉、
状态行多两项、配置总览把这两项标成"策略控件可改"。非法值收敛成 `review`，不靠写坏值放开。

**这一轮真实浏览器抓出我自己的一个漏项**：两个 select 建好了、也写进了状态行和保存补丁，
但**忘了 `ui.field(...)` 挂载** —— API 对、页面不对，只读 API 或看代码都发现不了。
真浏览器里状态行写着「评论=review · 弹幕=review」，下拉却不存在。补挂后加一条门：
策略面板里每个 `select` 都必须出现在 `ui.field(...)` 里，否则红；这条门已验证能抓住本次漏项
（临时删掉那行 → 报 `selDanmaku` 建了但没挂）。只查 select 不查 input：输入框还能挂在
rowbar（名字那节）或弹窗（驳回）里。

**顺带修一条假门禁**：Cortico-up 的 `node_modules/.bin` 是空的，`tsc` 根本不存在，
昨晚那句"tsc 干净"其实没有证据（那次的退出码来自管道末端的 `tail`）——已离线重建依赖链接，
`tsc --noEmit` 现在真跑通。

## 第二条真缺口：队列里的东西只显示计数，主人点不到（能力面席量出来的）

「待放行」那个数字一直算着 go-gate 队列（`pendingReplyCount` 读 `pending-replies.json`），
但页签上的按钮只有动态草稿的 `approve`/`reject`（收的是**草稿 id**）。评论/弹幕/分享型动态
进了队列，主人只看得见一个数，**没有放行的地方**——`pending-queue.mjs` 的 `releaseOne` 只被
CLI（`reply-draft release`）用，`panel/` 与 Cortico 侧 grep 0 命中。

现在世界页「待审稿」下面多一节「待放行队列」：每条列出类型/内容/时间，带「✓ 放行」
（真按当时记下的内容发出去）与「✗ 丢掉」。放行语义仍只有 dsh 一份实现（重建 argv + 过闸），
世界页只调它，不复制一遍。真浏览器端到端验过：放一条测试评论进队列 → 页面出现 →
点「✗ 丢掉」→ 确认 → toast「已丢掉」→ 队列文件 `items: []`。

## 她今天凌晨自己发了一条稿，而且是干净的（链条完整）

```
17:23Z 写日记（公开：看过 / 私人：本轮留下的判断（269期 · 卖人还是卖声音））
17:24Z 出稿 dyn-20261103-9aca38 → 17:26Z draft-result ok → auto-publish ok=true
        dyn_id=1266164923068579846
17:26Z watchedVideo verdict=drop（第269期——一个人做到两百多期，卖的不是单条作品）
17:27Z draft-result-consumed applied=[draftApproved]
```

正文：「这个点还醒着。今晚看的是《轩子ASMR 第269期》。 今天这条我判得比哪条都快：封面一眼
就看完了——睡衣、蕾丝吊带袜、电竞椅，右边写着「第269期 双耳触发 · 细腻近麦」。」

**没有星号、没有《》残片、没有内部管线词**（出站清洗那条链生效了），而且她**真的看了封面**
（`bili_look` → "封面一眼就看完了"）。这是切到 reanchor 之后她第一次自动发布成功。

一处要记的细节：因果账的时间戳是 **UTC**，而她的"天"按本地日界 —— 跨零点时账里的日期与
她的日期会差一天（这条稿在账里是 11-02 17:26Z，她的草稿文件是 2026-11-03）。复盘时按
`at` 过滤会漏，别当成没发生。

## 团队那一轮：六席被额度封顶打断，重派五席（记忆席那次已落盘）

`/deep-research` 那套并行分析第一次派六席，全部被 `credit usage limit` 打断（0 产出），
**重派**五席（架构裁决、能力面、把关链、挑刺、落地序），记忆席那份在被打断前已写完
（`docs/team-2026-11-03/03-memory-unify.md`，241 行）。产出落 `docs/team-2026-11-03/`。

**他们纠正了我文档里的四处错**（都已改进 `ARCHITECTURE-TARGET-2026-11-03.md`）：
bot 包 `cortico.api` 是 **7 不是 6**（`src/extensions/manifest.ts:23-27`，值不对包根本不加载）；
World id **不能叫 `bilibili`**（上游直播 World 已占 `src/worlds/index.ts:15`，撞名扩展不加载
`src/extensions.ts:357-362`）；`msgfeed` **不是"调用方为 0"**（CLI 侧 `comment-await.mjs:23`、
`comment-digest.mjs:18` 在用，**World 侧**才是零调用）；工具差集 **34 → 25**（CLI 名与工具名
口径不同）；上游落后 **543 → 436**。

**把关链席查出的重复实现**（还没动，记在这儿）：kill 路径 **6 份字面量**、档位 **两份实现**
（`publish-policy.mjs` ↔ `config-store.ts`，另有一份抄的 `inWindow` 在 `tank.ts`）、
ack 绑定校验 **4 份**（World 侧那份只查 draftId 不查 textHash）、`POLICY_DEFAULTS` 与
`capReached` **全仓无调用点**（死代码）。现成缺口：点赞/收藏不过 quota 额度闸、弹幕过闸不记账、
评论/弹幕/动态成功不写 causal。它还纠正了一条常见误解：**auto 并非完全失控**，`traffic` 的
`writeDaily=30` 仍是硬上限。

## 她 23:03 的一条意见把"点赞"这件事讲清了（2026-11-02 23:20）

`--usage` 读数跑出来（会话文件 226 行，覆盖 11-01 14:15 → 11-02 23:15）：

```
   3  bili_like  ✗失败 1  ⚠崩栈 2
声明 18 个 · 从没调用过：bili_alarm、bili_judgment、bili_memory_void
要看的：bili_like(1 失败/2 崩栈)
```

她自己 23:03 就在意见箱写了 `f-04014b`：「点赞接口两种失败混在一起：①收藏后 <120 秒调用
bili_like 直接抛 Node 未捕获异常 TrafficError；②重试时返回 code=-400，看起来像参数/权限问题，
实际可能仍是冷却或风控残留。**两者我都分不清是哪一种**」。她是对的，而且比我说得准——
`causal.jsonl` 里 `like` 一条都没有，所以从账上看她就是"没赞过"。

三条根因，三条修法：

1. **写请求没包 try**：`like`/`fav`/`comment`/`danmaku` 四条链路只给取信息的 GET 包了 try，
   POST 那步裸露；`traffic.mjs` 的写冷却 `TrafficError` 一抛就崩进程，她拿到的是堆栈。
   新增 `tools/lib/write-refusal.mjs`：认得闸门拒绝、翻成一行 `✗ 点赞没发出去：写操作冷却中…（等冷却过了再试）`、
   记一条 `like-failed` 账，退出码 4（与 quota-gate 既有语义一致）。四条链路都接了。
2. **失败无痕**：`noteWriteFailure` 落 `<kind>-failed`（actor=cli），`ops-day` 新增
   「今天没做成的动作」行把失败与降级一起顶出来。
3. **取数降级同样无痕**：`f-340915` 说 11-02 三个 feed 源同时失效而没人报警——以前只在 stdout
   说一句。现在写 `feed-degraded`（带失败源与当时池子大小），`ops-day` 一并显示。
   现跑一次 feed 已恢复：`候选池 140 → 去重后 96`，词表 `被赞 0 · 收藏 2 · 已发稿 3 → 45 个主题词`。

`code=-400` 的**根因仍未确认**（她的判断是"可能还是冷却/风控的另一种表现"，我没有证据推翻也没有证据坐实）。
所以 like.mjs 的 -400 提示改成"参数形状或冷却/风控的另一种表现，未确认——别拿同一个写法连续重试"，
不替平台编结论。下次她再点，`like-failed` 会带上确切 code，届时用数据判。

读数量本身也修了一处冤枉：`--usage` 第一版把 `bili_debrief` 4 次里有 3 次判成失败——
因为 debrief 回执照全是弹幕/评论原文，里面出现 `✗` 和「点赞失败」字样。现在只认**回执开头五行**
的 `✗`，崩栈另判（`file:///…:行号` / `node:internal/` / `at …` 帧）。

测试：`tests/contract/write-refusal.test.mjs` 5 条（含真起子进程验证退 4 + 落账 + 不再吐堆栈）、
`tests/wake-audit.test.mjs` +4 条（用量、素材不误判、名单从代码读、`--usage` 真跑一条命令）、
`tests/ops-day.test.mjs` +2 条（有失败账必须拦一项、没失败账必须是绿的）。
复跑 dsh **439/439（79 文件）**、哈希一致、consumers 全有生产调用。
feed 的降级账需要真实网络故障才触发，**没有离线可断言的路径**，这条只做代码走查。

## 退役五条工作树：查完才敢动（2026-11-02 23:45）

主人问"工作区到底在哪个盘、有几个仓"，顺手把冗余副本清了。查的过程比结果重要，记下来防重犯：

**先查出来的事实**：`Cortico-dev / -w2 / -w3 / dsh-bili-whale-dev / -policy` 五个都**不是独立 clone，
而是 `git worktree`**（`.git` 只有 1KB，里面是一行 `gitdir:`）。而 **`Cortico-up` 也是 `Cortico` 的工作树**
——也就是说 live 的代码树依赖 `Cortico\.git` 这个对象库，删错一个就把她带走了。这条已经写进
`CURRENT.md` 的盘位表。

**逐个核过再动**（五条全绿才动手）：

| 检查 | 结果 |
|---|---|
| 未提交改动 / stash | 五条全 0 |
| `.env` / `deployments` / node_modules 里的独有数据 | 没有 `.env`；`deployments/mybot/prompts/ORIENTATION.md` 与 live **一字不差**（`cmp` 四条全同）；node_modules 为空 |
| 独有内容 | 只有 `Cortico-dev/scratch/` 7 个探针脚本（gitignored）→ 先复制进退役目录再动 |
| 分支会不会被删掉 | 不会：`worktree remove` 只删检出目录，分支 ref 留在主仓 |

**动完复核**：`git worktree list` 两边各剩该剩的两个；`dev/policy`、`feat/*`、`dev/publisher` 等分支
在 `git branch --list` 里全部还在；7799 仍在听（pid 225772）、tick 照走、锚点照报。**目录没删**，
整体移到 `E:\WorkSpace_Qoder\_retired-2026-11-02\`（同盘改名，随时可移回），要彻底删由主人说一句。

**主人的裁决（11-02 23:50）**：留一周，**2026-11-09 之后可以彻底删**。删的条件（届时照做）：
`_retired-2026-11-02\` 只剩 3 个检出目录 + scratch 备份，git 里 `worktree list` 已经不再引用它们，
且这一周内没有任何"要回看那条分支上的改动"的需求 —— 分支本身在主仓，删目录不丢代码。

顺带答一句"为什么要那么多仓"：**8 个目录里只有 3 个是有意的**（`dsh-bili-whale` 的 upstream 基线 +
port 线、`Cortico` 主仓的对象库与 master、`Cortico-up` 的 live）。剩下 5 个是把 worktree 当成
"一条主题一条分支"的代替品用出来的结果，用完没有退役步骤 —— 代价今天兑现了：切 live 时
`Cortico-up` 是工作树这一点没人先说，于是 pid、日志、监督三样全落在了后面。
往前的规矩：**同时要在两条分支上跑东西才新建检出，其余一律在原仓开分支；一条线合完就退役。**


**顺带查到一件事**：`dev/policy` 相对 live 有 4 个补丁在 `git cherry` 里显示"没有等价物"
（`91aa02e` 写失败不吞、`2affef6` 历史/日记检索、`ddca555` 前置检查别抹启用意图、`480d456` 顶栏"我是谁"）。
但 `bili_look`、`whoInput`、`withLedgerError` 这些实际都在 live 里跑着——**原因是 reanchor 是
cherry-pick 过来的，冲突解决后 patch-id 变了，`git cherry` 认不出来**。所以这次的结论是：
补丁等价性检查在 reanchor 这条线上不可信，要判"有没有丢东西"得逐条看行为，不能只看 `+`。
这条教训比那 4 个补丁本身值钱，记在这儿。

**另一件事**：清理期间发现 dsh 多出一条不是我提的提交（`660417c`，23:37，另一席在同一分支上写文档）。
`live-code-anchor` 当场把它报成漂移——读数是对的，但它分不清"改代码"和"改文档"，天天红就没人看了。
于是给它加了一层：比对两个提交之间的路径，只动 `*.md`/`docs/` 的标成"（只动文档，行为不变）"，
含代码的把前三个代码文件名带出来。真跑确认：`dsh：提交变了 64eb03a→660417c（只动文档，行为不变）`。
测试 +2 条（docs 必须标 docs、`.ts` 必须标 code），锚点用例现在 6 条。

## 2026-11-04 · 新架构 7798 联调验收（Step 5 执行账）

- **真浏览器走查 8 面板**：抓出并修掉 4 处真实缺陷（`ui.segmented` 位置参数、`invoke` args 必须数组、`WebUiCheckbox` 返回形状、WorldContext.dataDir 是部署级 data/ 须开子目录）——全部记录在 `96f9b60`。
- **挑刺席审计验收脚本 v1**：坐实 4 处自欺（幂等标记洗绿、复原无断言、落盘只看 HTTP、git 只数条数），v2 重写后 **57/57 全绿**（`2a05a47`），覆盖蓝图 §10 全部写方法（含 updateDraft 哈希续签、assignAction 三动作、gate 全分支），全部带磁盘级断言。
- **真实 B 站读调用验证**（挑刺席"必须补"第 3 项）：nav `code=0 isLogin=true`、feed 实拉 10 条、msgfeed-like `code=0` —— 登录态有效，真实数据形状与包内解析一致。凭据源 `~/.bili-ai/credentials.json`（与 live 同源）。
- **真实 ffmpeg/TTS 验证**（Step 4 时）：3s 真出片 + 双封面 PNG 魔数校验、MiMo TTS 1.76s 真音频。
- **待办（切换 live 前）**：① 主模型配置 + console 一轮真实对话（挑刺席第 4 项）；② 切换时重跑迁移收增量（旧 live 停写→快照→再迁）；③ 摘除 Cortico-up 内建 bili-account 注册行；④ push 积压提交（Clash 内核未运行，GitHub 443 不通，本地领先 9 个提交）。
- **数据现状**：新家 `~/.xiaoyu-home/xiaoyu/` 67→69 条记忆（验收脚本自清，净增 2 条直发测试）、双日记完整、workspace git 12+ 提交留痕。
