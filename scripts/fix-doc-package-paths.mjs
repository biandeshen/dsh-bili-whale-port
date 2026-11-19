/**
 * #90 一次性文档路径修正：docs/ 与根目录 .md 里引用的 `packages/<包名>/...`
 * 在分层后失效。这里只做**有明确目标**的替换——包名到层的映射写死在下面，
 * 不认识的包名一律不动并报出来（不猜）。
 *
 *   node scripts/fix-doc-package-paths.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const LAYER = {
  'persona-core': 'kernel',
  'cap-bilibili': 'capabilities',
  'cap-journal': 'capabilities',
  'cap-memory': 'capabilities',
  'cap-state-rhythm': 'capabilities',
  'cap-vision': 'capabilities',
  'cap-media-studio': 'capabilities',
  'cortico-adapter': 'adapters',
  'cortico-bot-xiaoyu': 'adapters',
  'cortico-world-bilibili': 'adapters',
  'cortico-world-media': 'adapters',
  'fs-atomic': 'shared',
  'write-dedupe': 'shared',
}

// 只改 "packages/<名>/" 这个前缀形态；已经分层的一律不动
const RE = /(?<![\w/-])packages\/([a-z0-9-]+)\//g

function walk(dir, out = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (['node_modules', '.git', 'attic', 'host'].includes(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.md')) out.push(p)
  }
  return out
}

const files = [
  ...walk(path.join(ROOT, 'docs')),
  ...fs.readdirSync(ROOT).filter((f) => f.endsWith('.md')).map((f) => path.join(ROOT, f)),
]

let changedFiles = 0
let changedRefs = 0
const unknown = new Map()

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  let touched = false
  const out = text.replace(RE, (whole, name) => {
    const layer = LAYER[name]
    if (!layer) { unknown.set(name, (unknown.get(name) ?? 0) + 1); return whole }
    touched = true
    changedRefs += 1
    return `packages/${layer}/${name}/`
  })
  if (touched) {
    fs.writeFileSync(file, out, 'utf8')
    changedFiles += 1
  }
}

console.log(`改了 ${changedFiles} 个文档、${changedRefs} 处引用。`)
if (unknown.size) {
  console.log('\n不认识的包名（没改，需人工确认是否已退役）：')
  for (const [n, c] of unknown) console.log(`  ${n} × ${c}`)
}
