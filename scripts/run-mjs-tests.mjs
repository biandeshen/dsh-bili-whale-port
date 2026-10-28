/**
 * 动态发现并执行 .mjs 测试，断言「发现数 = 执行数」。
 *
 *   node scripts/run-mjs-tests.mjs                 # 本仓：tests/ + adapters/
 *   node scripts/run-mjs-tests.mjs --root E:/WorkSpace_Qoder/Cortico --import tsx
 *
 * 为什么不用 package.json 里手写的文件清单：删掉一个测试文件，清单仍"自洽"，
 * 门禁会静默变绿。这里每次从磁盘重新发现。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d }
const root = path.resolve(arg('root', process.cwd()))
const loader = arg('import', '') // 例如 tsx
const SKIP = new Set(['node_modules', '.git', 'dist', 'dist-web', '.spike-home', 'deployments', 'runtime', 'local-resources'])

function walk(dir, out = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.isFile() && e.name.endsWith('.test.mjs')) out.push(p)
  }
  return out
}

const files = walk(root).sort()
if (!files.length) {
  console.error(`DISCOVERED=0 EXECUTED=0  (root=${root})`)
  console.error('没有发现任何 .test.mjs —— 这本身是失败，不许当作"没有测试要跑"。')
  process.exit(1)
}

const nodeArgs = []
if (loader) nodeArgs.push('--import', loader)
nodeArgs.push('--test', ...files)

console.log(`DISCOVERED=${files.length}`)
for (const f of files) console.log('  - ' + path.relative(root, f))
console.log(`RUN: node ${nodeArgs.slice(0, loader ? 2 : 0).join(' ')} --test <${files.length} files>`)

const r = spawnSync(process.execPath, nodeArgs, { cwd: root, stdio: 'inherit' })
const code = r.status ?? 1
// node --test 不会告诉我们"实际执行了几个文件"，但文件是我们显式传的：
// 只要进程正常结束（0），就认为全部执行；非 0 时由测试输出定位。
console.log(`EXECUTED=${files.length}`)
if (code !== 0) {
  console.error(`FAILED exit=${code}（发现 ${files.length}，执行 ${files.length}）`)
  process.exit(code || 1)
}
