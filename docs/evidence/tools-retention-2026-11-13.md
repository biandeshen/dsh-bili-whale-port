# tools/ 为什么整棵留下（2026-11-13 实测，只读）

退役批（B-1）删了 `core/`、`panel/`、`adapters/opencode/`、`vendor/dsh-autocut/` 四棵树共 79 个文件，
**`tools/` 一个文件都没删**。这份是"没删"的判据，不是事后解释。

- 跑时机：2026-11-13，仓根 `E:\WorkSpace_Qoder\dsh-bili-whale`
- HEAD：`7bf9198`（79 个删除已 `git rm` 暂存、**尚未提交**；工作区脏）
- 全程只读：没有起宿主、没有发任何 B 站请求、没有花模型 token

---

## 一、三条活脚本 → tools/ 的真实边（不是注释、不是文档）

| 活脚本 | 行 | 边 | 性质 |
|---|---|---|---|
| `scripts/dynamic-approve.mjs` | 15 | `import { postImageDynamic } from '../tools/drafts/publishers/bilibili-dynamic.mjs'` | **真 import**；`:68` `const exec = publisher \|\| (runner ? fromRunner(runner) : postImageDynamic)` 把它当默认 publisher |
| `scripts/preflight.mjs` | 49-50 | `const bili = path.join(ROOT, 'tools', 'bili.mjs')` → `add(fs.existsSync(bili) ? 'ok' : 'fail', '工具链入口', bili)` | 存在性探针，**缺了就 EXIT≠0** |
| `scripts/counterfactual.mjs` | 11 | `import { composeDraft } from './draft-dynamic.mjs'` → `scripts/draft-dynamic.mjs` 引 `tools/lib/pick-image.mjs` | 传递边；counterfactual **在 `check-hashes.mjs` 冻结名单里** |

另有 `scripts/nightly-scheduler.mjs:18` `spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'draft-dynamic.mjs')])`。

复现（逐条可跑）：

```
grep -n "postImageDynamic" scripts/dynamic-approve.mjs
grep -n "tools', 'bili.mjs" scripts/preflight.mjs
grep -n "draft-dynamic" scripts/counterfactual.mjs scripts/nightly-scheduler.mjs
grep -n "pick-image" scripts/draft-dynamic.mjs
```

### 1.1 引用表的口径漏洞（这条比"tools 活着"更要紧）

`docs/evidence/legacy-refs-2026-11-12.md` 把 `tools/bili.mjs` 归进 **T2b**（"只被退役入口或死脚本引"），
把 `tools/lib` 42 个里的 37 个也归进 T2b/T3/T0，只有 5 个是 T2a。原因是它的**"活脚本"根集只取 npm 可达**
（`package.json` scripts + gates 链）。上面那三个脚本一个都不在 npm scripts 里：

```
grep -n "preflight\|dynamic-approve\|counterfactual\|nightly-scheduler" package.json
→ 无命中
```

于是它们被当成死脚本，它们引的东西就被判成"可删"。**T2b 因此偏宽，不能直接当删除清单用。**

本批的删除集不受这个漏洞影响，两道独立防线：

1. 删除集里的 57 个树内文件**零 T1、零 T2a**，且逐个核过"其余脚本"列里的引用方是否也在删除集里；
2. 新门禁 `scripts/check-script-paths.mjs` 扫的是**全部 422 个脚本文件**（不分层、不看 npm），
   任何指向已消失文件的仓内路径都红。它现在 EXIT=0。

**登记为后续**：引用表生成器 `scripts/audit-legacy-refs.mjs` 的根集应扩到"所有带 CLI 入口守卫或被冻结/被运维文档点名的脚本"，
否则下一批还会踩同一个坑。（本批不改它：它不在冻结名单里，但改根集会让整张表的分层数字全变，属另一批的活。）

---

## 二、可达性补测：31/42 → 35/42

### 2.1 口径（先说清楚，免得数字被读成别的）

- 起点：`tools/bili.mjs`（旧 CLI 派发器，83 行）。
- 三类边都算：① 静态 `import ... from '...'` / `require('...')`；② **派发表里的字符串**
  （`'commands/traffic.mjs'` 这种，`spawnSync` 用，不是 import 语法）；③ 动态 `await import('...')`。
- 只跟相对路径；裸包名不跟。**这仍是下界**：运行时拼出来的路径（`'commands/' + name + '.mjs'`）抓不到。
- 分母 42 = `tools/lib` 下全部 `.mjs`（含 `credentials/` 子目录 3 个）；顶层是 39 个。

### 2.2 两次假读数，当场推翻（留痕，别只报最后那个数）

| 版 | 报的数 | 为什么错 |
|---|---|---|
| 第 1 版 | 闭包 1 个文件、可达 0/42 | `ROOT` 写成正斜杠 `E:/...`，而 `path.resolve` 在 Windows 出反斜杠，`r.startsWith(ROOT)` **恒 false** → 一条边都没加进去 |
| 第 2 版 | 可达 31/42，但 `pending-queue` 判成不可达 | 正则漏了动态 `import('...')`：`tools/commands/reply-draft.mjs:114` 是 `const P = await import('../lib/pending-queue.mjs')`，`import\s*['"]` 匹配不到中间那个 `(` |
| 第 3 版（下面的数） | 可达 31/42 | 修了上面两处；`pending-queue` 正确进入闭包 |

**"0 可达"当时看着像个结论，其实是测量工具坏了。** 这正是本仓反复栽的那一类，所以把错版一起留在这里。

### 2.3 原始输出（第 3 版，逐字）

```
tools/lib 总文件数：42
从 tools/bili.mjs 传递可达：31
不可达：11
不可达清单：
  tools/lib/credentials/bilibili.mjs
  tools/lib/credentials/index.mjs
  tools/lib/credentials/mimo.mjs
  tools/lib/go-rebuild.mjs
  tools/lib/kill.mjs
  tools/lib/offline-gap.mjs
  tools/lib/pick-image.mjs
  tools/lib/poll-policy.mjs
  tools/lib/proc.mjs
  tools/lib/state-lock.mjs
  tools/lib/state-roots.mjs

闭包总文件数：81
闭包按目录：
  tools/commands  34
  tools/lib  31
  tools/verify  7
  packages/cap-bilibili  5
  tools/bili.mjs  1
  scripts/ack.mjs  1
  tools/drafts  1
  scripts/day-snapshot.mjs  1
```

注意闭包里有 `packages/cap-bilibili` 5 个文件：**依赖方向是 tools → packages**（例如
`tools/lib/paths.mjs` 只是个转发壳，`export * from '../../packages/cap-bilibili/src/platform/paths.mjs'`）。
所以"packages 离不开 tools"不成立，反过来才是真的。

### 2.4 并上 ops 脚本可达的 4 个 → 35/42

不可达的 11 个里，有 4 个其实被活脚本引（见第一节与引用表 T2a）：

| 文件 | 引它的活脚本 |
|---|---|
| `tools/lib/kill.mjs` | `scripts/ops-day.mjs`（npm `ops:day`） |
| `tools/lib/offline-gap.mjs` | `scripts/c2-offline.mjs` |
| `tools/lib/state-roots.mjs` | `scripts/check-state-roots.mjs`（在 gates 链里）、`scripts/audit-state-locations.mjs`、`scripts/migrate-state-roots.mjs` |
| `tools/lib/pick-image.mjs` | `scripts/draft-dynamic.mjs` ← `counterfactual.mjs` / `nightly-scheduler.mjs` |

31 + 4 = **35/42**；顶层 39 个里 **35 个**（`credentials/` 三件都不在 35 里）。

### 2.5 与审阅方「33/39 是活的」对账

同向，差在口径，不差在结论：

- 分母：审阅方 39 = 顶层；本文 42 = 含 `credentials/` 子目录 3 个。
- 分子：本文 CLI 派发器口径 31，加 ops 脚本口径 35。审阅方 33 落在两者之间，
  差的 2 个最可能是 `kill`/`offline-gap`/`state-roots`/`pick-image` 这四个里算了哪几个。
- **本文不猜审阅方那 2 个是谁**：上面 2.3/2.4 给了完整清单，谁都能自己并一遍。
- 无论 31、33 还是 35，**都远超"可以整棵删"的门槛**。

### 2.6 剩下 7 个没有活代码引用的，也留在原地

| 文件 | 层 | 为什么不动 |
|---|---|---|
| `tools/lib/go-rebuild.mjs` | 原 T2b → 现孤儿 | 原来只被 `core/api/routes.js` 引，本批删了 core 之后没人引了 |
| `tools/lib/poll-policy.mjs` | 原 T2b → 现孤儿 | 原来只被 `core/scheduler.js` 引，同上 |
| `tools/lib/proc.mjs` | T0 | 谁都不引 |
| `tools/lib/state-lock.mjs` | T3 | `tests/contract/state-roots.test.mjs` 还在跑它 |
| `tools/lib/credentials/index.mjs` | T3 | `tests/contract/credentials.test.mjs` 还在跑它 |
| `tools/lib/credentials/bilibili.mjs` | T3 | 只被上面那个 index 引 |
| `tools/lib/credentials/mimo.mjs` | T3 | 同上 |

**T3 不等于可删**（测试还在跑），孤儿也要等 tools 收编那批一起处理，不单独摘——
单独摘 7 个文件省不下什么，却要把 `tools/` 的完整性赌进去。

---

## 三、能力包侧两处功能缺口（删了 tools 就真丢能力）

### 3.1 带图动态：能力包发不出去

链路逐层核过：

```
grep -n "imagePath" packages/cap-bilibili/src/index.ts
→ 864:  imagePath: { type: 'string', description: '可选配图路径' }
→ 870:  async execute(args: { text: string; imagePath?: string; intent?: 'self' | 'share' })
→ 876:  imagePath: args.imagePath,          ← 交给闸门了
→ 1134: invoke(params: { id: string; text: string; imagePath?: string })
```

但默认执行器把它丢了：

```
sed -n '330,333p' packages/cap-bilibili/src/index.ts
→    const out = await executeBiliWrite(
→      action.kind,
→      { target: action.target, body: action.body },     ← 没有 imagePath
→      { ...writeCtx, ...(selfMid ? { selfMid } : {}) },
```

再往下客户端**根本没有图片字段**：

```
sed -n '343,346p' packages/cap-bilibili/src/client/bili-write.ts
→ export async function executeBiliWrite(
→   kind: 'like' | 'fav' | 'comment' | 'danmaku' | 'dynamic' | 'edit-dynamic' | 'dm',
→   action: { target: {...}; body: string },
→   ctx: BiliWriteContext,

sed -n '42,45p' packages/cap-bilibili/src/client/bili-write-extra.ts
→ export async function executeDynamic(
→   action: { target: { bvid?: string; dynId?: string }; body: string },
→   ctx: BiliWriteContext,

grep -n "image\|pictures" packages/cap-bilibili/src/client/bili-write.ts   → 0 命中
grep -rn "imagePath\|image" packages/cap-bilibili/src/client/bili-write-extra.ts → 0 命中
```

真能发图文动态的只有 tools 侧：

```
grep -rn "postImageDynamic" packages scripts
→ scripts/dynamic-approve.mjs:15  import { postImageDynamic } from '../tools/drafts/publishers/bilibili-dynamic.mjs'
→ scripts/dynamic-approve.mjs:68  const exec = publisher || (runner ? fromRunner(runner) : postImageDynamic)
（packages 侧 0 命中）

sed -n '1,25p' tools/commands/dynamic-image.mjs
→ import { postImageDynamic } from '../drafts/publishers/bilibili-dynamic.mjs'
→ const r = await postImageDynamic({ image: imagePath, text, atMid, atName, go: isGo })
```

**结论**：`imagePath` 在能力包里是个**收得下、发不出**的参数。删掉 tools 就把图文动态这条能力整个删掉，
而且面板上那个参数还会继续收——那是比"少个功能"更坏的形状。

### 3.2 批量放行：只有一个入口

```
grep -rn "releaseAll\|release --all\|'--all'" packages/cap-bilibili/src   → 0 命中
grep -n "all" tools/commands/reply-draft.mjs
→ 120:  const all = argv.includes('--all')
→ 122:  if (!ids.length && !all) { console.error('用法: release --id <id>... | --all [--dry]'); process.exit(2) }
→ 123:  const targets = all ? P.listPendingQueue().map((x) => x.id) : ids
```

待放行队列的批量放行目前只有 `node tools/bili.mjs reply-draft release --all`。

---

## 四、这两处缺口登记去哪

都属 **tools 收编那批**（把 CLI 能力搬进 cap-bilibili 之后再退役 tools），不是本批：

1. `executeBiliWrite` / `executeDynamic` 入参加图片字段，`defaultExecutor` 透传 `action.imagePath`，
   并补一条"带图动态真的发出去了"的契约（判据必须是**对外凭据**，不是干跑退出码）。
2. cap-bilibili 补 `releaseAll`，与 `reply-draft release --all` 成对报数后再退役旧入口。

**本批不修这两处**：改的是写侧执行器与对外发布路径，属行为变更，要独立验证与主人拍板，
不能塞进一个"删旧代码"的批里顺手做。

---

## 五、复现这份补测的脚本（只读，放仓外跑）

测量脚本没有进仓（它是一次性判据，不是门禁）。要复核就把下面这份存成临时文件再
`node <临时文件>`（在仓根跑，或用绝对路径改 `ROOT`）：

```js
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve('E:/WorkSpace_Qoder/dsh-bili-whale')
const START = path.join(ROOT, 'tools', 'bili.mjs')
const norm = (p) => path.resolve(p)
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/')

const IMPORT_RE = /(?:from\s*|import\s*\(\s*|import\s*|require\(\s*)['"]([^'"]+)['"]/g
const DISPATCH_RE = /['"]((?:commands|verify|drafts|lib)\/[\w./-]+\.(?:mjs|js|ts))['"]/g

const seen = new Set()
const queue = [START]

function resolveSpec(fromFile, spec) {
  const base = norm(path.resolve(path.dirname(fromFile), spec))
  const cands = [base, base + '.mjs', base + '.js', base + '.ts', path.join(base, 'index.mjs'), path.join(base, 'index.js')]
  for (const c of cands) { try { if (fs.statSync(c).isFile()) return c } catch {} }
  return null
}

while (queue.length) {
  const f = queue.shift()
  if (seen.has(f)) continue
  seen.add(f)
  let text
  try { text = fs.readFileSync(f, 'utf8') } catch { continue }
  const specs = new Set()
  for (const m of text.matchAll(IMPORT_RE)) if (m[1].startsWith('.')) specs.add(m[1])
  if (rel(f) === 'tools/bili.mjs') for (const m of text.matchAll(DISPATCH_RE)) specs.add('./' + m[1])
  for (const s of specs) {
    const r = resolveSpec(f, s)
    if (!r || !r.startsWith(ROOT)) continue
    if (!seen.has(r)) queue.push(r)
  }
}

const libAll = []
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const abs = path.join(d, e.name)
    if (e.isDirectory()) walk(abs)
    else if (/\.(mjs|js|ts)$/.test(e.name)) libAll.push(rel(abs))
  }
}
walk(path.join(ROOT, 'tools', 'lib'))
const reached = libAll.filter((f) => seen.has(norm(path.join(ROOT, f))))
console.log(`tools/lib 总文件数：${libAll.length}`)
console.log(`从 tools/bili.mjs 传递可达：${reached.length}`)
console.log(`不可达：${libAll.length - reached.length}`)
for (const f of libAll.filter((f) => !seen.has(norm(path.join(ROOT, f))))) console.log('  ' + f)
console.log(`闭包总文件数：${seen.size}`)
```

**这份脚本的两个已知局限**（别把它的输出当上限）：
① 运行时拼出的路径抓不到；② 派发表正则只认 `commands|verify|drafts|lib` 四个前缀，
`tools/bili.mjs` 若新增别的子目录会漏。所以 31 是**下界**，35 是"下界 + 已核实的 ops 边"。