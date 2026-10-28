# PLAN-REVIEW 2026-10-28 —— 四组研讨结论与方案修订

> 参会：架构与边界组、产品与验收组、运行时与机制组、平台与复用组（各自独立读码/读文档，只读）。
> 原始报告：`~/.qoder/tmp/PLAN-REVIEW/01-architect.md`、`02-product.md`、`03-runtime.md`、`04-platform.md`
> 本文件是**对 `ARCHITECTURE.md` v1 的修订案**：§1 共识、§2 分歧与裁决、§3 逐条改动、§4 新分期、§5 待拍板。
> 规则：裁决以"有代码/数据证据"的一方为准；无法裁决的进 §5，不写成已定。

## 1. 四组共识（没有分歧的部分）

1. **M0 方向正确**：确定性模板 + consumer 断言 + `voice` 必填，是当前唯一可证伪的输出链路。
2. **保留自研 `rhythm.ts`**，只借上游 7 类生活活动的文案与轮换；上游 `drives.ts` 更机械。
3. **记忆衰减必须与 `lastAppliedAt` 解耦**（`personaAdapter.ts:162-164` 的 `days>=1` + `floor` 是根因）。
4. **持久任务是 M2 的硬前提**（进程重启丢排程 = 崩一次丢一天）。
5. **文档必须标"现状 / 目标"**，不能把计划画成目录（§2.2 被三组同时点名）。

## 2. 分歧与裁决

| # | 争点 | 甲方 | 乙方 | 裁决 |
|---|---|---|---|---|
| 1 | `state/store` 放哪 | 原方案：放 `persona-core/state/` | 架构组：L3 必须零 `fs/path/env`，store 应出 L3 | **采纳乙方**：`persona-core` 改为纯函数包；持久化放 `Cortico/src/state/store.ts`（宿主侧），只依赖 L3 的类型与纯函数。门禁从"查命名"改为"查能力"（禁 `node:fs|node:path|process.env`） |
| 2 | `voice` 谁组装 | 原方案：World 组装 mood/memories/avoid | 架构组+产品组：语义在 L3，`avoid/last` 属工作流 | **采纳乙方**：L3 出 `buildVoiceBrief()`；World 只透传；`echo`（avoid/last）由 `draft-dynamic.mjs` 从 `drafts/` 生成；两端共用 `voice.schema.json` + 手写 `assertVoice` |
| 3 | `avoid` 命中怎么办 | 原方案：硬拒出稿 | 架构组：硬拒会与"日记只有一条 bullet"死锁 | **采纳乙方**：先软过滤（换下一条 bullet）；全部命中才 `{ok:false,error:'rejected-topic'}` |
| 4 | `topic` 取什么 | 原方案：日记标题 | 产品组实测：真实日记表格首列是 **BV**，`buildText:53` 要求首列是日期 → title 恒空 | **采纳乙方**：`topic` 改用 **bvid**；查重改归一化比较（10-26/10-27 同文仅差 13 字必须判重） |
| 5 | consumer 断言强度 | 原方案 5 条 | 产品组：A1/A2 是缺席式，改标点即过 | **采纳乙方**：换成 A1 标签全覆盖、A2 槽位级 diff（改动 ≥4 字，仅标点 FAIL）、A3 真实 `fields.json` 快照非恒等、A4 每个 span 溯源、A5 草稿存在 ⟺ `stance≠no` |
| 6 | `connection` 语义（Q-06） | 上游：孤独时给 **+** 增量 | 运行时组：上游写路径矛盾，标签是"需求"但消费点 6/7 按存量读 | **采纳乙方**：`connection` 保持**存量语义**不动；新增 `npcState.bond` 承载冷战/修补/重逢；删 `trust=connection` 别名；**无接触证据时不判 `cold_war`**，显示"未判定" |
| 7 | 预算顺序与粒度 | 原方案：先预算后事件 | 运行时组：预算看不到本次事件 delta；上游按 `(sourceId, field)` 二元组 | **采纳乙方**：`collect → budget → apply`；预算键 `(source, field)` + 部分生效；补 `action/silence/custom` 三源（`custom` 无上限是当前最大漏洞） |
| 8 | `COUPLING_CAP_MS=12h` | 原方案：保留，防离线穿底 | 运行时组：在线 168h vs 离线 12h = 14×，把 D-07 固化了 | **采纳乙方**：删 `COUPLING_CAP_MS`，只保留 **24h settle 上限**；穿底由 `decayAtomicFields` 的基线截断负责 |
| 9 | "体力恒满"的原因 | 原方案：恢复应用太频繁 | 运行时组：恢复 0.096/天 vs 消耗 0.15/天，满活动要 15 天才累；真问题是**恢复不分醒睡** | **采纳乙方**：引入 `state=awake/asleep`；恢复只在 asleep 生效；不改速率 |
| 10 | 强制轮记账 | 未讨论 | 运行时组：`FORCE_ACTION` 同时写 `lastKind/actionsToday/lastActionAt`，污染统计并吃当日额度 | **采纳乙方**：forced 只写 `manual` 标记，不写 `lastKind`/不占 `actionsToday` |
| 11 | Q-03 MemoryWeaver 插件化 | 主人：能做插件就做插件 | 平台组：插件边界治"协议"不治"算法"；跨进程会多一套 Python 状态 | **部分采纳**：M4 仍先落**进程内** ai-trpg 式确定性召回（它是 tick 路径，必须可单测）；MemoryWeaver 仅在将来需要"图谱/演化"时以**查询服务**形态接入，**不进 tick 路径**。此项仍待主人确认 |
| 12 | Q-04 视频接入形态 | REUSE-MATRIX：可用 `bili-op` 整链 | 平台组：`bili-op` 源码未解包，计费/输出目录未知；只 vendor `dsh-video-studio` 核心 | **采纳乙方**：`vendor dsh-video-studio` 核心 + 自写 `video-build` 子命令；**不采 `bili-op` 整链**；直播独立立项 |
| 13 | Q-08 DSH 侧车 | 可选 | 平台组：收益（UI/生命周期/更新）一个不用，代价（第二套状态/权限/账单/调度）全是最缺的 | **采纳乙方**：不引入 DSH 侧车 |
| 14 | 适配器判定树 | 原树：只读/低频 AND 协议稳定 | 平台组：判"适配器"而非"调用点"，会给出错答案（`dm read --mark-read` 是 POST 却像只读；`video_build` 不触网却因写文件被判原生；M3 60s 轮询被判低频） | **采纳乙方**：改四问、按**调用点**判：①触网？②改远端状态？③进我们账本？④<10 次/天？且**插件不得进 `sensors/` 或 tick** |
| 15 | 不变量 1 可执行性 | 原："写必须过闸" | 平台组：预算/幂等/熔断都在 `guardedFetch` 内部（`traffic.mjs:102-123,158-173`），子进程不进账，也没有预留/提交接口 | **采纳乙方**：写操作一律**原生**；插件只做只读。补第四条不变量：`credentials.json`/`traffic-state.json`/`dev_id`/`dm-quota.json` 单一写者，插件不得写 |
| 16 | bili-cli 凭据同步 | 原："同步 sessdata/bili_jct/dedeuserid" | 平台组：我们**没有 dedeuserid**（`cred.mjs:33-37` 只返三个字段），而 `dm.py:172` 靠它判 `from` → 她的私信会被当成主人来信，`connection` 假上涨 | **采纳乙方**：先补 `dedeuserid`（nav 接口取并缓存）；调用前后对 `credential.json` 做 sha256 比对，变化即 `CRED_ROTATED`；对 `from` 分布加断言（me/them 必须都出现） |
| 17 | 视频库引入方式 | 原："库级引入 `render()`" | 平台组：包 `exports` 只有 `"."` 与 `"./package.json"`，子路径 import 抛 `ERR_PACKAGE_PATH_NOT_EXPORTED` | **采纳乙方**：**vendor 6 个核心文件 + LICENSE** 到 `tools/vendor/dsh-video-studio@0.4.3/`，相对路径 import；配 `VENDOR.md` + `SHA256SUMS`；禁止 `npm i` 后 import 内部路径 |
| 18 | 读取失败语义 | 未定义 | 平台组：失败若下沉成"空数组"，会被读成"没人写信" → 关系机误判 | **采纳乙方**：插件读失败一律 `{ok:false}`，L3 不得应用 delta、不得重置 `lastContactAt`；空数组只有在 canary（`bili me`）通过时才可解释为 `OK_EMPTY` |

## 3. 对 `ARCHITECTURE.md` 的逐条改动（按文档位置）

| 位置 | 原文问题 | 改成 |
|---|---|---|
| §2.1 铁律 1 | 只禁 `bili|WHALE_HOME|D:/AI` | 扩展为 `bili|WHALE_HOME|D:/AI|node:fs|node:path|process.env`（L3 纯函数） |
| §2.1 铁律 2 | 只查 import 方向 | 增加"测试不得反向 import L4"（`adapter.test.mjs:6` 必须消除） |
| §2.2 目录 | 把目标态画成现状（`store.ts/fields.ts/presets.ts/describe.ts` 都不存在） | 改为两段：**现状 7 个文件**（types/decay/effect-bus/causal-chain/memory/npc-state-machine/rhythm）+ **M1 新增**；`packages/persona-core/` 为包路径，`src/state/store.ts` 明确属宿主 |
| §2.5 状态所有权 | 「wx 锁已有实现」为假（只有 `ack.mjs:97`）；`life.json` 4 个写者 | 按实测 6 行重写；锁标 `OPEN(D-18)`；`life.json` 收敛为 `lifeTick` 唯一写者（`:406` 改 pending 标记） |
| §11.1 voice 结构 | World 组装；缺 `why/score` 能力（`describeState` 只返回 string） | 换成 `buildVoiceBrief()` 签名；World 透传；`echo` 独立；`voice.schema.json` 共用 |
| §11.1 拒稿规则 | 硬拒 + clip 截断导致假通过 | 软过滤优先；`max` 先定句数再算长度，追加句不被 clip |
| §11.1 断言 | 5 条里有 2 条缺席式 | 换 A1–A5（见 §2 裁决 5） |
| §11.3 测试进闸 | 未提 `rhythm.test.mjs` 不在任何门禁 | 显式纳入；断言"磁盘 `.mjs` 数 = 执行数"（当前 26 个文件） |
| §11.5 写竞争 | Promise 队列与同步 `saveState` 不兼容；真实竞争在跨进程 | 改 `mutate(file, fn)` 同步临界区 + `revision` 比较 + 跨进程 lockfile；合并 `:327/:331` 两个 5s 定时器 |
| §12.2 管线顺序 | 预算在事件之前 | `collect → budget → apply`；`(source, field)`；补三源 |
| §12.2 硬耦合 | 保留 `COUPLING_CAP_MS` | 删除；只留 24h settle 上限 |
| §4.6 Q-06 | 写"拆分 trust/connection" | 改为"connection 不动 + 新增 bond + 无证据不判冷战" |
| §4.6 Q-07 | "只作缓慢背景漂移" | 具体化：可进 `night_mood/-0.036`、`morning_curiosity/+0.018`、`loneliness_mood/-0.072（封顶 -0.05/天）`；**必挡**三项 energy（净 +0.102/天会钉死体力）与 `loneliness_connection` |
| §6 分期 | M0 未含情绪最小修复 | M0 增加"情绪最小修复"：补 `action` 成因分支 + 全部标签有措辞（lexicon 枚举，查不到即 `unmapped-mood` 报错）。否则今天接上 voice 也恒"平静" |
| M0 DoD | 无"一天"证据 | 增加 `day-report.mjs --date D`：`days/<D>/{state.start,state.end,day,decisions,diff}.json` + 草稿 + 当日 audit，五项无 FAIL 才算过 |

## 4. 修订后的分期

**M0 止血（扩容）**
1. 时间游标拆分：`lastSettledAt` + `settle()`；`applyEffects` 不再积分时间；记忆用 `lastDecayedAt` + 小数天。
2. 情绪最小修复：`action` 成因分支 + lexicon 全覆盖 + `unmapped-mood` 硬错。
3. 输出链路：`buildVoiceBrief`(L3) + `echo` + 共享 schema + A1–A5。
4. 测试进闸：`.mjs` 全跑 + `check-consumers` + `tsc` 含 `persona-core`。
5. `Cortico` git init。

**M1 关系与场值（原 M1 缩小）**
1. `bond` 拆分；删 `trust` 别名；无接触证据不判冷战。
2. 预算 `(source,field)` + 三源上限；删 `COUPLING_CAP`；醒/睡状态变量。
3. 情绪投影与生活活动（依赖 1 的 kind 定型）。

**M2 运行时**
持久任务队列（含 `dead` 状态 + `deliveredTaskId`）+ 离线 24h settle + forced 记账修正。

**M3 传感器**（不变）：私信插件 + 入站正向输入 + `bond` 驱动关系恢复 + xiaoyu persona。

**M4 记忆改行为**（不变）：确定性召回（进程内）+ 决策钩子 + day-report 连续天数。

**P2 视频**：在 M4 之后；vendor `dsh-video-studio` 核心，自写 `video-build`；不采 `bili-op` 整链；直播独立立项。

## 5. 待主人拍板（更新）

| ID | 事项 | 团队建议 | 状态 |
|---|---|---|---|
| Q-01 | EmergentDimension | 暂缓（上游无实现） | NEED-USER |
| Q-02 | Coopanion / L5 | 先不定；许可干净的是 Cyrene | NEED-USER |
| Q-03 | MemoryWeaver 形态 | 进程内确定性召回优先；MW 只作将来"图谱查询服务"，不进 tick | NEED-USER（与"能做插件就做插件"部分冲突，需你拍） |
| Q-04 | 视频时机与形态 | M4 后；只 vendor video-studio 核心；直播独立 | NEED-USER |
| Q-06 | connection 语义 | 保持存量 + 新增 bond（团队裁决，待你确认） | NEED-USER |
| Q-07 | 昼夜节律 | 只进 mood/curiosity 三项，挡 energy 与 loneliness_connection | NEED-USER |
| Q-08 | DSH 侧车 | 不引入 | NEED-USER |

## 6. 未核实项（不得当结论）
1. `bili-op/` 未解包 → 其 `bili` 调用、计费、输出目录均为推断。
2. `dsh-autocut` 的 `lib/` 是否真能脱离 `@deepseek-ai/dsh-tools` 未验证。
3. bili-cli 的 `output.py/errors.py` 不在本地副本 → 错误码与退出码约定属 PARTIAL。
4. Python 管道 GBK 编码为推断，需实测一次中文私信输出。
5. `render()` 在 10 分钟素材上的内存/临时盘占用未实测。
