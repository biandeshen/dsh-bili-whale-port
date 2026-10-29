/**
 * 私信回信审批：list / approve <id> [--token …] [--go] / reject <id>
 *
 * 默认 dry：只跑 `bili dm --dry`，不发送、不消耗 token。
 * --go 需要一次性 token；并且**正文必须与入队时一致**（哈希不符拒绝），防止审完又改稿。
 * 冷却/风控失败会把 token 退回，可原 token 重试；成功后一次性作废。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { DSH_HOME as WHALE_HOME } from '../tools/lib/paths.mjs'
import { loadDrafts, findDraft, setStatus, textHash } from '../tools/lib/dm-drafts.mjs'
import * as ack from './ack.mjs'

const FILE = path.join(WHALE_HOME, 'bili-whale', 'control', 'dm-drafts.json')
const KILL = path.join(WHALE_HOME, 'bili-whale', 'control', 'kill')
const CAUSAL = path.join(WHALE_HOME, 'bili-whale', 'causal.jsonl')
const AUDIT = path.join(WHALE_HOME, 'bili-whale', 'control', 'dm-approve-audit.jsonl')
const BILI = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'tools', 'bili.mjs')

function audit(entry) {
  try {
    fs.mkdirSync(path.dirname(AUDIT), { recursive: true })
    fs.appendFileSync(AUDIT, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n')
  } catch {}
}

function recordSent(draft) {
  try {
    fs.mkdirSync(path.dirname(CAUSAL), { recursive: true })
    fs.appendFileSync(CAUSAL, JSON.stringify({
      at: new Date().toISOString(),
      kind: 'dm-sent',
      draftId: draft.id,
      inboundKey: draft.inboundKey ?? '',
      chars: String(draft.text ?? '').length,
      atMs: Date.now(),
    }) + '\n')
  } catch {}
}

export function approve({ id, token, go = false, runner } = {}) {
  const d = findDraft(FILE, id)
  if (!d) return { ok: false, error: '找不到回信草稿 ' + id }
  if (['sent', 'rejected'].includes(d.status)) return { ok: false, error: '草稿已处理过：' + d.status }
  if (fs.existsSync(KILL)) { audit({ id, action: 'approve', result: 'blocked-kill' }); return { ok: false, error: 'kill switch 已触发' } }

  if (go) {
    if (!d.ackId) return { ok: false, error: '这条没有一次性令牌，请重新生成草稿' }
    const pending = ack.listPending(WHALE_HOME).find((x) => x.id === d.ackId)
    if (!pending) return { ok: false, error: '令牌不存在或已过期' }
    if (String(pending.payload?.draftId ?? '') !== String(d.id)) return { ok: false, error: '令牌与草稿不匹配' }
    if (String(pending.payload?.textHash ?? '') !== textHash(d.text)) {
      return { ok: false, error: '正文在入队后被改过（哈希不符），请重新生成草稿再审' }
    }
    const a = ack.approve(WHALE_HOME, d.ackId, token)
    if (!a.ok) return { ok: false, error: '一次性令牌校验失败：' + a.error, code: a.code }
  }

  audit({ id: d.id, action: 'approve', mode: go ? 'go' : 'dry', textHash: d.textHash })
  const args = ['dm', '--msg', d.text, go ? '--go' : '--dry']
  const run = runner || ((a) => spawnSync(process.execPath, [BILI, ...a], { encoding: 'utf8', timeout: 180000 }))
  let r
  try { r = run(args) } catch (e) { r = { status: -1, stdout: '', stderr: String(e?.message ?? e) } }
  const out = String(r.stdout ?? '') + String(r.stderr ?? '')
  const ok = r.status === 0 && (go ? /已发送|code=0|成功/i.test(out) : true)
  const transient = !ok && /冷却|TRAFFIC_PAUSED|请稍后|频繁/.test(out)
  const status = ok ? (go ? 'sent' : 'dry-run') : (transient ? 'cooldown' : 'failed')
  setStatus(FILE, d.id, status, { result: { ok, at: new Date().toISOString(), mode: go ? 'go' : 'dry', out: out.slice(-800) } })
  if (go && !ok) { try { ack.release(WHALE_HOME, d.ackId) } catch {} }
  if (go && ok) recordSent(d)
  audit({ id: d.id, action: go ? 'send' : 'dry-run', result: status, exit: r.status ?? null, outHash: crypto.createHash('sha1').update(out).digest('hex') })
  return { ok, status, out: out.slice(-800) }
}

export function reject(id) {
  const d = findDraft(FILE, id)
  if (!d) return { ok: false, error: '找不到回信草稿 ' + id }
  if (d.status === 'sent') return { ok: false, error: '已经发出去了，不能再拒' }
  setStatus(FILE, id, 'rejected', { rejectedAt: new Date().toISOString() })
  if (d.ackId) { try { ack.cancel(WHALE_HOME, d.ackId) } catch {} }
  audit({ id, action: 'reject' })
  return { ok: true }
}

export function list() {
  const db = loadDrafts(FILE)
  const pend = ack.listPending(WHALE_HOME)
  return db.items.map((d) => {
    const a = pend.find((x) => x.id === d.ackId)
    return { ...d, token: a?.token ?? null, expiresAt: a?.expiresAt ?? d.expiresAt ?? null }
  })
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
if (isMain) {
  const argv = process.argv.slice(2)
  const cmd = argv[0]
  const arg = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined }
  const go = argv.includes('--go')

  if (cmd === 'list') {
    const items = list()
    if (!items.length) { console.log('（没有回信草稿）'); process.exit(0) }
    for (const d of items) {
      const t = new Date(d.at).toLocaleString('zh-CN', { hour12: false })
      console.log(`\n${d.id}  ${d.status}  ${t}  → ${d.who || '鱼片'}`)
      console.log(`  她写：${d.text}`)
      if (d.status === 'pending' || d.status === 'failed' || d.status === 'cooldown') {
        console.log(d.token ? `  令牌：${d.token}  （到期 ${new Date(d.expiresAt).toLocaleString()}）` : '  ⚠ 没有令牌，请重新生成草稿')
      }
    }
    process.exit(0)
  }

  if (cmd === 'approve') {
    const id = argv[1]
    if (!id) { console.error('用法: node scripts/dm-approve.mjs approve <id> [--token <token>] [--go]'); process.exit(2) }
    const r = approve({ id, token: arg('token'), go })
    console.log(r.ok ? `✓ ${r.status}` : `✗ ${r.error || r.status || '失败'}`)
    if (r.out) console.log(r.out)
    process.exit(r.ok ? 0 : 1)
  }

  if (cmd === 'reject') {
    const id = argv[1]
    if (!id) { console.error('用法: node scripts/dm-approve.mjs reject <id>'); process.exit(2) }
    const r = reject(id)
    console.log(r.ok ? '✓ 已拒绝' : '✗ ' + r.error)
    process.exit(r.ok ? 0 : 1)
  }

  console.error('用法: node scripts/dm-approve.mjs list | approve <id> [--token …] [--go] | reject <id>')
  process.exit(2)
}
