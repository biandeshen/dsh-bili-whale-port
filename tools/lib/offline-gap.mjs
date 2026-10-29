/**
 * C2 离线空窗：从 tick 时间线里找“最大的一段没有观测的时间”。
 * 只看 arm 到 now 的耗时不够——服务一直跑也会满 8 小时，必须证明中间真的断了。
 */
import fs from 'node:fs'
import path from 'node:path'

/** a 之后最近的一个 04:00 是否落在 (a, b] 内。 */
export function crossesBoundary(a, b, hour = 4) {
  if (!(b > a)) return false
  const d = new Date(a)
  d.setHours(hour, 0, 0, 0)
  let t = d.getTime()
  if (t <= a) {
    d.setDate(d.getDate() + 1)
    t = d.getTime()
  }
  return t <= b
}

/**
 * @param {number[]} timestamps 观测到的 tick 时刻（毫秒）
 * @param {{armedAt:number, now:number, boundaryHour?:number}} opts
 * @returns {{ms:number, from:number, to:number, crossed:boolean}}
 */
export function largestOfflineGap(timestamps, { armedAt, now, boundaryHour = 4 }) {
  const pts = [armedAt, ...timestamps.filter((t) => Number.isFinite(t) && t >= armedAt && t <= now), now]
    .sort((x, y) => x - y)
  let best = { ms: 0, from: armedAt, to: now }
  for (let i = 1; i < pts.length; i += 1) {
    const ms = pts[i] - pts[i - 1]
    if (ms > best.ms) best = { ms, from: pts[i - 1], to: pts[i] }
  }
  return { ...best, crossed: crossesBoundary(best.from, best.to, boundaryHour) }
}

/** 从 days/<d>/ticks.jsonl 收集时刻；坏行跳过，缺文件跳过。 */
export function readTickTimes(daysDir, days) {
  const out = []
  for (const d of days ?? []) {
    let raw = ''
    try { raw = fs.readFileSync(path.join(daysDir, d, 'ticks.jsonl'), 'utf8') } catch { continue }
    for (const line of raw.trim().split('\n')) {
      if (!line.trim()) continue
      try {
        const t = Date.parse(JSON.parse(line).at)
        if (Number.isFinite(t)) out.push(t)
      } catch {}
    }
  }
  return out
}
