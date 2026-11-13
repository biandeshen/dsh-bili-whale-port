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
  /**
   * 2026-11-14 改期望（原为 quiet）：最后一条是 402，之后没有成功调用 ⇒ 通道**仍然关着**。
   * 旧期望「近 15 分钟没动静 = quiet」正是被假冒恢复坑到的那条逻辑——
   * 线上 00:08:30 因此判成"上游恢复"清零退避，3 秒后又 402。
   * 现在只有「失败之后确实又成功过」才算恢复；quiet 只留给"今天既没成功也没失败"。
   */
  assert.equal(c.verdict, 'stalled-auth', '最后一条是 402 且之后没有成功 → 通道关着，不许判 quiet')
  assert.match(costSummary(c), /说不出口/, '要直说是额度把门关了')
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

test('失败之后一直没有成功 → 仍是 stalled（不许假恢复）；成功之后才回到 ok', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  write(dir, [
    { attempt: { startedAt: `${day}T05:00:00.000Z`, outcome: 'success', status: 200, meters: { input: 1000 } } },
    { attempt: { startedAt: `${day}T05:01:00.000Z`, outcome: 'failed', status: 402, meters: {} } },
  ])
  // 现在已是 06:00：成功与失败都远在 15 分钟之外
  const c = readCostToday({ dataDir: dir, basis: 'utc', now: Date.parse(`${day}T06:00:00.000Z`) })
  /**
   * 2026-11-14 改期望（原为 quiet）。旧口径「两边都过了 15 分钟 → quiet」会让心跳退避清零，
   * 而失败行要等下一次调用才落盘——于是"没有新行"被读成"恢复了"，实测 3 秒后又 402。
   * 现在：最后一次失败之后没有任何成功调用 ⇒ 通道仍关着（stalled-auth）。
   */
  assert.equal(c.verdict, 'stalled-auth', '失败之后没有成功＝通道还关着，不能判成"谁都没动"')
  assert.equal(c.paid, 1, '当日累计数还是要给，只是"当下状态"要判对')

  // 再来一条成功 → 这才是真的恢复
  write(dir, [
    { attempt: { startedAt: `${day}T05:00:00.000Z`, outcome: 'success', status: 200, meters: { input: 1000 } } },
    { attempt: { startedAt: `${day}T05:01:00.000Z`, outcome: 'failed', status: 402, meters: {} } },
    { attempt: { startedAt: `${day}T05:10:00.000Z`, outcome: 'success', status: 200, meters: { input: 900 } } },
  ])
  const ok = readCostToday({ dataDir: dir, basis: 'utc', now: Date.parse(`${day}T06:00:00.000Z`) })
  assert.equal(ok.verdict, 'ok', '失败之后有成功＝通道确实恢复（这一条以前永远判不出来：lastPaidMs 从没赋值）')
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
