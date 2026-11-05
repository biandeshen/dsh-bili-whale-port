/**
 * 读侧配额余量（审计 §2.7 F7）。
 *
 * 缺口长什么样：读护栏（`platform/traffic.mjs`）按**账号**记着
 * `readHour` / `readDay`，上限是 `readHourly: 600` / `readDaily: 3000`；
 * 但安全闸面板读的是**另一份** `traffic-state.json`（写侧那份），
 * 而且 `readTraffic()` 只回写侧的几项——**读侧余量一个字都看不见**。
 *
 * 于是：她某天突然说"我读不到东西了"，主人不知道是配额到了还是账号掉线；
 * 想调上限也不知道去哪儿调。
 *
 * 这一份把读护栏那份账**读出来给人看**（只读，不改）：
 *   · 按账号列出本小时 / 本日已用与上限；
 *   · 余量 = 上限 − 已用；
 *   · 上限本身来自读护栏的 `riskSettings()`（`platform/traffic.mjs` 的 RISK_DEFAULTS + 配置覆盖），
 *     所以**面板上显示的就是真正生效的那个数**，不是另一份副本。
 *
 * **为什么只读不改**：改配额要改读护栏那份配置（`~/.dsh/bili-ai/risk.json` 之类），
 * 那是另一条路；这里硬造一个"能改但没接到护栏"的旋钮，就是又一个空旋钮。
 * 要调就调真配置，读余量只是把它显出来。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 读护栏的默认预算（与 platform/traffic.mjs 的 RISK_DEFAULTS 保持一致）。 */
export const READ_QUOTA_DEFAULTS = {
  readHourly: 600,
  readDaily: 3000,
} as const

export interface ReadQuotaAccount {
  /** 账号指纹：读护栏自己给的名字（cookie 的哈希前缀，不是 uid，也不是原文） */
  account: string
  /** 记账日期（sv-SE 日界） */
  date: string
  readHour: number
  readDay: number
  /** 本小时已用 */
  usedHour: number
  /** 本日已用 */
  usedDay: number
  hourLimit: number
  dayLimit: number
  /** 本小时余量 */
  leftHour: number
  /** 本日余量 */
  leftDay: number
  /** 是否已经用满（用满就是"我读不到东西了"的原因） */
  exhausted: boolean
  /**
   * 什么时候恢复（毫秒时间戳；0 = 已经恢复或不适用）。
   *
   * 护栏的窗口口径：小时计数在 `now - hourAt >= 1h` 时清零，
   * 日计数在跨日（sv-SE 日界）时清零。所以：
   *   · 小时窗口满了 → hourAt + 1h 那一刻恢复；
   *   · 日窗口满了 → 下一个本地日界的 00:00 恢复。
   * 主人问"什么时候能读"时，答案就在这里——不给这个就等于让人干等。
   */
  resetsAt: number
  /** 现在离恢复还有多久（毫秒；0 = 现在就能用） */
  resetsInMs: number
}

export interface ReadQuotaReport {
  /** 护栏真正生效的上限 */
  limits: { readHourly: number; readDaily: number }
  accounts: ReadQuotaAccount[]
  /** 所有账号合计的本日用量 */
  totalDay: number
  /** 合计余量 */
  totalLeftDay: number
  /** 有没有任何账号用满了 */
  anyExhausted: boolean
  /**
   * 最早能读的时刻（毫秒；0 = 现在就能读）。
   * 所有用满的账号里，**最早**恢复的那个——主人只要等这个点。
   */
  nextAvailableAt: number
  /** 距那个点还有多久（毫秒；0 = 现在就能读） */
  nextAvailableInMs: number
  /** 读不到护栏的账（没跑过 / 路径变了）——页面上要说清，别显示成"余量无限" */
  available: boolean
  note?: string
}

/** 读护栏的状态目录：`<WHALE_HOME>/bili-ai`（platform/paths.mjs 的 stateDir 口径）。 */
export function readGuardStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.WHALE_HOME || env.DSH_HOME || path.join(env.USERPROFILE || env.HOME || os.homedir(), '.dsh')
  return path.join(home, 'bili-ai')
}

/** 下一个本地日界（00:00）的时间戳——日窗口恢复点。 */
function nextLocalMidnight(now: number): number {
  const d = new Date(now)
  d.setHours(24, 0, 0, 0)
  return d.getTime()
}

/** 读护栏那份账（按账号分）。读不到就如实说读不到。 */
export function readReadQuota(env: NodeJS.ProcessEnv = process.env, now: number = Date.now()): ReadQuotaReport {
  const limits = { ...READ_QUOTA_DEFAULTS }
  const stateFile = path.join(readGuardStateDir(env), 'traffic-state.json')

  // 上限：配置覆盖优先（读护栏 riskSettings() 的口径），没有就用默认值。
  try {
    const cfgFile = path.join(readGuardStateDir(env), 'risk.json')
    const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')).risk ?? {}
    if (Number.isFinite(Number(cfg.readHourly)) && Number(cfg.readHourly) > 0) limits.readHourly = Math.floor(Number(cfg.readHourly))
    if (Number.isFinite(Number(cfg.readDaily)) && Number(cfg.readDaily) > 0) limits.readDaily = Math.floor(Number(cfg.readDaily))
  } catch { /* 没有配置就用默认 */ }

  let raw: any = null
  try {
    raw = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
  } catch (e: any) {
    return {
      limits,
      accounts: [],
      totalDay: 0,
      totalLeftDay: limits.readDaily,
      anyExhausted: false,
      nextAvailableAt: 0,
      nextAvailableInMs: 0,
      available: false,
      note: `读不到读护栏的账（${stateFile}）：${String(e?.message ?? e)}`,
    }
  }

  const today = new Date().toLocaleDateString('sv-SE')
  const accounts: ReadQuotaAccount[] = []
  for (const [account, a] of Object.entries((raw?.accounts ?? {}) as Record<string, any>)) {
    const date = String(a?.date ?? '')
    // 跨日的 readDay 已被护栏清零；日期不同的那一小时计数也早失效了。
    const readHour = date === today ? Number(a?.readHour ?? 0) : 0
    const readDay = date === today ? Number(a?.readDay ?? 0) : 0
    const leftHour = Math.max(0, limits.readHourly - readHour)
    const leftDay = Math.max(0, limits.readDaily - readDay)
    const hourFull = readHour >= limits.readHourly
    const dayFull = readDay >= limits.readDaily
    // 什么时候恢复：小时窗口在 hourAt+1h 清零；日窗口在下一个本地日界（00:00）清零。
    // 两个都满了 → 取**更晚**的那个（真正能读要等两个窗口都过）。
    const hourResetAt = hourFull ? Number(a?.hourAt ?? 0) + 3600_000 : 0
    const dayResetAt = dayFull ? nextLocalMidnight(now) : 0
    const resetsAt = dayResetAt && hourResetAt ? Math.max(hourResetAt, dayResetAt) : (hourResetAt || dayResetAt)
    accounts.push({
      account,
      date,
      readHour,
      readDay,
      usedHour: readHour,
      usedDay: readDay,
      hourLimit: limits.readHourly,
      dayLimit: limits.readDaily,
      leftHour,
      leftDay,
      exhausted: hourFull || dayFull,
      resetsAt,
      resetsInMs: resetsAt > now ? resetsAt - now : 0,
    })
  }
  accounts.sort((a, b) => a.usedDay - b.usedDay)
  const totalDay = accounts.reduce((n, a) => n + a.usedDay, 0)
  // 最早能读：所有用满的账号里，恢复得最早的那个
  const waiting = accounts.filter((a) => a.exhausted && a.resetsAt > 0)
  const nextAvailableAt = waiting.length ? Math.min(...waiting.map((a) => a.resetsAt)) : 0
  return {
    limits,
    accounts,
    totalDay,
    totalLeftDay: Math.max(0, limits.readDaily - totalDay),
    anyExhausted: accounts.some((a) => a.exhausted),
    nextAvailableAt,
    nextAvailableInMs: nextAvailableAt > now ? nextAvailableAt - now : 0,
    available: true,
  }
}
