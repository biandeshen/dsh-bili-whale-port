/**
 * 旧代码引用表（删旧代码的施工依据，只读，不改一个字）。
 *
 *   node scripts/audit-legacy-refs.mjs [--json out.json] [--md out.md] [--quiet]
 *
 * 为什么要有这份东西：`core/ panel/ adapters/ tools/ vendor/` 是 DSH 插件时代的树，
 * 现在 live 是 Cortico 装载 `packages/`。但「看着像旧的」不等于「没人用」——
 * 删错一个文件的表现是门禁绿、线上也绿，直到某条只有旧线才有的能力（批量放行、带图动态）消失。
 * 所以删除前必须逐文件拿这张表，拿不出的不许删。
 *
 * 口径（写死，否则这表会变成一把软尺）：
 *  ① **注释里提一句不算引用**。第一版没区分，把 cap-bilibili 里「旧架构干这件事的是 core/scheduler.js」
 *     这类考古注释算成活引用，直接得出「core/ 不能删」的假结论。现在先扫注释区间，落在注释里的只进「提及」列。
 *  ② **path.join/resolve 的片段按整组解析**，不拿裸文件名去猜。第一版用后缀兜底，
 *     把 scripts/purge-acceptance-residue.mjs 自己写的 `path.join(qdir,'manifest.json')`
 *     误判成引用 `panel/assets/whale-girl/manifest.json`。猜不准的进「待人工确认」，不参与分层。
 *  ③ **无扩展名文件也算**（LICENSE / SHA256SUMS / NOTICE）：vendor 的许可证与校验清单被
 *     tests/vendor-video-studio.test.mjs 真读，漏掉它们会得出「T0 无人引用、可删」的违法结论。
 *  ④ 根分三种，混在一起会把「npm 入口指着它」误判成「运行时在用它」：
 *     pkg＝packages/** 源码（.md 不算）；entry＝package.json 与仓根 *.cmd/*.vbs；script＝npm scripts 点名的脚本。
 *     docs 与 tests 永远不当根、也不当桥：文档提一句、测试测一句，都不会让代码变活。
 *  ⑤ 分层：T1 被 packages 源码引（运行时真在用）／T2a 被活脚本引（npm scripts 往下可达，含 gates 链）
 *     ／T2b 只被退役入口或死脚本引／T3 只被测试引／T4 只被文档或注释提及／T0 无人引用。
 *     **T0/T4 不等于可删**：许可证、校验清单、以及「只有旧线才有的能力」要另行判定，见 --md 输出末尾。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d }
const has = (k) => process.argv.includes('--' + k)
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CAND_DIRS = ['core', 'panel', 'adapters', 'tools', 'vendor']
const SKIP = new Set(['node_modules', '.git', 'dist', 'dist-web', 'coverage', '.pnpm-store', 'data', 'days', 'runtime', 'local-resources', 'deployments', '.spike-home', 'spark-output', '.tmp'])
const TEXT_EXT = /\.(mjs|cjs|js|ts|tsx|json|md|html|css|txt|yml|yaml|cmd|vbs|jsonl|patch)$/i
const CODE_EXT = /\.(mjs|cjs|js|ts|tsx)$/i
const TOKEN_EXT = '(?:mjs|cjs|js|ts|tsx|json|md|html|css|png|jpg|jpeg|webp|gif|cmd|vbs|yml|yaml|txt|jsonl|mp3|wav|mp4|ttf|woff2?)'
const BARE_NAMES = new Set(['LICENSE', 'SHA256SUMS', 'NOTICE', 'README', 'CHANGELOG', 'VENDOR', 'AGENTS', 'QODER'])

const walk = (dir, out = []) => {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}
const rel = (p) => path.relative(REPO, p).replace(/\\/g, '/')

/** 注释区间（JS/TS 家族）：字符串/模板/正则里的 // 不算注释；正则用「前一个有效字符」启发式判定。 */
function commentRanges(text) {
  const ranges = []
  let i = 0, prev = ''
  const n = text.length
  while (i < n) {
    const c = text[i], c2 = text[i + 1]
    if (c === '"' || c === "'" || c === '`') {
      const q = c; i++
      while (i < n) { if (text[i] === '\\') { i += 2; continue } if (text[i] === q) { i++; break } i++ }
      prev = q; continue
    }
    if (c === '/' && c2 === '/') { const s = i; while (i < n && text[i] !== '\n') i++; ranges.push([s, i]); continue }
    if (c === '/' && c2 === '*') { const s = i; i += 2; while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++; i = Math.min(n, i + 2); ranges.push([s, i]); continue }
    if (c === '/' && /[(,=:[!&|?{};\n]/.test(prev || '\n')) {
      i++; let inClass = false
      while (i < n) { const d = text[i]; if (d === '\\') { i += 2; continue } if (d === '[') inClass = true; else if (d === ']') inClass = false; else if (d === '/' && !inClass) { i++; break } else if (d === '\n') break; i++ }
      prev = '/'; continue
    }
    if (!/\s/.test(c)) prev = c
    i++
  }
  return ranges
}
function lineCommentRanges(text, ext) {
  const ranges = []
  let off = 0
  for (const line of text.split('\n')) {
    const t = line.trimStart()
    const isC = /\.cmd$/i.test(ext) ? /^(rem\b|::)/i.test(t) : /\.vbs$/i.test(ext) ? t.startsWith("'") : /\.ya?ml$/i.test(ext) ? t.startsWith('#') : false
    if (isC) ranges.push([off, off + line.length])
    off += line.length + 1
  }
  return ranges
}
const inRanges = (ranges, pos) => ranges.some(([s, e]) => pos >= s && pos < e)

const all = walk(REPO)
const candidates = all.filter((p) => CAND_DIRS.includes(rel(p).split('/')[0]))
const candSet = new Set(candidates.map((p) => path.resolve(p)))
const candByRel = new Map(candidates.map((p) => [rel(p), path.resolve(p)]))
const textFiles = all.filter((p) => TEXT_EXT.test(p) && fs.statSync(p).size < 4_000_000)
const existsFile = (abs) => { try { return fs.statSync(abs).isFile() } catch { return false } }

// ── 根 ──────────────────────────────────────────────────────────────────────
const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'))
const rootKind = new Map()
const setRoot = (abs, kind) => { if (!rootKind.has(abs) || kind === 'pkg') rootKind.set(abs, kind) }
for (const p of all) if (rel(p).startsWith('packages/') && !/\.md$/i.test(p)) setRoot(path.resolve(p), 'pkg')
setRoot(path.resolve(REPO, 'package.json'), 'entry')
for (const p of all) if (/\.(cmd|vbs)$/i.test(p) && !rel(p).includes('/')) setRoot(path.resolve(p), 'entry')
const npmScripts = []
for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
  for (const m of String(cmd).matchAll(/([\w./-]+\.(?:mjs|js|ts|cmd|vbs))/g)) {
    const abs = path.resolve(REPO, m[1])
    if (existsFile(abs)) { setRoot(abs, 'script'); npmScripts.push(`${name} → ${m[1]}`) }
  }
}

// ── 引用边 ──────────────────────────────────────────────────────────────────
const edges = new Map()      // 确认：代码区、整组解析命中
const unconfirmed = new Map() // 待人工确认：裸文件名后缀猜中
const mentions = new Map()    // 注释区 / markdown 正文
const add = (map, t, r) => { if (!map.has(t)) map.set(t, new Set()); map.get(t).add(r) }

/** 直接解析：相对引用方 / 相对仓根；命中即确认。 */
function resolveDirect(token, referrer) {
  const t = token.split(/[?#]/)[0].trim().replace(/\\/g, '/')
  if (!t || t.includes('*') || /^[a-z]+:\/\//i.test(t) || t.startsWith('node:')) return []
  const bases = t.startsWith('.') ? [path.dirname(referrer), REPO] : [REPO, path.dirname(referrer)]
  const out = []
  for (const b of bases) { const abs = path.resolve(b, t); if (existsFile(abs)) out.push(abs) }
  return out
}
/** 片段拼法：只认「字面量能拼出仓内真实路径」，拼不出就不猜。 */
function resolveSegments(literals, referrer) {
  const out = []
  for (let i = 0; i < literals.length; i++) {
    const tail = literals.slice(i).join('/').replace(/\\/g, '/')
    if (!tail) continue
    for (const b of [REPO, path.dirname(referrer)]) {
      const abs = path.resolve(b, tail)
      if (existsFile(abs)) out.push(abs)
    }
    const hit = candByRel.get(tail)
    if (hit) out.push(hit)
  }
  return out
}

const RE_QUOTED = new RegExp(`['"\`]([^'"\`\\n]*?\\.${TOKEN_EXT})['"\`]`, 'g')
const RE_BARE_NAME = new RegExp(`['"\`](${[...BARE_NAMES].join('|')})['"\`]`, 'g')
const RE_IMPORT = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g
const RE_UNQUOTED = new RegExp(`(?:^|[\\s(=|&;])((?:[\\w.@-]+/)*[\\w.@-]+\\.${TOKEN_EXT})(?=$|[\\s)\\],;:'"\`])`, 'gm')
const RE_JOIN = /path\.(?:join|resolve)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g
const RE_LIT = /['"]([^'"]*)['"]/g

for (const f of textFiles) {
  const text = fs.readFileSync(f, 'utf8')
  const ext = path.extname(f)
  const isDoc = /\.md$/i.test(f) || rel(f).startsWith('docs/')
  const ranges = isDoc ? [[0, text.length]] : CODE_EXT.test(f) ? commentRanges(text) : lineCommentRanges(text, ext)
  const self = path.resolve(f)
  const seen = new Set()
  const record = (abs, isCode, confirmed) => {
    if (abs === self || !candSet.has(abs)) return
    const key = `${abs}|${isCode ? (confirmed ? 'e' : 'u') : 'm'}`
    if (seen.has(key)) return
    seen.add(key)
    add(isCode ? (confirmed ? edges : unconfirmed) : mentions, abs, self)
  }

  // path.join/resolve 整组
  for (const m of text.matchAll(RE_JOIN)) {
    const isCode = !inRanges(ranges, m.index)
    const literals = [...m[1].matchAll(RE_LIT)].map((x) => x[1]).filter((s) => s.length > 0)
    for (const abs of resolveSegments(literals, f)) record(abs, isCode, true)
  }
  // 带扩展名的引号 token / import / 裸路径
  for (const re of [RE_QUOTED, RE_IMPORT, RE_UNQUOTED, RE_BARE_NAME]) {
    re.lastIndex = 0
    for (const m of text.matchAll(re)) {
      const pos = m.index + m[0].indexOf(m[1])
      const isCode = !inRanges(ranges, pos)
      const direct = resolveDirect(m[1], f)
      if (direct.length) { for (const abs of direct) record(abs, isCode, true); continue }
      if (!isCode) continue
      // 裸文件名（无目录分隔）才允许进「待人工确认」，带目录的解析不到就是真不存在
      if (!m[1].includes('/') && !m[1].includes('\\')) {
        const norm = m[1].replace(/\\/g, '/')
        for (const [r, abs] of candByRel) if (r === norm || r.endsWith('/' + norm)) record(abs, true, false)
      }
    }
  }
}

// ── 可达性 ──────────────────────────────────────────────────────────────────
const cls = (abs) => {
  const r = rel(abs)
  if (/\.md$/i.test(r) || r.startsWith('docs/') || r.startsWith('spark-output/')) return 'doc'
  if (r.startsWith('tests/') || /\/test\//.test(r) || /\.test\./.test(r)) return 'test'
  if (r.startsWith('packages/')) return 'live'
  return 'script'
}
const rev = new Map()
for (const [target, refs] of edges) for (const r of refs) { if (!rev.has(r)) rev.set(r, new Set()); rev.get(r).add(target) }
const spread = (seed) => {
  const seen = new Set(), queue = [...seed]
  while (queue.length) {
    const cur = queue.pop()
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const target of rev.get(cur) ?? []) {
      const c = cls(target)
      if (c === 'doc' || c === 'test') continue
      if (!seen.has(target)) queue.push(target)
    }
  }
  return seen
}
const reachablePkg = spread([...rootKind].filter(([, k]) => k === 'pkg').map(([a]) => a))
// 刻意不含 entry：package.json 的 main/exports 与仓根 .cmd 是 DSH 插件时代的入口，
// 当活根会让 core/panel/adapters 整片「被活代码引」，掩盖它们已退役的事实。
const reachableOps = spread([...rootKind].filter(([, k]) => k === 'script').map(([a]) => a))

// ── 分层 ────────────────────────────────────────────────────────────────────
const rows = []
for (const c of candidates) {
  const abs = path.resolve(c)
  const refs = [...(edges.get(abs) ?? [])]
  const unconf = [...(unconfirmed.get(abs) ?? [])].filter((r) => !refs.includes(r))
  const men = [...(mentions.get(abs) ?? [])]
  const isDoc = (r) => cls(r) === 'doc'
  const isTest = (r) => cls(r) === 'test'
  const pkgRefs = refs.filter((r) => rel(r).startsWith('packages/') && !isDoc(r))
  const entryRefs = refs.filter((r) => rootKind.get(r) === 'entry')
  const scriptRefs = refs.filter((r) => cls(r) === 'script' && !entryRefs.includes(r))
  const opsRefs = scriptRefs.filter((r) => reachableOps.has(r))
  const testRefs = refs.filter(isTest)
  const docRefs = [...new Set([...refs.filter(isDoc), ...men])]
  const tier = reachablePkg.has(abs) ? 'T1'
    : opsRefs.length ? 'T2a'
    : (scriptRefs.length || entryRefs.length) ? 'T2b'
    : testRefs.length ? 'T3'
    : docRefs.length ? 'T4' : 'T0'
  rows.push({
    file: rel(c), tier, bytes: fs.statSync(c).size,
    isTest: /\.test\./.test(rel(c)) || /\/test\//.test(rel(c)),
    reachablePkg: reachablePkg.has(abs), reachableOps: reachableOps.has(abs),
    pkg: pkgRefs.map(rel), entry: entryRefs.map(rel), ops: opsRefs.map(rel),
    script: scriptRefs.map(rel), test: testRefs.map(rel), doc: docRefs.map(rel),
    unconfirmed: unconf.map(rel),
  })
}

const byTier = {}
for (const r of rows) (byTier[r.tier] ??= []).push(r)
const summary = {
  repo: REPO, candidates: rows.length, referrerFiles: textFiles.length,
  rootKinds: { pkg: [...rootKind.values()].filter((k) => k === 'pkg').length, entry: [...rootKind.values()].filter((k) => k === 'entry').length, script: [...rootKind.values()].filter((k) => k === 'script').length },
  tiers: Object.fromEntries(['T1', 'T2a', 'T2b', 'T3', 'T4', 'T0'].map((t) => [t, (byTier[t] ?? []).length])),
  unconfirmedPairs: rows.reduce((n, r) => n + r.unconfirmed.length, 0),
}
const TIERS = ['T1', 'T2a', 'T2b', 'T3', 'T4', 'T0']
const LEGEND = {
  T1: '被 packages 源码引 —— 运行时真在用，不许删',
  T2a: '被活脚本引（npm scripts 往下可达，含 gates 链）—— 删了门禁或运维就断',
  T2b: '只被退役入口（package.json main/exports、仓根 .cmd/.vbs）或死脚本引 —— 可删，但必须连带处理那些入口/脚本',
  T3: '只被测试引 —— 删文件必须同时处置那些测试，否则套件红',
  T4: '只被文档或注释提及 —— 可删；attic 里的提及不改写（那是当时的真相）',
  T0: '无人引用 —— 可删，但许可证/校验清单例外（vendor 的 LICENSE 与 SHA256SUMS 被测试真读，且删 vendored 代码必须留许可证）',
}

if (arg('json')) fs.writeFileSync(arg('json'), JSON.stringify({ summary, legend: LEGEND, npmScripts, rows }, null, 2))
if (arg('md')) {
  const L = [`# 旧代码引用表（只读分析，施工依据）`, '',
    `候选 ${rows.length} 文件（core/panel/adapters/tools/vendor）；引用方文本 ${textFiles.length} 份；根 ${summary.rootKinds.pkg} pkg + ${summary.rootKinds.entry} entry + ${summary.rootKinds.script} script。`, '',
    '分层：' + TIERS.map((t) => `${t}=${summary.tiers[t]}`).join(' · '), '',
    '**注释里提一句不算引用**；**path.join 片段按整组解析**，猜不准的进「待人工确认」不参与分层；**LICENSE/SHA256SUMS 这类无扩展名文件也算**。', '']
  for (const t of TIERS) {
    const list = byTier[t] ?? []
    L.push(`## ${t} —— ${list.length} 文件`, '', `> ${LEGEND[t]}`, '')
    if (!list.length) { L.push('（无）', ''); continue }
    L.push('| 文件 | packages 源码 | 活脚本(npm/gates) | 入口 | 其余脚本 | 测试 | 文档/注释 | 待人工确认 |', '|---|---|---|---|---|---|---|---|')
    for (const r of list) {
      const cap = (a, n = 4) => a.length ? a.slice(0, n).join('<br>') + (a.length > n ? `<br>…另 ${a.length - n}` : '') : '—'
      L.push(`| \`${r.file}\`${r.isTest ? ' (测试)' : ''} | ${cap(r.pkg)} | ${cap(r.ops)} | ${cap(r.entry, 2)} | ${cap(r.script)} | ${cap(r.test)} | ${cap(r.doc, 2)} | ${cap(r.unconfirmed, 3)} |`)
    }
    L.push('')
  }
  fs.writeFileSync(arg('md'), L.join('\n'))
}
if (!has('quiet')) {
  console.log(JSON.stringify(summary, null, 2))
  for (const t of TIERS) {
    const list = byTier[t] ?? []
    console.log(`\n== ${t} (${list.length}) ${LEGEND[t]} ==`)
    for (const r of list) console.log(`  ${r.file}  pkg=${r.pkg.length} ops=${r.ops.length} entry=${r.entry.length} script=${r.script.length} test=${r.test.length} doc=${r.doc.length}${r.unconfirmed.length ? ' 待确认=' + r.unconfirmed.length : ''}`)
  }
}