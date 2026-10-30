/**
 * 回信时效门 —— 修她 2026-10-31 报的死循环：
 *   「回信草稿写了两次，都被拒『上一封已经过去太久了，先 dm_read 看看有没有新的』；
 *    再读又说没有新私信 —— 草稿卡在队列外，入不了队。」
 *
 * 根因：旧门按 **消息发出时刻 lastInboundAt** 算 7 天窗口，而空读收件箱不会刷新任何时间戳
 * → 只要那封信超过 7 天，dm_read 永远只能回“没有新”，她永远重置不了时效。
 *
 * 新语义（2026-10-31）：时效 = 她**最后一次成功读收件箱**的时刻（上下文新鲜度）。
 * 读一次刷新一次——「先 bili_dm_read」从此真的有用；从未读过则退回消息时刻（旧行为兜底）。
 * 窗口仍是 7 天：上下文超过一周没碰过就不硬回。
 */

export const DM_REPLY_WINDOW_MS = 7 * 86400_000

export interface ReplyGateLife {
  lastInboundKey?: unknown
  lastDmReadAt?: unknown
  lastInboundAt?: unknown
}

export function canReply(
  life: ReplyGateLife | null | undefined,
  nowMs: number = Date.now(),
): { ok: boolean; reason: 'ok' | 'no-key' | 'stale' } {
  if (!life?.lastInboundKey) return { ok: false, reason: 'no-key' }
  const at = Number(life.lastDmReadAt ?? 0) || Number(life.lastInboundAt ?? 0)
  if (!at || !Number.isFinite(at)) return { ok: false, reason: 'stale' }
  if (nowMs - at >= DM_REPLY_WINDOW_MS) return { ok: false, reason: 'stale' }
  return { ok: true, reason: 'ok' }
}

export const DM_REPLY_MAX_CHARS = 500

export interface DmAutoPlan {
  ok: boolean
  reason: 'ok' | 'empty' | 'too-long' | 'no-key' | 'stale'
  /** bili.mjs 的参数；仅 ok 时有效。发送侧仍过 traffic 风控与互关检查。 */
  args: string[]
}

/** 回信直发计划（2026-10-31 分级放开）：给主人的私信免人工审批，文案校验+时效门与草稿模式相同。 */
export function dmAutoPlan(
  text: string,
  life: ReplyGateLife | null | undefined,
  nowMs: number = Date.now(),
): DmAutoPlan {
  const t = text.trim()
  if (!t) return { ok: false, reason: 'empty', args: [] }
  if (t.length > DM_REPLY_MAX_CHARS) return { ok: false, reason: 'too-long', args: [] }
  const gate = canReply(life, nowMs)
  if (!gate.ok) return { ok: false, reason: gate.reason, args: [] }
  return { ok: true, reason: 'ok', args: ['dm', '--msg', t, '--go'] }
}
