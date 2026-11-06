// P2 成本可见的内核：把"累 / 设计如此 / 没钱了"在一处读数里分开。
// 钉三件事：① 付费与失败分开计（失败不计 token，混在一起会把 2396 次失败说成"今天很贵"）；
// ② 402 连着来 → verdict 必须是 stalled-auth（说不出口），不能读成"她安静"；
// ③ 顶到模型上限的次数要数出来（这是 P1 那张占比表的入口指标）。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readCostToday, costSummary } from '../packages/cap-state-rhythm/src/cost-today.ts'

function write(dir, rows) {
  fs.writeFileSync(path.join(dir, 'usage.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
}

const day = '2026-11-07'
const base = `${day}T05:00:00.000Z`

test('付费与失败分开计，且能数出顶到上限的次数', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  write(dir, [
    { attempt: { startedAt: `${day}T05:00:00.000Z`, outcome: 'success', status: 200, meters: { input: 600000, output: 300 } } },
    { attempt: { startedAt: `${day}T05:10:00.000Z`, outcome: 'success', status: 200, meters: { input: 1048570, output: 120 } } },
    { attempt: { startedAt: `${day}T05:20:00.000Z`, outcome: 'failed', status: 402, meters: { input: null } } },
    // 昨天的三条不能混进来（日界口径）
    { attempt: { startedAt: '2026-11-06T23:59:00.000Z', outcome: 'success', status: 200, meters: { input: 900000 } } },
  ])
  const c = readCostToday({ dataDir: dir, basis: 'utc', now: Date.parse(`${day}T06:00:00.000Z`) })
  assert.equal(c.calls, 3, '只数当天三条')
  assert.equal(c.paid, 2)
  assert.equal(c.failed, 1)
  assert.equal(c.atCeiling, 1, '≥95% 上限的那次要数出来')
  assert.equal(c.statusCounts['402'], 1)
  assert.match(costSummary(c), /近 15 分钟没有新调用/, 'quiet 的措辞要说"这一阵没动静"，不能说成"今天没调用"')
  assert.match(costSummary(c), /今天 3 次调用/, '当日累计要一并给出来')
})

test('402 最近还在发生 → verdict=stalled-auth，不是"她很安静"', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  write(dir, [
    { attempt: { startedAt: `${day}T05:00:00.000Z`, outcome: 'success', status: 200, meters: { input: 1000 } } },
    { attempt: { startedAt: `${day}T05:56:00.000Z`, outcome: 'failed', status: 402, meters: {} } },
  ])
  const c = readCostToday({ dataDir: dir, basis: 'utc', now: Date.parse(`${day}T06:00:00.000Z`) })
  assert.equal(c.verdict, 'stalled-auth')
  assert.equal(c.stalledMinutes, 4)
  assert.match(costSummary(c), /说不出口/, '要直说是额度把门关了')
})

test('近 15 分钟两边都没动静 → quiet，不是 ok（别让人读成"她选择沉默"）', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  write(dir, [
    { attempt: { startedAt: `${day}T05:00:00.000Z`, outcome: 'success', status: 200, meters: { input: 1000 } } },
    { attempt: { startedAt: `${day}T05:01:00.000Z`, outcome: 'failed', status: 402, meters: {} } },
  ])
  // 现在已是 06:00：成功与失败都远在 15 分钟之外
  const c = readCostToday({ dataDir: dir, basis: 'utc', now: Date.parse(`${day}T06:00:00.000Z`) })
  assert.equal(c.verdict, 'quiet', '既没成功也没失败＝这一阵谁都没动，不能报"通道开着她在沉默"')
  assert.equal(c.paid, 1, '当日累计数还是要给，只是"当下状态"要判对')
})

test('半行（进程被杀）不炸；没有账的文件要说明白', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.writeFileSync(path.join(dir, 'usage.jsonl'), '{"attempt":{"startedAt":"2026-11-07T05:00:00.000Z","status":200,"meters":{"input":5}}}\n{"attempt":{"star', 'utf8')
  const c = readCostToday({ dataDir: dir, basis: 'utc', now: Date.parse(`${day}T06:00:00.000Z`) })
  assert.equal(c.paid, 1, '坏半行要被跳过而不是整本读不了')
  const missing = readCostToday({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cost-none-')), basis: 'utc' })
  assert.match(missing.note, /不存在/, '没有账要说"没有账"，不能报 0 次=她很安静')
})
