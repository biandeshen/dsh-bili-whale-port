/**
 * 来源预算 —— 每个 (source, field) 每天累计最多生效多少。
 *
 * 为什么需要：`bili_mood_apply` 的 custom 效果由模型填写，单次 |delta|≤0.5、可反复调用；
 * 没有预算时，模型可以在一个下午把 mood 从 -1 拉到 +1，人格状态失去意义。
 * 预算是"当天这个来源这个场最多还能推动多少"，超出部分当次归零（但仍记在账本里，便于解释）。
 *
 * 规则：
 * - 键 = `${source}|${field}`；只对幅度计费，正负都算（防止刷负面）。
 * - 换日（04:00 日界）清零；`decay` 无上限。
 * - 部分生效：余额不足时按剩余额度截断，而不是整条丢弃。
 */
import type { Effect } from './types.ts'
import { dayKey } from './rhythm.ts'

export interface BudgetLedger {
  day: string
  /** key = `${source}|${field}`，值为当天已生效的累计幅度 */
  spent: Record<string, number>
}

export interface ClippedEffect {
  source: string
  field: string
  requested: number
  allowed: number
}

const UNLIMITED = Number.POSITIVE_INFINITY

/** 每日来源上限（按场）。初值来自 ARCHITECTURE §12.2，action/silence/custom 为补的三源。 */
export const SOURCE_DAILY_CAP: Record<string, number> = {
  rest: 0.25,
  watched: 0.30,
  'master-reply': 0.20,
  inbound: 0.20,
  silence: 0.15,
  'draft-ok': 0.10,
  'draft-no': 0.10,
  risk: 0.10,
  action: 0.20,
  custom: 0.15,
  decay: UNLIMITED,
}

export const DEFAULT_DAILY_CAP = 0.10

export function emptyBudget(): BudgetLedger {
  return { day: '', spent: {} }
}

export function capFor(source: string): number {
  return SOURCE_DAILY_CAP[source] ?? DEFAULT_DAILY_CAP
}

export function applyBudgets(
  effects: Effect[],
  ledger: BudgetLedger,
  nowMs: number,
): { effects: Effect[]; ledger: BudgetLedger; clipped: ClippedEffect[] } {
  const day = dayKey(nowMs)
  const spent: Record<string, number> = ledger.day === day ? { ...ledger.spent } : {}
  const out: Effect[] = []
  const clipped: ClippedEffect[] = []

  for (const e of effects) {
    const cap = capFor(e.source)
    if (!Number.isFinite(cap)) { out.push(e); continue }
    const key = `${e.source}|${String(e.field)}`
    const used = spent[key] ?? 0
    const remaining = Math.max(0, cap - used)
    const requested = Math.abs(e.delta)
    const allowedMag = Math.min(requested, remaining)
    if (allowedMag > 0) {
      out.push({ ...e, delta: Math.sign(e.delta) * allowedMag })
      spent[key] = used + allowedMag
    }
    if (allowedMag < requested) {
      clipped.push({ source: e.source, field: String(e.field), requested: e.delta, allowed: Math.sign(e.delta) * allowedMag })
    }
  }

  return { effects: out, ledger: { day, spent }, clipped }
}
