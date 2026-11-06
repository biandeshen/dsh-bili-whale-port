/**
 * 状态文件到底在哪：一份**盘上事实**的账（只读，不改任何东西）。
 *
 *   node scripts/audit-state-locations.mjs [--json]
 *
 * 为什么要单开一支（2026-11-06 主人："先零成本的账搞清楚"）：
 * `check-state-roots.mjs` 那行「表里声明 24 类；调用点用了 12 类」看着像结论，
 * 其实是**门禁自己不会说话**——它只扫 `tools/core/panel/scripts` 四个旧目录，
 * 用的正则只认 `stateReadPath('x.json')` 这一种写法；
 * 她真正在跑的 `packages/` 那侧**根本不在扫描范围内**，
 * 所以"12 类"不是"只有 12 类有人在用"，是"旧 CLI 里能被我正则抓到的有 12 类"。
 * 拿这种数当结论说过一次就已经够错了，所以这里改成摆事实：
 *
 *   每个声明过的类 → 表里说谁写 → 三处目录（旧家 / 新家 / 部署侧）盘上到底有没有
 *                  → 旧 CLI 和能力包**分别**有几个调用点 → 判定
 *
 * 判定口径（每条都能被上面的数字复核，不许凭印象）：
 *   活-包         表里的路径在盘上，且能力包侧有调用点
 *   活-CLI        表里的路径在盘上，但只有旧 CLI 在调用（属退场清单）
 *   表外真身在写  表里的 write 路径**盘上根本没有**，可是她在别处真写着同名文件
 *                 ——这一类最要命：`check-state-roots` 查的是表里的路径，
 *                 于是它报的"没有绕过表 / 单写者"只覆盖旧 CLI 那一侧，看不见她的真实状态
 *   表路径盘上没有 按需创建（还没写过）或已死（没人调用），用调用点数区分，别一口咬定"死了"
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { legacyStateDir, stateDir, whaleHome } from '../tools/lib/paths.mjs'
import { kinds, resolve } from '../tools/lib/state-roots.mjs'
import { deployHome } from '../packages/cap-bilibili/src/platform/paths.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const asJson = process.argv.includes('--json')

function walk(dir, accept, out = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (['node_modules', '.git', 'dist'].includes(e.name)) continue
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) walk(abs, accept, out)
    else if (accept(e.name)) out.push(abs)
  }
  return out
}

/** 数调用点：分开数"旧 CLI 那侧"与"能力包那侧"，混在一起就没法说清谁还活着。 */
function callSites(kind) {
  const fileRe = new RegExp(`['"\`]${kind.replace(/[-]/g, '\\-')}\\.`, 'g')
  const kindRe = new RegExp(`(resolve|statePath|stateReadPath|writeStateText|stateExists)\\(\\s*['"\`]${kind.replace(/[-]/g, '\\-')}['"\`]`, 'g')
  const hit = (dirs) => {
    let n = 0
    const files = []
    for (const d of dirs) {
      for (const f of walk(path.join(ROOT, d), (name) => /\.(mjs|js|ts)$/.test(name) && !/\.test\./.test(name))) {
        const text = fs.readFileSync(f, 'utf8')
        if (kindRe.test(text) || fileRe.test(text)) { n += 1; files.push(path.relative(ROOT, f)) }
      }
    }
    return { n, files }
  }
  return {
    cli: hit(['tools', 'core', 'panel', 'scripts']),
    pkg: hit(['packages', 'adapters']),
  }
}

const whaleNew = stateDir()
const whaleOld = legacyStateDir()
const home = deployHome()
const deployData = [path.join(home, 'xiaoyu', 'data', 'bilibili'), path.join(home, 'data', 'bilibili')].find((d) => fs.existsSync(d)) ?? ''
// 她真正在写的这几处：表管的是 whale 侧，能力包与 persona 各写各的目录
const liveRoots = [
  [path.join(home, 'xiaoyu', 'data', 'bilibili'), '部署/bilibili'],
  [path.join(home, 'xiaoyu', 'data', 'persona'), '部署/persona'],
  [path.join(home, 'xiaoyu', 'data'), '部署/data'],
  [path.join(whaleHome, 'bili-whale'), 'whale/bili-whale'],
].filter(([d]) => fs.existsSync(d))

/** 短成 `—` 或 `11-06 13:10·845B`，让表格列宽撑得住（列错位就等于没有证据）。 */
function fmt(st) {
  if (!st) return '—'
  return `${st.mtime.slice(5, 10)} ${st.mtime.slice(11, 16)}·${st.bytes}B`
}

/** stat 一个路径（文件或目录都收）；目录用条目数当"体积"。 */
function statAny(p) {
  try {
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      return { mtime: st.mtime.toISOString(), bytes: fs.readdirSync(p).length, isDir: true }
    }
    return { mtime: st.mtime.toISOString(), bytes: st.size, isDir: false }
  } catch {
    return null
  }
}

/** 这个 kind 在某个目录下可能叫什么：表里写的名字 + `<kind>.json` + `<kind>.jsonl`（表里有好几类文件名与键名不一致）。 */
function candidateNames(kind, spec) {
  const fromTable = path.basename(spec.write)
  return [...new Set([fromTable, `${kind}.json`, `${kind}.jsonl`, kind])]
}

const rows = []
for (const kind of kinds()) {
  const spec = resolve(kind)
  const tableHit = statAny(spec.write)
  const names = candidateNames(kind, spec)
  // "她实际在写的那份"：在部署/persona、部署/bilibili、whale/bili-whale 里逐个试这些名字
  const liveHits = []
  for (const [dir, label] of liveRoots) {
    for (const n of names) {
      const st = statAny(path.join(dir, n))
      if (st) { liveHits.push({ label: `${label}/${n}`, ...st }); break }
    }
  }
  const sites = callSites(kind)
  const verdict = !tableHit && liveHits.length ? '表外真身在写'
    : !tableHit ? '表路径盘上没有'
      : sites.pkg.n > 0 ? '活-包'
        : sites.cli.n > 0 ? '活-CLI' : '表路径在、调用点抓不到'
  rows.push({
    kind,
    owner: spec.owner,
    write: spec.write,
    table: fmt(tableHit),
    cliSites: sites.cli.n,
    pkgSites: sites.pkg.n,
    live: liveHits.map((h) => `${h.label} ${fmt(h)}`).join(' / ') || '—',
    verdict,
    // 表里的 write 与她在写的那份不是同一个路径——门禁看不见她真实状态
    offTable: !tableHit && liveHits.length > 0,
  })
}

const noDisk = rows.filter((r) => r.verdict === '表路径盘上没有')
const cliOnly = rows.filter((r) => r.verdict === '活-CLI')
const alivePkg = rows.filter((r) => r.verdict === '活-包')
const offTable = rows.filter((r) => r.offTable)
/** 表里那份在盘上、她在写的又是另一份——同一个键两处有文件，最容易看错的就是这一类。 */
const clash = rows.filter((r) => r.table !== '—' && r.live !== '—')

if (asJson) {
  console.log(JSON.stringify({ whaleNew, whaleOld, deployData, liveRoots: liveRoots.map(([, l]) => l), rows }, null, 2))
} else {
  console.log(`# 状态文件落点账（只读）`)
  console.log(`  表管的两家：${whaleOld}（旧）/ ${whaleNew}（新）`)
  console.log(`  她还实际写在这些地方：${liveRoots.map(([, l]) => l).join(' / ') || '(一个都不存在)'}`)
  console.log(`\n  共 ${rows.length} 类：表路径在盘上 ${rows.length - noDisk.length} · 表路径盘上没有 ${noDisk.length}`
    + ` · 其中"表外真身在写" ${offTable.length} · 两处并存 ${clash.length} · 只剩旧 CLI ${cliOnly.length} · 包在用 ${alivePkg.length}\n`)
  const pad = (s, n) => String(s).padEnd(n)
  console.log(`  ${pad('类', 19)}${pad('写者', 15)}${pad('旧CLI/包', 9)}${pad('表里的路径', 18)}判定`)
  for (const r of rows) {
    console.log(`  ${pad(r.kind, 19)}${pad(r.owner, 15)}${pad(`${r.cliSites}/${r.pkgSites}`, 9)}`
      + `${pad(r.table, 18)}${r.verdict}${r.verdict === '表外真身在写' ? ' ⚠表看不见她' : ''}`)
    if (r.live !== '—' && (r.offTable || r.table !== '—')) console.log(`  ${pad('', 19)}└ 她实际在写：${r.live}`)
  }
  if (offTable.length) {
    console.log(`\n=== 表里路径不是她真正在写的那份（${offTable.length} 类）`)
    for (const r of offTable) console.log(`  - ${r.kind}：表指向 ${r.write}，实际在写 ${r.live}`)
    console.log(`  最坑的地方在这里：check-state-roots 查的是表里的路径，所以它报的`)
    console.log(`  "没有绕过表 / 单写者"**只覆盖旧 CLI 那一侧**，看不见能力包与 persona 的实际状态。`)
  }
  if (clash.length) {
    console.log(`\n=== 同一个键两处都有文件（${clash.length} 类，看之前先分清写者）`)
    for (const r of clash) console.log(`  - ${r.kind}：表里 ${r.table}｜她实际 ${r.live}`)
  }
  if (noDisk.length) {
    console.log(`\n=== 表里声明了、两处家里都没有（${noDisk.length} 类：按需创建 / 已死，看调用点数分）`)
    for (const r of noDisk) console.log(`  - ${r.kind}（owner=${r.owner}，调用点 旧CLI ${r.cliSites} / 包 ${r.pkgSites}）${r.live !== '—' ? `｜但她实际在写 ${r.live}` : ''}`)
  }
  if (cliOnly.length) {
    console.log(`\n=== 只剩旧 CLI 在用的（live 走能力包那侧，这些属退场清单）`)
    for (const r of cliOnly) console.log(`  - ${r.kind}：旧 CLI ${r.cliSites} 个调用点、能力包 0 个，表路径 ${r.table}`)
  }
  console.log(`\n口径说明：调用点是正则抓 resolve('kind') 与文件名两种写法数的，`)
  console.log(`  **只能用来分类，不能当"有没有人用"的结论**——真结论看 mtime：她那天有没有真的写过这份文件。`)
}
