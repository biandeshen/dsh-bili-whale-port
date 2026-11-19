// P2：她停了多久必须可见。四次状态（运行中/已暂停/已关机/余额不足）必须分得开，
// 且每种都带"多久了"。两次事故（停 25h、停 3d22h）在页面上都只是"她很安静"。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readLiveness, readInstanceLiveness } from '../src/liveness.ts'

const T0 = Date.parse('2026-11-13T23:00:00+08:00')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'liveness-'))

function usage(dir, rows) {
  fs.writeFileSync(path.join(dir, 'usage.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
}
function lock(dir, pid) {
  fs.writeFileSync(path.join(dir, 'instance.lock'), JSON.stringify({ pid, startedAt: new Date(T0 - 3600_000).toISOString() }), 'utf8')
}
const okAt = (ms) => ({ ts: new Date(ms).toISOString(), status: 200 })
const errAt = (ms, status) => ({ ts: new Date(ms).toISOString(), status })

test('运行中：进程活着 + 最近有成功调用', () => {
  const dir = tmp()
  lock(dir, process.pid)
  usage(dir, [okAt(T0 - 5 * 60_000)])
  const r = readLiveness({ dataDir: dir, now: T0 })
  assert.equal(r.kind, 'running')
  assert.match(r.line, /运行中/)
  assert.match(r.line, /最近一次成功调用/)
  assert.ok(r.lastOkAt)
})

test('已关机：instance.lock 的 pid 不存在（这是 11-10 那次停 3 天 22 小时的样子）', () => {
  const dir = tmp()
  lock(dir, 999999)          // 几乎不可能存在的 pid
  usage(dir, [okAt(T0 - 3 * 24 * 3600_000)])
  const r = readLiveness({ dataDir: dir, now: T0 })
  assert.equal(r.kind, 'stopped')
  assert.match(r.line, /已关机/)
  assert.match(r.line, /已停 3 天/)
  assert.match(r.line, /不是"她很安静"/)
})

test('已暂停：进程活着但总线暂停（这是 11-06 那次停 25 小时的样子）', () => {
  const dir = tmp()
  lock(dir, process.pid)
  usage(dir, [okAt(T0 - 25 * 3600_000)])
  const r = readLiveness({ dataDir: dir, now: T0, processState: 'paused' })
  assert.equal(r.kind, 'paused')
  assert.match(r.line, /已暂停/)
  assert.match(r.line, /已停 25 小时/)
})

test('余额不足单独成类：402 比暂停更硬，恢复也不会活', () => {
  const dir = tmp()
  lock(dir, process.pid)
  usage(dir, [okAt(T0 - 40 * 60_000), errAt(T0 - 10 * 60_000, 402)])
  const r = readLiveness({ dataDir: dir, now: T0 })
  assert.equal(r.kind, 'no-balance')
  assert.match(r.line, /余额不足/)
  assert.match(r.line, /恢复也不会活/)
  assert.match(r.line, /充值/)
})

test('402 之后又有成功调用 → 不再是余额不足（恢复要能看出来）', () => {
  const dir = tmp()
  lock(dir, process.pid)
  usage(dir, [errAt(T0 - 20 * 60_000, 402), okAt(T0 - 5 * 60_000)])
  const r = readLiveness({ dataDir: dir, now: T0 })
  assert.equal(r.kind, 'running')
})

test('没有任何账：不猜，明确说"没有任何调用读数"', () => {
  const dir = tmp()
  lock(dir, process.pid)
  const r = readLiveness({ dataDir: dir, now: T0 })
  assert.equal(r.silentMinutes, null)
  assert.match(r.line, /没有任何调用读数|没有一次成功调用/)
})

test('instance.lock 坏掉/缺失 → 未知，不当成"已关机"', () => {
  const dir = tmp()
  fs.writeFileSync(path.join(dir, 'instance.lock'), '{ 坏 json', 'utf8')
  const l = readInstanceLiveness(dir)
  assert.equal(l.alive, null)
  const r = readLiveness({ dataDir: dir, now: T0 })
  // 未知 + 没有调用读数 → 不能判成 stopped（那是污蔑：可能只是还没开口）
  assert.notEqual(r.kind, 'stopped')
})

test('basis 要写明依据（可复现，不许只给结论）', () => {
  const dir = tmp()
  lock(dir, process.pid)
  usage(dir, [okAt(T0 - 60_000)])
  const r = readLiveness({ dataDir: dir, now: T0 })
  assert.ok(r.basis.some((b) => b.includes('usage.jsonl')))
  assert.ok(r.basis.some((b) => b.includes('instance.lock')))
})
