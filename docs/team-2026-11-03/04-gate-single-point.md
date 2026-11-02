# 不可逆动作的把关链：现状、单点化设计与论证（把关链席 · 2026-11-03）

裁决前提：主人已定「只有不可逆动作的把关链可能不可拆，但必须给论证」。本文只读研究，不改代码、不发任何 B 站请求（未运行 `--go`，未联网写）。所有断言带 file:line；读不到的东西在 §5.2 明说。

---

## 1. 现状图：一条写从决策到落平台经过哪些检查

### 1.1 六条写通道的实际闸门序列

括号内是「唯一实现位置」；★ = 该检查在这一条通道上**不存在**。

| # | 闸门 | 动态 | 评论 | 弹幕 | 私信 | 点赞 | 收藏 |
|---|---|---|---|---|---|---|---|
| 1 | 纪律闸（debrief/日记新鲜度）`gates.ts:4,13,24` | `definition.ts:727,732` | ★ | ★ | ★ | ★ | ★ |
| 2 | 档位→是否进待审队列 | `definition.ts:764`（auto 分支） | `comment.mjs:107` | `danmaku.mjs:103` | `definition.ts:872`（dmReply 档位） | `like.mjs:45` | `fav.mjs:54` |
| 3 | 内容判据（分享 @主人 / once-per-person / 五判据 / 评分卡 / 回信时效） | ★ | `comment.mjs:164-183`（@主人）、`:188-230`（once-per-person）、`:233-246`（评分卡） | ★ | `dm-send-core.mjs:117,129,137`（登录/互关/锁定）；时效 `dm-reply.ts:26` | ★ | `fav.mjs:115-127` |
| 4 | quota 自主/分享额度 `quota.mjs:118` | `publishers/bilibili-dynamic.mjs:124`（图文）、`:208`（纯文字） | `comment.mjs:325` | `danmaku.mjs:106` | `dm-send-core.mjs:149`（仅 share） | ★ | ★ |
| 5 | 一次性令牌 ack 绑 draftId+textHash | `dynamic-approve.mjs:51-57` | ★ | ★ | `dm-approve.mjs:50-57` | ★ | ★ |
| 6 | kill 急刹 | `traffic.mjs:100` | 同 | 同 | 同 | 同 | 同 |
| 7 | traffic 冷却/预算/防重发 `traffic.mjs:92` | 同（全部写走 `guardedFetch`） | 同 | 同 | 同 | 同 | 同 |
| 8 | 失败账 `<kind>-failed` `write-refusal.mjs:37` | ★ | `comment.mjs:423` | `write-refusal.mjs:55` | `dm-send-core.mjs:100`（dm-blocked） | `like.mjs:115` | `fav.mjs:194` |
| 9 | 成功账 causal | `definition.ts:791`（auto-publish） | ★ | ★ | `dm-send-core.mjs:183` / `definition.ts:876` | `definition.ts:914` | `definition.ts:926` |
| 10 | 报备 notify `report.mjs` | ★ | `comment.mjs:396` | ★ | ★ | ★ | ★ |

★ 汇总（这些是**现在就存在的缺口**，不是设计建议）：

- **点赞、收藏不过 quota 自主额度闸**：`tools/commands/` 里只有 `danmaku.mjs:15`、`dm.mjs:20`、`dynamic.mjs:13`、`edit-dynamic.mjs:10` import `quota-gate.mjs`，`like.mjs`/`fav.mjs` 没有。`docs/ARCHITECTURE-2026-11.md:105` 写的「like/fav 是自发档但仍过 kill/额度」里的"额度"指 `fav.mjs:120` 自己的每天 3 条和点赞 30 天去重，不是 quota 自主额度。
- **弹幕过额度闸但不记账**：`danmaku.mjs` 里 `record(` 0 命中（`quota.json` 的 log 只由 `quota.mjs:175` 写），所以 `usedAuto` 永不因弹幕自增。
- **`dynamic.mjs:13` import 了 `gate` 却从不调用**：动态的额度判定实际在 `tools/drafts/publishers/bilibili-dynamic.mjs:124` 与 `:208`（`gateFn`）。
- **评论、弹幕、动态成功不写 causal**：`docs/ARCHITECTURE-2026-11.md:84` 的 kind 清单里没有 `comment`/`danmaku`/`dynamic`；`ops-day.mjs:88` 只读 `/-failed$/`。

### 1.2 唯一实现 vs 第二份（重复实现逐条）

| 机制 | 唯一实现 | 第二份 / 副本 | 后果 |
|---|---|---|---|
| kill | `tools/lib/kill.mjs:20` `isKillOn()` | **同一路径字面量 6 处**：`kill.mjs:18`、`scripts/dynamic-approve.mjs:20`、`scripts/dm-approve.mjs:17`、`tools/commands/reply-draft.mjs:29`、`Cortico-up/src/worlds/bili-account/paths.ts:27`、`.../tank.ts:24` | 加一条写通道就多一处可能漏 |
| traffic | `tools/lib/traffic.mjs:92` `guarded()` | 无第二份实现；所有写通道都 `import { guardedFetch as fetch }`（`dynamic.mjs:1`、`like.mjs:1`、`fav.mjs:1`、`danmaku.mjs:1`、`dm.mjs:1`、`rename.mjs:1`、`dm-send-core.mjs:16`、`publishers/bilibili-dynamic.mjs:15`） | **当前唯一真正做到单点的闸** |
| quota | `tools/commands/quota.mjs:118` | **两份 wrapper**：`tools/lib/quota-gate.mjs:25` 与 `tools/commands/comment.mjs:64` 自己 spawn 了一份 `quota()` | 参数拼法漂移过一次（`quota.mjs:93-100` 的注释记着 `--share` 被吞） |
| go-gate 队列 | `tools/lib/go-gate.mjs:29` `queueGo` | 「档位→入队」这个判定被抄了 4 份：`comment.mjs:107`、`danmaku.mjs:103`、`like.mjs:45`、`fav.mjs:54` | comment 的判定与别的三条不一致（只有它 exempt `--auto`/`--share`，见 `comment.mjs:107`） |
| ack 令牌 | `scripts/ack.mjs:85` `approve()` | **绑定校验抄 4 份**：`dynamic-approve.mjs:53-56`、`dm-approve.mjs:52-55`、`dynamic-approve.mjs:109-111`（面板侧）、World 侧 `tank.ts:371` `freshAckToken`（只查 draftId，不查 textHash） | 「审完改稿即拒」这条规则在 4 个地方各写一遍 |
| 档位读取 | `tools/lib/publish-policy.mjs:30` `readPolicy` | `Cortico-up/.../config-store.ts:118` `readPolicyLite`（逐行等价）；`.../tank.ts:351` `policyInWindow` 是 `publish-policy.mjs:48` `inWindow` 的第三份 | 官方记在 `docs/ARCHITECTURE-DECOUPLING-2026-11-01.md:447`：**没有跨仓等值测试**，新增键靠人记得改两处 |
| 档位默认值 | — | `publish-policy.mjs:19` `POLICY_DEFAULTS` 与 `:58` `capReached` **全仓无调用点**（真实默认在 `config-store.ts:122-131`；auto 上限判断内联在 `definition.ts:772`） | 默认值有 2 处、且其中 1 处是死的 |
| 正文清洗 | `tools/lib/plain-outbound.mjs:53` | `tools/drafts/compose.mjs:28` `stripBold`（只去粗体，另一半） | compose.mjs:349 两个都用 |
| 因果账 | `tools/lib/causal.mjs:27`（actor=cli） | `Cortico-up/.../causal-io.ts:17`（actor=host） | 这份**是有意的**双写者：只 append 单行，见下 |
| 失败收口 | `tools/lib/write-refusal.mjs:49` `attemptWrite` | 内含 `process.exit(4)`（`:56`）——库函数直接杀进程 | 调用方无法 catch；`write-refusal.mjs:46-47` 注释自陈「成功账不在这里写——World 与 go-gate 放行各自已经记了，重复记会让 K4 的分母翻倍」 |

### 1.3 放行侧（人工放行）也有两套

- 草稿：世界页放行 `scripts/dynamic-approve.mjs:100` `approveFromPanel`（服务端持 token，token 不出响应 `:96`），CLI 放行 `dynamic-approve.mjs:36` `approve`。
- go-gate 队列：`tools/lib/pending-queue.mjs:72` `releaseOne`（执行 + 摘队），CLI 出口 `tools/commands/reply-draft.mjs:111-131`；重建 argv 在 `tools/lib/go-rebuild.mjs`（白名单 fail-closed，"展示=执行"）。
- `pending-queue.mjs:85` 靠输出里的 `✗` 判失败（因为被规则拒时 exit 仍是 0）——**这是"退出码不够用"的实证**。

---

## 2. 单点化设计

### 2.1 落点

目标架构里闸门归 world 包 `src/domain/`（`docs/ARCHITECTURE-TARGET-2026-11-03.md:100` 已把 `traffic/quota/kill/go-gate/ack/publish-policy/plain-outbound` 标到 `src/domain/`）。本次设计把这条链收敛成**一个** `WriteGate` 接口 + 一份档位 schema，其余全部退成它的输入。

### 2.2 闸门顺序（与现状的差异一并标出）

```
决策（World / CLI）
  └─ WriteGate.check(action)
       ① kill 急刹                 ← 前置到链首（现状在 traffic 内部，顺序上无副作用差，但语义上应最先）
       ② 档位判定                  ← 是否需要主人放行
            需要 → WriteGate.enqueue(action) → 返回 needs-approval（本次不写）
       ③ 内容判据（各判据模块）      ← 保持可拆（见 §3.3）
       ④ quota 额度（自主/分享）
       ⑤ traffic 冷却/预算/防重发 + 网络写
  └─ 成功 → causal(kind) → report
     失败 → causal(kind-failed) + 退出码
```

与现状的两处差异（都是修正，不是偏好）：

1. **档位判定前置于 quota 额度**。现状 comment 是「档位→队列」在前（`comment.mjs:107`）、quota 在后（`:325`）；danmaku 同样（`:103` → `:106`）；但 like/fav 无 quota。统一后「需要人工放行」的动作不消耗额度——现状里进入队列的那次调用（`comment.mjs:107` 直接 `process.exit(0)`）本来也没消耗，一致。
2. **kill 前置**。现状 kill 只在网络写那一刻判（`traffic.mjs:100`）+ approve 层提前判（`dynamic-approve.mjs:47`、`dm-approve.mjs:46`、`pending-queue.mjs:52`）+ World spawn 前判（`definition.ts:100`、`runner.ts:17`）。这些层保留同一判定结果，避免"入队时 kill 没开、放行时 kill 开了"这种时间差。

### 2.3 TypeScript 形状

```ts
// src/domain/gate/types.ts
export type WriteKind = 'dynamic' | 'comment' | 'danmaku' | 'dm' | 'like' | 'fav' | 'rename' | 'edit-dynamic'
export type WriteIntent = 'self' | 'owner-authorized' | 'share' | 'reply'

export interface WriteAction {
  kind: WriteKind
  intent: WriteIntent
  target: { bvid?: string; oid?: string; room?: string; mid?: string; dynId?: string }
  body: string                 // 已是 plainOutbound 后的纯文本（清洗在构造处做一次）
  bodyHash: string             // sha1(body)；与 ack 令牌绑定的 textHash 同一口径
  draftId?: string
  draftTextHash?: string
  actor: 'cli' | 'host'
}

export type GateVerdict =
  | { ok: true }
  | { ok: false; code: 'killed';    reason: string }
  | { ok: false; code: 'cooldown';  reason: string; retryAfterMs?: number }
  | { ok: false; code: 'quota';     reason: string; usedToday: number; cap: number }
  | { ok: false; code: 'policy';    reason: string; tier: string }
  | { ok: false; code: 'needs-approval'; reason: string; pendingId: string }

export interface WriteGate {
  check(action: WriteAction): Promise<GateVerdict>
  enqueue(action: WriteAction): Promise<{ ok: true; pendingId: string } | { ok: false; reason: string }>
  release(pendingId: string, opts: { token: string; actor: 'cli' | 'host' }): Promise<ReleaseResult>
}

export interface ReleaseResult {
  ok: boolean
  exit: number
  verdict: GateVerdict | null
  out: string
}
```

**失败语义（退出码）**——现状退出码含义不一致，这张表是收口后的约定：

| 码 | 含义 | 现状对应 |
|---|---|---|
| 0 | 成功（且输出里没有 `✗`） | 现在还需要 `pending-queue.mjs:85` 补一条"输出含 ✗ 即失败" |
| 2 | 闸门拒：档位/额度/判据（**可重试或可改配置**） | `quota.mjs:123,142,148,167`；`comment.mjs:336`；`danmaku.mjs:107` |
| 3 | 前置条件缺失（凭据、分享关闭、无法确认关系） | `comment.mjs:251`；`dm-send-core.mjs:117,128` |
| 4 | 传输层拒：冷却 / 风控 / 登录态失效 | `write-refusal.mjs:56`；`comment.mjs:298`；`dm-send-core.mjs:132,140` |
| 5 | 素材不合法（图片格式/尺寸） | `publishers/bilibili-dynamic.mjs` 的 exit 5 |
| 6 | 平台拒绝（code≠0，已发出但被拒） | `comment.mjs:426` |
| -2 | kill（宿主 spawn 前拦截） | `definition.ts:100`、`runner.ts:17` |

现状的 `comment` 平台失败用 6、闸门失败用 2，而 `like/fav` 的闸门失败用 4（`write-refusal.mjs:56`）——同一个"被拒"有三种码。收口后闸门拒一律 2，传输层拒一律 4，平台拒一律 6。

**账本落点（causal 的 kind 命名）**：

- 成功：`<kind>`，取自 `WriteAction.kind`。现状已有 `like`（`definition.ts:914`）、`fav`（`:926`）、`dm-out`（`dm-send-core.mjs:183`）、`dm-auto-sent`（`definition.ts:876`）、`dm-sent`（`dm-approve.mjs:33`）、`auto-publish`（`definition.ts:791`）。**补齐** `comment`、`danmaku`、`dynamic` 三条，否则"今天发了多少"在账上不可算（`ops-day.mjs:75-90` 是唯一的读侧）。
- 失败：`<kind>-failed`（`write-refusal.mjs:37` 已是这个口径，`ops-day.mjs:88` 按 `/-failed$/` 读，**不改**）。
- 闸门拒与平台拒不新造 kind，改为在 `<kind>-failed` 里加字段 `stage: 'gate' | 'platform' | 'transport'`——这样 `ops-day.mjs:88` 的现有口径继续成立，闸门拒从"失败"里可区分。
- 账本不得出现正文/凭据/token（`tools/lib/causal.mjs:8-9`）：`<kind>-failed` 只记 `bv` 与 `reason`（`write-refusal.mjs:38-39`），新增字段沿用这条红线。

**kill 怎么参与**：`check()` 第一步判 `isKillOn()`，返回 `{ok:false, code:'killed'}`。kill 不进档位、不进账（它是急刹不是动作），但**必须**在两处判：check 入口 + 网络写之前（`traffic.mjs:100` 现状位置保留，因为队列里一条东西可能入队时 kill 没开）。

**档位怎么参与**：档位不是一个布尔，是一个 `Policy` 对象，由**唯一**一份 `readPolicy()` 产出（收掉 `config-store.ts:118` 与 `tank.ts:351`），`WriteGate` 只读它。档位决定两件事：① 这个 kind 要不要进队列（`permissions.*`）；② 草稿类要不要自动发（`publish.draftMode` + `autoWindow` + `autoDailyCap`，现状内联在 `definition.ts:764-774`，收进 gate）。

---

## 3. 论证：为什么必须单点（以及哪些其实可以分散）

### 3.1 必须单点的四条（每条都有可核对的证据）

**① 事故：档位能被同机一次盲 POST 改成 `auto`。**
`docs/CURRENT.md:45` 记 2026-11-01 01:23 正式配置 `publish.draftMode` 被写成 `auto`，载荷含 `autoDailyCap=-9`，7799 是本机免口令端口；`Cortico-up/src/worlds/bili-account/definition.ts:280-300` 就是那个写接口（`panel === 'policy'` → `policySet(args[0])` 在 `:281`，`:284-286` 自陈「7799 是本机免口令端口：任何本地进程 POST 这里就能把她从"要我审"变成"她自己发"」）。现有防线只有两条，且都不是闸门：`config-store.ts:31`（测试上下文拒写生产配置）与 `definition.ts:287-299`（auto 生效要往私人日记写一节）。
**这条证据支持的是**：准入判定必须在**代码**里且只有一条路径。提示词层的"要先问主人"对进程外写入零作用（`docs/CURRENT.md:45` 明确）。它**不支持**"所有闸门合并成一个函数"——它支持的是"同一语义不得有第二份实现"，因为第二份就是第二个可被盲写的入口。

**② kill 的语义要求全域判定，而全域判定漏一处就等于不存在。**
`tools/lib/traffic.mjs:96-99` 的注释把这一点写死：「这一句必须在域名分叉**之前**：放在后面，非 B 站域会在上一行直接 transport 出去，急刹车对它们等于不存在」。当前同一个 kill 路径有 6 份字面量（§1.2），判定点有 5 处（`traffic.mjs:100`、`dynamic-approve.mjs:47`、`dm-approve.mjs:46`、`pending-queue.mjs:52`、`definition.ts:100` + `runner.ts:17`）。
**为什么这是物理约束而不是品味**：漏点的后果是"她以为停了，其实还在对外发"——不可逆。其它闸门漏点的后果是"多发一条/少发一条"，可回读可撤销。

**③ 防重发与预算必须以同一本账为准，否则预算翻倍。**
`traffic.mjs:104-117` 用 url+body 的指纹做操作 ID，`operations` 满了 2000 就停（`:118`），冷却与写预算记在同一份 `traffic-state.json`（`:110-127`）。而"谁记成功账"现在就有两个机制：World 的 causal（`definition.ts:914,926`）与 quota 的 `record`（`quota.mjs:175`）。`write-refusal.mjs:46-47` 已经吃过这个亏并把结论写进注释：「成功账不在这里写——World 与 go-gate 放行各自已经记了，重复记会让 K4 的分母翻倍」。
**这条证据支持的是"记账口径必须单点"**，即一个 kind 的成功/失败只有一处写。它不支持"闸门逻辑必须全在一个文件里"。

**④ 档位的第二份实现已经欠了债，且是"新增键靠人记得改两处"这种必然出错的形态。**
`docs/ARCHITECTURE-DECOUPLING-2026-11-01.md:447-468` 明确记录：`publish-policy.mjs` 与 `config-store.ts` 的 `readPolicyLite` 是同一语义两份实现，逐行等价但**没有跨仓等值测试**，验收条件写着「新增键只改 `publish-policy.mjs` 一处，页面自动出现」。当前 8 个键就是要改两处（§4）。

### 3.2 单点的物理边界（这才是真正的"不可拆"）

必须**同一处**的只有三件事：

1. **准入判定**（一个写动作是否被允许）——判据可以来自很多模块，但"问一次"只能在一个地方问，且必须覆盖全部写出口。
2. **不可逆动作的身份**（kind + target + bodyHash）——`traffic.mjs:104-105` 的操作 ID 与 `ack` 的 `draftId`+`textHash` 绑定（`dynamic-approve.mjs:53-56`）必须用同一个 bodyHash 口径，否则"审过的正文"和"发出的正文"可以不是同一串。
3. **成败各记一次**——一条写动作在账上恰好一条成功账或一条失败账。

### 3.3 明确**可以**分散的（不要把设计偏好写成物理约束）

- **内容类判据**：once-per-person 30 天（`comment.mjs:188-230`）、收藏五判据（`fav.mjs:115-127`）、分享必须 @主人（`comment.mjs:164-183`）、评分卡 `minScore`（`comment.mjs:233-246` → `ai-share.mjs`）、回信时效窗（`dm-reply.ts:26`）。这些各自独立演进、互不耦合、拒了不产生不可逆后果。**应该拆成 `domain/` 下各自的判据模块**，由 WriteGate 依次调用。
- **频率/节奏类**：`quota.selfDaily`（`config.mjs:49`）、`shareDaily`、沉默衰减（`quota.mjs:63-81`）、`traffic` 的 `writeGapSec`/`minGapMs`（`traffic.mjs:8`）。多实例各算各的不会造成不可逆后果（只会更保守）。**可以分散**。
- **纪律闸** `gates.ts:4,13,24`：它管的是"这一轮能不能出稿"，不是"能不能对外发"，属于内容侧。归 `domain/` 但类别是 `discipline`，不并进 WriteGate。
- **正文清洗** `plain-outbound.mjs:53`：幂等纯函数，放构造处即可（`ARCHITECTURE-TARGET-2026-11-03.md:142` 已这么写）。
- **记忆、召回、日记、文案、节奏函数、五阶段、场值**：主人的裁决已是"全部可拆"。

**一句话**：不可拆的是"一个写动作在对外前必须被问一次、并且只被记账一次"，不是"闸门的判据必须写在一个文件里"。

---

## 4. 档位声明式化（8 项）

### 4.1 现在怎么存、怎么改

- **存**：`bili-whale.config.json` 的 `publish` / `permissions` 两节；路径 `tools/lib/paths.mjs:43` `configPath`（`BILI_WHALE_CONFIG` 可覆盖）。
- **读**：两份实现（`publish-policy.mjs:30` `readPolicy` / `config-store.ts:118` `readPolicyLite`），外加 `tank.ts:351` `policyInWindow` 抄了 `publish-policy.mjs:48` `inWindow` 的第三份。
- **默认**：`publish-policy.mjs:19` `POLICY_DEFAULTS` 全仓无调用点——真实默认在 `config-store.ts:122-131` 逐字段写死；`publish-policy.mjs:58` `capReached` 同样无调用点，auto 上限判断内联在 `definition.ts:772`。**默认值现在有两处，其中一处是死的。**
- **改**：`config-store.ts:27` `policySet` → 只接受白名单键（`:35-36`）→ 用 `readPolicyLite` 归一（`:39`）→ 原子写 tmp+rename（`:46-48`）→ 测试上下文拒写生产配置（`:31`）。宿主入口 `definition.ts:280-300`，其中 auto 分支额外写私人日记（`:287-299`）。
- **WebUI 渲染**：8 个控件**硬编码**在 `Cortico-up/src/worlds/bili-account/webui/client.ts`——类型 `:456`、控件 `:468-475`（`selMode`/`inpCap`/`inpWin`/`selLike`/`selFav`/`selDm`/`selComment`/`selDanmaku`）、提交 patch `:481-482`、回显 `:636-639`。键名集合另有一份 `tank.ts:193` `POLICY_KEYS`（注释仍写"策略六项"，实际 8 项，注释过期）。
- **通用机制已经在跑**：`tank.ts:214` `settingsOverview` 遍历配置 JSON 的**所有**标量叶子，标出 `declared`（dsh `DEFAULTS` 里有没有）/ `editable` / `editVia` / `needsRestart`；`tank.ts:313` `settingsSet` 做通用写入 + 类型/范围校验（一次最多 12 项）。策略 8 项被 `POLICY_KEYS` 从通用通道里**排除**（`tank.ts:227` 注释说明理由：有档位护栏和 auto 留痕）。

### 4.2 改成 JSON Schema 声明后是什么样

```ts
// src/config.ts —— world 包的配置段（域内唯一声明）
export const POLICY_SCHEMA = {
  publish: {
    type: 'object',
    title: '发送策略',
    properties: {
      draftMode:    { type: 'string', enum: ['review', 'auto'], default: 'review',
                     title: '草稿发送', description: 'review=人工放行；auto=出稿即发' },
      autoDailyCap: { type: 'integer', minimum: 0, maximum: 20, default: 0,
                     title: 'auto 每日上限', description: '0 = 不限' },
      autoWindow:   { type: 'string', pattern: '^$|^\\d{1,2}:\\d{2}-\\d{1,2}:\\d{2}$', default: '',
                     title: 'auto 时段', description: 'HH:MM-HH:MM，跨午夜；空 = 不限' },
    },
    required: ['draftMode', 'autoDailyCap', 'autoWindow'],
  },
  permissions: {
    type: 'object',
    title: '各通道档位',
    properties: {
      like:    { type: 'string', enum: ['self', 'review'], default: 'self',    title: '点赞' },
      fav:     { type: 'string', enum: ['self', 'review'], default: 'self',    title: '收藏' },
      dmReply: { type: 'string', enum: ['direct', 'queue'], default: 'direct', title: '回主人私信' },
      comment: { type: 'string', enum: ['self', 'review'], default: 'review',  title: '评论' },
      danmaku: { type: 'string', enum: ['self', 'review'], default: 'review',  title: '弹幕' },
    },
    required: ['like', 'fav', 'dmReply', 'comment', 'danmaku'],
  },
} as const
```

WebUI 渲染后不再是 8 个写死的控件，而是一张**表**：

| 键 | 控件 | 取值 | 当前 | 说明 |
|---|---|---|---|---|
| `publish.draftMode` | 下拉 | review / auto | review | auto 生效会往她的私人日记写一节 |
| `publish.autoDailyCap` | 数字框 | 0–20 | 0 | 0 = 不限；今日已 auto N 条 |
| `publish.autoWindow` | 文本框 | `HH:MM-HH:MM` | 空 | 空 = 不限；跨午夜 |
| `permissions.like` | 下拉 | self / review | self | review = 收回成待审队列 |
| `permissions.fav` | 下拉 | self / review | self | 同上 |
| `permissions.dmReply` | 下拉 | direct / queue | direct | queue = 回信退回草稿队列 |
| `permissions.comment` | 下拉 | self / review | review | review = 进待审队列 |
| `permissions.danmaku` | 下拉 | self / review | review | review = 进待审队列 |

「保存」一次提交整片；提交后显示这次改了什么（from → to）。页面上方的"kill 压过这里的一切设置"常驻提示与 auto 留痕（`definition.ts:287-299`）保留，不因为 schema 化而丢。**这一页因此不再需要 `client.ts:456` 的手写类型、`:468-475` 的 8 个控件、`:481-482` 的 patch、`:636-639` 的回显**——改成遍历 schema。

同时 `tank.ts:193` 的 `POLICY_KEYS` 硬编码 8 个键也消失：键从 schema 派生。

### 4.3 auto 的护栏：`autoDailyCap=0` 等于不限——该不该有默认上限

**事实**：

- `publish-policy.mjs:6` 注释："publish.autoDailyCap 0 = 不限（主人要的默认）"；`config-store.ts:123` 的 `Math.max(0, Number(p.autoDailyCap ?? 0) || 0)`；`definition.ts:772` 只在 `> 0` 时判上限。
- 所以事故载荷 `autoDailyCap=-9` **在写入时被归一成 0**，即"不限"（`config-store.ts:123`）。归一方向是"放开"，不是"保守"。
- 但"不限"**不等于无上限**：auto 发的动态仍要过 traffic 的写预算（`publishers/bilibili-dynamic.mjs:124` 的 quota + `traffic.mjs:121` 的 `writeDaily`/`writeHourly`，默认 `writeDaily=30`/`writeHourly=12`，`traffic.mjs:8`）。**这条是对"auto = 完全失控"说法的重要修正**：暴露面有硬上限。
- 另外两套节奏约束与档位无关：quota 自主上限 `selfDaily=6`、分享 `shareDaily=3`（`config.mjs:49`）。

**建议（这是建议，不是结论；主人说过档位一律走配置、不用拍板）**：

1. **默认给一个有限值**（例如 `autoDailyCap` 默认 3，量级对齐 `shareDaily=3` / `selfDaily=6`）。理由：auto 是**唯一没有人类点击**的档位，`review` 有令牌、`self` 有预算兜着，只有 auto 同时缺"人的一次点击"和"一条专属节奏上限"。风险低：设回 0 即可恢复不限，schema 里保留 `0 = 不限`。
2. **schema 里写死 `minimum: 0` 并让非法值报错，而不是静默归一**。现在 `-9` 被 `config-store.ts:123` 静默改成 0（=放开），这与"归一应该往保守方向"相反。建议：负数直接拒绝并说明原因；`0` 是唯一的"不限"写法。
3. `autoWindow` 建议给一个非空默认（如 `10:00-23:00`）——但这会改变现状行为，**建议**而非结论；主人一句话就能定。

---

## 5. 风险、代价，以及我不知道的地方

### 5.1 风险与代价

- **单点 = 单点故障**。WriteGate 挂 → 所有写停。缓解：判定本身无 IO（档位读一次内存、kill 判一次 `existsSync`），traffic 侧的 IO 已有锁 + fail-closed（`traffic.mjs:37,55`）；且 World spawn 前的 kill 判定（`definition.ts:100`）保持独立，不依赖 gate 进程存活。
- **迁移期双实现并存 = 两份真相**。必须一次性切换，并补上现在缺失的**跨仓等值测试**（`docs/ARCHITECTURE-DECOUPLING-2026-11-01.md:447-468` 的验收条件），否则"新增键只改一处"仍然靠人记。
- **退出码收口会连带改测试**。现在闸门拒有 2/4 两种码、平台拒 6、kill -2，`pending-queue.mjs:85` 还靠输出里的 `✗` 补判（因为被拒时 exit 是 0）。改码会牵动 79 个测试文件里的断言面（`docs/evidence/gates-2026-11-03.json` 记 444 项）。
- **traffic 的 `operations` 上限 2000（`traffic.mjs:118`）与 24h 过期（`:115`）会更紧**。单点后所有写都经过它，这两条约束从"多数写"变成"全部写"。
- **账本 kind 补齐会改变读侧口径**。补 `comment`/`danmaku`/`dynamic` 成功账后，`ops-day.mjs:75-90` 的统计数字会变（此前那些写根本没进账），历史数据不可比——补账那天要记一笔口径变更。
- **WebUI schema 化要保住 auto 留痕**。`definition.ts:287-299`（auto 生效写私人日记、写失败要报出来）不能因为控件改成遍历 schema 而丢。
- **`causal.jsonl` 保持无锁是有实测支撑的**：`tests/contract/state-roots.test.mjs:133` 记「2026-11-02 实测：三进程并发各写 60 行 100KB，600 行无撕裂——单行 append 本身原子」，`state-roots.mjs:75` 据此标 `requiresLock: false`。收口后写者仍只有 host 与 cli 两个进程各 append 单行，**这个前提不变**——但如果将来多一个进程写 causal，必须重新验。

### 5.2 我不知道 / 证据不足（明确标注）

1. **事故的原始记录文件在工作树里不存在**。`docs/CURRENT.md:45` 指向 `days/2026-11-01/incident.md`，但 `ls days` 返回 `No such file or directory`，`find -name incident.md`（dsh 仓 4 层深 + 两个仓根）无命中。本文对事故的引用全部来自 `docs/CURRENT.md:45-46` 的摘要与 `config-store.ts:31` / `definition.ts:284-286` 的代码注释，**没有读到原始现场**。写入者仍未查明（`CURRENT.md:46` 自陈"未查明"），我也没有能力判定。
2. **`autoDailyCap=-9` 写入后的实际值我没读到正式配置文件**。"-9 → 0 → 不限"是按 `config-store.ts:123` 的代码推导，**不是实测**。同理，auto 是否真的发出过（`CURRENT.md:45` 说没有：`autoSentToday=0`、causal 无 `auto-publish`）我也只读到摘要。
3. **弹幕"过额度闸但不记账"是静态判定**。依据是 `danmaku.mjs` 里 `record(` 0 命中、`quota.json` 的 log 只由 `quota.mjs:175` 写。我没有运行它来确认 `usedAuto` 不会被别处补上。
4. **`POLICY_DEFAULTS` / `capReached` "全仓无调用点"的结论有范围限制**：我 grep 了 `tools/`、`scripts/`、`core/`、`tests/`，**没有**覆盖 `panel/` 目录与 Cortico 侧；两者都引用这两个符号才会推翻这条。
5. **两份档位实现"逐行等价"是读出来的，不是测出来的**。我逐字段比对了 `publish-policy.mjs:30-42` 与 `config-store.ts:118-132`（8 个键的默认、归一、枚举都一致），但**没有写向量测试**去证明它们永远一致——这正是 §3.1④ 说的那个债。
6. **我只做了静态阅读**：没有跑测试、没有跑任何 `--go`、没有联网写。§1.1 的「★」是按代码路径判定的缺口，不是运行观测。
7. **审计事件 2026-11-01 三次点赞崩栈**（`write-refusal.mjs:9-13`；`-400` 根因未确认，`like.mjs:110` 明写"未确认"）与 01:23 事故是**两件独立的事**，我没有把它们混算，也没有 `-400` 的证据。
