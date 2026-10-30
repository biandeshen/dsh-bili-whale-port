/**
 * 她的意见箱（2026-10-31 主人：“最好能有这样的机制，或者允许它能提出，然后让她解决”）。
 *
 * append-only：`~/.dsh/bili-whale/control/feedback.jsonl`
 *   add     → {id:'f-xx', kind:'feedback', at, atMs, day, issue, severity, selfHandled, note}
 *   resolve → 追加 {kind:'feedback-resolved', id, at, atMs, resolvedBy:'whale'|'owner'}
 * 折叠规则：同 id 有 resolved 记录 → 已解决；永不删原始条目（历史可回放）。
 *
 * 用法:
 *   node bili.mjs feedback add --issue "一句话现象" [--severity low|high] [--self] [--note "你已如何对治"]
 *   node bili.mjs feedback list [--json] [--all]
 *   node bili.mjs feedback resolve <id> [--by whale|owner]
 *
 * 只写本地文件，不联网、不动 B 站、不改代码。resolve 是记录，不是修复——修复仍走人。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { dshPath } from '../lib/paths.mjs'
// 日界与快照同源（scripts/day-snapshot.mjs 是唯一实现，不复制第三份）
import { logicalDay as dayOf } from '../../scripts/day-snapshot.mjs'

const FILE = dshPath('bili-whale', 'control', 'feedback.jsonl')

function readEntries(file = FILE) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

export function listFeedback(file = FILE, { all = false, limit = 30 } = {}) {
  const entries = readEntries(file)
  const resolved = new Set(entries.filter((e) => e.kind === 'feedback-resolved').map((e) => String(e.id)))
  const items = entries.filter((e) => e.kind === 'feedback').map((e) => ({
    id: e.id,
    at: e.at,
    day: e.day,
    issue: String(e.issue ?? '').slice(0, 200),
    severity: e.severity === 'high' ? 'high' : 'low',
    selfHandled: !!e.selfHandled,
    note: String(e.note ?? '').slice(0, 300),
    resolved: resolved.has(String(e.id)),
    resolvedBy: resolved.has(String(e.id)) ? (entries.find((x) => x.kind === 'feedback-resolved' && String(x.id) === String(e.id))?.resolvedBy ?? '') : null,
  }))
  const open = items.filter((x) => !x.resolved)
  return { ok: true, openCount: open.length, items: (all ? items : open).slice(-limit).reverse(), total: items.length }
}

export function appendFeedback({ issue, severity = 'low', selfHandled = false, note = '' }, file = FILE) {
  const text = String(issue ?? '').trim()
  if (!text) return { ok: false, error: 'issue 是空的' }
  if (text.length > 500) return { ok: false, error: 'issue 太长（>500 字），一句话现象就够' }
  const entry = {
    id: 'f-' + crypto.randomBytes(3).toString('hex'),
    kind: 'feedback',
    at: new Date().toISOString(),
    atMs: Date.now(),
    day: dayOf(),
    issue: text,
    severity: severity === 'high' ? 'high' : 'low',
    selfHandled: !!selfHandled,
    note: String(note ?? '').slice(0, 300),
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, JSON.stringify(entry) + '\n')
  return { ok: true, id: entry.id, at: entry.at }
}

export function resolveFeedback(id, by = 'owner', file = FILE) {
  const target = String(id ?? '')
  if (!target) return { ok: false, error: '缺 id' }
  const open = listFeedback(file, { all: true }).items.filter((x) => !x.resolved).map((x) => x.id)
  if (!open.includes(target)) return { ok: false, error: '没有这条未解决的：' + target }
  const entry = { kind: 'feedback-resolved', id: target, at: new Date().toISOString(), atMs: Date.now(), resolvedBy: by === 'whale' ? 'whale' : 'owner' }
  fs.appendFileSync(file, JSON.stringify(entry) + '\n')
  return { ok: true, id: target, resolvedBy: entry.resolvedBy }
}

// ── CLI ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('tools', 'commands', 'feedback.mjs'))
if (isMain) {
  const cmd = argv[0]
  // 简易 flag 解析（避免把位置参数吞掉）
  const flag = (k) => argv.includes('--' + k)
  const val = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined }
  const positional = argv.filter((a, i) => i > 0 && !a.startsWith('--') && !argv[i - 1].startsWith('--'))

  if (cmd === 'add') {
    const r = appendFeedback({ issue: val('issue'), severity: val('severity') || 'low', selfHandled: flag('self'), note: val('note') || '' })
    if (r.ok) console.log(`[feedback] 已记入意见箱 ${r.id}（主人在面板「她的意见箱」能看到；不修复代码，只记录）`)
    else console.error('[feedback] ' + r.error)
    process.exit(r.ok ? 0 : 2)
  }
  if (cmd === 'list') {
    const r = listFeedback(FILE, { all: flag('all') })
    if (flag('json')) console.log(JSON.stringify(r, null, 2))
    else {
      console.log(`开放 ${r.openCount} 条（共 ${r.total}）：`)
      for (const it of r.items) console.log(`  ${it.id} [${it.severity}${it.selfHandled ? '·她已对治' : ''}${it.resolved ? '·已解决(' + it.resolvedBy + ')' : ''}] ${it.day} ${it.issue}${it.note ? ' ｜ 对治：' + it.note : ''}`)
      if (!r.items.length) console.log('  （空）')
    }
    process.exit(0)
  }
  if (cmd === 'resolve') {
    const r = resolveFeedback(positional[0], val('by') || 'owner')
    if (r.ok) console.log(`[feedback] ${r.id} 已标记解决（${r.resolvedBy}）`)
    else console.error('[feedback] ' + r.error)
    process.exit(r.ok ? 0 : 2)
  }
  console.error('用法: feedback add --issue "..." [--severity high] [--self] [--note "..."] | list [--json] [--all] | resolve <id> [--by whale|owner]')
  process.exit(2)
}
