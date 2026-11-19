# 宿主 `legacy/bili-account-retired/` 退役处置表（2026-11-19）

## 一、它到底在不在装配链上（决定性证据）

| 检查项 | 结果 |
|---|---|
| 宿主 `src/` `bin/` `scripts/` `templates/` 引用 legacy | **零** |
| 宿主 `pnpm-workspace.yaml` / `package.json` 登记 legacy | **无** |
| 部署 `~/.xiaoyu-home/xiaoyu/config.json` 的 `worlds.bili-account` | `enabled: true`（有配置） |
| 部署 `extensions/package.json` 里 `bili-account` 指向哪 | **`dsh-bili-whale/packages/cortico-world-bilibili`**（本仓新 world） |
| 宿主 `extensions/` 里有没有装 legacy world | **没有**（该目录只有 market 清单 + node_modules） |

**结论：legacy 从来没有被加载过。** 线上跑的一直是本仓的 `cortico-world-bilibili`。

## 二、它包含什么（18 个文件）

| 文件 | 行数 | 内容 | 处置 |
|---|---|---|---|
| `tank.ts` | 567 | 旧 world 的面板数据层（`pendingQueueState` / `settingsState` / `judgmentList` / `avatarBinary` … 共 31 个导出） | **退役**。新架构由 `cap-bilibili` 4 个 panel + bot 侧配置组承担 |
| `definition.ts` | — | 旧 WorldDefinition，串起下面所有模块 | **退役** |
| `gates.ts` | 39 | 三条内容前置门禁（见第三节） | **退役**（主人 2026-11-19 拍板：已废弃） |
| `task-queue.ts` | 86 | 持久任务队列（at-least-once / 崩溃重投 / 5 次进 dead） | **退役**。前提是旧 scheduler；新架构无 scheduler、无 spawn |
| `runner.ts` | 21 | 子进程执行器 + kill switch 前置拦截 | **退役**。新架构进程内直调，无 spawn |
| `config-store.ts` | 133 | 旧配置读写（`policySet` / `renameSelf` / `hostDisplayName`） | **退役**。新架构由 `cortico-bot-xiaoyu` 的 4 个配置组承担 |
| `diary.ts` / `dm.ts` / `dm-reply.ts` / `causal-io.ts` / `personaAdapter.ts` / `prompts.ts` / `paths.ts` / `capability.ts` / `tool-decls.ts` / `webui/client.ts` / `ENV_PROMPT.md` | — | 旧 world 的自有实现 | **退役** |

## 三、三条内容前置门禁：确认废弃（主人 2026-11-19 拍板）

`gates.ts` 的 `canDraft` / `canApplyWatched` / `diaryFresh`：

1. 出稿（`bili_draft_dynamic`）前必须先 `bili_debrief` 一条；
2. 记 `watchedVideo` 前必须 debrief 过；
3. 公开日记 24h 内必须更新过。

**新架构一条都没实现，且这是有意为之**：`docs/specs/06-bili-write.md` 明写
「函数返回空字符串即"不拦"；**唯一真实刹车是 `draftMode` 与档位表本身**」。
结合主人 2026-11-07 的 `draftMode=auto`（发布默认开）与「我不决定她看什么」的取向，
这三条属于旧 world 的自律设计，新架构换成了「她自己决定」。

主人 2026-11-19 明确确认：**不迁，确认已废弃**。

## 四、19 个测试的处置

引用 legacy 的测试共 **19 个 / 131 个用例**。逐个核对后分两类：

### 类 A：断言对象就是 legacy 代码，随 legacy 一起退役（12 个）

| 测试 | 用例 | 测什么 |
|---|---|---|
| `webui-tank` | 21 | 旧面板数据层（`readPolicyLite` / `settingsState` / `renameSelf` …） |
| `core` | 18 | 旧 `gates` / `runner` / `personaAdapter` |
| `diary-page` | 13 | 旧 `diary.ts` 的分页/摘要 |
| `capabilities` | 11 | 旧 `BILI_ACCOUNT` 定义 |
| `settings-write` | 9 | 旧 `policySet` |
| `dm-reply` | 7 | 旧 `dm-reply.ts` |
| `task-queue` | 6 | 旧 `task-queue.ts`（含 at-least-once） |
| `memory-recall` | 4 | 旧 `personaAdapter` 的 recall |
| `watch-verdict` | 4 | 旧 `personaAdapter` 的看片结论 |
| `dm` | 4 | 旧 `dm.ts` |
| `env-prompt` | 3 | 旧 `ENV_PROMPT.md` 契约 |
| `causal-ledger` | 3 | 旧 `countCausalActions` |

### 类 B：断言本仓已有对等实现，删前已核对（7 个）

| 测试 | 用例 | 本仓对应 |
|---|---|---|
| `memory-void` | 7 | `cap-memory/tests/memory-void.test.mjs` |
| `approval-reason` | 5 | `tests/contract/approval-reason.test.mjs`（dsh 侧落账） |
| `life-stages` | 6 | `cap-state-rhythm/tests/life-stages.test.mjs` |
| `naming` | 4 | `packages/kernel/persona-core/tests/naming.test.mjs` |
| `feed-hygiene` | 3 | `capabilities/cap-state-rhythm/tests/feed-hygiene.test.mjs` |
| `draft-rework` | 3 | `tests/draft-rework.test.mjs`（闸门行为） |
| `causal-ledger` 的 action 计数部分 | — | `capabilities/cap-state-rhythm/tests/action-ledger.test.mjs` |

## 五、一个连带发现（必须单独处理，不属于本处置表）

部署目录的 `extensions/package.json` 里那三条 `link:` 仍指向**搬迁前**的路径：

```
cortico-bot-xiaoyu      → link:E:/WorkSpace_Qoder/dsh-bili-whale/packages/cortico-bot-xiaoyu
cortico-world-bilibili  → link:E:/WorkSpace_Qoder/dsh-bili-whale/packages/cortico-world-bilibili
cortico-world-media     → link:E:/WorkSpace_Qoder/dsh-bili-whale/packages/cortico-world-media
```

这三个目录在 #90 分层后已不存在（现在在 `packages/adapters/` 下）。
**下次启动宿主会找不到扩展。** 这条改动落在部署目录（不在 Git 里），
而"不碰线上配置"是长期约束——**因此本轮不动它，只记录并报告**。

## 六、执行方式

1. 在宿主仓库删 `legacy/`（`git rm -r`）与上述 18 个测试（提交 `67072f0`）；
2. 修 `tests/core/util.test.ts` 里那张"直读文件系统"的期望清单（去掉 7 条 legacy 路径——
   那五个扫描目录本来就不含 `legacy/`，所以那些条目从写下起就永远不会被命中）；
3. `test:mjs` 入口仍有效：删完后 `tests/*.test.mjs` 还剩 `session-history` 一个（8/8 通过），
   不会变成空集合静默通过；
4. `git subtree pull` 同步进 `host/cortico`（合并提交 `70ad4c7`）。

## 七、执行结果

**宿主侧**

```
Test Files  1 failed | 289 passed (290)
Tests       1 failed | 5206 passed | 3 skipped (5210)
```

唯一失败是 `bridge.test.ts` 的 viewer 用例（canvas 原生模块缺失，安装时用了 `--ignore-scripts`）。
删除前是 2 败，删后 1 败——说明那两条里有一条正是 legacy 的。

**本仓侧**

相对引用扫过一遍：`host-legacy-retirement` 之后 `check-consumers` 报出 4 个 UNUSED
（`buildVoiceBrief` / `decideAction` / `describeState` / `readMood`）。

这不是"删多了"，而是**门禁指错了树**：这 4 个符号的 `home` 写的是 `CORTICO`（宿主检出），
意思是"应该由宿主调用"。但唯一一份 `persona-core` 早在 #88 就搬进本仓了，
它们的真实调用者一直在这边（`cortico-persona.ts` / `cap-state-rhythm` / `counterfactual.mjs` /
`preview-recall.mjs`）。已把 `home` 改为 `ROOT`，6 个符号全部 OK。

⚠ **同时暴露了这条门禁的局限**（既有的，不是本轮引入）：它按**符号名出现次数**判断，
不是按真实调用。变异测试：把 `buildVoiceBrief(...)` 改成 `(0 && buildVoiceBrief)(...)`
（永假，实际不会执行），门禁仍判 OK。也就是说它能抓"名字彻底消失"，
抓不到"调用被短路/注释掉但名字还在"。要补得改成 AST 级判断，那是独立一项工作。

## 八、扩展链接已修（2026-11-19，主人同意后执行）

**先更正一处我写错的话**：这份 `extensions/package.json` **不在**
`~/.xiaoyu-home/xiaoyu/`（那里根本没有 `extensions/` 目录），
而在 **`Cortico-up/extensions/`** ——宿主检出的本地工作区。
宿主 `.gitignore:36` 是 `/extensions/`，所以它既不进 Git、也不进 subtree，
属于"每台机器自己生成"的部署产物。之前把它说成"线上配置"不准确。

**问题**：三条 `link:` 指向分层前的 `packages/<名>`，三个目录全部不存在，
`extensions/node_modules` 里三条符号链接**全部悬空**。

**修法**：三行改成 `packages/adapters/<名>`，`pnpm install --ignore-scripts` 重链。

**验证（不看安装输出，看实际加载）**：

```
# ① node 视角解析符号链接
cortico-bot-xiaoyu      → packages/adapters/cortico-bot-xiaoyu      | package.json: true
cortico-world-bilibili  → packages/adapters/cortico-world-bilibili  | package.json: true
cortico-world-media     → packages/adapters/cortico-world-media     | package.json: true

# ② 用宿主自己的 tsx 真正 import 三个入口（不是只查文件在不在）
OK   cortico-bot-xiaoyu      | id=xiaoyu        (cortico.kind=bot,   api=7)
OK   cortico-world-bilibili  | id=bili-account  (cortico.kind=world, api=6)
OK   cortico-world-media     | id=media-studio  (cortico.kind=world)

# ③ 扩展发现列表
cortico-bot-xiaoyu, cortico-world-bilibili, cortico-world-media
```

备份在 `E:\WorkSpace_Qoder\_backups\Cortico-up-extensions-package.json.bak-pre-layering-20261119`
（刻意放在 `extensions/` 之外——虽然宿主扫的是目录不是文件，但别留会让人误读的东西）。

**注意**：这是本机宿主工作区的改动，不在 Git 里，**不会被 subtree 带进本仓**。
换一台机器或重建宿主检出时，要按同样方式指到 `packages/adapters/`。
