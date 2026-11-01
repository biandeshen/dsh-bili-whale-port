/**
 * 动态发现并执行 .mjs 测试，断言「发现数 = 执行数」。
 *
 *   node scripts/run-mjs-tests.mjs                     # 本仓：tests/ + adapters/
 *   node scripts/run-mjs-tests.mjs --report docs/evidence/gates-2026-11-01.json
 *   node scripts/run-mjs-tests.mjs --root E:/WorkSpace_Qoder/Cortico --import tsx
 *
 * 为什么不用 package.json 里手写的文件清单：删掉一个测试文件，清单仍"自洽"，
 * 门禁会静默变绿。这里每次从磁盘重新发现。
 *
 * 为什么执行数不写 `files.length`：那等于"我传了几个就执行了几个"，同义反复，
 * 防不住改名、进 SKIP 名单、零断言空文件。现在从 node --test 的汇总里读真实计数，
 * 跟发现数对不上就判失败。`--report` 把整份结果落盘，文档只引路径不抄数字。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d }
const root = path.resolve(arg('root', process.cwd()))
const loader = arg('import', '') // 例如 tsx
const reportAt = arg('report', '')
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

console.log(`DISCOVERED=${files.length}`)
for (const f of files) console.log('  - ' + path.relative(root, f))

/**
 * 一个文件一个进程地跑。
 *
 * 为什么不用一次 `node --test <全部文件>`：那个模式只给整批的汇总，"哪个文件没跑起来"
 * 只能靠猜，`EXECUTED = files.length` 是传参算的、同义反复。单文件跑会拿到它自己的
 * 退出码与计数，于是"发现 72 个、跑成 72 个"是真的比出来的，不是我说它跑了。
 * 代价是慢一点——门禁本来就不该图快。
 */
const startedAt = new Date()
const perFile = []
let out = ''
for (const file of files) {
  const rel = path.relative(root, file)
  const r = spawnSync(process.execPath, [...nodeArgs, '--test', file], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const text = `${r.stdout ?? ''}${r.stderr ?? ''}`
  out += text
  const pick = (label) => {
    const m = new RegExp(`^ℹ ${label} (\\d+)$`, 'm').exec(text)
    return m ? Number(m[1]) : null
  }
  const item = {
    file: rel,
    exit: r.status ?? 1,
    tests: pick('tests'), pass: pick('pass'), fail: pick('fail'),
    // 一个文件正常跑完必然至少有 tests 计数；没有就是它没被当成测试文件执行
    // （改名骗过发现、空文件、被 skip 名单挡住都会落到这里）。
    ran: pick('tests') !== null,
  }
  perFile.push(item)
  const mark = item.exit === 0 && item.ran ? '✔' : '✖'
  console.log(`${mark} ${rel}  tests=${item.tests ?? '?'} fail=${item.fail ?? '?'}`)
  if (item.exit !== 0) process.stdout.write(text)
}

const sum = (k) => perFile.reduce((n, x) => n + (x[k] ?? 0), 0)
const counts = { tests: sum('tests'), pass: sum('pass'), fail: sum('fail') }
const executed = perFile.filter((x) => x.ran).length
const notRun = perFile.filter((x) => !x.ran).map((x) => x.file)
const failed = perFile.filter((x) => x.exit !== 0)
const code = failed.length ? 1 : 0

console.log('')
console.log(`EXECUTED=${executed}/${files.length}`)
console.log(`COUNTS tests=${counts.tests} pass=${counts.pass} fail=${counts.fail}`)
if (notRun.length) console.log(`NOT_RUN=${notRun.join(', ')}`)

const mismatch = executed !== files.length || counts.tests === 0

if (reportAt) {
  const target = path.isAbsolute(reportAt) ? reportAt : path.join(root, reportAt)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, JSON.stringify({
    at: startedAt.toISOString(),
    root,
    exit: code,
    discovered: files.length,
    executed,
    counts,
    mismatch,
    notRun,
    files: perFile,
  }, null, 2) + '\n')
  console.log(`REPORT=${target}`)
}

if (code !== 0) {
  console.error(`FAILED：${failed.length} 个文件不为 0`)
  process.exit(1)
}
if (mismatch) {
  console.error('FAILED：有文件没被当成测试跑起来（或一条断言都没有）——这类"绿"不算数。')
  process.exit(1)
}
