// P2b：402 止损。三件事各自钉住：
//   ① 假恢复 —— 402 之后还没有成功调用时，verdict 不许退回 quiet/ok（否则退避被清零）；
//   ② 封顶 —— 退避封顶 60 分钟（原来 30）；
//   ③ 持久化 —— 重启后仍在退避窗口内，不许回到 30 秒一拍。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readCostToday } from '../../../capabilities/cap-state-rhythm/src/cost-today.ts'
import { stallScheduleMs, STALL_MAX_MINUTES, STALL_STEP_MAX } from '../src/stall-backoff.ts'
import { readStallState, writeStallState, clearStallState } from '../src/stall-state.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'stall-p2b-'))
const T0 = Date.parse('2026-11-14T00:00:00+08:00')

function usage(dir, rows) {
  fs.writeFileSync(path.join(dir, 'usage.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
}
const call = (ms, status, input = 0) => ({
  attempt: { startedAt: new Date(ms).toISOString(), status, meters: { input, output: input ? 10 : 0 } },
})

test('① 假恢复：402 之后 20 分钟没有新行，verdict 仍是 stalled-auth（不是 quiet）', () => {
  const dir = tmp()
  usage(dir, [call(T0 - 60 * 60_000, 200, 700000), call(T0 - 20 * 60_000, 402)])
  // 20 分钟 > freshMs(15)，旧逻辑会退回 quiet
  const c = readCostToday({ dataDir: dir, now: T0 })
  assert.equal(c.verdict, 'stalled-auth')
})

test('① 恢复要靠成功调用证明：402 之后又成功 → ok（不许永远卡在停摆）', () => {
  const dir = tmp()
  usage(dir, [call(T0 - 40 * 60_000, 402), call(T0 - 2 * 60_000, 200, 700000)])
  const c = readCostToday({ dataDir: dir, now: T0 })
  assert.equal(c.verdict, 'ok')
})

test('① 今天从没失败过 → 不许被误判成停摆', () => {
  const dir = tmp()
  usage(dir, [call(T0 - 3 * 60_000, 200, 700000)])
  const c = readCostToday({ dataDir: dir, now: T0 })
  assert.equal(c.verdict, 'ok')
})

test('① 429 归 throttled，不与 402 混为一类', () => {
  const dir = tmp()
  usage(dir, [call(T0 - 5 * 60_000, 429)])
  const c = readCostToday({ dataDir: dir, now: T0 })
  assert.equal(c.verdict, 'throttled')
})

test('② 退避序列 2/4/8/16/32/60，封顶 60 分钟', () => {
  const seq = [1, 2, 3, 4, 5, 6, 99].map((s) => stallScheduleMs(s) / 60_000)
  assert.deepEqual(seq, [2, 4, 8, 16, 32, 60, 60])
  assert.equal(STALL_MAX_MINUTES, 60)
  assert.equal(STALL_STEP_MAX, 6)
})

test('③ 持久化：写进去的 until 重启后还能读到', () => {
  const dir = tmp()
  writeStallState(dir, { until: T0 + 30 * 60_000, step: 3, kind: 'stalled-auth' })
  const st = readStallState(dir, T0)
  assert.equal(st.step, 3)
  assert.equal(st.kind, 'stalled-auth')
  assert.ok(st.until > T0)
})

test('③ 坏文件/缺失 → 当作没有（退化成照原节奏，不是"不许动"）', () => {
  const dir = tmp()
  assert.deepEqual(readStallState(dir, T0), { until: 0, step: 0 })
  fs.writeFileSync(path.join(dir, 'stall-backoff.json'), '{坏', 'utf8')
  assert.deepEqual(readStallState(dir, T0), { until: 0, step: 0 })
})

test('③ 过期太久的记录不许拖着（一周前的 until 视为无）', () => {
  const dir = tmp()
  writeStallState(dir, { until: T0 - 7 * 24 * 3600_000, step: 6, kind: 'stalled-auth' })
  assert.equal(readStallState(dir, T0).until, 0)
})

test('③ 清零后读回是空状态', () => {
  const dir = tmp()
  writeStallState(dir, { until: T0 + 60_000, step: 1 })
  clearStallState(dir)
  assert.deepEqual(readStallState(dir, T0), { until: 0, step: 0 })
})
