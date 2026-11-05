/**
 * 行动账（append-only NDJSON）——"她今天真做过什么"的凭据。
 *
 * 为什么单独一份账（2026-11-06 三层诊断的第三层）：
 *   `life.json` 的 actionsToday / lastActionAt / lastKind 是**会被覆盖的汇总**，
 *   而 `applyActionRecord` 在生产里**一个调用者都没有**——账一直是 0，
 *   于是 `restPressure` 永远顶在 1.0（"距上次行动 999 小时"），
 *   她自己的对账句也永远说"账上还没有过一次行动"。
 *   这里补上的是一条只追加的流水：每次她记一笔就多一行，谁都能拿它跟 life.json 对账。
 *
 * 为什么不是数据库：一天 4–6 行，一年两千行，读完只要几毫秒；
 * 而 NDJSON 坏了还能一行一行看。**不许因为文件变大就悄悄删旧行**——
 * 要归档另开一份，账本身保持可追溯。
 */
import fs from 'node:fs'
import path from 'node:path'
import { dayKey } from '../../persona-core/src/rhythm.ts'

export interface ActionRecord {
  /** 毫秒时间戳 */
  at: number
  /** 本地日期（sv-SE，与日账口径一致） */
  day: string
  /** 7 类活动之一：rest / explore / create / social / reflect / exercise / consume */
  activity: string
  /** 人话活动名（歇会儿 / 找点新鲜的…） */
  label: string
  /** 她自己补的一句（可空） */
  note?: string
  /** 谁记的：她自己报的 / 主人替她补的 */
  source?: 'self' | 'owner'
}

export interface ActionLedgerView {
  /** 今天的行动条数（跨日自动归零的口径） */
  count: number
  /** 最近一次行动的时间戳（任何一天；0 = 从未） */
  lastAt: number
  /** 今天的流水（新→旧） */
  today: ActionRecord[]
  /** 账里一共多少行（含历史） */
  total: number
}

/** 追加一行。坏行绝不影响主流程：行动本身已经发生了，记不下来是账的问题。 */
export function appendActionRecord(file: string, rec: ActionRecord): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, JSON.stringify(rec) + '\n', 'utf8')
}

export function readActionLedger(file: string, now: number = Date.now()): ActionLedgerView {
  let raw = ''
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return { count: 0, lastAt: 0, today: [], total: 0 }
  }
  const today = dayKey(now)
  const all: ActionRecord[] = []
  for (const line of raw.split('\n')) {
    const s = line.trim()
    if (!s) continue
    try {
      const rec = JSON.parse(s)
      const at = Number(rec?.at ?? 0)
      if (!Number.isFinite(at) || at <= 0) continue
      all.push({
        at,
        day: String(rec?.day ?? dayKey(at)),
        activity: String(rec?.activity ?? ''),
        label: String(rec?.label ?? ''),
        ...(rec?.note ? { note: String(rec.note) } : {}),
        ...(rec?.source === 'owner' ? { source: 'owner' as const } : { source: 'self' as const }),
      })
    } catch { /* 半行（写到一半断电）跳过，别让一行坏账毁掉整本账 */ }
  }
  const todays = all.filter((r) => r.day === today)
  return {
    count: todays.length,
    lastAt: all.reduce((n, r) => Math.max(n, r.at), 0),
    today: todays.sort((a, b) => b.at - a.at),
    total: all.length,
  }
}
