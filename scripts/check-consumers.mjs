/**
 * 生产调用点检查：核心导出必须真的被非测试代码调用。
 * 防的是"写了但没接线"——三次外审抓到的都是这一类。
 *
 *   node scripts/check-consumers.mjs [--cortico <检出目录>]
 *
 * 默认查 live 那棵检出（仓库同级的 `Cortico-up`）；要查别的检出用 --cortico <目录> 显式指定。
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
  // 下面四个的 home 原先是 CORTICO（宿主检出）。2026-11-19 宿主 legacy 整域退役后，
  // 宿主侧再也没有它们的调用点，于是门禁报 UNUSED——但这是**指错了树**：
  // 它们的真实调用者一直在这边（decideAction→cortico-persona.ts、describeState/readMood
  // →cap-state-rhythm、buildVoiceBrief→counterfactual.mjs/preview-recall.mjs）。
  // 唯一一份 persona-core 已在本仓（#88），所以判据应该看本仓。
  { symbol: 'buildVoiceBrief', home: ROOT },
  { symbol: 'decideAction', home: ROOT },
  { symbol: 'describeState', home: ROOT },
  { symbol: 'readMood', home: ROOT },
]

// `host`：宿主 Cortico 收编目录（#89），它的消费关系由宿主自己的门禁管。
const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'dist-web', '.spike-home', 'deployments', 'runtime', 'local-resources', 'docs', 'days', 'host'])
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
