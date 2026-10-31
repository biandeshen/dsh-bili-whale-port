/**
 * 私信传感器输出解析 —— `bili.mjs dm-await --json --peek` 的退出约定：
 *   0 = 有消息（stdout 最后一行 JSON）/ 1 = 正常空 / 2 = 输入问题 / 3 = 读取失败。
 * 关键规则：**读取失败不能被当成"没人写信"**（ARCHITECTURE §2.3 不变量 4 / 裁决 18），
 * 否则关系机会误判为被冷落。
 *
 * 时间戳在这个边界上统一成毫秒：B站 给的是秒，而本地一切 `*At` 都是毫秒。
 */

/** 秒或毫秒 → 毫秒（10 位是秒；13 位是毫秒，两者不会混）。 */
export function toMs(ts: number): number {
  return Number.isFinite(ts) && ts > 0 && ts < 1e11 ? Math.round(ts * 1000) : ts
}

export interface DmMessage {
  hit: true
  mid: string
  name: string
  text: string
  /** 毫秒 */
  ts: number
  key: string
  receipt: string
}

export type DmPeek =
  | { kind: 'hit'; message: DmMessage }
  | { kind: 'empty' }
  | { kind: 'error'; detail: string }

export function parseDmPeek(status: number, out: string): DmPeek {
  if (status === 1) return { kind: 'empty' }
  if (status !== 0) return { kind: 'error', detail: (out || '').trim().slice(0, 300) || ('exit=' + status) }
  const line = out.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith('{')).pop()
  if (!line) return { kind: 'error', detail: 'no-json' }
  let raw: any
  try { raw = JSON.parse(line) } catch { return { kind: 'error', detail: 'bad-json' } }
  if (raw?.hit === false) return { kind: 'empty' }
  if (raw?.hit !== true || typeof raw.text !== 'string' || typeof raw.receipt !== 'string' || typeof raw.key !== 'string') {
    return { kind: 'error', detail: 'bad-message' }
  }
  return {
    kind: 'hit',
    message: {
      hit: true,
      mid: String(raw.mid ?? ''),
      name: String(raw.name ?? '主人'),
      text: raw.text,
      ts: toMs(Number(raw.ts ?? 0)),
      key: raw.key,
      receipt: raw.receipt,
    },
  }
}
