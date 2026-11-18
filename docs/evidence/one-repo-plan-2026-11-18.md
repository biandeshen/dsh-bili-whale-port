# 单仓收敛方案 + 架构现状对账（2026-11-18）

> 主人要求：**只要一个仓库，不是两个，更不是三个。**
> 本文全部数字为当日实测，带命令或 `file:line`。未验证的写「未验证」。

---

## 0. 结论先行

1. 磁盘上从来不是三个仓库，是 **2 个 git 仓库 + 3 个工作树**。`Cortico` / `Cortico-new` / `Cortico-up` 共用 `Cortico/.git`（29M）。
2. **`Cortico-new` 已清除，回收 991M**（本轮执行，见 §5）。它是一次做了一半、后来在 `reanchor/replay` 上重做并完成的旧副本。
3. 要真做到「一个仓库」，**推荐路线 2：把宿主以 `git subtree` 并进我们仓的 `host/`**。一个 `.git`、一份 `git log`、一次 clone，磁盘上只剩 `dsh-bili-whale/`。
4. 路线 1（宿主降为 git 依赖）只做到「一个 clone」，且需要额外写 launcher；**补丁包路线已排除**（实测 171 提交 / 501 文件，远超 `pnpm patch` 可维护规模）。
5. **本轮我造成了一次数据损坏并已完全复原**：`git worktree remove --force` 跟着 pnpm 的 Windows junction 走进共享源码，清空了 4 个目录 **74 个文件**。根因已查实（§5.2），复原后全量 **922 tests / 921 pass / 1 fail（既有）**。**#77 仍未获批准，不得当作已完成。**
6. **此后删任何含 `node_modules` 的目录，必须先摘 junction**（§5.2bis）。根治是把 `link:` 绝对路径改相对（S3）。

---

## 1. 现状实测

### 1.1 仓库与工作树

```
$ git -C E:/WorkSpace_Qoder/Cortico worktree list      # 清除 Cortico-new 之后
E:/WorkSpace_Qoder/Cortico     144157d [master]
E:/WorkSpace_Qoder/Cortico-up  ca48a69 [reanchor/replay]
```

| 目录 | 身份 | 净重 | 说明 |
|---|---|---|---|
| `Cortico/.git` | **唯一的宿主对象库** | 29M | 两个工作树都指向它 |
| `Cortico/` | master 工作树 | 956M | 绝大部分是 node_modules 与旧检出 |
| `Cortico-up/` | `reanchor/replay` 工作树 | 23M（不含 node_modules） | **线上宿主** |
| `Cortico-new/` | ~~detached 97fec27~~ | ~~991M~~ | **本轮已移除** |
| `dsh-bili-whale/.git` | 我们的产品仓 | 32M | 11 个包 |

`Cortico-up/.git` 的内容是一行：
`gitdir: E:/WorkSpace_Qoder/Cortico/.git/worktrees/Cortico-up`
→ **删 `Cortico` 会当场打断线上宿主仓的 git。** 这是「三个目录清成两个」那条旧计划的硬伤。

### 1.2 远端与推送状态

| 仓 | remote | 状态 |
|---|---|---|
| 宿主 | `origin = biandeshen/Cortico-local`、`upstream = Pal-AI-Lab/Cortico` | `master` 有 `[origin/master]`；**`reanchor/replay` 无远端跟踪 = 未推** |
| 我们 | `private = biandeshen/dsh-bili-whale-port`、`upstream = Alterssss/dsh-bili-whale` | 本地领先 14 个提交未推 |

### 1.3 宿主怎么加载我们（缺陷仍在）

`Cortico-up/extensions/package.json:5-7`：

```json
"cortico-bot-xiaoyu":     "link:E:/WorkSpace_Qoder/dsh-bili-whale/packages/cortico-bot-xiaoyu",
"cortico-world-bilibili": "link:E:/WorkSpace_Qoder/dsh-bili-whale/packages/cortico-world-bilibili",
"cortico-world-media":    "link:E:/WorkSpace_Qoder/dsh-bili-whale/packages/cortico-world-media"
```

**机器专属绝对路径**。换机器 / 换盘符即断。单仓收敛时顺手改成相对路径。

### 1.4 宿主改动规模（决定路线可行性）

```
$ git rev-list --count reanchor/base..reanchor/replay
171
$ git diff --stat reanchor/base..reanchor/replay | tail -1
501 files changed, 23382 insertions(+), 7923 deletions(-)
```

`reanchor/base = eda5873 chore: re-anchor our snapshot onto v0.2.7 (upstream ancestor)`

→ **171 提交 / 501 文件不是补丁集，是一个真分叉。** `pnpm patch` / `patch-package` 路线排除。

---

## 2. 三条路线对比

| | 路线 1：宿主作 git 依赖 | **路线 2：subtree 并入 `host/`** | 路线 3：只清工作树 |
|---|---|---|---|
| 你 clone 几个仓 | 1 | **1** | 2 |
| 世界上有几个 git 历史 | 2 | **1** | 2 |
| 磁盘最终剩什么 | `dsh-bili-whale/` + node_modules 里的宿主 | **`dsh-bili-whale/`（含 `host/`）** | `Cortico/` + `dsh-bili-whale/` |
| 前置工作 | 推 `reanchor/replay`；**写 launcher**（宿主是应用不是库，有自己的 `extensions/`、`deployments/`、启动脚本） | #77 内核归一（需批准） | 无 |
| 启动方式 | 要改 | **不变**（从 `host/` 起） | 不变 |
| 上游同步 | fork rebase（同今天） | `git subtree pull --prefix=host upstream main`（同今天一样痛，不会更痛） | fork rebase |
| 满足「一个仓库」 | 半个（一个 clone，两个历史） | **是** | 否 |
| 仓体积 | 32M | **≈61M**（29+32，node_modules 不进 git） | 不变 |

### 2.1 为什么路线 2 不违反当时定的铁律 #2

铁律 #2 原文管的是 **import 方向**：「5 个能力包内部绝不直接 `import 'cortico/*'`」。**它不管目录归属。**

- 病根 #1 是「**我们的产品代码寄居在上游框架检出里**」——`src/worlds/bili-account`（4008 行）住在宿主树内，还改了上游 `src/worlds/index.ts:18`。
- 路线 2 是**反过来**：宿主住进**我们的**树（`host/`），产品仍在 `packages/`。**所有权方向是对的。**

配套门禁（必须同时交付，否则等于把病根 #1 倒过来再犯一次）：

1. `host/` 默认只读；改宿主必须走显式流程并留痕。
2. `cap-*` 不许 import `cortico/*`（已有门禁，保留）。
3. **内核只许一份**（#77），subtree 之前必须先归一，否则把分叉一起搬进来。

### 2.2 推荐

**路线 2。** 判据：字面满足「一个仓库」；改动面最小（不写 launcher、不依赖先推未推分支）；不破坏 import 方向铁律；保留全部历史可追溯（本项目重视 gitSha 证据，故 **不加 `--squash`**）。

---

## 3. 施工表（路线 2）

| 步 | 动作 | 前置 | 验收 | 回滚 |
|---|---|---|---|---|
| S0 | 打 tag `pre-single-repo` | — | `git tag` 可见 | tag 即回滚点 |
| S1 | **#77 B 段：宿主 `persona-core` 归一** | **需主人批准** | 宿主只剩引用、无实体；`live-drift` 转绿；三处引用（`package.json:38`、`tsconfig.json:23`、`pnpm-workspace.yaml:14`）同步改掉 | `git checkout -- persona-core` |
| S2 | `git subtree add --prefix=host E:/WorkSpace_Qoder/Cortico reanchor/replay` | S1 | 一个 `git log` 里能看到宿主 171 提交；`host/src/core/types.ts` 存在 | `git reset --hard pre-single-repo` |
| S3 | `extensions/package.json` 三条 `link:` 绝对路径 → 相对 | S2 | 全仓 grep `link:E:/` = 0 命中 | 单文件还原 |
| S4 | 加 `host/` 只读门禁 + 内核单份门禁 | S2 | 故意改 `host/` 一行 → 门禁红 | 删门禁 |
| S5 | 新目录真 clone 一次 → `pnpm install` → 起宿主 | S3 S4 | 11 页签真浏览器全操作台；全量测试 `fail=0` 且 `EXECUTED=DISCOVERED` | 保留旧目录直到此步通过 |
| S6 | **先摘 junction**（§5.2bis），再删 `Cortico/`（956M）与 `Cortico-up/`（23M） | **S5 通过 + junction 已摘** | 磁盘只剩 `dsh-bili-whale/`；删后两仓 `git ls-files --deleted` 均为空 | S5 未过不许删 |

**S6 是本轮事故的重演点**：`Cortico-up/extensions/node_modules` 里那三条 junction 直指我们的源码包。
**不先摘就删，等于把 §5.2 再犯一次。** 摘除用 `rmdir <junction>`（不带 `/S`）或 `fsutil reparsepoint delete`。

**S1 是硬前置**：内核不归一就 subtree，等于把「两份 persona-core 常量漂移」永久固化进单仓。

**S6 之前 `Cortico/.git` 不许删**——它是唯一对象库，subtree 未验证通过前删了就没有退路。

---

## 4. 架构对账：当时定的 vs 现在的

### 4.1 当时定的（`ARCHITECTURE-TARGET-2026-11-03.md`，主人 2026-11-03 拍板）

**三条铁律：**

1. **万物皆能力扩展**，按业务域整块聚合，不按「感知/表达/行动」横切。B 站是完整一块，绝不保留独立 dsh CLI 第二层。
2. **核心资产 100% 宿主无关**，连 Cortico 本身也是可插拔插座。`cap-*` 绝不 `import 'cortico/*'`，只靠最外层 50–100 行薄转接头。
3. **没有只读黑盒**：每个能力扩展强制四件套 `store + context/event + tools + panel`（panel 必须可读写）。

**三层：** 宿主无关能力层 → Cortico 薄转接头层 → Cortico 插座层。

### 4.2 现在的项目骨架（实测行数）

| 包 | 层 | src 文件 | 行数 | 测试文件 |
|---|---|---:|---:|---:|
| `persona-core` | 内核（纯函数） | 22 | 2639 | 12 |
| `cap-state-rhythm` | 能力·状态与作息 | 10 | 3081 | 12 |
| `cap-memory` | 能力·记忆 | 5 | 2529 | 6 |
| `cap-journal` | 能力·日记/判断/意见 | 4 | 1854 | 1 |
| `cap-vision` | 能力·视觉（后加，第 6 个） | 5 | 1363 | 4 |
| `cap-bilibili` | 能力·B 站整块 | 14 | 5700 | 15 |
| `cap-media-studio` | 能力·音视频创作 | 5 | 1158 | 4 |
| `cortico-bot-xiaoyu` | 转接头 A（bot, api=7） | 13 | 2125 | 13 |
| `cortico-world-bilibili` | 转接头 B（world, api=6） | 4 | 397 | 1 |
| `cortico-world-media` | 转接头 C（world, api=6） | 3 | 278 | **0** |
| `cortico-adapter` | UI 契约与 helper | 2 | 563 | 1 |

根目录：`assets/ docs/ packages/ scripts/ spark-output/ tests/ tools/ vendor/`

**与蓝图的差**：蓝图写 5 个 `cap-*`，实际 **6 个**（`cap-vision` 是 B7a 批后加的）。这是合理增长，不是偏离。

### 4.3 全量功能：33 把工具（逐包实测，与侧边报告一致）

| 域 | 工具 | 数 |
|---|---|---:|
| 状态与作息 | `mood_read` `mood_apply` `life_do` | 3 |
| 记忆 | `memory_remember` `memory_recall` `memory_void` | 3 |
| 日记/判断/意见 | `diary_read` `diary_write` `judgment_read` `judgment_write` `judgment_revisit` `feedback_submit` | 6 |
| 视觉 | `see_video` | 1 |
| **内务小计** | | **13** |
| B 站 | `bili_feed` `bili_search` `bili_watch` `bili_debrief` `bili_subtitles` `bili_comments` `bili_danmaku` `bili_whois` `bili_seek` `bili_inbox_read` `bili_inbox_ack` `bili_like` `bili_fav` `bili_comment` `bili_dynamic_draft` `bili_dynamic_recent` `bili_dynamic_edit` `bili_dm_reply` | **18** |
| 出片 | `media_tts_preview` `media_video_build` | **2** |
| **合计** | | **33** |

另有 QQ 接入（复用宿主内置 QQ world，NapCat 正向 WS）与控制台对话，走宿主自带 world，不在 33 之内。

### 4.4 铁律达成度

| 铁律 | 状态 | 证据 |
|---|---|---|
| #1 万物皆扩展、B 站整块、无第二层 CLI | **达成** | 43 条命令收编进 `cap-bilibili`（5700 行），spawn 边界已消灭 |
| #2 宿主无关 | **代码面达成，可插拔未落地** | `cortico-adapter/src/*.ts` import 语句 **0 条**；能力包搜 `core.complete/chat/llm/generate`、`invokeModel`、`submitMessage` **全 0 命中**。**但**：`link:` 绝对路径、内核两份、**从未在第二个宿主上跑过** |
| #3 无只读黑盒、四件套 | **大部分达成，两处缺口** | 11 页签操作台已建；`cortico-world-media` **tests=0**；11 页签真浏览器验收（#74）**未做** |

---

## 5. 本轮已执行

### 5.1 清除 `Cortico-new`（回收 991M）

**先证明它过期，再删：**

```
$ git merge-base --is-ancestor 97fec27 reanchor/replay   → YES（不是孤儿提交）
$ git -C Cortico-new status --short                       → 19 条未提交
```

那 19 条是把 `src/worlds/bili-account/*` 搬到 `legacy/bili-account-old/`。而 **`Cortico-up` 已经做完了**：
`src/worlds/` 只剩 `bilibili console minecraft qq websearch webui-fixture index.ts`（无 `bili-account`），
`legacy/bili-account-retired/` 已存在且含同一批文件，`src/worlds/index.ts` 不再引用它。

→ 结论：**做了一半、后来在另一条线上重做并完成的旧副本。**

**删前留退路**：19 条改动存成补丁
`~/.xiaoyu-home/rollback/cortico-new-uncommitted-20261118.patch`（3678 字节 / 72 行，纯 rename 无内容变更）。

```
$ git worktree remove --force Cortico-new     → 成功
$ git worktree list                           → 只剩 Cortico 与 Cortico-up
$ git -C Cortico-up log --oneline -1          → ca48a69（宿主仓 git 正常）
```

### 5.2 我造成的一次数据损坏（已完全复原，根因已查实）

**结论：是 `git worktree remove --force Cortico-new` 干的。不是并发、不是别人。**

移除后复查，两处源码被清空，目录 mtime **都是 `Nov 18 11:17`**（正是该命令执行的那一分钟）：

| 被清空的目录 | 文件数 |
|---|---:|
| `Cortico-up/persona-core/` | 27 |
| `dsh-bili-whale/packages/cortico-bot-xiaoyu/` | 31 |
| `dsh-bili-whale/packages/cortico-world-bilibili/` | 9 |
| `dsh-bili-whale/packages/cortico-world-media/` | 7 |

合计 **74 个 tracked 文件**（`git ls-files` 逐包点数：47 + 27）。

**根因：pnpm 在 Windows 上建的是 junction，递归删除会跟着 junction 走进真实源码。**

```
$ cmd /c "dir /AL Cortico-up\extensions\node_modules"
<JUNCTION> cortico-bot-xiaoyu     [E:\WorkSpace_Qoder\dsh-bili-whale\packages\cortico-bot-xiaoyu]
<JUNCTION> cortico-world-bilibili [E:\WorkSpace_Qoder\dsh-bili-whale\packages\cortico-world-bilibili]
<JUNCTION> cortico-world-media    [E:\WorkSpace_Qoder\dsh-bili-whale\packages\cortico-world-media]

$ cmd /c "dir /AL Cortico-up\node_modules\@xiaoyu"
<JUNCTION> persona-core [E:\WorkSpace_Qoder\Cortico-up\persona-core]
```

`Cortico-new` 是同一个仓的工作树，它的 `extensions/package.json` 带着**同样的三条 `link:E:/...` 绝对路径**，
因此它的 `node_modules` 里也有**指向同一批真实源码的 junction**。
`git worktree remove --force` 递归删 `Cortico-new` 时**跟着 junction 走了进去**，把共享的目标目录清空了。

→ **被删的集合与 `link:` 目标集合完全吻合**，这就是因果证据，不是巧合。
→ 讽刺的是：**§1.3 那条「绝对路径 link」缺陷，正是这次数据损坏的放大器。**

**当时的半拆状态**（宿主三处引用悬空，`pnpm install` 与 typecheck 都会失败）：

```
package.json:38       "@xiaoyu/persona-core": "workspace:*"
tsconfig.json:23      include 含 "persona-core/src/**/*.ts"
pnpm-workspace.yaml:14  - 'persona-core'
```

**复原与核验（全部已跑）：**

```
$ git -C Cortico-up checkout -- persona-core
$ git -C Cortico-up diff --stat HEAD -- persona-core     → 无输出（逐字节一致）
$ git -C dsh-bili-whale checkout -- packages/
$ git -C dsh-bili-whale diff --stat HEAD                 → 无输出
$ git ls-files --deleted                               → 空（两仓都是）
$ git ls-files -z | xargs -0 ...                       → 687 个 tracked 文件全在位
$ node scripts/run-mjs-tests.mjs
  EXECUTED=159/159   tests=922 pass=921 fail=1 skipped=0
```

那 1 个 fail 是既有的 `live-drift`（两份 persona-core 常量漂移 = #77），**与本次损坏无关，改动前就是红的**。

> 一个自查坑：`git ls-files | while read f; do [ -e "$f" ]...` 报「1 个缺失」，
> 实为中文路径被 git 引号化（`"spark-output/brief/\345\260..."`）导致的**假阳性**。
> 权威判据是 `git ls-files --deleted` 与 `-z` 精确复核，两者都为空。**别拿 shell 循环的读数当损坏证据。**

**#77 仍未获批准。** 这次意外清空恰好是 #77 想做的事，但真做必须同步改掉上面三处引用 + 加防分叉门禁。
**不得把这次事故当作 #77 已完成。** 已恢复原状。

### 5.2bis 安全规程（此后删任何工作树/目录必须照做）

1. **先摘 junction，再删目录。** 枚举：`cmd /c "dir /AL /S <目标>"`；
   摘除用 `rmdir <junction>`（**不带 `/S`**，只删链接本身）或 `fsutil reparsepoint delete <junction>`。
2. **绝不**对含 `node_modules` 的工作树直接 `git worktree remove --force`。
   先 `pnpm install --offline` 之外的手段清链接，或先把 `node_modules` 整体移走。
3. 删前 `git status --short` 存证；删后**立刻**对**所有共享该 link 目标的仓**跑 `git ls-files --deleted`。
4. 根治：**把 `link:` 绝对路径改成相对路径**（S3），并让单仓后不再存在跨目录 junction。

### 5.3 day-watchdog：不能停（原提议撤回）

上一轮我提议「把 day-watchdog 停掉或改指新家」。**查完撤回「停掉」这半句：**

```
~/.dsh/bili-whale/days          35 天，最新 2026-11-18
~/.xiaoyu-home/xiaoyu/days      不存在
~/.xiaoyu-home/xiaoyu/data/days 不存在
PID 16352  alive=1   node scripts\day-watchdog.mjs --audit   起于 11-15 19:43
日志末尾 [2026-11-17T17:38:49Z] tick 2026-11-18 count=20
```

**它是「她的一天」唯一的 tick 来源。** 停掉 = 面板断粮。
正确修法是**改指新家**（`tools/lib/paths.mjs:6` 只是 `export * from '../../packages/cap-bilibili/src/platform/paths.mjs'`，
真正解析在 `cap-bilibili` 里），并先把存量 35 天迁过去。这属于 #58「状态落点账收口」，**先提案再动**。

另：线上实例当前**彻底停着**——`~/.xiaoyu-home/xiaoyu/control/` 无 pid/log，7799 端口无监听。
旧家 `cortico.log` 最后三行是 `启动: xiaoyu / 启动失败: gate is not defined / 进程异常退出（1）。未自动重启。`（mtime 11-15 19:43）。
已核当前源码：`gate` 在 `cortico-bot-xiaoyu/src/index.ts:91` 声明，188/192/196 均为同一工厂返回的闭包，**无 TDZ 问题**；
加 tool-gate 的 `e52f17f` 提交于 **11-16 12:28**，晚于该 mtime → 那次崩溃是提交前的中间态，不是现行代码缺陷。

---

## 6. 架构层面现存问题（按严重度）

| # | 问题 | 实测 | 归属 |
|---|---|---|---|
| P1 | **烧钱乘法**：每笔行动 3.5–14 次模型调用 × ~71 万 token | 11-06: 226 笔/3237 次=14.3；11-13: 4 笔/20 次=5.0 | 闸门+幂等已修（`e52f17f`），离线回放 12→6；**线上未验证** |
| P2 | **B 站 18 工具 0 调用** | envPrompt 已补（`5445a18`），渲染出 653/508 字符 | 阶段 2-1 真跑验证**待主人批准** |
| P3 | **可插拔未落地** | `link:` 绝对路径；内核两份（宿主 16 / 本仓 22 `.ts`，常量漂移）；第二宿主从未跑过 | 本文路线 2 + #77 + #73 |
| P4 | **B 侧 `activityDrive` 反向退化** | 场值全满 **57 醒/天** > 低体力低刺激 **27**；驱动曲线 U 形，谷底 0.375@stim≈0.4，峰值 1.000@stim=1.0 | #86，改它=改她的行为，**需拍板** |
| P5 | **状态两套家并存且仍在发生** | 旧家 watchdog 今天还在写；新家无 `days/` | #58，先提案 |
| P6 | **出片 0 个 mp4** | `media_video_build` 已实现，卡点未定位 | 未查清 |
| P7 | **公开日记停在 11-06** | 私日记到 11-13 | 未查清根因 |
| P8 | **声称↔实现无门禁** | 观测窗 K1/K2/K3 至今 0；`cortico-world-media` tests=0；11 页签真浏览器未验收 | #62 / #74 |
| P9 | 宿主估算器中文低估 29% | `tokens.ts:17` `cjk*0.6+other*0.3`；660,111 vs 923,418 | **根因记录，方向已由主人撤销，不复活** |

---

## 7. 需要主人拍板的岔路

1. **路线 2 vs 路线 1**（本文推荐 2）。
2. **#77 B 段批准**——它是 S1 硬前置，不批则单仓收敛无法开始。
3. **#86 `activityDrive`**——修不修（会改她的行为）。
4. **#58 状态落点**——watchdog 改指新家 + 35 天存量迁移。
5. 单仓后是否把仓名从 `dsh-bili-whale` 改成 `xiaoyu`（它现在装的是两者）。

## 8. 复现命令

```bash
git -C E:/WorkSpace_Qoder/Cortico worktree list
git -C E:/WorkSpace_Qoder/Cortico-up rev-list --count reanchor/base..reanchor/replay
git -C E:/WorkSpace_Qoder/Cortico-up diff --stat reanchor/base..reanchor/replay | tail -1
git -C E:/WorkSpace_Qoder/Cortico-up branch -vv | grep reanchor
grep -n "link:" E:/WorkSpace_Qoder/Cortico-up/extensions/package.json
grep -n "persona-core" E:/WorkSpace_Qoder/Cortico-up/{package.json,tsconfig.json,pnpm-workspace.yaml}
ls ~/.dsh/bili-whale/days | wc -l ; ls ~/.xiaoyu-home/xiaoyu/days 2>/dev/null
```