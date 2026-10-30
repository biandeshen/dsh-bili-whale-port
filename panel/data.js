/**
 * panel 数据聚合 —— 补三个 core 端点的缺口（docs/BASELINE.md 缺口①②③）：
 *   /api/timeline  事件流游标分页（M1a：主源 causal.jsonl，缺失才回退 whale-log.jsonl；
 *                   契约抄 AMpath life-history-query：cursor=偏移行号，降序）
 *   /api/diary     两本日记正文（private 从无端点 → 这里只读补上）
 *   /api/vitals    鱼缸 HUD：status+deps.scheduler+traffic 余量（面板自算 settings−used）+ pending 数（M1a：三队列合计）
 */
import fs from 'node:fs'
import path from 'node:path'
import { riskSettings } from '../tools/lib/traffic.mjs'
import { causalFile, normalizeCausalEntry, readCausalLines } from './causal.mjs'
import { collectDrafts, NEEDS } from './drafts.mjs'

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }

export function timeline(whaleHome, { cursor = 0, limit = 50 } = {}) {
  // M1a：她的一天 —— 先读 Cortico 写的因果链；新机器/未开跑时回退旧 whale-log
  let lines = readCausalLines(whaleHome)
  const fromCausal = lines.length > 0
  if (!fromCausal) {
    const f = path.join(whaleHome, 'whale-log.jsonl')
    try { lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean) } catch {
      return { ok: true, items: [], next: null, total: 0, source: 'none' }
    }
  }
  const start = Math.max(0, Math.min(lines.length, Number(cursor) || 0))
  const page = lines.slice(start, start + Math.min(200, Math.max(1, Number(limit) || 50))).map((l) => {
    try {
      const e = JSON.parse(l)
      return fromCausal ? (normalizeCausalEntry(e) ?? null) : e
    } catch { return { at: null, kind: 'parse-error', note: l.slice(0, 120) } }
  }).filter(Boolean)
  page.reverse() // 降序：最新在前（AMpath life-history 同款语义）
  const next = start + page.length < lines.length ? start + page.length : null
  return { ok: true, items: page, next, total: lines.length, source: fromCausal ? 'causal' : 'whale-log' }
}

export function diary(whaleHome) {
  const pick = (name) => {
    try {
      const text = fs.readFileSync(path.join(whaleHome, name), 'utf8')
      return { bytes: Buffer.byteLength(text, 'utf8'), updatedAt: fs.statSync(path.join(whaleHome, name)).mtime.toISOString(), text: text.slice(-12_000) }
    } catch { return null }
  }
  return { ok: true, owner: pick('whale-diary.md'), private: pick('whale-diary-private.md') }
}

export function vitals({ whaleHome, home, traffic, schedStatusGetter }) {
  const status = readJson(path.join(home, '.bili-ai', 'quota.json')) ?? { log: [] }
  const today = new Date().toLocaleDateString('sv-SE')
  const todays = (status.log ?? []).filter((x) => new Date(x.at).toLocaleDateString('sv-SE') === today)
  const t = traffic.status()
  const RISK = riskSettings()
  const acct = Object.values(t.accounts ?? {})[0] ?? null
  const isToday = acct && acct.date === new Date().toLocaleDateString('sv-SE')
  const inHour = acct && Number(acct.hourAt) === Math.floor(Date.now() / 3_600_000)
  const remaining = acct ? {
    readHour: Math.max(0, RISK.readHourly - (inHour ? acct.readHour ?? 0 : 0)),
    readDay: Math.max(0, RISK.readDaily - (isToday ? acct.readDay ?? 0 : 0)),
    writeHour: Math.max(0, RISK.writeHourly - (inHour ? acct.writeHour ?? 0 : 0)),
    writeDay: Math.max(0, RISK.writeDaily - (isToday ? acct.writeDay ?? 0 : 0)),
  } : null
  const pending = readJson(path.join(home, '.bili-ai', 'pending-replies.json'))
  const gogate = (pending?.items ?? []).length
  // M1a：bubble 的“等你审”必须是三队列合计 —— 只算 go-gate 会让有 3 条动态稿的面板说“没事”
  const d = collectDrafts({ whaleHome })
  return {
    ok: true, today,
    scheduler: schedStatusGetter(),
    shares: todays.filter((x) => x.share).length,
    commentsToday: todays.length,
    plan: readJson(path.join(whaleHome, 'whale-night.json')),
    traffic: { settings: RISK, pausedUntil: t.until ?? null, streak: t.streak ?? 0, last: t.last ?? null, remaining },
    pendingCount: gogate + d.needs,
    pendingParts: { gogate, dynamic: d.dynamic.filter((x) => NEEDS.has(x.status)).length, dm: d.dm.filter((x) => NEEDS.has(x.status)).length },
  }
}
