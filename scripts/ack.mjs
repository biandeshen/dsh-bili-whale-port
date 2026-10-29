/**
 * ack 一次性批准队列：入队生成 pending_id + 一次性 token（短 TTL）。
 * 放行必须 id + token；校验通过后原子认领（claim 文件 wx），再标记 used。
 * 纯文件实现，不触网、不调 B 站写接口。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

/** 默认 12 小时：晚上出的草稿，第二天早上主人起来再放行也来得及 */
export const DEFAULT_TTL_MS = 12 * 3600_000

export function queueDir(whaleHome) {
  return path.join(whaleHome, 'bili-whale', 'control', 'pending')
}

function atomicWrite(file, data) {
  const tmp = file + '.' + process.pid + '.' + crypto.randomBytes(3).toString('hex') + '.tmp'
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, file)
}

function tokenDigest(token) {
  return crypto.createHash('sha256').update(String(token)).digest()
}

function claimPath(whaleHome, id) {
  return path.join(queueDir(whaleHome), String(id) + '.claim')
}

export function enqueue(whaleHome, payload, opts = {}) {
  const dir = queueDir(whaleHome)
  fs.mkdirSync(dir, { recursive: true })
  const id = 'ack-' + crypto.randomBytes(8).toString('hex')
  const token = crypto.randomBytes(16).toString('hex')
  const ttl = Number(opts.ttlMs ?? DEFAULT_TTL_MS)
  const item = {
    id, token, tokenHash: tokenDigest(token).toString('hex'), ttlMs: ttl,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttl).toISOString(),
    used: false, usedAt: null,
    payload,
  }
  atomicWrite(path.join(dir, id + '.json'), JSON.stringify(item, null, 2))
  return { id, token, expiresAt: item.expiresAt }
}

/** 列出待审项（本地 owner 使用；token 只在这里可见，不进模型上下文）。过期项顺手清理。 */
export function listPending(whaleHome, now = Date.now()) {
  const dir = queueDir(whaleHome)
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    const p = path.join(dir, f)
    let it
    try { it = JSON.parse(fs.readFileSync(p, 'utf8')) } catch { continue }
    if (it.used) continue
    if (Date.parse(it.expiresAt) <= now) {
      try { fs.unlinkSync(p) } catch {}
      try { fs.unlinkSync(claimPath(whaleHome, it.id)) } catch {}
      continue
    }
    out.push(it)
  }
  return out
}

/** pending id 只允许字母数字与连字符，禁止路径分隔/穿越。 */
const ID_SHAPE = /^ack-[a-z0-9-]{1,64}$/

function load(whaleHome, id) {
  if (!ID_SHAPE.test(String(id))) return null
  const f = path.join(queueDir(whaleHome), String(id) + '.json')
  const base = path.resolve(queueDir(whaleHome))
  if (!path.resolve(f).startsWith(base + path.sep)) return null
  try {
    const item = JSON.parse(fs.readFileSync(f, 'utf8'))
    if (item.id !== id) return null
    return { file: f, item }
  } catch { return null }
}

/** 返回 { ok, code, error?, payload? }；code ∈ ok | not-found | used | expired | bad-token */
export function approve(whaleHome, id, token, now = Date.now()) {
  const hit = load(whaleHome, id)
  if (!hit) return { ok: false, code: 'not-found', error: '找不到这条待审' }
  const it = hit.item
  if (it.used) return { ok: false, code: 'used', error: '已放行过（一次性）' }
  if (Date.parse(it.expiresAt) <= now) return { ok: false, code: 'expired', error: '已过期' }
  const expect = it.tokenHash ? Buffer.from(it.tokenHash, 'hex') : tokenDigest(it.token)
  if (!crypto.timingSafeEqual(tokenDigest(token), expect)) {
    return { ok: false, code: 'bad-token', error: 'token 不匹配' }
  }
  // 原子认领：wx 创建成功才算拿到；并发的第二个会 EEXIST，不可能双重放行。
  try {
    fs.writeFileSync(claimPath(whaleHome, it.id), new Date(now).toISOString(), { flag: 'wx' })
  } catch {
    return { ok: false, code: 'used', error: '已放行过（一次性）' }
  }
  it.used = true
  it.usedAt = new Date(now).toISOString()
  atomicWrite(hit.file, JSON.stringify(it, null, 2))
  return { ok: true, code: 'ok', payload: it.payload }
}

/** 传输层失败（冷却/风控在写之前就拒了）→ 把认领退回去，主人可以用同一个 token 重试。 */
export function release(whaleHome, id) {
  const hit = load(whaleHome, id)
  if (!hit) return { ok: false, code: 'not-found' }
  const it = hit.item
  it.used = false
  it.usedAt = null
  atomicWrite(hit.file, JSON.stringify(it, null, 2))
  try { fs.unlinkSync(claimPath(whaleHome, id)) } catch {}
  return { ok: true, code: 'released' }
}

/** 作废一条待审（如草稿被拒）：删除令牌，不再在待审列表里出现。 */
export function cancel(whaleHome, id) {
  const hit = load(whaleHome, id)
  if (!hit) return { ok: false, code: 'not-found' }
  try { fs.unlinkSync(hit.file) } catch {}
  try { fs.unlinkSync(claimPath(whaleHome, id)) } catch {}
  return { ok: true, code: 'cancelled' }
}
