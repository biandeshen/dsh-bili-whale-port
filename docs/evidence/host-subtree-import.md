# 宿主收编进 `host/cortico/` 的实测记录（#89 · 2026-11-19）

## 做法

```
git subtree add --prefix=host/cortico E:/WorkSpace_Qoder/Cortico-up HEAD
```

- 来源：`Cortico-local` 分支 `reanchor/replay`，HEAD `294ce13`（**已含 persona-core 副本删除**）；
- 不 `--squash`：保留宿主 551 个提交的完整历史，将来 `git subtree pull` 能真正算出增量；
- 结果：1238 个跟踪文件、1 个合并提交 `613ffd5`；
- 前置：先提交了 `294ce13`（删副本），否则收编进去的是带副本的旧状态。

## 为什么先改门禁

收编前先给树扫描类门禁加 `host` 跳过。理由是收编后这些门禁第一次会扫到 25 个宿主 `.mjs`
与 371 个宿主测试，把本仓自己的错误淹没。

**但"加了跳过"不等于"跳过是必要的"。** 逐条实测（把 `'host'` 从各 SKIP 里临时拿掉再跑）：

| 门禁 | 扫描根 | 跳过是否生效 | 结论 |
|---|---|---|---|
| `run-mjs-tests` | 从 `root` 整树发现 `*.test.mjs` | **必需** | 不跳过会多发现 371 个宿主测试；它们要 `--import tsx`，本仓没有 |
| `check-mjs-syntax` | 从 `ROOT` 整树 | **必需** | 实测 342（跳过）/ 367（不跳过），差值 25 = `host/` 里的 `.mjs` |
| `check-consumers` | `walk(ROOT)` | **必需** | 实测宿主 `legacy/` 里有 4 个符号的调用点（`buildVoiceBrief` 2、`decideAction` 2、`describeState` 6、`readMood` 5）；不跳过时它们让"全部有生产调用"**假通过** |
| `check-state-roots` | `walk` 全树找状态读写 | **必需** | 不跳过时多出 3 条 `owner=host` 报错 |
| `check-cortico-paths` | 固定 `SCAN_DIRS` 白名单 | **空操作** | 白名单里没有 `host`，永远走不到；已回退，只留一句注释防止后人再加 |
| `check-script-paths` | 固定 `SCAN_DIRS` 白名单 | **空操作** | 同上 |
| `check-doc-hygiene` | 固定 `CODE` 白名单 | **空操作** | 同上 |

这条记录的意义：如果只看"门禁都绿了"就收工，就分不清"我防住了"和"我加了一段永不执行的代码"。
三个空操作已删除，并在原处留注释说明"别再加回来"。

## 读数

```
run-mjs-tests          167/167 文件，957/957 用例通过，exit 0
check-mjs-syntax       0   342 个 .mjs（跳过 host 的 25 个）
check-consumers        0
check-cortico-paths    0   扫 459 个文件
check-script-paths     0
check-live-drift       0   15 项全 ✓，无漂移
check-doc-hygiene      0   158 篇
check-hashes           0   16 冻结，4 个带理由重冻
check-state-roots      1   ← 与收编无关：本机 ~/.dsh 与 ~/.bili-ai 自 11-01 起
                            dm-await-state / dm-quota / pending-replies 三处历史分叉（#58 范围）
```

## 哈希重冻的理由

`run-mjs-tests` / `check-consumers` / `check-cortico-paths` / `check-script-paths`
四个在冻结名单里。前两个是实质改动（加了必须的跳过），后两个只是留注释说明"这是空操作"。
`g3b-check` 的"验收脚本哈希"这一项因此先报了 changes，重冻后 5 例全绿——
这正是冻结机制在履职，不是它坏了。

## 仍未完成

1. **宿主自身的测试没跑过**：`host/cortico/node_modules` 不存在（subtree 只搬跟踪文件），
   本机 `tsx`/`vitest` 目录也是空的。要在收编后验证宿主侧，需先 `pnpm install`。
2. **`host/cortico/package.json` 没有任何 workspace 关系**：它还是宿主那份，
   里面的 `extensions/*` 依赖仍写作 `link:E:/WorkSpace_Qoder/dsh-bili-whale/packages/...`（绝对路径）。
   改成相对路径属于 #90（分层重组）的范围。
3. **宿主 `legacy/bili-account-retired/` 仍 import `@xiaoyu/persona-core`**，现在那条 import
   在本仓树里解析不到。宿主 `typecheck` 会报——随 #90 改指向时一并处理。
4. 本仓根 `pnpm-workspace.yaml` 还没把 `host/cortico` 纳入（也不该纳入：它是 subtree 的镜像，
   有自己的依赖树）。这条要在 #90 决定"宿主是自己装依赖还是被本仓管"时再定。
