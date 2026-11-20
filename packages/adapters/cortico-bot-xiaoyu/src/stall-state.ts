/**
 * 停摆退避的**持久化**（2026-11-14 补）。
 *
 * 为什么不能再只放在内存里：实测 23:53 起 402，退避爬到 16 分钟后，`00:08:30` 被判"上游恢复"
 * 清零（那是旧 `cost-today` 的假恢复，已修），紧接着 3 秒后又 402；
 * 更常见的是**进程重启**（主人手动起、崩溃重起）——内存状态清零，于是刚欠费的机器
 * 又按 30 秒一拍往回撞。把 (until, step, 原因) 落到 data 目录，重启后接着用。
 *
 * 界线没变：**这不是配额**。它只推迟"对已知不通的端点再敲一次"，
 * 通道一恢复（成功调用晚于最后一次失败）立刻清零，她一次机会都不少。
 *
 * 坏文件/读不到 = 当作没有（退化成"照原节奏撞几下"），绝不因为一个坏 json 让她不许动。
 */
import fs from 'node:fs'
import path from 'node:path'

export const STALL_STATE_FILE = 'stall-backoff.json'

export interface StallState {
  /** 退避窗口结束的时间戳（ms）；0 = 没有退避 */
  until: number
  /** 第几次退避（1..STALL_STEP_MAX） */
  step: number
  /** 判定来源：402 欠费 or 429 限流 */
  kind?: 'stalled-auth' | 'throttled'
  /** 最后一次失败的时间（ISO），给人看 */
  lastFailureAt?: string
}

const EMPTY: StallState = { until: 0, step: 0 }

export function readStallState(dataDir: string, now = Date.now()): StallState {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dataDir, STALL_STATE_FILE), 'utf8'))
    const until = Number(j?.until)
    const step = Number(j?.step)
    if (!Number.isFinite(until) || !Number.isFinite(step)) return { ...EMPTY }
    /**
     * 2026-11-21 对抗演练修：原来"退避窗口过去 6 小时就整份丢弃"会把 `step` 一起扔掉。
     *
     * 反例（真跑过）：8 小时后读回 `step=0`。而 402 欠费**不会自己好**，
     * 主人隔一天才充值的话，退避就从封顶的 60 分钟退回 2 分钟重爬，一夜又能撞十几次——
     * 正是 2026-11-14 修过的那个毛病在长停摆下复发。
     *
     * 现在的规则分开处置两件事：
     *   · `until` 过期 → 窗口结束，可以试（这是对的，不算"恢复"）
     *   · `step` 只有**通道真的恢复**（`clearStallState`）才归零，不因为时间流逝而归零
     * 只保留一条兜底：一周以上的记录当作陈年残留（那时 step 早该被 clear 掉）。
     * 用 `>=`：恰好一周也算过期，与 `stall-stoploss.test.mjs` ③ 的口径一致。
     */
    if (until > 0 && now - until >= 7 * 24 * 3600_000) return { ...EMPTY }
    return {
      until: Math.max(0, until),
      step: Math.max(0, step),
      ...(j?.kind === 'stalled-auth' || j?.kind === 'throttled' ? { kind: j.kind } : {}),
      ...(typeof j?.lastFailureAt === 'string' ? { lastFailureAt: j.lastFailureAt } : {}),
    }
  } catch {
    return { ...EMPTY }
  }
}

export function writeStallState(dataDir: string, s: StallState): void {
  try {
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(path.join(dataDir, STALL_STATE_FILE), JSON.stringify(s, null, 2), 'utf8')
  } catch {
    // 写不进去就只影响"重启后还要再撞几下"，不影响本次退避
  }
}

export function clearStallState(dataDir: string): void {
  try {
    fs.rmSync(path.join(dataDir, STALL_STATE_FILE), { force: true })
  } catch { /* 删不掉也无害：下一条成功调用会把它覆盖成 until=0 */ }
}
