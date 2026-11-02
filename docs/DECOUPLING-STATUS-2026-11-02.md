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
