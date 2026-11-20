/**
 * 线上漂移门禁：查"代码对了，线上还是旧的"。
 *
 * 为什么加这个（2026-11-04 一天内踩了两次，都是靠人想起来才发现的）：
 *   ① describe.json 要手动重导——今天 bot 那份还写着 10 个工具（缺 see_video）、
 *      world 那份 16 个（缺 bili_watch），线上日志一直 warn「工具不在 describe.tools 里,照常生效」。
 *   ② 部署目录里的人设副本要手动拷——`~/.xiaoyu-home/xiaoyu/prompts/ORIENTATION.md`
 *      还是昨天那份，没有"什么时候该看画面"。她手里有新工具却不知道什么时候用，
 *      这跟没给她工具一样；而所有单测都是绿的。
 * 这两处都不在门禁里，所以它们坏了没人报警。现在进来。
 *
 *   node scripts/check-live-drift.mjs            # 只判，不改任何东西
 *   node scripts/check-live-drift.mjs --verbose  # 顺带把每份文件的字节数与时间打出来
 *
 * 只读脚本：不写部署目录、不跑 build、不碰 B 站。修不修由人决定，这里只负责说出来。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'

const REPO = path.resolve(process.env.DRIFT_REPO || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'))
const HOME = process.env.USERPROFILE || process.env.HOME || homedir()
const DEPLOY = process.env.CORTICO_HOME || path.join(HOME, '.xiaoyu-home')
const BOT = process.env.CORTICO_BOT || 'xiaoyu'
const VERBOSE = process.argv.includes('--verbose')

const lines = []
let failed = 0
const ok = (n, d) => lines.push(`✓ ${n}${d ? '：' + d : ''}`)
const warn = (n, d) => lines.push(`· ${n}${d ? '：' + d : ''}`)
const bad = (n, d) => { lines.push(`✗ ${n}${d ? '：' + d : ''}`); failed += 1 }

// ── 1) 人设正本 vs 部署副本 ────────────────────────────────────────────────
function checkPrompts() {
  const liveDir = path.join(DEPLOY, BOT, 'prompts')
  // 扫"哪个包带 persona/*.md"，不把包名写死：正本将来搬家或再加一份人设，这里不用跟着改。
  // 2026-11-19 #90 分层后 packages 不再平铺（kernel/ capabilities/ adapters/ shared/），
  // 所以这里递归找，而不是 `packages/*/persona`——那样分层之后一个都找不到，门禁自己对但报不到正本。
  const srcDirs = []
  const findPersonaDirs = (dir) => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === 'node_modules' || e.name === 'dist') continue
      const p = path.join(dir, e.name)
      if (e.name === 'persona' && fs.readdirSync(p).some((f) => f.endsWith('.md'))) { srcDirs.push(p); continue }
      findPersonaDirs(p)
    }
  }
  findPersonaDirs(path.join(REPO, 'packages'))
  if (!srcDirs.length) { bad('找不到任何人设正本目录（packages/**/persona/*.md）', '门禁本身要修'); return }
  if (!fs.existsSync(liveDir)) { bad('部署 prompts 目录不存在', `${liveDir}（她正在用旧家还是新家？）`); return }
  for (const srcDir of srcDirs) {
    for (const name of fs.readdirSync(srcDir).filter((f) => f.endsWith('.md'))) {
      const srcFile = path.join(srcDir, name)
      const liveFile = path.join(liveDir, name)
      const src = fs.readFileSync(srcFile, 'utf8')
      if (!fs.existsSync(liveFile)) {
        bad(`部署缺 ${name}`, `仓库正本来没这份，她自己也没写过覆盖版 → 现在读的是包内默认，改正本不生效`)
        continue
      }
      const live = fs.readFileSync(liveFile, 'utf8')
      if (live === src) { ok(`部署 ${name} 与正本一致`, `${Buffer.byteLength(src)} B`); continue }
      const srcM = fs.statSync(srcFile).mtimeMs
      const liveM = fs.statSync(liveFile).mtimeMs
      if (srcM > liveM) {
        bad(`部署 ${name} 落后于仓库正本`,
          `正本 ${new Date(srcM).toISOString().slice(0, 16)} 比部署 ${new Date(liveM).toISOString().slice(0, 16)} 新——`
          + '改了没搬过去，她带着旧脑子过日子（personaText 每次读文件，下一轮生效，不用重启）')
      } else {
        warn(`部署 ${name} 比仓库正本新`, '主人可能在页面上直接改过：这是她的家的权威版本，需要回写仓库正本再说，别反向覆盖')
      }
      if (VERBOSE) {
        const a = src.split('\n'), b = live.split('\n')
        lines.push(`    行数 正本 ${a.length} / 部署 ${b.length}；首处不同行号约 ${a.findIndex((l, i) => l !== b[i]) + 1}`)
      }
    }
  }
}

// ── 2) 两份 persona-core：说清哪份是活的 ───────────────────────────────────
/**
 * **同名不同源的两份 persona-core**（2026-11-06 实锤）：
 *   · **仓库这份（活的）**：`packages/persona-core/src/` —— 能力包（cap-state-rhythm 等）
 *     用相对路径 import 的是它，**线上 live 跑的就是它**。B14 的节奏常量
 *     （CHECK_PROB 0.35 / 30–90s / 恢复 0.02/h / 行动开销 0.015）改在这里才生效。
 *   · **宿主那份（另一条链）**：`Cortico-up/persona-core/src/` —— 宿主自带 world 用的副本，
 *     连 import 扩展名都不同（`.js`）。我们没挂那些 world，**当前不参与她的行为**。
 *
 * 这次就栽在"改错份"上：预算配额改在仓库那份时线上没生效（后来发现真正的原因另有一说，
 * 但同名两份本身就是要防的坑）。所以门禁现在**明确指出哪份是活的**，并只在两份
 * 都参与同一条链时才要求一致——否则只报差异、不报错（免得天天报一个不影响行为的差异）。
 */
function checkPersonaCore() {
  const hostRoot = process.env.CORTICO_ROOT || path.join(REPO, 'host', 'cortico')
  const mine = path.join(REPO, 'packages', 'kernel', 'persona-core')
  const theirs = path.join(hostRoot, 'persona-core')
  if (!fs.existsSync(theirs)) {
    ok('宿主 persona-core 不存在', '只有一份，链路唯一')
    return
  }
  /**
   * 宿主那份是否被我们的链**真的 import**（不是注释里提了一嘴）。
   *
   * 2026-11-19 修：原来只做 `text.includes('Cortico-up')`，于是
   * `cortico-bot-xiaoyu/src/session-rotation.ts:19` 在那段「上游类型里没有 createSession」
   * 的说明注释里写了 `Cortico-up/src/core/types.ts:530` 这个出处，就被判成
   * "我们的链引了宿主树" → 走"必须逐字对齐"分支 → 天天报一条节奏常量假警，
   * 而那条常量差异按设计就该存在（宿主副本已删，见 #88）。
   * 判据改成**只认 `from '…'` / `import('…')` 里出现宿主路径**的行。
   */
  const IMPORT_HOST_RE = /(?:\bfrom\s*|\bimport\s*\(\s*)['"][^'"]*Cortico-up[^'"]*['"]/
  let linked = false
  const pkgDir = path.join(REPO, 'packages')
  for (const name of fs.readdirSync(pkgDir)) {
    const srcDir = path.join(pkgDir, name, 'src')
    if (!fs.existsSync(srcDir)) continue
    for (const f of fs.readdirSync(srcDir)) {
      if (!f.endsWith('.ts')) continue
      const text = fs.readFileSync(path.join(srcDir, f), 'utf8')
      if (IMPORT_HOST_RE.test(text)) { linked = true; break }
    }
    if (linked) break
  }
  if (!linked) {
    /**
     * 防二次分叉（#88，2026-11-19）。
     *
     * 唯一一份 `@xiaoyu/persona-core` 在 `packages/persona-core`。宿主那份已于 2026-11-19 删除
     * （处置表：`docs/evidence/host-persona-core-disposition.md`）——它当时是严格子集，
     * 且 `rhythm.ts` 停在 B14 之前的旧常量，`scripts/check-live-drift.mjs` 实测抓到过
     * `ACTION_COST_ENERGY 0.05 vs 0.015`、`3–7 分钟 vs 30–90 秒`。
     *
     * 所以这里默认**判失败**：宿主树里再冒出一份 `persona-core/` 就是又长出了第二个真相，
     * 而这一轮修掉的正是不知不觉改错份。确实需要保留时，用
     * `CORTICO_ALLOW_HOST_PERSONA_CORE=1` 显式放行（默认拒绝、显式开关），
     * 并在处置表里写明理由与同步方式。
     */
    if (process.env.CORTICO_ALLOW_HOST_PERSONA_CORE === '1') {
      warn('宿主有一份 persona-core（已显式放行）', `${theirs}｜放行者须保证它与 packages/persona-core 逐字同步，否则先删`)
    } else {
      bad('宿主又出现一份 persona-core（第二份真相）',
        `${theirs}｜唯一一份应在 packages/persona-core；删掉它，或设 CORTICO_ALLOW_HOST_PERSONA_CORE=1 显式放行并记录理由`)
    }
    // 补一条当日预算余额的提醒：**改预算代码不会重置当日余额**。
    // 2026-11-06 实锤：budget.ts 08:57 就改成不限了，但 12:47 重启后 energy 仍冻结在
    // 0.807——当时 fields.json 里的 budget.spent['action|energy'] 当天已花满 0.2，
    // 余额为 0 就不允许再生效（换日才清零）。看起来像"改了没生效"，其实是"余额没了"。
    // 注意：**只看有上限的来源**——action/rest 改成不限后，spent 里的旧值是历史残留，
    // 不再截断也不该报（否则天天报一个不成立的警报）。
    const fields = path.join(DEPLOY, BOT, 'data', 'persona', 'fields.json')
    try {
      const st = JSON.parse(fs.readFileSync(fields, 'utf8'))
      const spent = st?.budget?.spent ?? {}
      const day = st?.budget?.day
      const caps = readSourceCaps(path.join(REPO, 'packages', 'kernel', 'persona-core', 'src', 'budget.ts'))
      const frozen = Object.entries(spent).filter(([k, v]) => {
        const src = String(k).split('|')[0]
        const cap = caps[src]
        return cap !== undefined && Number.isFinite(cap) && Number(v) >= cap - 1e-9
      })
      if (frozen.length) {
        warn(`当日预算余额已用尽（${day}）`, frozen.map(([k, v]) => `${k}=${Number(v).toFixed(2)}`).join(' ')
          + '｜改预算代码不会重置它，要等换日（或手动清 ledger）')
      } else {
        const finite = Object.entries(spent).filter(([k]) => {
          const src = String(k).split('|')[0]
          const cap = caps[src]
          return cap !== undefined && Number.isFinite(cap)
        })
        ok('当日预算余额未用尽', day
          ? (finite.length ? finite.map(([k, v]) => `${k}=${Number(v).toFixed(2)}`).join(' ') : '无受限来源的支出')
          : '无账')
      }
    } catch { /* 读不到就不报 */ }
    return
  }
  // 一旦将来真把两份接进同一条链，就必须逐字对齐
  const read = (p, re) => {
    const out = []
    for (const m of fs.readFileSync(p, 'utf8').matchAll(re)) out.push(`${m[1]}=${String(m[2]).trim()}`)
    return out.sort()
  }
  for (const { file, re, label } of PERSONA_CORE_CONSTS) {
    const a = path.join(mine, file)
    const b = path.join(theirs, file)
    if (!fs.existsSync(a) || !fs.existsSync(b)) continue
    const av = read(a, re)
    const bv = read(b, re)
    if (av.join('|') === bv.join('|')) ok(`两份 persona-core 的${label}一致`, av.join(' '))
    else bad(`两份 persona-core 的${label}不一致（同一条链，必须逐字对齐）`, `仓库：${av.join(' ')}｜宿主：${bv.join(' ')}`)
  }
}

// ── 3) 源码工具清单 vs describe.json ───────────────────────────────────────
const PERSONA_CORE_CONSTS = [
  { file: 'src/budget.ts', re: /^\s*(rest|action|custom|watched):\s*([^,\n]+),/gm, label: '来源日预算' },
  { file: 'src/rhythm.ts', re: /export const (CHECK_PROB|REST_RECOVERY_PER_HOUR|ACTION_COST_ENERGY|NEXT_CHECK_MIN_MS|NEXT_CHECK_MAX_MS)\s*=\s*([^;\n]+)/gm, label: '节奏常量' },
]

/** 读 budget.ts 里的来源上限（UNLIMITED 的返回 Infinity）。 */
function readSourceCaps(file) {
  const out = {}
  try {
    const text = fs.readFileSync(file, 'utf8')
    for (const m of text.matchAll(/^\s*([A-Za-z-]+):\s*([^,\n]+),/gm)) {
      const raw = m[2].trim()
      out[m[1]] = raw === 'UNLIMITED' ? Number.POSITIVE_INFINITY : Number(raw)
    }
  } catch { /* 读不到就当没有上限 */ }
  return out
}

function summarizeKeys(file) {
  const text = fs.readFileSync(file, 'utf8')
  const start = text.indexOf('const TOOL_SUMMARIES')
  if (start < 0) return null
  const open = text.indexOf('{', start)
  let depth = 0
  let end = -1
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break } }
  }
  if (end < 0) return null
  const block = text.slice(open + 1, end)
  return [...block.matchAll(/^\s*([A-Za-z_][\w]*)\s*:/gm)].map((m) => m[1])
}

function checkDescribe() {
  const pkgDir = path.join(REPO, 'packages')
  for (const name of fs.readdirSync(pkgDir)) {
    const dir = path.join(pkgDir, name)
    const dj = path.join(dir, 'describe.json')
    if (!fs.existsSync(dj)) continue
    const srcFiles = []
    const srcDir = path.join(dir, 'src')
    if (fs.existsSync(srcDir)) for (const f of fs.readdirSync(srcDir)) if (f.endsWith('.ts')) srcFiles.push(path.join(srcDir, f))
    let keys = null
    let from = ''
    for (const f of srcFiles) {
      const k = summarizeKeys(f)
      if (k) { keys = k; from = path.relative(REPO, f); break }
    }
    if (!keys) { warn(`${name} describe.json 没有可比对的源码清单`, '（工具清单不是从 TOOL_SUMMARIES 生成的，跳过）'); continue }
    const declared = JSON.parse(fs.readFileSync(dj, 'utf8')).tools ?? []
    const have = declared.map((t) => t.name)
    const missing = keys.filter((k) => !have.includes(k))
    const stale = have.filter((h) => !keys.includes(h))
    if (!missing.length && !stale.length) { ok(`${name} describe.json 与源码一致`, `${have.length} 个工具`) }
    else {
      bad(`${name} describe.json 过期`,
        (missing.length ? `缺 ${missing.join(',')}` : '') + (missing.length && stale.length ? '；' : '') +
        (stale.length ? `多 ${stale.join(',')}（源码里已没有）` : ''))
      lines.push('    修法：cd host/cortico && pnpm describe:extension ../../packages/' + name)
    }
  }
}

// ── 3) webui 产物是否比"打进包里的那些源码"旧 ────────────────────────────
/**
 * 不能拿"整个 src 目录的最新 mtime"来判：bundle 只打 client.ts 的**导入闭包**，
 * 而 client.ts 之外的那些文件（能力包的 index.ts、persona 的适配层）改了不影响产物。
 * 上一版这么写，一次报了 4 处漂移，其中 3 处是假的——假漂移和假阳性一样坏，
 * 它教人把这个门禁的输出划过去。
 */
function bundleClosure(entry) {
  const seen = new Set()
  const stack = [entry]
  while (stack.length) {
    const f = stack.pop()
    const abs = path.resolve(f)
    if (seen.has(abs) || !fs.existsSync(abs)) continue
    seen.add(abs)
    let text = ''
    try { text = fs.readFileSync(abs, 'utf8') } catch { continue }
    for (const m of text.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      stack.push(path.resolve(path.dirname(abs), m[1]))
    }
  }
  return [...seen]
}

function checkBundles() {
  const pkgDir = path.join(REPO, 'packages')
  for (const name of fs.readdirSync(pkgDir)) {
    const dir = path.join(pkgDir, name)
    const entry = path.join(dir, 'src', 'webui', 'client.ts')
    const out = path.join(dir, 'dist', 'webui.js')
    if (!fs.existsSync(entry)) continue
    if (!fs.existsSync(out)) { bad(`${name} 缺 webui 产物`, '跑 node scripts/build-webui.mjs'); continue }
    const outM = fs.statSync(out).mtimeMs
    const closure = bundleClosure(entry)
    let newest = 0
    let newestFile = ''
    for (const f of closure) {
      const m = fs.statSync(f).mtimeMs
      if (m > newest) { newest = m; newestFile = f }
    }
    if (newest > outM) {
      bad(`${name} 的 webui 产物比源码旧`, `${path.relative(REPO, newestFile)} 更新后没重跑 build-webui（产物里还是上一版控件）`)
    } else ok(`${name} webui 产物是新的`, `${fs.statSync(out).size} B，闭包 ${closure.length} 个文件`)
  }
}

// ── 主流程 ────────────────────────────────────────────────────────────────
checkPrompts()
checkPersonaCore()
checkDescribe()
checkBundles()

if (VERBOSE) lines.push(`    部署家：${path.join(DEPLOY, BOT)}`)
console.log(lines.join('\n'))
console.log(failed ? `\n线上有 ${failed} 处漂移（只报不改，修不修由人决定）` : '\n没有漂移')
process.exitCode = failed ? 1 : 0
