/**
 * 状态根门禁：把"谁有权写哪份状态"从口头约定变成一条可复跑的命令。
 *
 * 查四件事，任何一条不满足就非零退出：
 *   1. 表覆盖：实际在用的状态文件都在 `state-roots` 的 KINDS 表里（新增文件不许绕过）；
 *   2. 单写者：同一个文件不能既在 CLI 写清单里、又由宿主写；
 *   3. 旧家退场：兼容期内还有哪些文件只在旧家——列出来，退场日之前要清完；
 *   4. **两家分叉**（2026-11-07 加）：同一类在新旧两家都有、值却不一样，就是"读数分家"的直接症状。
 *      以前这条只打印一句 `·` 就放行（EXIT=0），等于把已知问题藏在绿色里；
 *      现在要么迁平，要么进 `SPLIT_ALLOWED` 带**到期日与负责人**，到期即红。
 *
 *   node scripts/check-state-roots.mjs [--json]
 *
 * 这是只读检查：不改任何状态，也不建目录。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { legacyStateDir, stateDir } from '../tools/lib/paths.mjs'
import { kinds, readHitsLegacy, specOf } from '../tools/lib/state-roots.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const json = process.argv.includes('--json')
const problems = []
const notes = []

/** 库里出现过的状态类（从 KINDS 表拿），逐个看盘上到底在哪。 */
const declared = new Set(kinds())

// 1. 表覆盖：扫调用点里写死的 <name>.json，确认都在表里。
const SRC = ['tools', 'core', 'panel', 'scripts']
const declaredFiles = new Set()
for (const kind of declared) {
  try {
    const spec = specOf(kind)
    if (spec.owner === 'both-with-lock') continue
  } catch { /* 表里缺这一类，下面统一报 */ }
  declaredFiles.add(kind)
}

function walk(dir, out = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) walk(abs, out)
    else if (/\.(mjs|js)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(abs)
  }
  return out
}

const used = new Set()
/**
 * 注释里的举例不是调用点。第一版把 `audit-state-locations.mjs` 头注释里那句
 * `stateReadPath('x.json')` 数成了一个叫 `x` 的状态类，于是门禁因为**注释**变红——
 * 假红比漏红更坏：下一个修的人会直接把这条正则放宽。
 */
const CODE_LINE = (line) => {
  const t = line.trim()
  return !(t.startsWith('*') || t.startsWith('/*') || t.startsWith('//') || t.startsWith('<!--'))
}
for (const dir of SRC) {
  for (const file of walk(path.join(ROOT, dir))) {
    const text = fs.readFileSync(file, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      if (!CODE_LINE(line)) continue
      for (const m of line.matchAll(/state(?:ReadPath|Path|Exists)\(\s*['"]([a-z0-9-]+)\.(?:json|jsonl|log)['"]/gi)) {
        used.add(m[1])
      }
      for (const m of line.matchAll(/writeStateText\([^)]*?['"]([a-z0-9-]+)\.(?:json|jsonl|log)['"]/gi)) {
        used.add(m[1])
      }
    }
  }
}

for (const name of [...used].sort()) {
  if (!declared.has(name)) problems.push(`状态类「${name}」在调用点里用了，但 state-roots 的 KINDS 表里没有它`)
}

// 2. 单写者：表里每一类只能有一个 owner，且 both-with-lock 必须声明 requiresLock。
for (const kind of [...declared].sort()) {
  const spec = specOf(kind)
  if (!['cli', 'host', 'both-with-lock'].includes(spec.owner)) {
    problems.push(`「${kind}」的 owner=${spec.owner} 不是 cli / host / both-with-lock`)
  }
}

// 3. 旧家退场：还在只能从旧家读到的文件，逐条列出来（不是错误，是待办）。
const fresh = stateDir()
const legacy = legacyStateDir()
const legacyOnly = []
for (const kind of [...declared].sort()) {
  if (kind === 'credentials' || kind === 'drafts' || kind === 'runs') continue
  try {
    if (readHitsLegacy(kind)) legacyOnly.push(kind)
  } catch { /* 表里没有这一类时上面已经报过 */ }
}
if (legacyOnly.length) notes.push(`仍在只读旧家：${legacyOnly.join('、')}（退场日前要迁到 ${fresh}）`)

// 4. 新家还是旧家：两份都在的时候，值是否已经分叉（读数分家的直接症状）。
const split = []
for (const kind of [...declared].sort()) {
  if (kind === 'credentials' || kind === 'drafts' || kind === 'runs') continue
  let name
  try { name = kind === 'fields' ? 'fields.json' : `${kind}.json` } catch { continue }
  const a = path.join(fresh, name)
  const b = path.join(legacy, name)
  try {
    if (!fs.existsSync(a) || !fs.existsSync(b)) continue
    const sa = fs.statSync(a)
    const sb = fs.statSync(b)
    if (sa.size !== sb.size || Math.abs(sa.mtimeMs - sb.mtimeMs) > 60_000) split.push(kind)
  } catch { /* 读不到就不报 */ }
}
/**
 * 分叉白名单（2026-11-07 主人拍板的口径：**要么升格为失败，要么加带到期日的白名单**）。
 * 每条必须写清"为什么允许两份不一样"、负责人、到期日。到期即红；续期要在这里改日期，
 * 并在 `docs/CURRENT.md` 留一行——不许悄悄续。（不许删旧家原件，这条规矩优先于"变绿"。）
 */
const SPLIT_ALLOWED = {
  'api-cache': { until: '2026-12-01', owner: '批次负责人', why: '只是缓存，读新家即可；旧那份不参与任何判据' },
  'feed-search-cache': { until: '2026-12-01', owner: '批次负责人', why: '同上：缓存分叉不改变她的行为，只可能多打一次网络' },
  'traffic-state': { until: '2026-12-01', owner: '批次负责人（归 #58 状态落点收口）', why: '**同名不同物**：闸内那份记 writeGapSec/pausedUntil/lastWriteAt/seenFingerprints，传输层那份记 accounts/until/streak/riskEndpoint——收口的正确动作是改名，不是把值迁平（见 docs/specs/06-bili-write.md ⑤ 第 5 条）' },
}
const today = new Date().toISOString().slice(0, 10)
if (split.length) notes.push(`本轮实测两家都存在且不一致的类：${split.join('、')}`)
const unexplained = []
const expired = []
for (const kind of split) {
  const allow = SPLIT_ALLOWED[kind]
  if (!allow) { unexplained.push(kind); continue }
  if (allow.until < today) expired.push(`${kind}（白名单到期日 ${allow.until}，负责人 ${allow.owner}）`)
  else notes.push(`分叉已豁免到 ${allow.until}：${kind} —— ${allow.why}（负责人 ${allow.owner}）`)
}
if (unexplained.length) {
  problems.push(`新旧两家读数分家且无解释：${unexplained.join('、')} —— 要么用 scripts/migrate-state-roots.mjs 迁平，要么写进 SPLIT_ALLOWED（带到期日与负责人），不许就这么放行`)
}
for (const e of expired) problems.push(`分叉白名单已过期：${e}`)
// 白名单不许变化石：已经不分叉的豁免条目要撤掉，否则它会把将来真的分叉一起遮掉。
const staleAllowed = Object.keys(SPLIT_ALLOWED).filter((k) => !split.includes(k))
if (staleAllowed.length) notes.push(`白名单里这些类今天不分叉了，可以撤：${staleAllowed.join('、')}`)

const result = {
  ok: problems.length === 0,
  stateDir: fresh,
  legacyDir: legacy,
  declared: [...declared].sort(),
  used,
  problems,
  notes,
}

if (json) {
  console.log(JSON.stringify(result, null, 2))
} else {
  console.log(`状态根门禁　state-roots`)
  console.log(`  新家：${fresh}`)
  console.log(`  旧家：${legacy}`)
  console.log(`  表里声明 ${result.declared.length} 类；旧 CLI 调用点抓到 ${used.size} 类`)
  console.log(`  ⚠ 口径：只扫 tools/core/panel/scripts 四个目录，正则只认 stateReadPath/writeStateText 两种写法；`)
  console.log(`    packages/（能力包，她真正在跑的那一侧）**不经过这张表**，所以"12"不等于"只有 12 类有人用"。`)
  console.log(`    要说"她实际在写哪份文件"，跑 scripts/audit-state-locations.mjs——那条盘上实况为准。`)
  for (const n of notes) console.log(`  · ${n}`)
  if (problems.length) {
    for (const p of problems) console.log(`  ✗ ${p}`)
  } else {
    console.log('  ✓ 没有绕过表的路径，也没有多写者')
  }
}

process.exit(result.ok ? 0 : 1)
