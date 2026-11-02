# ARCHITECTURE-TARGET-2026-11-03 —— 现架构实测图 + 重写方案

> **本文管两件事：① 现在的架构到底是什么形状（全部现数，带文件与行数）；② 如果重写，最合理的形状是什么（包边界、接口形状、数据流、迁移与回滚）。**
> **本文是重写方向的唯一依据（2026-11-03 收口）**：原 `PLAN-2026-11-03.md` 把六席分析压成六阶段排期表，**未经主人审阅就落仓并触发了开工**（主人原话："谁让你写了？……谁让你方案一出就他妈执行的，我看过吗？"），已作废删除。它的三条冲突裁决归位到本文 §4（配置落点）/§5（门禁口径）/§6（粒度），其余排期内容不再生效；要原文：`git show 36147ed:docs/PLAN-2026-11-03.md`。**方案可以写，但主人看过之前不是排期，也不是开工凭据。**
> 判据来源：`Cortico-up/docs/extensions.md`（扩展 = 一个 npm 包补一个 World/provider/bot；**仓库内建的 World 与 provider 仅包含参考 bot 所需的实现**）、`Cortico-up/src/world.ts:52` 的 `WorldDefinition` 契约、`Cortico-up/templates/extension/{world,bot}` 两个可直接装的模板。
> 上游归属：`Cortico` = Pal-AI-Lab（MIT）、`dsh-bili-whale` = Alterssss。本文不重复 `ARCHITECTURE-2026-11.md`（那篇写的是"代码里现在成立的事"，按 `file:line`），它只回答"该长成什么样"。

---

## 0. 一张表先说清现在有几个东西

| 代码体 | 位置 | 规模（2026-11-03 现数） | 是谁的 |
|---|---|---|---|
| Core | `Cortico-up/src/core/` | 42 个 .ts / 9,551 行 | 上游 |
| WebUI | `src/web/` | 298 个 .ts / 38,155 行 | 上游 |
| Providers | `src/providers/` | 79 / 8,109 | 上游 |
| 扩展装载 | `src/extensions/` | 18 / 2,543 | 上游 |
| 上游内建 worlds | `src/worlds/` 共 161 / 66,199 行 | minecraft 47,703 · bilibili(直播) 6,727 · qq 5,226 · console 1,285 · websearch 1,070 · fixture 140 | **上游，不是我们的** |
| **她的 World** | `src/worlds/bili-account/` | **17 个 .ts / 4,008 行** | 我们的，**却住在框架检出里** |
| **她的人格内核** | `persona-core/` | 16 个 .ts / 2,054 行 | 我们的（今天才成 workspace 包） |
| **她的人格宿主** | `bots/cormini/` | 34 个 .ts / 6,222 行 | **上游参考 bot**，`deployment.json` 写的就是 `{"bot":"cormini"}` |
| **她的手** | 第二仓 `dsh-bili-whale/` | **43 条 CLI** + `tools/lib` + `tools/drafts` + 41 个 `scripts/` + 79 个测试文件 | 上游移植线 |

World 内部（`src/worlds/bili-account/`，共 4,008 行）：

```
definition.ts      1044   工具装配 + 生活循环 + 事件帧投递（最大的一块）
webui/client.ts     706   6 个页签的浏览器端
tank.ts             511   所有读数（三队列合计、体征、策略、草稿）
personaAdapter.ts   460   第二套状态与记忆：loadState/saveState/applyEffects/remember
diary.ts            321   两本日记的读写与检索
prompts.ts          141   她每一轮看到的话术（含 todayDraftLine）
capability.ts       130   "我此刻有什么手脚"
config-store.ts     126   策略与名字的读写
paths.ts             98   状态路径 + draftsDir 解析
life-stages.ts       97   生活循环五阶段（今天拆出来的纯函数）
task-queue.ts        86   pending 队列 at-least-once
dm-reply.ts          80   回信时效判断
dm.ts                54   收件箱
tool-decls.ts        52   18 个工具的声明
causal-io.ts         42   因果账（actor=host）
gates.ts             39   kill / 风控
runner.ts            21   spawn dsh CLI 的唯一入口
```

## 1. 现架构的六处耦合（每处都有证据）

1. **产品在框架检出里**。`docs/extensions.md` 明说内建 World 只该装"参考 bot 所需的实现"，而 `bili-account` 是我们整个产品，`src/worlds/index.ts:18` 把它注册进上游的 world 表。后果：跟上游对账（master…upstream/main 实测落后 **436**）时，我们的东西和上游的东西在同一个树里，一次 rebase 就会打到一起。
2. **人格宿主是上游参考 bot**。部署 `bot=cormini`（6,222 行，上游的），她的记忆实现、workspace 权限、heartbeat 全在那儿；我们只往它的 workspace 里塞了 `CONSTITUTION.md`/`judgments.md`/`handoffs/`（10 文件 2.4M）。想改人设机制就得改上游示例 bot。
3. **两套记忆互不相认**。`grep` 实测：`bili-account/*.ts` 对框架 Memory（`MemoryAssemblyContext`、BlobStore、`cortico/core/blobs.ts`）的引用 **0 次**，对 `workspace` 的引用 **0 次**。她的记忆是 `C:\.dsh\bili-whale\fields.json` 里 `memories: 60 条 / chain: 68 条`、上限 200 的数组（`personaAdapter.ts:215` `slice(-HISTORY_LIMIT)`）；而 cormini 那套文件式记忆另有 `workspace/judgments.md`。她自己在意见箱 `f-d99d64` 抱怨"判断结果没有独立视图，只能从日记正文里捞"——捞不到是因为**它不在同一个库里**。
4. **argv 字符串边界**。宿主调手的方式是 `spawn('node tools/bili.mjs', [子命令, '--text', 正文, '--go'])`。所有防注入工作（`--` 开头拒收、`plainOutbound` 清洗、`--token-env` 不让令牌进进程列表、"退出码 0 也可能是被拒"的输出里找 `✗`）都是这条边界的税。
5. **能力面只暴露了一小半**。dsh 有 43 条命令，她身上 18 个工具；按能力算差集 **25 条**（CLI 名与工具名不同口径，直接比名字会算出 34）里包含：`check-mention`（@我的）、`check-comment`（回复我的）、`likes`（收到的赞）、`comment-await`（等回复）、`comments`/`comment-digest`/`thread`（评论区）、`whois`、`search`、`subtitles`、`dynamic-edit`、`danmaku`、`comment-del`、`notify`。**入站只有私信一条**（`definition.ts:824` 的 `dm-await --peek/--ack`）；`tools/lib/msgfeed.mjs` 已实现"回复我的/@我的"两个收件箱并写清了字段坑——**CLI 侧有调用方**（`comment-await.mjs:23`、`comment-digest.mjs:18` import 它，`likes.mjs:41` 读第三个收件箱），但 **World 侧零调用**（她够不着）；`bili_comment`/`bili_danmaku` 工具在 `tool-decls.ts` 里 **0 命中**——"评论/弹幕维持人工放行"这条决定，她连发起入口都没有。
6. **三个盘四处家**。代码 `E:\WorkSpace_Qoder\`（且 live 用的 `Cortico-up` 是 `Cortico` 的 **git worktree**，对象库在主仓，删主仓带走 live）；状态 `C:\.dsh\bili-ai\`（新家）+ `C:\.bili-ai\`（旧家，退役到 `LEGACY_UNTIL=2026-12-01`）+ `C:\.dsh\bili-whale\`（fields/causal/日记/control）；素材与稿子 `D:\AI\养鱼\`；会话与 bot workspace `Cortico\deployments\mybot\`。

**唯一不该拆的东西**（判据：换一个宿主/换一个人格，它是否还得一模一样存在）：**不可逆动作的把关链**——`traffic`（minGap / 读写额度 / `pausedUntil`）→ `quota-gate`（自主发言额度、分享 3 条/日）→ `kill` 急刹 → `go-gate` 待放行队列 → `ack` 一次性令牌（绑 `draftId` + `textHash`，审完改稿即拒）→ `publish.draftMode` / `permissions` 档位 → 发完写 `causal`。论证是事故级的：2026-11-01 01:23 正式配置 `publish.draftMode` 被同机一个盲 POST 改成 `auto`、载荷还带 `autoDailyCap=-9`；提示词层的"要先问主人"对这种写入零作用。除此之外，节奏函数、五阶段、场值、记忆结构、判断卡、词表、文案规则——全部是内容，全部可拆可换可测。

## 2. 目标架构：四个包 + 一个部署，宿主零产品代码

```
xiaoyu/                                    ← 部署（数据树，可整体搬）
├── deployment.json      {"bot":"xiaoyu"}
├── config.json          worlds: {bilibili-account:{enabled:true}} · providers · tick
├── prompts/             CONSTITUTION.md · ORIENTATION.md（人设正本，只此一份）
├── memory/              MEMORY.md + blobs/ + judgments/ + handoffs/   ← 框架 Memory
├── state/               fields.json(只场值) · causal.jsonl · diaries/ · life.json · control/
└── media/               assets/daily/*.png · drafts/<date>.json       ← 素材与产出

packages/
├── cortico-bot-xiaoyu/        kind=bot    人设 + 记忆 + heartbeat + 控制台
├── cortico-world-bilibili/    kind=world  整个 B 站域（平台细节不出包）
└── @xiaoyu/persona-core/      普通依赖    纯函数内核（场值/情绪/节奏/文案）
```

### 2.1 `cortico-bot-xiaoyu`（bot 包，照 `templates/extension/bot` 的形状）

```
package.json  {"name":"cortico-bot-xiaoyu","main":"./index.ts",
               "cortico":{"kind":"bot","api":7,"describe":"describe.json"},
               "keywords":["cortico-bot","cortico"]}
index.ts              导出 BotDefinition：World 声明只写 ['bilibili-account']、Persona、Memory 路径
persona/persona.ts    人设组装：读 prompts/CONSTITUTION.md + ORIENTATION.md，注入场值与记忆
persona/blobs.ts      附件（她看到的图、收到的私信里的图）
persona/MEMORY.seed.md 首次启动时的记忆种子（现在是 cormini 的，得换成她的）
persona/PREFIX.md      署名前缀
persona/memory.ts      记忆策略：core / recent / long 三层 + 检索 + 作废
```

**契约版本是 7 不是 6**（`src/extensions/manifest.ts:23-27`）：`check:extension` 打印的 Contracts 行上写什么，
包里就得是什么，值不对**根本不加载**。我第一版文档写的 6 是照抄旧版模板，错了。
**记忆只能归 bot 包，理由是硬的**：`WorldHost` 只给 World 只读 `blob()`（`src/core/types.ts:732`），
World 写不了 Memory——所以"World 也留一份记忆"在契约层就做不到，不是设计偏好。

**边界**：不认识 B 站，不 import 任何 world；记忆**只走框架 Memory**（可查、可检索、可作废）。今天 `personaAdapter.ts` 里那 60 条 memories 迁进这里。

### 2.2 `cortico-world-bilibili`（world 包，照 `templates/extension/world` 的形状）

```
package.json  {"name":"cortico-world-bilibili","main":"./src/index.ts",
               "cortico":{"kind":"world","api":6,"describe":"describe.json"}}
src/index.ts            导出 BILIBILI_ACCOUNT_DEFINITION（**World id 不能叫 bilibili**：上游内建直播 World
                        已占 `src/worlds/index.ts:15`，启动器预占内建 id（`src/launcher.ts:173-175`），
                        撞名的扩展**不加载**（`src/extensions.ts:357-362`）。包名 cortico-world-bilibili 仍可用）
src/definition.ts       WorldDefinition：id/label/defaults/preflight/configOptions/create/describe
src/world.ts            World 实例：mount/unmount、事件投递、工具绑定
src/config.ts           配置段 + 默认值 + JSON Schema（档位、额度、路径、身份）
src/client/             ← 原 dsh 的 43 条 CLI，改成 typed API（见 2.4）
  api.ts  inbox.ts  feed.ts  watch.ts  publish.ts  interact.ts  gates.ts  ledger.ts
src/domain/             ← 原 tools/lib：traffic/quota/kill/go-gate/ack/publish-policy/plain-outbound
src/persona/            ← 原 life-stages/prompts/capability/diary（她这一轮看到什么）
src/webui/              页签（浏览器端），只通过公开 HTTP API 消费
src/ENV_PROMPT.md       环境提示词
describe.json           pnpm describe:extension 生成的自描述
tests/                  fake-host + 契约测试（原 dsh 80 文件/444 项搬进来）
```

**契约版本按类不同，不是一次改齐**：`src/extensions/manifest.ts:23-27` 的
`EXTENSION_API_VERSIONS = { world: 6, provider: 6, bot: 7 }`，模板同值
（`templates/extension/world/package.json` = 6、`templates/extension/bot/package.json` = 7）。
所以本包写 **6**、§2.1 的 bot 包写 **7**；api 高于或低于该类契约都会被 `check:extension` 拒装载
（`manifest.ts:143-146`）。本文初稿把两处都写成 6、修订时又都写成 7，都是错的。

**边界**：平台细节（BV 号、`msgfeed` 字段坑、polymer 端点、412 风控、wbi 签名）不出这个包；对宿主只暴露 `WorldDefinition` 契约 + WebUI 声明。

### 2.3 `@xiaoyu/persona-core`（已经是包，只差搬出 Cortico 检出）

16 个 .ts / 2,054 行的纯函数：emotion、npc-state-machine、rhythm、voice-brief、naming、life-activities。**零 IO、零宿主引用**——这是唯一今天已经合格的层。

### 2.4 argv 边界换成 typed API（第 4 处耦合的解法）

```ts
// src/client/inbox.ts —— 四路入站一次讲清，宿主不认识其中任何一路
export interface InboxItem { kind: 'dm' | 'reply' | 'mention' | 'like'; key: string;
                             who: string; text: string; atMs: number; ref?: { bvid?: string; rpid?: string } }
export interface InboxClient {
  peek(kind: InboxItem['kind'], opts?: { since?: number }): Promise<InboxItem[]>   // 只读，幂等
  ack(items: InboxItem[]): Promise<void>                                           // 游标推进
  resolveLatestReply(item: InboxItem): Promise<string>                             // msgfeed 的坑：正文以楼层为准
}

// src/client/gates.ts —— 唯一不可绕过的写闸，签名里就带"不可逆"
export interface WriteGate {
  check(action: WriteAction): GateVerdict                    // pass | cooldown | quota | killed | needs-approval
  enqueue(action: WriteAction): PendingId                    // 需要人工放行的入队
  release(id: PendingId, token: string): ReleaseResult       // 一次性令牌 + 正文哈希绑定
}

// src/client/publish.ts
export interface PublishClient {
  dynamic(draft: OutboundDraft, go: boolean): Promise<SendResult>
  comment(target: CommentTarget, body: string, go: boolean): Promise<SendResult>
  danmaku(room: string, msg: string, go: boolean): Promise<SendResult>
  dm(to: string, text: string, go: boolean): Promise<SendResult>
}
```

`OutboundDraft.text` 在类型层就是"已清洗的纯文本"（`plainOutbound` 收在构造处，不再是每个出口各调一遍）。43 条 CLI 不删——它们变成 `src/cli.ts` 的薄壳（人手排障还要用），但**生产路径一条也不走 argv**。

## 3. 数据流（重写后长这样，四路入站都在）

```
[入站] 私信 / 回复我的 / @我的 / 收到的赞
   InboxClient.peek() 轮询（或事件驱动）
        → host.pushEvent({type:'bilibili-account.inbox', source:'bilibili-account', senderKey:'bilibili-account.inbox'})
        → 她的事件帧（"有人找你"），不是工具调用
[决策] persona-core.rhythm.decideAction(场值, 关系, 最近动作, rng)
        → 五阶段（对账 → 睡着恢复 → 决策 → 动作成本 → 记账），全是纯函数
[动作] 工具（22+ 个，含 comment/danmaku/inbox_read/judgment_read）
        → 写动作一律先过 WriteGate.check
[闸]   traffic(冷却/额度) → quota → kill → go-gate/ack(令牌+哈希) → 档位(auto|review|queue|self|direct)
[出站] PublishClient.* → plainOutbound → 发布 → causal(kind, actor, atMs) → report(通知)
[记忆] 一切写 Memory（分层 + 可检索 + 可作废）；fields.json 只剩场值与 lastAppliedAt
[读数] WebUI 页签 ← 公开 HTTP API ← World 声明（不再有第二处算数：三队列合计只有一个实现）
```

## 4. 状态与数据布局（收掉三个盘四处家）

- 全部进部署树：`xiaoyu/state/`（fields、causal、diaries、life、control）+ `xiaoyu/media/`（配图、稿子）。
- 路径可配（`config.ts` 里 JSON Schema 声明 `stateDir`、`mediaDir`、`draftsDir`），默认在部署树内——你早就说过"状态目录要可配置"，今天 `D:\AI\养鱼` 与 `C:\.dsh` 两个盘并存就是这个没做。
  - **这一组的唯一 owner 是 world 包的 `config.ts`**（2026-11-03 主人裁决："这些很明显是配置参数，就不能把配置放那儿吗？界面上不能改吗？默认就是这样子"）。`ARCHITECTURE-DECOUPLING-2026-11-01.md` §9.3 步骤 1 把同一组键放在 dsh 的 `bili-whale.config.json.storage` 里，那是**重复声明**：重写后由 `config.ts` 声明默认值与 Schema、页面按声明渲染可改项，`DEC §9.3` 那处指向本文，不再各定一份默认值。
- `state-roots` 那张 24 类表继续当门禁用（表覆盖 / 单写者 / 新旧家分叉），迁移用 `migrate-state-roots.mjs` 那条模式：默认 `--dry`、`--apply` 留 ledger、`--rollback <id>` 且哈希变过就拒绝回滚。
- 旧家 `C:\.bili-ai` 按 `LEGACY_UNTIL` 退役；D 盘那份素材迁完就在 `media/`。

## 5. 迁移：五个阶段，每阶段独立可回滚

| 阶段 | 交付 | 门禁 | 回滚 |
|---|---|---|---|
| **P1 能力面补齐** | 收件箱四路（`msgfeed` 接上）+ `bili_comment`/`bili_danmaku` 工具（默认 `review`=人工放行）+ `judgment_read` 视图 | dsh 全绿 + `wake-audit --usage` 里"从没调用过"名单变短 + 意见箱 f-d99d64/f-11a351 有落点 | 工具声明删掉即回滚，无数据迁移 |
| **P2 抽 world 包** | `src/worlds/bili-account` + dsh 的 43 条命令 → `cortico-world-bilibili`（`git mv` 保历史）；argv → typed API；CLI 降级成薄壳 | `pnpm check:extension <目录>` + 包内 vitest/444 项全绿 + `live-code-anchor --set/--check` + 落线实跑（照 `docs/evidence/landing-drill-2026-11-02.md` 的做法，用副本 `~/.dsh-up` + 备用端口，不碰 live） | 包不装回；in-tree 那份 `git revert` 即回 |
| **P3 记忆统一** | `fields.memories`(60) + `chain`(68) + `workspace/judgments.md` → 框架 Memory 三层；fields.json 只留场值 | 迁移脚本 `--dry` 默认 + ledger + `--rollback`；召回行为用现成的 `tests/contract/*` 与反事实脚本（`counterfactual.mjs`）比对前后 | 迁移脚本回滚；旧文件原样保留到确认 |
| **P4 人设独立成 bot 包** | `bots/cormini` 里我们依赖的部分 → `cortico-bot-xiaoyu`；`deployment.json` 改 `{"bot":"xiaoyu"}` | bot 包 typecheck/test + 干装载 + 一次真启动核对 CONSTITUTION/ORIENTATION 前缀漂移门 | deployment.json 改回 `cormini` 即回滚 |
| **P5 数据树收口** | 三个盘四处家 → 部署树内 `state/`+`media/`，路径全可配 | `check-state-roots` + `ops-backup` 重打一份 + 恢复演练（照 `docs/evidence/restore-drill-2026-11-01.md` 的四项比对） | ledger 回滚；原目录只读保留 |

顺序理由：**先把手补全（P1）再搬包（P2）**——搬的必须是完整的 B 站域，不是缺手的版本；记忆（P3）在包结构定型后动，否则要迁两次。P1 与 P2 都不是"便宜补丁 vs 大重构"的取舍，是同一条线上的前后两步。

> **这张表的三处待收（2026-11-03 挑刺席 `docs/team-2026-11-03/05-red-team.md`，尚未解决，开工前必须先收）**：
> ① **顺序本身没有独立复核**——六席里负责"落地序"的第六席在额度封顶中被打断、从未产出（`docs/team-2026-11-03/` 只有 01–05），P1→P5 的排法是主持人推断。
> ② **P2 门禁写的"包内 vitest/444 项全绿"与实际不符**——那 80 文件 / 444 项跑在 **node:test**（`scripts/run-mjs-tests.mjs`，见 `docs/evidence/gates-2026-11-03.json`），搬进 vitest 是**改写断言面**而不是搬家，代价要按改写计。
> ③ **P1 门禁的两条不是命令判定**——"`wake-audit --usage` 名单变短"只覆盖 235 行会话，"意见箱 `f-d99d64`/`f-11a351` 有落点"这两个 ID 在 `C:\Users\Administrator\.dsh` 下 grep 无命中、存储位置未核实。**每条门禁须写成"一条命令 + 期望退出码或输出"**，否则阶段完成与否不可判。
> 另：P1 只补工具面，**不重设默认档位**——评论/弹幕档位已成配置项（`tools/lib/publish-policy.mjs:26-27`、`src/worlds/bili-account/config-store.ts:130-131`，2026-11-03 落地），默认仍按主人定的"界面上能改、默认值由代码定"。

## 6. 明确不做的

- 不重写宿主。Core/WebUI/providers 那 5.6 万行是上游的，我们的价值不在那儿。
- 不引第二套 runtime、不做微服务、不上消息队列。单机单进程 + append-only 账已经够用（今天实测：三进程并发追加 600 行无撕裂，所以 `causal` 降级成不上锁）。
- 不做"更细的拆"。41 个 CLI 是抽错的粒度，正确的聚合单位是**一个域一个包**（B 站 = 一个包），不是每条命令一个模块。**这条是主人裁决，不是本席偏好**（2026-11-03 原话："我认为万物皆扩展"；"所谓的看视频、收件箱、点赞、收藏、发视频、B 站……他不就可以抽成一个完整的东西吗？还他妈的非要单独再抽吗？你抽那么细粒度干什么？"）。据此，`ARCHITECTURE-DECOUPLING-2026-11-01.md` §9.2 标题与 §9.4 里"互动感知独立成一个单元"的"独立"须读作**包内模块 + 依赖方向单向**，不是独立 npm 包；§9.2 的结论句（先在 World 内做）保留。
- 不动把关链的语义，只把它从 dsh 搬进包的 `domain/`。

## 7. 代价（不粉饰）

- P2 要停一次 live（换包 + 重启），且 `dist/web` 必须重建——切 live 时已经踩过一次白屏。
- argv → typed API 会重写 43 个命令的入口，dsh 那 444 项测试的断言面大半要跟着改（测试是资产，但要搬家）。
- `bots/cormini` 是上游参考 bot，我们依赖它的 memory/workspace 实现；抽出来时要决定"抄一份进我们的包"还是"继续依赖上游包"——抄就要跟上游漂移对账，依赖就要接受上游改接口。这条现在**没有结论**，P4 开工前必须先定。
- 与上游对账（落后 543 / 领先 116）在 P2 之后会**变容易**（我们的东西不在上游树里了），但在 P2 之前会更难。所以 P2 越早越好。
