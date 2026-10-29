// C2 离线空窗：必须证明 tick 时间线里真的断了一段，而不是只过了 8 小时
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { largestOfflineGap, crossesBoundary, readTickTimes } from '../tools/lib/offline-gap.mjs'

const at = (iso) => Date.parse(iso)

test('关机一夜：最大空窗跨 04:00，接近 12h', () => {
  const g = largestOfflineGap([
    at('2026-10-28T21:05:00+08:00'),
    at('2026-10-28T21:10:00+08:00'),
    at('2026-10-29T09:00:00+08:00'),
    at('2026-10-29T09:05:00+08:00'),
  ], { armedAt: at('2026-10-28T21:00:00+08:00'), now: at('2026-10-29T10:00:00+08:00') })
  assert.equal(g.ms, at('2026-10-29T09:00:00+08:00') - at('2026-10-28T21:10:00+08:00'))
  assert.equal(g.crossed, true)
})

test('服务一直在跑：最大空窗只有 5 分钟，不能算离线', () => {
  const armed = at('2026-10-28T20:00:00+08:00')
  const now = armed + 9 * 3600_000
  const ticks = []
  for (let t = armed; t <= now; t += 5 * 60_000) ticks.push(t)
  const g = largestOfflineGap(ticks, { armedAt: armed, now })
  assert.equal(g.ms, 5 * 60_000)
  assert.equal(g.crossed, false)
})

test('04:00 边界判定：跨过才算；05:00 之后到 06:00 不算', () => {
  assert.equal(crossesBoundary(at('2026-10-29T03:00:00+08:00'), at('2026-10-29T05:00:00+08:00')), true)
  assert.equal(crossesBoundary(at('2026-10-29T05:00:00+08:00'), at('2026-10-29T06:00:00+08:00')), false)
})

test('readTickTimes 跳过坏行/缺文件', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'offline-gap-'))
  const d1 = path.join(home, 'd1')
  fs.mkdirSync(d1, { recursive: true })
  fs.writeFileSync(path.join(d1, 'ticks.jsonl'), [
    JSON.stringify({ at: '2026-10-29T09:00:00+08:00' }),
    'not json',
    JSON.stringify({ at: 'bad' }),
    JSON.stringify({ at: '2026-10-29T09:05:00+08:00' }),
  ].join('\n'))
  const ts = readTickTimes(home, ['d1', 'missing'])
  assert.deepEqual(ts, [at('2026-10-29T09:00:00+08:00'), at('2026-10-29T09:05:00+08:00')])
})
