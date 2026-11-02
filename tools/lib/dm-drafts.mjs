/**
 * 私信回信草稿：只落盘，不发送。
 * 审批在 scripts/dm-approve.mjs：一次性 token + kill 开关 + 正文哈希一致才调 `bili dm --go`。
 *
 * 状态：pending（等她写/等主人审）→ dry-run / sent / failed / cooldown / rejected
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { plainOutbound } from './plain-outbound.mjs'

export const MAX_TEXT = 500

export function textHash(text) {
  return crypto.createHash('sha256').update(String(text ?? '')).digest('hex')
}

export function loadDrafts(file) {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    return { items: Array.isArray(j.items) ? j.items : [] }
  } catch { return { items: [] } }
}

export function saveDrafts(file, db) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.' + process.pid + '.' + crypto.randomBytes(3).toString('hex') + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2) + '\n')
  fs.renameSync(tmp, file)
}

export function findDraft(file, id) {
  return loadDrafts(file).items.find((x) => x.id === id) || null
}

/**
 * 入队一条回信草稿。
 * @returns {{ok:true,item:object}|{ok:false,error:string}}
 */
export function addDraft(file, { text, inboundKey = '', who = '', src = '', ackId = '' } = {}) {
  // 入队即清洗：存的就是要发的那份字。放在这里而不是 approve 里，
  // 是为了 textHash 也对齐清洗后的正文——否则「审的是干净稿、发出去另一份字」。
  const body = plainOutbound(text)
  if (!body) return { ok: false, error: '正文是空的' }
  if (body.length > MAX_TEXT) return { ok: false, error: `正文太长（>${MAX_TEXT} 字），砍短一点` }
  // 发送走 `dm.mjs --msg <正文>`；以 -- 开头会被命令行解析成参数，直接拒绝
  if (body.startsWith('--')) return { ok: false, error: '正文不能以 -- 开头（会被当成命令行参数）' }
  const db = loadDrafts(file)
  // 同一封来信只排一条：她一轮里反复调用不会刷出一堆重复草稿
  if (inboundKey && db.items.some((x) => x.status === 'pending' && String(x.inboundKey) === String(inboundKey))) {
    return { ok: false, error: '这封来信已经有一条等他审的回信了' }
  }
  const day = new Date().toLocaleDateString('sv-SE')
  const item = {
    id: `dm-${day.replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex')}`,
    date: day,
    at: new Date().toISOString(),
    inboundKey: String(inboundKey),
    who: String(who).slice(0, 40),
    src: String(src).slice(0, 300),
    text: body,
    textHash: textHash(body),
    status: 'pending',
    ackId: String(ackId),
  }
  db.items.push(item)
  saveDrafts(file, db)
  return { ok: true, item }
}

export function setStatus(file, id, status, extra = {}) {
  const db = loadDrafts(file)
  const hit = db.items.find((x) => x.id === id)
  if (!hit) return null
  Object.assign(hit, extra, { status })
  saveDrafts(file, db)
  return hit
}

/** 把一次性令牌的 id 挂到草稿上（token 本身不落这个文件）。 */
export function attachAck(file, id, { ackId = '', expiresAt = '' } = {}) {
  const db = loadDrafts(file)
  const hit = db.items.find((x) => x.id === id)
  if (!hit) return null
  hit.ackId = String(ackId)
  if (expiresAt) hit.expiresAt = expiresAt
  saveDrafts(file, db)
  return hit
}
