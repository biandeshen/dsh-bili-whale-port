/**
 * 回信时效门 —— 唯一事实源是 `life.json` 里的这三个字段，且都是毫秒：
 *   lastDmReadAt   最后一次成功读到收件箱的时刻（空读也算读到；读取失败不刷新）
 *   lastInboundKey 她当前要回的那一封的 key
 *   lastInboundAt  那一封送达的时刻
 * 窗口取两者较新的一次：回信靠的是"上下文还新鲜"，不是"信本身还不旧"——
 * 信躺了 8 天但她刚读过收件箱，上下文就在手边；7 天没碰过收件箱才不硬回。
 *
 * `control/dm-applied.json` 的 keys 只记"这封的效果已经加过了"，不参与能否回信判定；
 * 判定只看这里，两处各自推进会互相把对方作废（读信推进游标、门判过期）。
 */
import { toMs } from './dm.ts'

export const DM_REPLY_WINDOW_MS = 7 * 86400_000

export interface ReplyGateLife {
  lastInboundKey?: string | number | null
  lastDmReadAt?: number | string | null
  lastInboundAt?: number | string | null
}

export function canReply(
  life: ReplyGateLife | null | undefined,
  nowMs: number = Date.now(),
): { ok: boolean; reason: 'ok' | 'no-key' | 'stale' } {
  if (!life?.lastInboundKey) return { ok: false, reason: 'no-key' }
  // toMs：落盘数据里有秒值（B站 原始时间戳），不迁移文件，读的时候归一。
  const at = Math.max(toMs(Number(life.lastDmReadAt ?? 0)), toMs(Number(life.lastInboundAt ?? 0)))
  if (!at || !Number.isFinite(at)) return { ok: false, reason: 'stale' }
  if (nowMs - at >= DM_REPLY_WINDOW_MS) return { ok: false, reason: 'stale' }
  return { ok: true, reason: 'ok' }
}

/** 成功读了一次收件箱（命中或空都算）。调用方负责落盘。 */
export function noteInboxRead(life: ReplyGateLife, atMs: number = Date.now()): void {
  life.lastDmReadAt = atMs
}

/**
 * 记下"这一封"：它既是回信的靶子，也证明她此刻读过收件箱。
 * 重复投递（效果已加过、只补确认）的那一封同样要记——否则 key 停在旧值，
 * 她会拿到"最近没有他的新消息"，而那封信其实刚读出来。
 */
export function noteInbound(
  life: ReplyGateLife,
  msg: { key: string; ts: number },
  atMs: number = Date.now(),
): void {
  life.lastInboundKey = msg.key
  life.lastInboundAt = msg.ts > 0 ? toMs(msg.ts) : atMs
  life.lastDmReadAt = atMs
}

export const DM_REPLY_MAX_CHARS = 500

export interface DmAutoPlan {
  ok: boolean
  reason: 'ok' | 'empty' | 'too-long' | 'no-key' | 'stale'
  /** bili.mjs 的参数；仅 ok 时有效。发送侧仍过 traffic 风控与互关检查。 */
  args: string[]
}

/** 回信直发计划：给主人的私信免人工审批，文案校验与时效门和草稿模式相同。 */
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
