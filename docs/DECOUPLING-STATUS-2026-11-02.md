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

