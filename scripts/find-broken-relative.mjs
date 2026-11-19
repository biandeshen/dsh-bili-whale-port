/**
 * 搬家后的第二遍检查：#90 迁移器只重写了 `from '…'` 形式的 import 说明符，
 * 但代码里还有**别的相对路径**——动态 import 的字符串、路径常量、
 * `new URL('…', import.meta.url)`、以及指向仓根 `vendor/` 的深层相对路径。
 *
 * 这里不猜任何东西：对每个 .ts/.mjs 里的每个相对路径字面量，解析一次，
 * 不存在就报出来（文件:行 + 解析结果）。人看一眼就知道是该改路径还是该删。
 *
 *   node scripts/find-broken-relative.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SKIP = new Set(['node_modules', '.git', 'dist', 'dist-web', '.spike-home', 'deployments', 'runtime', 'local-resources', 'host', 'docs', 'attic', 'data', 'days', 'spark-output', 'coverage'])

function walk(dir, out = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|mjs|js)$/.test(e.name) && !/\.test\.mjs$/.test(e.name)) out.push(p)
  }
  return out
}

// 单个字符串字面量里的相对路径（不跨引号）。要排除：
//   · 模板里的 ${…}
//   · 只是文档性的路径（// 注释里）——但注释里的错误引用同样该修，所以照报，标 comment
const RE = /(['"`])(\.\.?\/[^'"`\n]*?)\1/g
let problems = 0

for (const file of walk(path.join(ROOT, 'packages')).concat(walk(path.join(ROOT, 'scripts')), walk(path.join(ROOT, 'tools')))) {
  const text = fs.readFileSync(file, 'utf8')
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    for (const m of line.matchAll(RE)) {
      const spec = m[2]
      if (/\$\{/.test(spec)) continue
      const abs = path.resolve(path.dirname(file), spec)
      if (fs.existsSync(abs)) continue
      const isComment = /^\s*(\/\/|\*|\/\*)/.test(line)
      problems += 1
      console.log(`${path.relative(ROOT, file)}:${i + 1}${isComment ? '  [注释]' : ''}\n   ${spec}  →  ${path.relative(ROOT, abs)}`)
    }
  }
}
console.log(`\n共 ${problems} 处相对路径指向不存在的文件。`)
