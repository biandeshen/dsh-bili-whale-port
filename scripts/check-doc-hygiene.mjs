/**
 * 文档卫生门禁（2026-11-07 主人拍板"文档体制改制"的防复发那半）。
 *
 *   node scripts/check-doc-hygiene.mjs [--json]
 *
 * 病名先落在数上：全仓 157 个 `.md`、`docs/` 里 121 个（含 46 个 evidence），
 * 而**"某功能现在是怎么设计的"这一类 = 0 份**；`docs/` 从中午 59 篇到晚上 131 篇，
 * 12 小时翻倍。这套写法的规则是只增不换，所以它没有终点。
 * 后果不是"难看"，是因果：改代码时没有规格可对照，只有案卷可翻，
 * 于是同类坑反复来（`core.log` 形状炸三处、读错家目录骗过只读评审、`check-state-roots` 报分叉却 EXIT=0、
 * 断言一个不存在的 `go-gate.mjs`）。
 *
 * 三条红即失败：
 *   R1 不许新增案卷类文档：`docs/*-YYYY-MM-DD.md` 或 `docs/(HANDOFF|CLOSEOUT|STATUS|BATCH|AUDIT|PLAN|REVIEW|DECISION|DEEP-AUDIT)-*`；
 *      白名单只有 `docs/specs/`（10 份功能详设）与 `docs/evidence/`（门禁消费的机器产物）与 `docs/attic/`（考古，只读）。
 *      要改现状 → **就地改那 10 份**，不许再开一本。
 *   R2 文档里出现的相对路径与 `file:line` 引用，指向的文件必须存在（防"案卷里的路径早就没了"）。
 *   R3 specs 的 ② 节点名的参数，必须在代码里 grep 到**读取点**——
 *      零读取点即红。这一条是 `prefs.like`、`activeCap=40`、`context.maxTokens`（空转到今天才发现）、
 *      `lastKind` 这类"旋钮存在但没人读"的克星。
 *
 * R3 的口径要写死，否则它自己会变成一把软尺：
 *   只扫 ② 节里**四列表格**（参数名 | 定义 | 配置键 | 面板控件）第一列的反引号标识符；
 *   ⑤ 节里作为"已知缺陷"提到的键**不算**（缺陷本来就该被记着，不是规格承诺）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DOCS = path.join(ROOT, 'docs')
const asJson = process.argv.includes('--json')
const problems = []

const mdFiles = (dir, out = []) => {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) mdFiles(p, out)
    else if (e.name.endsWith('.md')) out.push(p)
  }
  return out
}
const allDocs = mdFiles(DOCS)
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/')

/** 案卷类命名的特征（日期后缀 / 台账类前缀）。attic 里的历史文件不追（那是负结果的归宿）。 */
const LEDGER_RE = /(?:^|[/-])(HANDOFF|CLOSEOUT|STATUS|BATCH|AUDIT|PLAN|REVIEW|DECISION|DEEP-AUDIT|CURRENT|BACKLOG)/i
const DATED_RE = /\d{4}-\d{2}-\d{2}/

// ── R1 不许新增案卷类文档（在 specs/evidence/attic 之外） ──────────────────
const WHOLESALE = ['specs', 'evidence', 'attic']
/**
 * 唯一被点名保留的台账：`docs/CURRENT.md`（主人 2026-11-07 拍板"降级为台账，不是现状"）。
 * 例外不给白名单而是给条件：**降级那句必须写在前十行里，且不许再加第二本**。
 * 否则"台账"会变成案卷的合法外衣——这正是这次改制要治的病。
 */
const LEDGER_ALLOWED = new Set(['docs/CURRENT.md'])
for (const f of allDocs) {
  const under = rel(f)
  const top = under.split('/')[1] ?? ''
  if (WHOLESALE.includes(top)) continue
  const base = path.basename(f)
  if (DATED_RE.test(base) || LEDGER_RE.test(base)) {
    if (LEDGER_ALLOWED.has(under)) {
      const head = fs.readFileSync(f, 'utf8').split('\n').slice(0, 10).join('\n')
      if (!/台账/.test(head) || !/不是现状/.test(head)) {
        problems.push({ rule: 'R1 台账降级声明缺失', where: under, detail: '前十行必须写明"台账，不是现状"' })
      }
      continue
    }
    problems.push({ rule: 'R1 案卷类文档', where: under, detail: '就地改 docs/specs/ 里对应那一份，别再开一本' })
  }
}
const specsDir = path.join(DOCS, 'specs')
const specs = fs.existsSync(specsDir) ? fs.readdirSync(specsDir).filter((f) => f.endsWith('.md')) : []
if (specs.length && specs.length !== 10) {
  problems.push({ rule: 'R1 specs 必须恰好 10 份', where: 'docs/specs', detail: `现在 ${specs.length} 份` })
}
// 验收口径②：`docs/` 根目录 .md 净数 ≤ 12（不含 attic/、evidence/、specs/ 子目录）。
// 这条是"只增不换"的硬上界：案卷可以搬去 attic，但不许在根目录继续堆。
const rootMd = fs.existsSync(DOCS) ? fs.readdirSync(DOCS).filter((f) => f.endsWith('.md')) : []
const rootMdCount = rootMd.length
if (rootMdCount > 12) {
  problems.push({ rule: 'R1 docs 根目录净数超限', where: 'docs/', detail: `${rootMdCount} 篇 > 12（多余的搬 docs/attic/YYYY-MM/）` })
}

// ── R2 文档里的路径与 file:line 引用必须存在 ───────────────────────────────
// 扫描范围＝**活文档**。`docs/attic/` 与 `docs/evidence/` 不进 R2：
// attic 的规矩是"按原日期保留、不改写"，evidence 是门禁消费的机器产物；
// 拿一条会要求改写的门禁去卡一批明令不许改写的文件，只能逼人绕过整条 R2。
const REF_RE = /(?:^|[\s`('"])((?:\.\.?\/|docs\/|packages\/|scripts\/|tools\/|src\/|adapters\/|vendor\/|core\/|extensions\/|worlds\/|platform\/)[\w./-]*\.(?:tsx|ts|mjs|json|js|md))(?::\d+)?/g
// 注意扩展名分支的**顺序**：`js|json` 会先吃掉 `.js` 再把 `on` 留在括号外（实测把
// `extensions/market-index.json` 报成不存在的 `.js`）。长的在前。
/**
 * 解析口径（第一版在这里错过一次，把 1256 条好端端的引用报成失效）：
 * ① `docs/`、`packages/` 这类**仓根相对**写法必须从仓根解析，只有 `./`、`../` 才是相对该文档自己；
 * ② `src/`、`core/`、`extensions/` 这批属于**宿主仓**（Cortico-up），本仓没有——
 *    按本仓既有的定位约定 `CORTICO_ROOT || ../Cortico-up` 再试一次；
 *    宿主不在场时报「未核」而不是「失效」，否则换台机器跑门禁就是一片假红。
 * 用错基准，R2 就变成一把只会喊狼来的尺——假违规比漏违规更坏，它会让下一个人直接加白名单绕过整条门禁。
 */
const HOST = process.env.CORTICO_ROOT || path.resolve(ROOT, '..', 'Cortico-up')
const hostPresent = fs.existsSync(HOST)
let r2Unchecked = 0
function resolveRef(docFile, target) {
  if (target.startsWith('./') || target.startsWith('../')) return [path.resolve(path.dirname(docFile), target)]
  return [path.resolve(ROOT, target), path.resolve(HOST, target)]
}
const livingDocs = allDocs.filter((f) => {
  const under = rel(f)
  return !['attic', 'evidence'].includes(under.split('/')[1] ?? '')
})
for (const f of livingDocs) {
  const text = fs.readFileSync(f, 'utf8')
  for (const m of text.matchAll(REF_RE)) {
    const target = m[1]
    const cands = resolveRef(f, target)
    if (cands.some((c) => fs.existsSync(c))) continue
    if (cands.length > 1 && !hostPresent) { r2Unchecked += 1; continue }
    problems.push({ rule: 'R2 引用指向不存在的文件', where: `${rel(f)}:${text.slice(0, m.index).split('\n').length}`, detail: target })
  }
}

// ── R3 specs ② 节点名的参数必须有读取点 ────────────────────────────────────
const CODE = ['packages', 'src', 'scripts', 'tools', 'adapters']
function readPoints(name) {
  // 定义处（声明、默认值、schema）不算被读：只数 `.name` / `[name]` / `name)` 这类**取值使用**的形态
  const usage = new RegExp(`(?:\\.|\\[|\\(|,|\\?\\.)\\s*['"\`]?${name}['"\`]?\\s*(?:\\]|\\)|\\.|,|;|\\s*[-=<>)]|\\?)`)
  const direct = new RegExp(`\\b${name}\\b`)
  let hits = 0
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist', 'data', 'attic'].includes(e.name)) continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) {
        const t = fs.readFileSync(p, 'utf8')
        for (const line of t.split('\n')) {
          if (line.includes('//') && !usage.test(line)) continue
          if (usage.test(line) || (direct.test(line) && !/^\s*(export\s+)?(const|interface|type)\s/.test(line))) hits += 1
        }
      }
    }
  }
  for (const d of CODE) walk(path.join(ROOT, d))
  return hits
}

for (const s of specs) {
  const text = fs.readFileSync(path.join(specsDir, s), 'utf8')
  const sec2 = text.split(/^\s*##\s*②\s/m)[1]?.split(/^\s*##\s*[③④⑤]/m)[0] ?? ''
  const tableRows = sec2.split('\n').filter((l) => l.trim().startsWith('|') && !/^\|\s*:?-{2,}/.test(l.trim()))
  const named = new Set()
  for (const row of tableRows.slice(1)) {
    const first = row.split('|')[1] ?? ''
    for (const id of first.matchAll(/`([^`]+)`/g)) {
      const raw = id[1].trim()
      if (/^[a-zA-Z][\w.]*$/.test(raw) && raw.length > 2) named.add(raw)
    }
  }
  for (const name of named) {
    const key = name.includes('.') ? name.split('.').pop() : name
    if (readPoints(key) === 0) {
      problems.push({ rule: 'R3 ② 节点名的参数没有读取点', where: `docs/specs/${s}`, detail: `${name}（声明存在，但代码里找不到取值使用）` })
    }
  }
}

// ── R4 specs 的五节结构（不许加第六节，⑤ 每条要带命令，"待观察"≤3） ────────
let pending = 0
for (const s of specs) {
  const text = fs.readFileSync(path.join(specsDir, s), 'utf8')
  const heads = [...text.matchAll(/^##\s*([①②③④⑤⑥⑦])/gm)].map((m) => m[1])
  for (const need of ['①', '②', '③', '④', '⑤']) {
    if (!heads.includes(need)) problems.push({ rule: 'R4 五节不齐', where: `docs/specs/${s}`, detail: `缺 ${need}` })
  }
  if (heads.filter((h) => ['⑥', '⑦'].includes(h)).length) {
    problems.push({ rule: 'R4 不许加节', where: `docs/specs/${s}`, detail: '出现了 ⑥/⑦' })
  }
  const sec5 = text.split(/^\s*##\s*⑤\s/m)[1] ?? ''
  for (const line of sec5.split('\n')) {
    if (/^\s*[-·]\s/.test(line) && !/node |npm |git |--date|scripts\/|\bbash\b|命令/.test(line)) {
      problems.push({ rule: 'R4 ⑤ 条目没带可跑命令', where: `docs/specs/${s}`, detail: line.trim().slice(0, 70) })
    }
    if (/待观察|后续再看/.test(line)) pending += 1
  }
}
if (pending > 3) problems.push({ rule: 'R4 「待观察」超限', where: 'docs/specs', detail: `${pending} 条（上限 3，且每条要注明负责人与批次）` })

if (asJson) console.log(JSON.stringify({ ok: problems.length === 0, specs: specs.length, docs: allDocs.length, livingDocs: livingDocs.length, r2Unchecked, problems }, null, 2))
else {
  console.log(`# 文档卫生门禁`)
  console.log(`  docs 下 .md ${allDocs.length} 篇（活文档 ${livingDocs.length}／specs ${specs.length}/10），根目录 ${rootMdCount} 篇（验收上限 12）`)
  console.log(`  R2 基准：本仓 ${ROOT}；宿主 ${HOST}${hostPresent ? '' : '（不在场 → 宿主侧引用计「未核」，当前 ' + r2Unchecked + ' 条）'}`)
  if (!problems.length) console.log('  ✓ 三条（案卷不新增 / 引用都存在 / ② 的参数有读取点）全绿')
  else {
    const by = {}
    for (const p of problems) (by[p.rule] ??= []).push(p)
    console.log(`  ✗ ${problems.length} 条违规`)
    for (const [rule, list] of Object.entries(by)) {
      console.log(`\n  ## ${rule} —— ${list.length}`)
      for (const x of list.slice(0, 25)) console.log(`    - ${x.where}  ${x.detail}`)
      if (list.length > 25) console.log(`    …另 ${list.length - 25} 条`)
    }
  }
}
process.exitCode = problems.length ? 1 : 0
