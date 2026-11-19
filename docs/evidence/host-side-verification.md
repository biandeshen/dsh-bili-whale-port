# 宿主侧验证 —— 第一次有真实读数（2026-11-19）

在此之前，"宿主侧无损"一直是**未验证**（本机 `tsx`/`vitest` 目录为空）。
这一轮把依赖装上了，于是可以给出读数，同时纠正两处我上轮写错的话。

## 一、lock 陈旧（已修）

`294ce13` 删了宿主 `package.json` 的 `@xiaoyu/persona-core` 与 `pnpm-workspace.yaml` 的条目，
但 `pnpm-lock.yaml` 没跟着重算，残留三处：

```
importers..dependencies['@xiaoyu/persona-core']:
  specifier: workspace:*
  version: link:persona-core
importers.persona-core: {}
```

后果：`pnpm install --frozen-lockfile` 会因 lock 与 manifest 不一致直接失败。

修法：在**宿主仓库**跑 `pnpm install --lockfile-only --ignore-scripts`（只解析、不下载），
提交 `5b76ddc`，净变化 5 行删除、无版本漂移；再用 `git subtree pull` 同步进 `host/cortico`
（这一步同时证明收编机制真的能用：只带进那 5 行）。

## 二、宿主依赖装不上，根因不是网络

现象：`pnpm install` 报
`ENOENT ... Cortico\node_modules\.pnpm\esbuild@0.28.2\node_modules\esbuild\package.json`。

查因（`node_modules` 里 18 个符号链接全部断裂，完好 0）：
`node_modules/.modules.yaml` 里有

```
virtualStoreDir: "E:\\WorkSpace_Qoder\\Cortico\\node_modules\\.pnpm"
```

即 `Cortico-up`（`Cortico` 的 git worktree）当初是用**另一棵树**的 store 目录建的；
那棵树的 `.pnpm` 下 370 个条目**目录在、内容是空的**（没有 `package.json`）。
所以 pnpm 一直往空壳里 link，然后读不到清单。

对照：主检出 `Cortico` 里 `pnpm install` 1.9 秒成功 → **store 与网络都正常**，
问题纯粹是这棵工作树指向了坏路径。

修法：`rm -rf node_modules`（删前确认工作树干净、无 junction，只有 pnpm 自己的符号链接），
再 `pnpm install --ignore-scripts` → 29 秒装完，18/18 链接完好，`tsx`/`vitest` 可跑。

⚠ 用了 `--ignore-scripts`，所以 `canvas` 的原生二进制没编译。
这是**我的安装方式**造成的，不是宿主缺陷；需要它在跑一次不带该参数的重装。

## 三、读数

### vitest（宿主自己的入口）

```
Test Files  2 failed | 288 passed (290)
Tests       2 failed | 5205 passed | 3 skipped (5210)
Duration    325s
```

两个失败：

| 文件 | 用例 | 原因 |
|---|---|---|
| `tests/worlds/minecraft/bridge.test.ts` | viewer 模块装得起来 | `Cannot find module '../build/Release/canvas.node'` ← 我用 `--ignore-scripts` 跳过编译 |
| （同一批里的第 2 个） | — | 同源：canvas 原生模块缺失 |

单独跑 `bridge.test.ts`（除 viewer 那条）全绿；`architecture-boundary.test.ts` 全绿。
**没有一条失败与删 `persona-core` 有关。**

### 那 7 个 `.mjs` 测试：全红，但**不在 vitest 扫描范围里**

`vitest.config.ts` 的 `include` 是 `['tests/**/*.test.ts', ...]` —— 只跑 `.ts`。
所以上表的 5205 并不包含 `tests/*.test.mjs` 这一批。

逐个用 `tsx --test` 跑（7 个）：

```
approval-reason  exit=1   Cannot find package '@xiaoyu/persona-core'
causal-ledger    exit=1   同上
draft-rework     exit=1   同上
feed-hygiene     exit=1   同上
life-stages      exit=1   同上
memory-void      exit=1   同上
naming           exit=1   同上
```

**根因是删掉的包还在被 legacy 引用**。这正是待主人拍板的那件事，不是我这次弄坏的：
上一轮记录里它们也是红的（当时归因于"没有 tsx"，其实**有 tsx 也会红**——
真正原因是模块不存在）。这里更正上轮那句"失败原因是加载器缺失"。

## 四、要主人拍板的一件事

宿主 `legacy/bili-account-retired/`（7 个 .ts）与 `tests/*.test.mjs`（7 个）仍在
`import '@xiaoyu/persona-core'`，而该包已从宿主 manifest 删除。两条路：

- **A. 退役 legacy**：删目录 + 删那 7 个 .mjs 测试。这些断言本仓都已有对等覆盖
  （见 `host-persona-core-disposition.md` 的对照表）。宿主测试从 5210 → 约 5205（少的就是它们）。
- **B. 给 legacy 一条显式路径**：宿主 `tsconfig` 的 `paths` 加
  `"@xiaoyu/persona-core/*": ["../dsh-bili-whale/packages/kernel/persona-core/src/*"]`，
  但这样宿主又依赖了另一棵树的源码路径——与我们刚删掉"第二份真相"的初衷相反。

我倾向 A，但这是删别人仓的历史资产，需要你明确点头。

## 五、复现

```bash
# 宿主侧（在 Cortico-up）
pnpm install                 # 补 canvas 原生模块，需不带 --ignore-scripts
./node_modules/.bin/vitest run
./node_modules/.bin/tsx --test tests/naming.test.mjs   # 观察 ERR_MODULE_NOT_FOUND

# 本仓侧
node scripts/run-mjs-tests.mjs
```
