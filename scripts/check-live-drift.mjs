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
  // 扫"哪个包带 persona/*.md"，不把包名写死：正本将来搬家或再加一份人设，这里不用跟着改
  const srcDirs = fs.readdirSync(path.join(REPO, 'packages'))
    .map((n) => path.join(REPO, 'packages', n, 'persona'))
    .filter((d) => fs.existsSync(d) && fs.readdirSync(d).some((f) => f.endsWith('.md')))
  if (!srcDirs.length) { bad('找不到任何人设正本目录（packages/*/persona/*.md）', '门禁本身要修'); return }
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

// ── 2) 源码工具清单 vs describe.json ───────────────────────────────────────
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
      lines.push('    修法：cd Cortico-up && pnpm describe:extension ../dsh-bili-whale/packages/' + name)
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
checkDescribe()
checkBundles()

if (VERBOSE) lines.push(`    部署家：${path.join(DEPLOY, BOT)}`)
console.log(lines.join('\n'))
console.log(failed ? `\n线上有 ${failed} 处漂移（只报不改，修不修由人决定）` : '\n没有漂移')
process.exitCode = failed ? 1 : 0
