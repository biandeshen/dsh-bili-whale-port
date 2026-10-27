/**
 * ack 一次性批准队列：入队生成 pending_id + 一次性 token（短 TTL）。
 * 放行必须 id + token；校验通过后立即作废（used:true）。
 * 纯文件实现，不触网、不调 B 站写接口。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const DEFAULT_TTL_MS = 2 * 3600_000

export function queueDir(whaleHome) {
  return path.join(whaleHome, 'bili-whale', 'control', 'pending')
}

export function enqueue(whaleHome, payload, opts = {}) {
  const dir = queueDir(whaleHome)
  fs.mkdirSync(dir, { recursive: true })
  const id = 'ack-' + crypto.randomBytes(8).toString('hex')
  const token = crypto.randomBytes(16).toString('hex')
  const ttl = Number(opts.ttlMs ?? DEFAULT_TTL_MS)
  const item = {
    id, token, ttlMs: ttl,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttl).toISOString(),
    used: false, usedAt: null,
    payload,
  }
  fs.writeFileSync(path.join(dir, id + '.json'), JSON.stringify(item, null, 2))
  return { id, token, expiresAt: item.expiresAt }
}

/** 列出待审项（本地 owner 使用；token 只在这里可见，不进模型上下文）。 */
export function listPending(whaleHome) {
  const dir = queueDir(whaleHome)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => {
    try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { return null }
  }).filter(Boolean).filter((x) => !x.used)
}

function load(whaleHome, id) {
  const f = path.join(queueDir(whaleHome), String(id) + '.json')
  try { return { file: f, item: JSON.parse(fs.readFileSync(f, 'utf8')) } } catch { return null }
}

/** 返回 { ok, code, error?, payload? }；code ∈ ok | not-found | used | expired | bad-token */
export function approve(whaleHome, id, token, now = Date.now()) {
  const hit = load(whaleHome, id)
  if (!hit) return { ok: false, code: 'not-found', error: '找不到这条待审' }
  const it = hit.item
  if (it.used) return { ok: false, code: 'used', error: '已放行过（一次性）' }
  if (Date.parse(it.expiresAt) <= now) return { ok: false, code: 'expired', error: '已过期' }
  if (String(it.token) !== String(token)) return { ok: false, code: 'bad-token', error: 'token 不匹配' }
  it.used = true
  it.usedAt = new Date(now).toISOString()
  fs.writeFileSync(hit.file, JSON.stringify(it, null, 2))
  return { ok: true, code: 'ok', payload: it.payload }
}
