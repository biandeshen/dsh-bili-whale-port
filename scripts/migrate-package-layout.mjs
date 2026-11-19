/**
 * 一次性迁移工具：#90 packages 分层重组后，重写所有相对 import。
 *
 * 为什么不用 sed：层级变化不是统一的。跨层（cap → persona-core）距离 +1，
 * 但同层（cap → cap，两者都进了 capabilities/）距离反而 -1。
 * 靠正则替换必然错一半，而错的后果是"运行时找不到模块"或**更坏**——解析到同名但不对的文件。
 *
 * 做法（每条相对说明符）：
 *   ① 把当前文件路径反推回"搬家前的旧路径"；
 *   ② 用旧目录解析这条说明符，得到旧目标（不要求存在，只是一条路径）；
 *   ③ 把旧目标映射到新布局；
 *   ④ 从当前目录算到新目标的相对路径；
 *   ⑤ 目标文件**必须存在**，否则报出来（说明这条 import 搬家前就已断开，不是这次弄坏的）。
 *
 *   node scripts/migrate-package-layout.mjs            # 只报告
 *   node scripts/migrate-package-layout.mjs --write    # 真改
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WRITE = process.argv.includes('--write')
const SKIP = new Set(['node_modules', '.git', 'dist', 'dist-web', '.spike-home', 'deployments', 'runtime', 'local-resources', 'host', 'docs', 'attic', 'data', 'days', 'spark-output', 'coverage', 'vendor'])

/** 新路径 → 旧路径（搬运前）。用来"倒带"解析。 */
function toOld(abs) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/')
  const m = /^packages\/(kernel|capabilities|adapters)\/([^/]+)(\/.*)?$/.exec(rel)
  if (m) return path.join(ROOT, 'packages', m[2] + (m[3] ?? ''))
  return abs
}

/** 旧路径 → 新路径。 */
function toNew(abs) {
  const rel = path.relative(ROOT, abs).split(path.sep).join('/')
  const m = /^packages\/([^/]+)(\/.*)?$/.exec(rel)
  if (!m) return abs
  const [, name, rest = ''] = m
  if (name === 'kernel' || name === 'capabilities' || name === 'adapters' || name === 'shared') return abs
  if (name === 'persona-core') return path.join(ROOT, 'packages', 'kernel', name + rest)
  if (name.startsWith('cap-')) return path.join(ROOT, 'packages', 'capabilities', name + rest)
  if (name.startsWith('cortico-')) return path.join(ROOT, 'packages', 'adapters', name + rest)
  return abs
}

function walk(dir, out = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|mjs|js)$/.test(e.name)) out.push(p)
  }
  return out
}

const SPEC = /(\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)'(\.[^']*\.(?:ts|mjs|js))'/g

const changes = []
const broken = []

for (const file of [...walk(path.join(ROOT, 'packages')), ...walk(path.join(ROOT, 'scripts')), ...walk(path.join(ROOT, 'tests'))]) {
  const text = fs.readFileSync(file, 'utf8')
  const oldFile = toOld(file)
  let out = text
  let touched = false
  for (const m of text.matchAll(SPEC)) {
    const spec = m[2]
    const curTarget = path.resolve(path.dirname(file), spec)
    if (fs.existsSync(curTarget)) continue // 当前能解析，说明不需要改（例如同包内引用）
    const oldTarget = path.resolve(path.dirname(oldFile), spec)
    const newTarget = toNew(oldTarget)
    if (!fs.existsSync(newTarget)) {
      broken.push({ file: path.relative(ROOT, file), spec, resolvedTo: path.relative(ROOT, curTarget) })
      continue
    }
    let next = path.relative(path.dirname(file), newTarget).split(path.sep).join('/')
    if (!next.startsWith('.')) next = './' + next
    const replaced = m[0].replace(spec, next)
    out = out.replace(m[0], replaced)
    touched = true
    changes.push({ file: path.relative(ROOT, file), from: spec, to: next })
  }
  if (touched) {
    changes.filter((c) => c.file === path.relative(ROOT, file)).forEach((c) => console.log(`  ${c.file}\n    ${c.from}\n    → ${c.to}`))
    if (WRITE) fs.writeFileSync(file, out, 'utf8')
  }
}

console.log(`\n${WRITE ? '已改写' : '将改写'} ${changes.length} 条；解析不到的目标 ${broken.length} 条。`)
if (broken.length) {
  console.log('\n以下 import 在搬家前就是断的（或指向已被删除的文件），本次不猜，需人工看：')
  for (const b of broken) console.log(`  ${b.file}\n    ${b.spec}  →  ${b.resolvedTo}`)
}
