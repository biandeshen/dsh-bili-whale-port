/**
 * 控件清点与静态体检：每一页、每一个按钮、每一条写操作（只读，零成本）。
 *
 *   node scripts/audit-controls.mjs [--json] [--package=cap-bilibili] [--strict]
 *
 * 为什么要这支（2026-11-06 主人："每个功能、每个按钮逐个进行检查，还有每个页面"）：
 * "逐个检查"如果靠人一遍遍点，第二轮就没人真点得动。所以把它变成**可复跑的静态清单**：
 *   R1 每一页有什么面板、几个控件、几个写操作（页面清单）
 *   R2 写操作按钮**没有确认**（writable 的方法被 actionButton 调用，却没给 confirm/preRun）
 *   R3 直接 `call()` 的按钮**没有 busy/失败可见**（点了不知道在跑、挂了不知道挂了）
 *   R4 没接脏守卫的包（输入框有未保存内容还能切页/还能点）
 *   R5 客户端引用的方法在服务端面板里**不存在**（点了必然 404，属"声称↔实现"）
 *   R6 服务端 writable 方法在页面上**没有任何入口**（只能改文件/只能用 CLI）
 *
 * `--strict` 时任何一条违规都非零退出（默认只报，不拦当前交付）。
 * 已知口径问题：正则不是 AST，跨行的对象字面量可能漏判 —— 所以每条违规都给**文件与行号**，
 * 让人能当场翻过去看，不让人拿这表的"没报"当"没问题"。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const asJson = process.argv.includes('--json')
const strict = process.argv.includes('--strict')
const only = (process.argv.find((a) => a.startsWith('--package=')) || '').split('=')[2] || ''

const PKGS = fs.readdirSync(path.join(ROOT, 'packages'))
  .filter((d) => fs.existsSync(path.join(ROOT, 'packages', d, 'src', 'index.ts')))
  .filter((d) => !only || d === only)

const lineOf = (text, idx) => text.slice(0, idx).split('\n').length
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/')

/** 收源码文件（跳过产物目录），用于"服务端方法可能不在 index.ts 里"这一事实。 */
function walk(dir, accept, out = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (['node_modules', 'dist', '.git'].includes(e.name)) continue
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) walk(abs, accept, out)
    else if (accept(e.name)) out.push(abs)
  }
  return out
}

/** 从 `fromIdx` 处的 `{` 开始做括号配平，返回块内文本（含首尾括号）。 */
function balanced(text, fromIdx) {
  const open = text.indexOf('{', fromIdx)
  if (open < 0) return ''
  let depth = 0
  let i = open
  let inStr = null
  for (; i < text.length; i += 1) {
    const c = text[i]
    if (inStr) {
      if (c === '\\') i += 1
      else if (c === inStr) inStr = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; continue }
    if (c === '{') depth += 1
    else if (c === '}') { depth -= 1; if (depth === 0) return text.slice(open, i + 1) }
  }
  return text.slice(open)
}

/**
 * 服务端：把 `panels()` 里每个面板的 methods 抠出来（name / verb / writable）。
 * 缩进不做假设 —— 用括号配平，正则只负责认键名，这样跨行写法不会被漏判成"没问题"。
 */
function serverPanels(src) {
  const out = []
  for (const pm of src.matchAll(/\bmethods:\s*\{/g)) {
    const block = balanced(src, pm.index + pm[0].length - 1)
    const head = src.slice(Math.max(0, pm.index - 1500), pm.index)
    const idMatches = [...head.matchAll(/\bid:\s*'([^']+)'/g)]
    const titleMatches = [...head.matchAll(/\btitle:\s*'([^']+)'/g)]
    const methods = []
    // 两种写法都得认：`key: {` 换行再 `name:`（cap-bilibili 那种），和 `key: { name: 'x', verb: 'POST', writable: true,`
    // 挤在一行的（cap-vision 那种）。第一版只认前者，于是把真实存在的方法报成"服务端不存在"——
    // **假违规比漏违规更坏**：它会让人去修一个没坏的东西。
    for (const mm of block.matchAll(/([A-Za-z0-9_]+):\s*\{\s*name:\s*'([^']+)'/g)) {
      const seg = balanced(block, mm.index + mm[0].indexOf('{'))
      methods.push({
        key: mm[1],
        name: mm[2],
        writable: /\bwritable:\s*true/.test(seg),
        verb: (seg.match(/\bverb:\s*'(GET|POST)'/) || [])[1] ?? 'GET',
      })
    }
    out.push({
      panel: idMatches[idMatches.length - 1]?.[1] ?? '?',
      title: titleMatches[titleMatches.length - 1]?.[1] ?? '?',
      line: lineOf(src, pm.index),
      methods,
    })
  }
  return out
}

/** 把 `(` 之后的实参按顶层逗号切开（括号/引号内不切）——这样第 5 个参数一定是方法名。 */
function splitArgs(text, openParenIdx) {
  const args = []
  let depth = 0
  let cur = ''
  let inStr = null
  for (let i = openParenIdx + 1; i < text.length; i += 1) {
    const c = text[i]
    if (inStr) {
      cur += c
      if (c === '\\') { cur += text[i + 1] ?? ''; i += 1 }
      else if (c === inStr) inStr = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') { inStr = c; cur += c; continue }
    if (c === '(' || c === '[' || c === '{') { depth += 1; cur += c; continue }
    if (c === ')' || c === ']' || c === '}') {
      if (depth === 0 && c === ')') { args.push(cur); return args }
      depth -= 1; cur += c; continue
    }
    if (c === ',' && depth === 0) { args.push(cur); cur = ''; continue }
    cur += c
  }
  return args
}

/**
 * 客户端：`actionButton(ctx, ui, msg, 标签, 方法, 参数, opts)`。
 * 位置参数按上面切开，**不再靠"抓第一个引号串"**——那会把标签当方法名，
 * 于是 R2/R5 报出一片假违规（2026-11-06 第一版就踩了这个）。
 */
function clientControls(src) {
  const buttons = []
  const bareCalls = []
  for (const m of src.matchAll(/\bactionButton\(/g)) {
    const args = splitArgs(src, src.indexOf('(', m.index))
    if (args.length < 5) continue
    const label = (args[3] ?? '').trim().replace(/^['"`]|['"`]$/g, '')
    const methodRaw = (args[4] ?? '').trim()
    const method = (methodRaw.match(/^['"`]([^'"`]+)['"`]$/) || [])[1] ?? methodRaw
    const optsText = args.slice(5).join(',')
    buttons.push({
      label,
      method,
      dynamic: (methodRaw.match(/^['"`]/) === null), // 方法名是变量 → 静态判不了，如实标出来
      confirm: /\bconfirm\s*:/.test(optsText) || /\bpreRun\s*:/.test(optsText),
      busy: /busyLabel/.test(optsText),
      line: lineOf(src, m.index),
    })
  }
  const cRe = /(?:^|[^.\w])call\(\s*(?:api|ctx)\b[^;]{0,160}/g
  for (const cm of src.matchAll(cRe)) {
    const seg = cm[0]
    if (/catch|\.then|onError|ui\.error|showError/.test(seg)) continue
    bareCalls.push({ line: lineOf(src, cm.index), text: seg.trim().slice(0, 90) })
  }
  return { buttons, bareCalls, dirtyGuard: /createDirtyGuard/.test(src) }
}

const rows = []
const problems = []
/** 本地可逆写（不要求弹确认），单独列出来供人核对"改完有没有回读"，不计入违规。 */
const localWrites = []
for (const pkg of PKGS) {
  const indexPath = path.join(ROOT, 'packages', pkg, 'src', 'index.ts')
  const clientPath = path.join(ROOT, 'packages', pkg, 'src', 'webui', 'client.ts')
  /**
   * 服务端方法不能只从 `src/index.ts` 找：`cap-vision` 的面板是在别的文件里定义的，
   * 只扫入口会把它的方法清单看成"不存在"，于是 R5 报出一片假违规（2026-11-06 第一版踩到 4 处）。
   */
  const srcFiles = walk(path.join(ROOT, 'packages', pkg, 'src'), (name) => name.endsWith('.ts'))
  const serverSrc = srcFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n')
  const server = serverPanels(serverSrc)
  const clientSrc = fs.existsSync(clientPath) ? fs.readFileSync(clientPath, 'utf8') : ''
  const client = clientControls(clientSrc)
  if (client.buttons.length > 0 && server.length === 0) {
    problems.push({ pkg, rule: 'R0 解析盲区（这包的面板没解析到，R5/R6 对它无效）', where: rel(indexPath), detail: `${client.buttons.length} 个按钮悬空` })
  }
  const writableNames = new Set(server.flatMap((p) => p.methods.filter((m) => m.writable).map((m) => m.name)))
  const allNames = new Set(server.flatMap((p) => p.methods.map((m) => m.name)))

/**
 * 写操作分两档（2026-11-06 第一版把 19 个"保存"都报成违规，那没法修也不想修）：
 *   OUTWARD 会产生对外可见/不可逆后果（发布、回话、绑定/解绑、屏蔽、清空、恢复）→ **必须确认**
 *   LOCAL   只改她本地状态（存草稿、设配额、挪卡片）→ 不该弹确认（点一次弹三次是折磨），
 *           但要"改完回读"与脏守卫，另立 R8 检查
 */
const OUTWARD = /(^|[^a-zA-Z])(publish|release|send|reply|bind|unbind|block|purge|delete|remove|void|clear|restore|reset|apply|adopt|ignore|assign|build|preview)([^a-zA-Z]|$)/i

  for (const b of client.buttons) {
    if (!b.method) continue
    if (b.dynamic) {
      problems.push({ pkg, rule: 'R7 方法名是变量（静态判不了，要人看）', where: `${rel(clientPath)}:${b.line}`, detail: `按钮「${b.label}」→ ${b.method}` })
      continue
    }
    const isWrite = writableNames.has(b.method)
    const outward = OUTWARD.test(b.method)
    if (isWrite && outward && !b.confirm) {
      problems.push({ pkg, rule: 'R2 对外/不可逆写没确认', where: `${rel(clientPath)}:${b.line}`, detail: `按钮「${b.label}」→ ${b.method}` })
    }
    if (isWrite && !outward && !b.confirm) {
      localWrites.push({ pkg, name: b.method, line: b.line, label: b.label })
    }
    if (!allNames.has(b.method)) {
      problems.push({ pkg, rule: 'R5? 客户端方法在服务端清单里找不到（先确认不是我漏解析）', where: `${rel(clientPath)}:${b.line}`, detail: `${b.label} → ${b.method}` })
    }
  }
  for (const c of client.bareCalls) {
    problems.push({ pkg, rule: 'R3 裸 call()（busy/失败可见要自己写）', where: `${rel(clientPath)}:${c.line}`, detail: c.text })
  }
  if (clientSrc && !client.dirtyGuard && /\binput\b|textarea|sliderField|textField/.test(clientSrc)) {
    problems.push({ pkg, rule: 'R4 有输入控件却没接脏守卫', where: rel(clientPath), detail: 'createDirtyGuard 没出现' })
  }
  const used = new Set(client.buttons.map((b) => b.method))
  for (const p of server) {
    for (const mth of p.methods) {
      if (mth.writable && !used.has(mth.name)) {
        problems.push({ pkg, rule: 'R6 writable 方法页面无入口', where: `${rel(indexPath)}:${p.line}`, detail: `${p.panel}.${mth.name}` })
      }
    }
  }
  rows.push({
    pkg,
    panels: server.map((p) => ({
      panel: p.panel,
      title: p.title,
      methods: p.methods.length,
      writable: p.methods.filter((m) => m.writable).length,
    })),
    buttons: client.buttons.length,
    bareCalls: client.bareCalls.length,
    dirtyGuard: client.dirtyGuard,
  })
}

const totals = {
  packages: rows.length,
  panels: rows.reduce((s, r) => s + r.panels.length, 0),
  methods: rows.reduce((s, r) => s + r.panels.reduce((a, p) => a + p.methods, 0), 0),
  writable: rows.reduce((s, r) => s + r.panels.reduce((a, p) => a + p.writable, 0), 0),
  buttons: rows.reduce((s, r) => s + r.buttons, 0),
  problems: problems.length,
}

if (asJson) console.log(JSON.stringify({ totals, rows, problems }, null, 2))
else {
  console.log(`# 控件清点（静态，正则口径）`)
  console.log(`  包 ${totals.packages} · 面板 ${totals.panels} · 服务端方法 ${totals.methods}（其中 writable ${totals.writable}）· 页面按钮 ${totals.buttons}\n`)
  for (const r of rows) {
    console.log(`## ${r.pkg}  按钮 ${r.buttons} · 裸 call ${r.bareCalls} · 脏守卫 ${r.dirtyGuard ? '有' : '**无**'}`)
    for (const p of r.panels) console.log(`   · ${p.panel.padEnd(18)}「${p.title}」 方法 ${String(p.methods).padStart(2)}（写 ${p.writable}）`)
  }
  console.log(`\n# 违规清单（${problems.length}）`)
  const byRule = {}
  for (const p of problems) (byRule[p.rule] ??= []).push(p)
  for (const [rule, list] of Object.entries(byRule).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n## ${rule} —— ${list.length} 处`)
    for (const x of list) console.log(`  ${x.where}  ${x.detail}`)
  }
  console.log(`\n## R8 本地可逆写（不要求弹确认，共 ${localWrites.length} 个）—— 只用来核对"改完有没有回读"`)
  for (const w of localWrites) console.log(`  ${w.pkg} · ${rel(path.join(ROOT, 'packages', w.pkg, 'src', 'webui', 'client.ts'))}:${w.line} 「${w.label}」→ ${w.name}`)
  console.log(`\n口径：正则会漏跨行写法，"没报"不等于"没问题"；每条都给了文件行号，抽查比信数重要。`)
}
if (strict && problems.length) process.exitCode = 1
