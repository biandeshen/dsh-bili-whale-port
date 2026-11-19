/**
 * 脚本路径门禁：脚本里指向**仓内**的路径必须真的存在。
 *
 *   node scripts/check-script-paths.mjs [--json] [--root <目录>]
 *
 * 为什么要有它：删旧代码的表现不是报错，是「门禁绿、线上也绿，直到某天有人跑那条脚本」。
 * 已有 check-doc-hygiene R2 管文档里的引用，这一条管**代码与启动器**里的引用：
 * `.mjs/.cmd/.vbs` 里写着的仓内路径，指向的文件没了就是红。
 *
 * 口径（写死，否则它会变成一把只会喊狼来的尺）：
 *  ① 只管**仓内**路径。home、`D:/AI/养鱼`、tmp、宿主检出（`../Cortico-up`）都不管——
 *     那些是运行时数据或别的仓，本机不存在不等于违规（换台机器跑就是一片假红）。
 *     `data/` 也不管：本仓根本没有 data/ 目录，它是部署家里的运行时目录。
 *  ② 相对 import/require 一律查，且允许省略扩展名（按 .ts/.tsx/.mjs/.js/index.* 补一次）。
 *     这是最强的一条：import 不到的文件就是坏代码，没有解释空间。
 *  ③ **写目标不算违规**：同一行出现 writeFileSync/mkdirSync/createWriteStream/rmSync/`>` 重定向等，
 *     说明这个路径是要被创建/删除的，此刻不存在是正常的。这类计「未核」并打印出来，不静默放行。
 *  ④ 注释里的路径**只在用法示例语境下算**（`node …` / `npm run …` / `cd …` / 「用法」）：
 *     要防的风险是「照着注释里的示例跑就会跑错」。散文式提及不算——
 *     tests/perm-tier.test.mjs 的注释正是在记录「案卷写的 tools/go-gate.mjs 从来没存在过」，
 *     那是负结果，判它红等于逼人改掉一条正确的历史记录。这类同样计「未核」并打印。
 *     markdown 文档不在本门禁范围（那是 check-doc-hygiene R2 的活）。
 *  ⑤ 含 `${`、`*`、`<` 的模板/通配路径跳过：那是运行时才成形的字符串。
 *  ⑥ **模板字符串内部**与**夹具键名**（`'<假文件名>': …`）不算引用：
 *     前者是塞进临时仓的假文件内容或运行时拼出的命令，后者是在给假文件起名，都不指向本仓。
 *     两者计「未核」并打印，不静默放行。
 *  ⑦ path.join/resolve 只在**第一个参数是仓根标识**（ROOT/REPO/__dirname/import.meta.dirname）时解析，
 *     且只取**连续的字面量参数**，遇到变量就停。否则 `path.join(DEPLOY,'data','fields.json')`
 *     会被当成仓内路径、`path.join(ROOT,'packages',pkg,'src','index.ts')` 会被拼成 packages/src/index.ts。
 *     字面量里再含引号（`'tools/commands/'+cmd+'.mjs'`）就不是字面量，停。
 *  ⑧ **比较型断言的期望值**（assert.equal/match 等，且同行没有 fs/path 调用）不算引用：
 *     那是在比对夹具产出的文件名字符串，不是在打开路径。assert.ok(fs.existsSync(…)) 仍算。
 *  ⑨ 用法示例注释里的**裸路径**（没引号）也算：`// 用法：node scripts/x.mjs` 照着跑就会跑错。
 *     前后紧贴引号/斜杠/词字符的 token 跳过（前者交给 R2，后者是更长的仓外路径的一段）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d }
const REPO = path.resolve(arg('root', path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')))
const asJson = process.argv.includes('--json')

const SCAN_DIRS = ['scripts', 'tools', 'tests', 'packages', 'adapters', 'core', 'panel', 'vendor']
// `host`：宿主 Cortico 收编目录（#89），它自己的脚本路径规矩由宿主那套管。
const SKIP = new Set(['node_modules', '.git', 'dist', 'dist-web', 'coverage', '.pnpm-store', 'data', 'days', 'runtime', 'local-resources', 'deployments', '.spike-home', 'spark-output', 'docs', 'attic', 'host'])
const EXT = /\.(mjs|cjs|js|ts|tsx|cmd|vbs)$/i
const REPO_DIRS = ['scripts', 'tools', 'tests', 'packages', 'adapters', 'core', 'panel', 'vendor', 'docs', 'assets']
const PATH_EXT = '(?:mjs|cjs|js|ts|tsx|json|html|css|cmd|vbs|yml|yaml|md|png|jpg|txt)'
const WRITE_RE = /writeFileSync|appendFileSync|mkdirSync|createWriteStream|rmSync|unlinkSync|writeFile|appendFile|mkdir|rm\s|>\s*|outFile|outfile|--report|--out\b|copyFileSync|renameSync/
const USAGE_RE = /\bnode\b|\bnpm\b|\bnpx\b|\bcd\b|用法|运行：|执行：|\$\s/
const ASSERT_CMP_RE = /\bassert\.(?:equal|strictEqual|deepStrictEqual|notEqual|notStrictEqual|match|doesNotMatch)\s*\(/
const FS_CALL_RE = /\b(?:fs|path)\.|existsSync|readFileSync|readdirSync|spawnSync|execFileSync/
const ROOT_IDS = /^(?:ROOT|REPO|repoRoot|root)$/
const MAX_BYTES = 2_000_000

const walk = (dir, out = []) => {
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (EXT.test(e.name)) out.push(p)
  }
  return out
}
const files = [...SCAN_DIRS.flatMap((d) => walk(path.join(REPO, d))),
  ...fs.readdirSync(REPO).filter((f) => /\.(mjs|cjs|js|cmd|vbs)$/i.test(f)).map((f) => path.join(REPO, f))]
const rel = (p) => path.relative(REPO, p).replace(/\\/g, '/')
const exists = (abs) => { try { return fs.statSync(abs).isFile() } catch { return false } }
const isDir = (abs) => { try { return fs.statSync(abs).isDirectory() } catch { return false } }

/** 省略扩展名的 import：按 Node/tsx 的解析顺序补一次。 */
function resolveImport(spec, fromFile) {
  const base = path.resolve(path.dirname(fromFile), spec)
  if (exists(base)) return true
  for (const ext of ['.ts', '.tsx', '.mjs', '.js', '.cjs', '.json']) if (exists(base + ext)) return true
  if (isDir(base)) for (const ext of ['.ts', '.tsx', '.mjs', '.js', '.cjs', '.json']) if (exists(path.join(base, 'index' + ext))) return true
  return false
}

/** JS/TS 词法区间：注释 + 模板字符串（含 ${} 里的嵌套）。正则用「前一个有效字符」启发式判定。 */
function jsRanges(text) {
  const comments = [], templates = []
  let i = 0, prev = ''
  const n = text.length
  const skipString = (q) => { i++; while (i < n) { if (text[i] === '\\') { i += 2; continue } if (text[i] === q) { i++; break } i++ } }
  const skipTemplate = (start) => {
    i++
    while (i < n) {
      if (text[i] === '\\') { i += 2; continue }
      if (text[i] === '`') { i++; break }
      if (text[i] === '$' && text[i + 1] === '{') {
        i += 2
        let depth = 1
        while (i < n && depth > 0) {
          const c = text[i]
          if (c === '\\') { i += 2; continue }
          if (c === '"' || c === "'") { skipString(c); continue }
          if (c === '`') { skipTemplate(i); continue }
          if (c === '{') depth++
          else if (c === '}') depth--
          i++
        }
        continue
      }
      i++
    }
    templates.push([start, i])
  }
  while (i < n) {
    const c = text[i], c2 = text[i + 1]
    if (c === '"' || c === "'") { skipString(c); prev = c; continue }
    if (c === '`') { skipTemplate(i); prev = '`'; continue }
    if (c === '/' && c2 === '/') { const s = i; while (i < n && text[i] !== '\n') i++; comments.push([s, i]); continue }
    if (c === '/' && c2 === '*') { const s = i; i += 2; while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++; i = Math.min(n, i + 2); comments.push([s, i]); continue }
    if (c === '/' && /[(,=:[!&|?{};\n]/.test(prev || '\n')) {
      i++; let inClass = false
      while (i < n) { const d = text[i]; if (d === '\\') { i += 2; continue } if (d === '[') inClass = true; else if (d === ']') inClass = false; else if (d === '/' && !inClass) { i++; break } else if (d === '\n') break; i++ }
      prev = '/'; continue
    }
    if (!/\s/.test(c)) prev = c
    i++
  }
  return { comments, templates }
}
function lineCommentRanges(text, ext) {
  const ranges = []
  let off = 0
  for (const line of text.split('\n')) {
    const t = line.trimStart()
    const isC = /\.cmd$/i.test(ext) ? /^(rem\b|::)/i.test(t) : /\.vbs$/i.test(ext) ? t.startsWith("'") : false
    if (isC) ranges.push([off, off + line.length])
    off += line.length + 1
  }
  return ranges
}
/** 严格落在模板内部（不含起始反引号本身）：`scripts/<x>.mjs` 这种单行模板仍算真引用。 */
const inTemplateBody = (ranges, pos) => ranges.some(([s, e]) => pos > s && pos < e)

/** path.join/resolve 的参数按顶层逗号切，字符串里的逗号不算分隔。 */
function joinArgs(inner) {
  const parts = []
  let depth = 0, cur = '', q = null
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if (q) { cur += c; if (c === '\\') { cur += inner[++i] ?? ''; continue } if (c === q) q = null; continue }
    if (c === '"' || c === "'" || c === '`') { q = c; cur += c; continue }
    if (c === '(' || c === '[' || c === '{') depth++
    if (c === ')' || c === ']' || c === '}') depth--
    if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  if (cur.trim()) parts.push(cur.trim())
  return parts
}
const LITERAL = /^(['"])([^'"]*)\1$/

const problems = []
const unchecked = []
let scanned = 0

for (const f of files) {
  if (fs.statSync(f).size > MAX_BYTES) continue
  scanned += 1
  const text = fs.readFileSync(f, 'utf8')
  const lines = text.split('\n')
  const ext = path.extname(f)
  const isJs = /\.(mjs|cjs|js|ts|tsx)$/i.test(f)
  const { comments, templates } = isJs ? jsRanges(text) : { comments: lineCommentRanges(text, ext), templates: [] }
  const lineOf = (pos) => text.slice(0, pos).split('\n').length
  const push = (rule, pos, target, reason) => {
    const item = { rule, where: `${rel(f)}:${lineOf(pos)}`, target, line: (lines[lineOf(pos) - 1] ?? '').trim().slice(0, 160) }
    if (reason) unchecked.push({ ...item, reason })
    else if (WRITE_RE.test(lines[lineOf(pos) - 1] ?? '')) unchecked.push({ ...item, reason: '写目标（同行有写/删/重定向），此刻不存在属正常' })
    else problems.push(item)
  }
  /** 注释里的散文提及 vs 用法示例：只看**所在那一行**有没有命令语境（整块判会把散文段误当示例）。 */
  const commentReason = (pos) => {
    const r = comments.find(([s, e]) => pos >= s && pos < e)
    if (!r) return null
    return USAGE_RE.test(lines[lineOf(pos) - 1] ?? '') ? null : '注释里的散文提及（非用法示例），不作为可跑路径'
  }
  const fixtureKeyReason = (endPos) => /^\s*:\s*['"`[]/.test(text.slice(endPos, endPos + 8)) ? '夹具键名（给临时仓里的假文件起名），不指向本仓' : null
  const assertReason = (pos) => {
    const line = lines[lineOf(pos) - 1] ?? ''
    return ASSERT_CMP_RE.test(line) && !FS_CALL_RE.test(line) ? '比较型断言的期望值（比对夹具产出的文件名），不是打开路径' : null
  }

  // ② 相对 import / require / 动态 import
  for (const m of text.matchAll(/(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"](\.[^'"]+)['"]/g)) {
    const spec = m[1]
    if (spec.includes('${') || spec.includes('*')) continue
    if (resolveImport(spec, f)) continue
    push('R1-import 不存在', m.index, spec, inTemplateBody(templates, m.index) ? '模板字符串内部（夹具内容或运行时拼出的代码）' : null)
  }

  // ③ 引号里的仓根相对路径
  const reQuoted = new RegExp(`['"\`]((?:${REPO_DIRS.join('|')})/[\\w./-]*\\.${PATH_EXT})['"\`]`, 'g')
  for (const m of text.matchAll(reQuoted)) {
    const t = m[1]
    if (t.includes('${') || t.includes('*') || t.includes('<')) continue
    const abs = path.resolve(REPO, t)
    if (exists(abs)) continue
    const reason = inTemplateBody(templates, m.index) ? '模板字符串内部（夹具内容或运行时拼出的命令）'
      : fixtureKeyReason(m.index + m[0].length) ?? assertReason(m.index) ?? commentReason(m.index)
    push('R2-仓内路径不存在', m.index, t, reason)
  }

  // ⑨ 用法示例注释里的裸路径（没引号也算：照着跑就会跑错）。逐行判，不整块判。
  const reBare = new RegExp(`(?:${REPO_DIRS.join('|')})/[\\w./-]*\\.${PATH_EXT}`, 'g')
  for (const [s, e] of comments) {
    let off = s
    for (const line of text.slice(s, e).split('\n')) {
      if (USAGE_RE.test(line)) {
        for (const m of line.matchAll(reBare)) {
          const t = m[0]
          if (t.includes('*') || t.includes('<')) continue
          const before = line[m.index - 1] ?? ''
          const after = line[m.index + t.length] ?? ''
          if (/['"`/\w.-]/.test(before) || /['"`/\w.-]/.test(after)) continue
          const abs = path.resolve(REPO, t)
          if (!exists(abs)) push('R5-用法示例里的裸路径不存在', off + m.index, t)
        }
      }
      off += line.length + 1
    }
  }

  // ④ path.join/resolve：仓根标识 + 连续字面量
  for (const m of text.matchAll(/path\.(?:join|resolve)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
    const parts = joinArgs(m[1])
    if (parts.length < 2) continue
    const head = parts[0]
    const selfDir = /^(?:__dirname|import\.meta\.dirname)$/.test(head)
    if (!selfDir && !ROOT_IDS.test(head)) continue
    const lits = []
    for (const p of parts.slice(1)) {
      const mm = LITERAL.exec(p)
      if (!mm) break
      if (mm[2].includes('${') || mm[2].includes('*')) { lits.length = 0; break }
      lits.push(mm[2])
    }
    const tail = lits.join('/').replace(/\\/g, '/')
    if (!tail || !new RegExp(`^(?:${REPO_DIRS.join('|')})/`).test(tail)) continue
    if (!new RegExp(`\\.${PATH_EXT}$`).test(tail)) continue
    const abs = path.resolve(selfDir ? path.dirname(f) : REPO, tail)
    if (!exists(abs)) push('R3-片段拼出的路径不存在', m.index, tail)
  }

  // ⑤ .cmd/.vbs 里的 `node scripts\xxx.mjs`
  if (/\.(cmd|vbs)$/i.test(f)) {
    for (const m of text.matchAll(/node\s+["']?([\w.\\/ -]+\.(?:mjs|js|cjs))["']?/gi)) {
      const t = m[1].trim().replace(/\\/g, '/')
      if (t.includes('%') || t.includes('${')) continue
      const abs = path.resolve(REPO, t)
      if (!exists(abs)) push('R4-启动器指向不存在', m.index, t)
    }
  }
}

const ok = problems.length === 0
const byReason = {}
for (const u of unchecked) byReason[u.reason] = (byReason[u.reason] ?? 0) + 1
if (asJson) console.log(JSON.stringify({ ok, repo: REPO, scanned, problems, unchecked, uncheckedByReason: byReason }, null, 2))
else {
  console.log(`脚本路径门禁：扫了 ${scanned} 个 .mjs/.cjs/.js/.ts/.tsx/.cmd/.vbs（仓内路径；home/素材盘/运行时 data/宿主检出不在此列）`)
  if (unchecked.length) {
    console.log(`\n未核 ${unchecked.length} 条（不算违规，但列出来免得静默放行）：`)
    for (const [r, n] of Object.entries(byReason)) console.log(`  ${n} 条 —— ${r}`)
    for (const u of unchecked.slice(0, 12)) console.log(`  - ${u.where}  ${u.target}`)
    if (unchecked.length > 12) console.log(`  …另 ${unchecked.length - 12} 条（--json 看全量）`)
  }
  if (ok) console.log('\n✓ 脚本里没有指向已消失文件的仓内路径')
  else {
    const by = {}
    for (const p of problems) (by[p.rule] ??= []).push(p)
    console.log(`\n✗ ${problems.length} 处违规`)
    for (const [rule, list] of Object.entries(by)) {
      console.log(`\n## ${rule} —— ${list.length}`)
      for (const x of list.slice(0, 25)) console.log(`  ${x.where}  ${x.target}\n    ${x.line}`)
      if (list.length > 25) console.log(`  …另 ${list.length - 25} 条`)
    }
    console.log('\n修法：要么把路径改到还在的那份，要么把这条脚本/启动器一起退役。别让脚本指着空气。')
  }
}
process.exitCode = ok ? 0 : 1