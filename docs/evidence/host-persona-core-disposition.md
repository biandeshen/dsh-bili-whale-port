# 宿主 `persona-core/` 副本处置表（#88 · 2026-11-19）

本仓 `packages/persona-core/src/` 与宿主 `Cortico-up/persona-core/src/` 是**两份同包名、不同内容**的实现。
后者是严格子集（少 `atomic-write.ts` / `capability.ts` / `cortico-defaults.ts` / `temporal.ts` / `tz.ts` / `write-dedupe.ts`），
且 `rhythm.ts` 的节奏常量仍是改 B14 之前的旧值：

| 常量 | 宿主副本（旧） | 本仓（活的那份） |
|---|---|---|
| `ACTION_COST_ENERGY` | `0.05` | `0.015` |
| `NEXT_CHECK_MIN_MS` | `3 * 60_000` | `30 * 1000` |
| `NEXT_CHECK_MAX_MS` | `7 * 60_000` | `90 * 1000` |
| `REST_RECOVERY_PER_HOUR` | `0.005` | `0.02` |

`node scripts/check-live-drift.mjs` 在 2026-11-19 08:5x 抓到这条不一致（见 `gates-2026-11-19.json` 之前的
`live-drift` 失败输出）。这不是本次改动造成的：宿主那份从 B14 之后就没再同步过。

## 谁在用宿主这份

| 引用方 | 性质 | 运行时是否走它 |
|---|---|---|
| 宿主 `src/` `bin/` `scripts/` | — | **零引用**（已 grep 证实） |
| `legacy/bili-account-retired/`（7 个 .ts） | 已退役的旧 B 站 world | **不在装配链**（无任何 json/yaml 登记） |
| 宿主 `tests/*.test.mjs`（7 个） | 测试 | 只在测试进程 |
| `node_modules/@xiaoyu/persona-core` | symlink → `./persona-core` | — |

导出符号逐个文件比对过：本仓是宿主那份的**超集**（无任何宿主导出在本仓缺失）。

## 断言去向（宿主测试 → 本仓对应）

| 宿主测试 | 断言在讲什么 | 本仓对应 | 覆盖情况 |
|---|---|---|---|
| `tests/feed-hygiene.test.mjs` | `watchedFromMemories` 的近 7 天/同 UP 计数 | `packages/cap-state-rhythm/tests/feed-hygiene.test.mjs` | **已移植**（5252 B vs 2369 B，更全） |
| `tests/life-stages.test.mjs` | 五阶段顺序/睡着判定/扣成本/记账时序 | `packages/cap-state-rhythm/tests/life-stages.test.mjs` | **已移植**（5636 B vs 5860 B） |
| `tests/memory-void.test.mjs` | 作废/恢复/召回剔除 | `packages/cap-memory/tests/memory-void.test.mjs` | **已移植**（5310 B vs 6273 B） |
| `tests/naming.test.mjs` | 称呼/情绪标签/voice-brief | `packages/persona-core/tests/naming.test.mjs` | **已移植**（4613 B vs 3274 B，覆盖更宽） |
| `tests/approval-reason.test.mjs` | 拒稿理由一路走到记忆、无理由不编造 | `tests/contract/approval-reason.test.mjs` | 本仓证 dsh 侧落账；**宿主侧的"结算成记忆"那半段随 legacy 一起退役** |
| `tests/causal-ledger.test.mjs` | `countCausalActions`：只数 kind=action、按自然日、坏行跳过 | `packages/cap-state-rhythm/tests/action-ledger.test.mjs` | **等价移植**（本仓读 `actions.ndjson`，语义相同） |
| `tests/draft-rework.test.mjs` | 拒稿后可重出（宿主侧话术） | `tests/draft-rework.test.mjs` | 本仓那份已覆盖闸门行为；宿主侧话术随 legacy 退役 |

### 宿主 `persona-core/tests/`（9 个文件，随目录一起删）

按去注释、去空白归一后逐行比对，逐文件结论（"宿主独有"= 归一后宿主有、本仓没有的行）：

| 宿主测试 | 本仓对应 | 宿主独有行 |
|---|---|---|
| `adapter.test.mjs` | `packages/cap-state-rhythm/tests/state-rhythm.test.mjs` | 12 条用例**逐条同名**，0 |
| `budget.test.mjs` | `packages/persona-core/tests/budget.test.mjs` | 0 |
| `conversation-assessment.test.mjs` | 同名 | 0 |
| `core.test.mjs` | 同名（204 行 vs 204 行） | 0 |
| `emotion.test.mjs` | 同名 | 0 |
| `life-activities.test.mjs` | 同名 | 0 |
| `retrieval.test.mjs` | 同名（158 行 vs 113 行，本仓更全） | 0 |
| `rhythm.test.mjs` | 同名（127 行 vs 121 行） | **6**（见下） |
| `voice-brief.test.mjs` | 同名（125 行 vs 125 行） | **1**（见下） |

`rhythm.test.mjs` 的 6 行宿主独有断言，断的正是 **B14 之前的旧常量**：

```
assert.ok(Math.abs(restRecoveryDelta(F({energy:0.5}),5)-0.025)<1e-9)   // 旧 0.005×5
assert.ok(a>=3*60_000 && b<=7*60_000 && b>a)                            // 旧 3–7 分钟
assert.ok(Math.abs(stale.urge-0.25)<1e-9, 'urge='+stale.urge)            // 旧 urge 公式
assert.ok(fresh.urge<stale.urge)
assert.ok([...byDay.values()].every((n)=>n<=15), '单日失控：'+...)      // 旧每日上限
test('rhy：评估间隔带抖动，不是整点', ...)
```

本仓那份已经按新值断言（`restRecoveryDelta(...) - 0.1`、`a >= 30*1000 && b <= 90*1000`）。
所以这 6 行是**同一条链的两个版本**，不是漏移植：旧值已被 B14 有意替换，丢弃旧的才正确。

`voice-brief.test.mjs` 的 1 行是 fixture 路径（宿主 `../../tests/fixtures/...` vs 本仓 `./fixtures/...`），
同一份 `fields-real-20261029.json` 两边都在。

## 本机验证限制（必须如实标注）

宿主 `node_modules` 里 `tsx` / `vitest` / `typescript` / `express` 四个目录**为空**（依赖被清过），
`node --import tsx` 直接 `Cannot find package`。所以：

- 删除**之前**已尽力取基线：无 tsx 时 7 个文件 5 过 7 败，失败原因是加载器缺失，不是断言失败。
- 删除**之后**无法用宿主自身的测试自证宿主侧无损——这一点本轮**未验证**，留给能跑宿主测试的环境。
- 本仓侧不受影响：本仓测试不 import 宿主那份（`packages/` 内只有一处注释提到 `Cortico-up`）。

## 删除范围（仅这三类，不动别人写的业务代码）

1. 宿主 `persona-core/`（27 个被跟踪文件：16 个 `src/*.ts` + `README.md` + `package.json` + 9 个 `tests/*.test.mjs`）——
   测试与退役 legacy 的唯一消费者；
2. 宿主 `package.json` 里 `"@xiaoyu/persona-core": "workspace:*"`；
3. 宿主 `pnpm-workspace.yaml` 的 `- 'persona-core'`；
4. 宿主 `tsconfig.json` include 里的 `"persona-core/src/**/*.ts"`。

**不删** `legacy/bili-account-retired/`：那是宿主仓库的历史资产，不在本轮授权范围（"不许为了省事硬删别人仓的文件"）。
删掉副本后，宿主 `typecheck` 会在这些 legacy 文件上报找不到模块——这是**已知且预期**的，
处置方式是随 #89 `git subtree` 收编宿主后统一改指向，不在本轮硬修。

## 防二次分叉门禁

`scripts/check-live-drift.mjs` 的 `checkPersonaCore()` 已经能抓"两份不一致"，
但它靠扫描字符串 `Cortico-up` 判 `linked`，会被**文档注释**误触发：

- `packages/cortico-bot-xiaoyu/src/session-rotation.ts:19` 在注释里写了
  `` `Cortico-up/src/core/types.ts:530` `` 作为出处引用 → 被判成"我们的链引了宿主树"
  → 走"必须逐字对齐"分支 → 报出那条节奏常量假警。

删除副本后这条路自然消失（`theirs` 不存在 → 早退 `只有一份，链路唯一`）。但那道门禁仍然不够硬：
它只比较两份都**存在**时的差异，无法阻止"有人又把副本抄回来"。所以要补一条**独立**的
存在性断言：`Cortico-up/persona-core` 不应存在；若存在，必须是有记录的例外。

同时修掉 `linked` 的误判：判据改为"`from '...Cortico-up...'` 形式的 import"，
注释里提到路径不算链接。

## 执行结果（2026-11-19）

**宿主侧**
- `git rm -r persona-core` → 27 个文件删除（`git status` 只剩这 27 个 `D` + 3 个配置 `M`）；
- `package.json` / `pnpm-workspace.yaml` / `tsconfig.json` 三处声明已清（`grep -c persona-core` 分别为 0 / 0 / 2 条注释）；
- 删前已枚举：工作树干净（`git status --porcelain` 为 0）、无 junction / symlink、无内部 `node_modules`；
- 回滚点：tag `pre-xiaoyu-subtree-20261118` @ `21a75ee`。

**本仓侧语法依赖（删后发现并一并修掉）**

宿主副本不止被测试用，`scripts/` 里还有 3 个活脚本按 `hostImport('persona-core/...')` 读它。
删掉后它们会 `ERR_MODULE_NOT_FOUND`，所以一并改回本仓：

| 脚本 | 改动 | 运行验证 |
|---|---|---|
| `scripts/counterfactual.mjs` | `buildVoiceBrief` → `../packages/persona-core/src/voice-brief.ts` | 冻结哈希已带理由重冻（`check-hashes` 0） |
| `scripts/simulate-rhythm.mjs` | 5 个函数 → `../packages/persona-core/src/*.ts` | **实跑**：`node scripts/simulate-rhythm.mjs 42` → 30 天 170 次行动，退出 0 |
| `scripts/preview-recall.mjs` | `buildVoiceBrief` / `dayKey` → 本仓 | 未实跑（另需宿主 `src/worlds/bili-account/`，该目录早已不存在） |

`scripts/drill-gate.mjs`、`scripts/smoke-tools.mjs` 只 import 宿主 `src/worlds/bili-account/`，
不碰 persona-core；那个目录本就已不存在（脚本自己的注释已写明），不在本轮范围。

**门禁（均实测退出码）**

```
scripts/check-live-drift.mjs      0（15 项全 ✓，无漂移）
scripts/check-hashes.mjs          0（16 冻结，1 带理由重冻）
scripts/check-script-paths.mjs    0
scripts/check-cortico-paths.mjs   0
scripts/check-consumers.mjs       0
scripts/check-state-roots.mjs     1  ← 与本轮无关：本机 ~/.dsh 与 ~/.bili-ai 自 11-01 就有
                                      dm-await-state / dm-quota / pending-replies 三处历史分叉（#58 范围）
run-mjs-tests.mjs                 166/166 文件，955/955 用例通过（gates-2026-11-19.json）
```

**反证（证明新门禁不是摆设）**

| 场景 | 退出码 | 输出 |
|---|---|---|
| 默认，宿主无副本 | 0 | `✓ 宿主 persona-core 不存在：只有一份，链路唯一` |
| 造一个假副本 | 1 | `✗ 宿主又出现一份 persona-core（第二份真相）` |
| `CORTICO_ALLOW_HOST_PERSONA_CORE=1` + 假副本 | 0 | `· 宿主有一份 persona-core（已显式放行）`（warn 不 fail） |
| 清掉假副本 | 0 | 回到 `✓` |

**仍未完成（如实标注）**

- 宿主自身 19 个 `*.test.mjs` 中依赖 legacy 的 8 个，在**本机跑不了**（`tsx` / `vitest` / `typescript` / `express`
  四个 `node_modules` 目录为空，`node --import tsx` 报 `Cannot find package`）。
  所以"宿主侧无损"这一条本轮**未验证**，需要在依赖装好的环境补跑一次。
- 宿主 `typecheck` 会因 legacy 里 `@xiaoyu/persona-core` 找不到而报错——**已知、预期**，
  随 #89 收编后统一改指向。
