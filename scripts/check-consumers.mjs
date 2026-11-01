/**
 * 生产调用点检查：核心导出必须真的被非测试代码调用。
 * 防的是"写了但没接线"——三次外审抓到的都是这一类。
 *
 *   node scripts/check-consumers.mjs [--cortico <检出目录>]
 *
 * 落线之后功能在 `Cortico-up`（reanchor/replay），`Cortico` 只做 hotfix；
 * 默认查落线那一侧，临时要看 live 就用 --cortico ../Cortico 显式指定。
 */
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const argAt = process.argv.indexOf('--cortico')
const CORTICO = argAt > 0 && process.argv[argAt + 1]
  ? path.resolve(ROOT, process.argv[argAt + 1])
  : path.resolve(ROOT, '..', 'Cortico-up')

const TARGETS = [
  { symbol: 'buildText', home: ROOT },
  { symbol: 'composeDraft', home: ROOT },
  { symbol: 'buildVoiceBrief', home: CORTICO },
  { symbol: 'decideAction', home: CORTICO },
  { symbol: 'describeState', home: CORTICO },
  { symbol: 'readMood', home: CORTICO },
]

const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'dist-web', '.spike-home', 'deployments', 'runtime', 'local-resources', 'docs', 'days'])
const isTest = (p) => /(^|[\\/])tests?([\\/])/.test(p) || /\.test\.[cm]?[jt]s$/.test(p)

function walk(dir, out = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (SKIP_DIR.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(mjs|js|ts)$/.test(e.name)) out.push(p)
  }
  return out
}

const files = walk(ROOT).concat(walk(CORTICO)).filter((f) => !isTest(f))
let bad = 0
for (const { symbol, home } of TARGETS) {
  const hits = []
  for (const f of files) {
    if (!f.startsWith(home)) continue
    if (f.endsWith('check-consumers.mjs')) continue // 别把目标清单自身算成调用
    let src
    try { src = fs.readFileSync(f, 'utf8') } catch { continue }
    const re = new RegExp(`\\b${symbol}\\b`, 'g')
    const n = (src.match(re) || []).length
    if (n) hits.push({ file: path.relative(home, f).replace(/\\/g, '/'), n })
  }
  // 至少要有"定义 + 一处使用"或"两处使用"
  const ok = hits.length >= 2 || (hits.length === 1 && hits[0].n >= 2)
  console.log(`${ok ? 'OK      ' : 'UNUSED  '}${symbol}  ${hits.map((h) => `${h.file}(${h.n})`).join(', ') || '无任何引用'}`)
  if (!ok) bad++
}

console.log(`\n${bad === 0 ? '全部有生产调用' : bad + ' 个导出没有生产调用'}`)
process.exit(bad === 0 ? 0 : 1)
