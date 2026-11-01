/**
 * panel 鉴权 —— 宿主自带的信任栅栏（requestRejection 之类）在这里换成 Bearer token。
 * 规则：默认只绑 127.0.0.1；每个请求仍需 Bearer token（fail-closed）；
 * token 首启自动生成，存 <WHALE_HOME>/panel.token（0600），面板页用 ?t= 引导一次。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export function loadToken(whaleHome) {
  const f = path.join(whaleHome, 'panel.token')
  try {
    const t = fs.readFileSync(f, 'utf8').trim()
    if (t) return { file: f, token: t }
  } catch {}
  const t = crypto.randomBytes(24).toString('hex')
  fs.mkdirSync(whaleHome, { recursive: true })
  fs.writeFileSync(f, t + '\n')
  try { fs.chmodSync(f, 0o600) } catch {}
  return { file: f, token: t }
}

export function isLoopback(req) {
  const raw = String(req.headers?.host ?? '').toLowerCase()
  const h = raw.startsWith('[') ? raw.slice(0, raw.indexOf(']') + 1) : raw.split(':')[0]
  if (!(h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1')) return false
  const ip = String(req.socket?.remoteAddress ?? '')
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
}

export function authorized(req, token) {
  if (!isLoopback(req)) return { ok: false, code: 403, error: '只接受本机回环访问' }
  const bearer = String(req.headers?.authorization ?? '').replace(/^Bearer\s+/i, '')
  const q = new URL(req.url, 'http://x').searchParams.get('t') || ''
  const eq = (a) => a.length === token.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(token))
  if (eq(bearer) || eq(q)) return { ok: true }
  return { ok: false, code: 503, error: '缺少或错误的访问令牌（fail-closed）：Bearer 头或 ?t= 均可' }
}
