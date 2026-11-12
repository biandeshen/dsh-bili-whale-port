# 脚本路径门禁：故意判红 + 真仓全绿（B-1 退役批）

- 跑于 2026-11-13 00:15（本机，北京时间），仓 `E:\WorkSpace_Qoder\dsh-bili-whale`
- 跑时仓 HEAD `7bf91984718d871f4c58fde10b966be2043b8b5e`（删除已 `git rm` 入暂存区，当时尚未提交）
- **本批落成的提交：`b2e9fe7`**（118 文件，+7118 / −5902），证据补记提交 `4f6de3b`。
- **提交后在干净工作区复跑过一次**（HEAD `4f6de3b`）：whale `EXECUTED=149/149`、`tests=858 pass=858 fail=0 skipped=0 todo=0 cancelled=0`；
  宿主 `EXECUTED=28/28`、`229 pass / 0 fail`（宿主报告 gitSha `ca48a69`）。
  所以 `gates-2026-11-13.json` 里的 `gitSha` 现在是 **`4f6de3b`**，与它实际跑的那份代码一致。
  下面第三节记录的**删前**那份 `gates-2026-11-12.json`（gitSha `07fa6b6`）仍有口径缺陷：
  它跑在脏工作区上，sha 不等于实际代码——runner 不记 `dirty`，归任务 #63，本批不改冻结件。
- 门禁 `scripts/check-script-paths.mjs`（本批新增，已进 `scripts/hashes.json` 冻结名单，16 份）
- 回归 `tests/script-paths.test.mjs`：11 条，含故意违规与**故意合法**两侧（假红比漏红更坏）

这份证据回答两个问题：**它真的会判红吗**（不是只在全绿仓上跑过一次），
以及**删完 79 个文件之后真仓是不是干净的**。

## 一、故意判红：造一个指着四棵退役树的小仓

夹具落在仓外临时目录（`%TEMP%\b1-red-demo`），**不进本仓**，所以它自己不会污染真仓的门禁读数。
两个文件，内容如下（原样）：

`scripts/points-at-retired.mjs`

```js
// 故意违规样本：指向 2026-11-12 退役的四棵旧接入树。用来证明新门禁真的会判红。
import fs from 'node:fs'
import path from 'node:path'
import { loadRoutes } from '../core/api/routes.js'

const ROOT = path.resolve(import.meta.dirname, '..')
const panel = path.join(ROOT, 'panel', 'server.js')
const daemon = path.join(ROOT, 'adapters', 'opencode', 'daemon.js')
const autocut = path.join(ROOT, 'vendor', 'dsh-autocut', 'lib', 'index.js')
export const gone = [panel, daemon, autocut].filter((p) => fs.existsSync(p))
export { loadRoutes }
```

`open-panel.cmd`

```bat
@echo off
node scripts\launch-panel.mjs
```

命令与原始输出：

```
$ node scripts/check-script-paths.mjs --root "C:/Users/Administrator/AppData/Local/Temp/b1-red-demo"
脚本路径门禁：扫了 2 个 .mjs/.cjs/.js/.ts/.tsx/.cmd/.vbs（仓内路径；home/素材盘/运行时 data/宿主检出不在此列）

✗ 5 处违规

## R1-import 不存在 —— 1
  scripts/points-at-retired.mjs:4  ../core/api/routes.js
    import { loadRoutes } from '../core/api/routes.js'

## R3-片段拼出的路径不存在 —— 3
  scripts/points-at-retired.mjs:7  panel/server.js
    const panel = path.join(ROOT, 'panel', 'server.js')
  scripts/points-at-retired.mjs:8  adapters/opencode/daemon.js
    const daemon = path.join(ROOT, 'adapters', 'opencode', 'daemon.js')
  scripts/points-at-retired.mjs:9  vendor/dsh-autocut/lib/index.js
    const autocut = path.join(ROOT, 'vendor', 'dsh-autocut', 'lib', 'index.js')

## R4-启动器指向不存在 —— 1
  open-panel.cmd:2  scripts/launch-panel.mjs
    node scripts\launch-panel.mjs

修法：要么把路径改到还在的那份，要么把这条脚本/启动器一起退役。别让脚本指着空气。
EXIT=1
```

四棵退役树（`core/`、`panel/`、`adapters/`、`vendor/dsh-autocut/`）各被抓到一次，
三种写法（相对 import、`path.join` 片段、`.cmd` 启动器）各命中对应规则，退出码 1。

## 二、真仓全绿：删完之后没有任何脚本指着空气

```
$ node scripts/check-script-paths.mjs
脚本路径门禁：扫了 422 个 .mjs/.cjs/.js/.ts/.tsx/.cmd/.vbs（仓内路径；home/素材盘/运行时 data/宿主检出不在此列）

未核 30 条（不算违规，但列出来免得静默放行）：
  6 条 —— 注释里的散文提及（非用法示例），不作为可跑路径
  2 条 —— 模板字符串内部（夹具内容或运行时拼出的代码）
  21 条 —— 夹具键名（给临时仓里的假文件起名），不指向本仓
  1 条 —— 比较型断言的期望值（比对夹具产出的文件名），不是打开路径
  - scripts/audit-legacy-refs.mjs:16  panel/assets/whale-girl/manifest.json
  - tests/cortico-paths.test.mjs:37  ./lib/host-root.mjs
  - tests/cortico-paths.test.mjs:37  scripts/a.mjs
  - tests/cortico-paths.test.mjs:38  scripts/b.mjs
  - tests/cortico-paths.test.mjs:46  scripts/bad.mjs
  - tests/cortico-paths.test.mjs:54  scripts/bad.mjs
  - tests/cortico-paths.test.mjs:61  scripts/bad.mjs
  - tests/cortico-paths.test.mjs:68  scripts/bad.mjs
  - tests/cortico-paths.test.mjs:78  scripts/label.mjs
  - tests/cortico-paths.test.mjs:80  scripts/node_modules/x/index.mjs
  - tests/cortico-paths.test.mjs:87  scripts/bad.mjs
  - tests/cortico-paths.test.mjs:94  scripts/bad.mjs
  …另 18 条（--json 看全量）

✓ 脚本里没有指向已消失文件的仓内路径
EXIT=0
```

**30 条「未核」逐类都有理由，不是白名单**：门禁把每一处豁免都打印出来，
读的人能自己判断该不该信。其中 `scripts/audit-legacy-refs.mjs:16` 那条是审计工具注释里
记录的一次历史假阳性（鲸鱼娘 manifest），不是用法示例。

## 三、同批其余门禁（2026-11-13 实测，逐条退出码）

| 门禁 | 退出码 | 读数 |
|---|---|---|
| `check-mjs-syntax.mjs` | 0 | 322 个 .mjs，无 TS 语法混入，逐个 `node --check` 通过 |
| `run-mjs-tests.mjs --report docs/evidence/` | 0 | DISCOVERED=149 / EXECUTED=149 / tests=858 pass=858 fail=0 skipped=0 todo=0 cancelled=0 |
| `run-mjs-tests.mjs --root ../Cortico-up --import tsx` | 0 | DISCOVERED=28 / EXECUTED=28 / tests=229 pass=229 fail=0（报告落宿主仓 `docs/evidence/gates-Cortico-up-2026-11-13.json`） |
| `check-consumers.mjs` | 0 | 全部有生产调用 |
| `check-hashes.mjs` | 0 | 16 份「一致」（本批 `--write --note` 重冻，rewritten=2） |
| `check-cortico-paths.mjs` | 0 | 无脚本指向第二宿主克隆 |
| `check-script-paths.mjs` | 0 | 见上 |
| `check-live-drift.mjs` | 0 | 线上部署与仓内产物无漂移 |
| `check-doc-hygiene.mjs` | 0 | 活文档 17／specs 10/10／docs 根 7 篇（上限 12），三条全绿 |
| `check-state-roots.mjs` | **1** | **本批之前就红**：`dm-await-state`、`dm-quota`、`pending-replies` 三类新旧两家读数分家且无解释。属状态落点收口（任务 #58），不是删除造成的；另 3 类分叉已带到期日与负责人豁免 |

删除前后的测试数对照（同一台机、同一个 runner，逐文件对账，不是净差猜测）：

- `docs/evidence/gates-2026-11-12.json`：**892 pass / 156 文件**（删前）
- `docs/evidence/gates-2026-11-13.json`：**858 pass / 149 文件**（删后）
- 净 −34 的**精确来源**（按两份报告的 `files[]` 逐文件相减）：

| 类别 | 文件 | 条数 |
|---|---|---|
| 整份退役（8 份） | `adapters/opencode/test/contract.test.mjs` 4 · `tests/contract/injection.test.mjs` 2 · `tests/contract/panel.test.mjs` 5 · `tests/contract/routes.test.mjs` 4 · `tests/dm-exit-integration.test.mjs` 1 · `tests/dom/tank-smoke.test.mjs` 2 · `tests/listener-polling.test.mjs` 1 · `tests/vendor-autocut.test.mjs` 2 | **−21** |
| 就地瘦身（7 份） | `go-gate` 6→5 · `launcher` 2→1 · `m1a-observability` 5→1 · `m1e-approval` 12→10 · `integration` 19→13 · `issue27` 8→2 · `updates` 13→9 | **−24** |
| 本批新增（1 份） | `tests/script-paths.test.mjs`（新门禁的故意违规 + 故意合法两侧） | **+11** |

892 − 21 − 24 + 11 = 858，对得上。**瘦身的 7 份删掉的都是指向已删模块的那几条**
（`tests/helpers/{plugin,scheduler,dm-delivery,scheduler-timeout}.mjs`、`core/{session-delivery,scheduler,work-dir,mention-summary}.js`），
不是"删测试让门禁变绿"：留下的 149 个文件全部执行，零 skip 零 todo 零 cancelled。

**这份对账有一个口径缺陷，一并说明**：报告里的 `gitSha` 记的是**跑时的 HEAD**，不记工作区是否脏。
删前那份记 `07fa6b6`，但当时 S1–S4 的改动已在工作区（`tests/cortico-paths.test.mjs`、`tests/host-root.test.mjs` 已在跑），
所以那个 sha **不等于**它实际跑的那份代码。本批不改这个 runner（它在冻结名单里），
登记为版本可回溯收口（任务 #63）的一条：报告应同时记 `dirty` 与暂存区指纹。

## 四、还没验的那一条（别把这份读成"全验收通过"）

**真浏览器 11 个页签**：本轮实测 `node scripts/preflight.mjs` 报「端口 7799 可用」，
即**线上宿主此刻没在跑**。按本批约束不重启线上生活循环，所以这一条**未验证**，
需要主人决定是起线上还是起备用端口验证实例。`tests/dom/` 那 9 个是 FakeEl，按判据不算数。