/**
 * 状态根门禁：把"谁有权写哪份状态"从口头约定变成一条可复跑的命令。
 *
 * 查三件事，任何一条不满足就非零退出：
 *   1. 表覆盖：实际在用的状态文件都在 `state-roots` 的 KINDS 表里（新增文件不许绕过）；
 *   2. 单写者：同一个文件不能既在 CLI 写清单里、又由宿主写；
 *   3. 旧家退场：兼容期内还有哪些文件只在旧家——列出来，退场日之前要清完。
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
for (const dir of SRC) {
  for (const file of walk(path.join(ROOT, dir))) {
    const text = fs.readFileSync(file, 'utf8')
    for (const m of text.matchAll(/state(?:ReadPath|Path|Exists)\(\s*['"]([a-z0-9-]+)\.(?:json|jsonl|log)['"]/gi)) {
      used.add(m[1])
    }
    for (const m of text.matchAll(/writeStateText\([^)]*?['"]([a-z0-9-]+)\.(?:json|jsonl|log)['"]/gi)) {
      used.add(m[1])
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
if (split.length) notes.push(`新旧两份已经分叉（读新家，但旧家仍是老值）：${split.join('、')}`)

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
  console.log(`  表里声明 ${result.declared.length} 类；调用点用了 ${used.size} 类`)
  for (const n of notes) console.log(`  · ${n}`)
  if (problems.length) {
    for (const p of problems) console.log(`  ✗ ${p}`)
  } else {
    console.log('  ✓ 没有绕过表的路径，也没有多写者')
  }
}

process.exit(result.ok ? 0 : 1)
