/**
 * 会话轮换 —— 抄上游 `sessionRotateDays` 的语义，适配到 Cortico 的能力面。
 *
 * ## 上游是什么（Alterssss/dsh-bili-whale `lib/session-delivery.js:25-32`）
 *
 * ```js
 * const days = Number(cfg.sessionRotateDays ?? 0)
 * const rotating = Number.isFinite(days) && days > 0
 *   && now() - state.startedAt >= days * 86400000
 *   && now() - lastDelivered >= 8 * 60000
 *   && !isBusy()
 * const next = rotating ? { id: randomUUID(), startedAt: now(), rotatedFrom: state.id } : state
 * ```
 * 即：**开启后（days>0）且本会话已用满 N 天、且距上次投递 ≥8 分钟、且不忙** → 换一个新会话，
 * 旧会话保留（`rotatedFrom` 记来源，可回溯）。
 *
 * ## 为什么这里不能照抄"新建 session id"
 *
 * Cortico 的 `CoreApi`（`Cortico-up/src/core/types.ts:530`）**没有** `createSession` /`clearSession`，
 * 只有 `requestContextHandoff()`。Persona 无法自己造 session id。
 * 所以本仓的等价实现是：
 *
 *   **到期 + 空闲 → 请求一次上下文交接**（handoff）。
 *
 * 交接会把"更早的对话换成一份笔记"，效果等价于"换一个新会话但保留记忆"——
 * 这正是上游想要的（旧会话保留、上下文不再无限堆）。差别只在于 session id 不变，
 * 但对我们关心的成本问题（上下文不再单调增长）是同一个效果。
 *
 * ## 语义边界（不能含糊）
 *
 * - **这不是配额**：它不限制"她今天能做几件事"，只限制"一份会话最长用多久"。
 * - **默认关闭**（`sessionRotateDays = 0`），与上游默认一致。
 * - 只在**空闲**时触发：忙的时候交接会把正在进行的回合打断。
 */

import fs from 'node:fs'
import path from 'node:path'

/** 距上次投递至少多久才允许轮换（抄上游 8 分钟） */
export const ROTATE_IDLE_MS = 8 * 60_000

export interface RotationState {
  /** 本"会话段"的起始时间（毫秒）；0 = 还没开始 */
  startedAt: number
  /** 上一次真正投递的时间（毫秒）；0 = 还没投过 */
  lastDeliveredAt: number
  /** 轮换了几次（观测用） */
  rotations: number
}

export const EMPTY_ROTATION: RotationState = { startedAt: 0, lastDeliveredAt: 0, rotations: 0 }

export interface RotationInput {
  /** 配置：轮换天数；0 = 不轮换（上游默认） */
  rotateDays: number
  /** 是否正忙（有回合在跑）；忙的时候不轮换 */
  busy: boolean
  now?: number
}

/**
 * 是否该轮换。返回 `{ rotate, reason }`，reason 用于日志与面板（必须可读）。
 */
export function shouldRotate(state: RotationState, input: RotationInput): { rotate: boolean; reason: string } {
  const now = input.now ?? Date.now()
  const days = Number(input.rotateDays)
  if (!Number.isFinite(days) || days <= 0) {
    return { rotate: false, reason: '会话轮换未开启（sessionRotateDays=0）' }
  }
  if (!state.startedAt) {
    return { rotate: false, reason: '还没记录会话起点（首拍不轮换）' }
  }
  const ageMs = now - state.startedAt
  const needMs = days * 86_400_000
  if (ageMs < needMs) {
    const leftH = ((needMs - ageMs) / 3_600_000).toFixed(1)
    return { rotate: false, reason: `会话用了 ${(ageMs / 86_400_000).toFixed(2)} 天，还差 ${leftH} 小时到 ${days} 天` }
  }
  if (state.lastDeliveredAt && now - state.lastDeliveredAt < ROTATE_IDLE_MS) {
    const waitMin = Math.ceil((ROTATE_IDLE_MS - (now - state.lastDeliveredAt)) / 60_000)
    return { rotate: false, reason: `距上次投递不足 8 分钟（还差 ${waitMin} 分钟），空闲后再轮换` }
  }
  if (input.busy) {
    return { rotate: false, reason: '正在处理回合，忙完再轮换' }
  }
  return { rotate: true, reason: `会话已用 ${(ageMs / 86_400_000).toFixed(2)} 天（≥${days}），空闲中 → 请求交接` }
}

/**
 * 轮换状态的小仓库（落盘，重启后接着算）。
 * 只存三个数，坏了就当没有（退化成"不轮换"，绝不因此让她不许动）。
 */
export class RotationStore {
  private readonly file: string

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'session-rotation.json')
  }

  read(): RotationState {
    try {
      const j = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      const startedAt = Number(j?.startedAt)
      const lastDeliveredAt = Number(j?.lastDeliveredAt)
      const rotations = Number(j?.rotations)
      if (!Number.isFinite(startedAt) || startedAt < 0) return { ...EMPTY_ROTATION }
      return {
        startedAt: Math.max(0, startedAt),
        lastDeliveredAt: Number.isFinite(lastDeliveredAt) ? Math.max(0, lastDeliveredAt) : 0,
        rotations: Number.isFinite(rotations) ? Math.max(0, rotations) : 0,
      }
    } catch {
      return { ...EMPTY_ROTATION }
    }
  }

  write(state: RotationState): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify(state, null, 2), 'utf8')
    } catch { /* 写不进去只影响"重启后从今天重算"，不影响运行 */ }
  }
}
