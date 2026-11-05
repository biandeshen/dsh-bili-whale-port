/**
 * 安全闸补读侧（F7）+ 待放行超时（F9）。
 *
 * ① **读侧余量**：读护栏按账号记 `readHour` / `readDay`（上限 600 / 3000），
 *    但安全闸面板读的是**另一份** traffic-state.json（写侧），而且只回写侧的几项
 *    ——读侧余量一个字都看不见。于是她某天说"我读不到东西了"，
 *    主人分不清是配额到了还是账号掉线。
 *    这一条钉住：余量能读出来、按账号分、上限就是护栏真正生效的那个数、
 *    读不到账要**说读不到**（不能显示成"余量无限"）。
 *
 * ② **待放行超时**：`dyn-20261102-cd6d4a` 那样一条烂在队列里好几天，
 *    主人早忘了它，某天顺手"全部放行"就飞出去了。
 *    现在的口径：**只标过期，不删**；放行过期项要多确认一次（后端 + 面板双保险）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readReadQuota, READ_QUOTA_DEFAULTS } from '../src/domain/read-quota.ts'
import { WriteGate } from '../src/domain/write-gate.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cap-rq-'))

/** 造一份读护栏的账（放在临时的 WHALE_HOME 下）。 */
function withGuardState(accounts) {
  const home = tmp()
  const dir = path.join(home, 'bili-ai')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'traffic-state.json'), JSON.stringify({ accounts }, null, 2), 'utf8')
  return { env: { WHALE_HOME: home }, dir }
}

test('读侧余量：按账号读出来，上限就是护栏真正生效的那个数', () => {
  const today = new Date().toLocaleDateString('sv-SE')
  const { env } = withGuardState({
    abc123: { date: today, readHour: 12, readDay: 340 },
    def456: { date: today, readHour: 3, readDay: 8 },
  })
  const r = readReadQuota(env)
  assert.equal(r.available, true)
  assert.equal(r.limits.readHourly, READ_QUOTA_DEFAULTS.readHourly)
  assert.equal(r.limits.readDaily, READ_QUOTA_DEFAULTS.readDaily)
  assert.equal(r.accounts.length, 2)
  const abc = r.accounts.find((a) => a.account === 'abc123')
  assert.equal(abc.usedHour, 12)
  assert.equal(abc.usedDay, 340)
  assert.equal(abc.leftHour, READ_QUOTA_DEFAULTS.readHourly - 12)
  assert.equal(abc.leftDay, READ_QUOTA_DEFAULTS.readDaily - 340)
  assert.equal(abc.exhausted, false)
  assert.equal(r.totalDay, 348)
})

test('读侧余量：用满了要说出来（这正是"我读不到东西了"的原因）', () => {
  const today = new Date().toLocaleDateString('sv-SE')
  const { env } = withGuardState({
    full: { date: today, readHour: READ_QUOTA_DEFAULTS.readHourly, readDay: 10 },
    gone: { date: today, readHour: 1, readDay: 99999 },
  })
  const r = readReadQuota(env)
  assert.equal(r.anyExhausted, true)
  assert.equal(r.accounts.find((a) => a.account === 'full').exhausted, true)
  assert.equal(r.accounts.find((a) => a.account === 'gone').exhausted, true)
  assert.equal(r.accounts.find((a) => a.account === 'gone').leftDay, 0)
})

test('读侧余量：跨日的计数不算今天的（护栏跨日清零，口径要一样）', () => {
  const { env } = withGuardState({
    old: { date: '2026-01-01', readHour: 500, readDay: 900 },
  })
  const r = readReadQuota(env)
  const old = r.accounts.find((a) => a.account === 'old')
  assert.equal(old.usedDay, 0, '不是今天的用量不算')
  assert.equal(old.usedHour, 0)
})

test('读侧余量：读不到账要说读不到，不许显示成"余量无限"', () => {
  const home = tmp()
  const r = readReadQuota({ WHALE_HOME: home })
  assert.equal(r.available, false)
  assert.ok(r.note, '要有原因说明')
  assert.equal(r.accounts.length, 0)
})

test('待放行超时：过期的要标出来，但不删', async () => {
  const dir = tmp()
  const gate = new WriteGate({
    dataDir: dir,
    executor: async () => ({ ok: true, dynId: 'd1' }),
  })
  const old = new Date(Date.now() - 72 * 3600_000).toISOString()
  await gate.execute({
    kind: 'dynamic', intent: 'self', target: { bvid: 'BV1aaBBccDD1' }, body: '很久以前的一条',
  })
  // 把这条的时间改成三天前（模拟烂在队列里的稿子）
  const qf = path.join(dir, 'pending-queue.json')
  const items = JSON.parse(fs.readFileSync(qf, 'utf8'))
  items[0].createdAt = old
  fs.writeFileSync(qf, JSON.stringify(items, null, 2), 'utf8')

  const overview = gate.queueOverview(48)
  assert.equal(overview.items.length, 1)
  assert.equal(overview.staleCount, 1)
  assert.ok(overview.oldestAgeHours >= 70)
  assert.equal(gate.listQueue('pending').length, 1, '过期不等于该扔——不许删')
})

test('待放行超时：放行过期项要多确认一次（后端兜底，脚本也一样）', async () => {
  const dir = tmp()
  const gate = new WriteGate({
    dataDir: dir,
    executor: async () => ({ ok: true, dynId: 'd1' }),
  })
  await gate.execute({
    kind: 'dynamic', intent: 'self', target: { bvid: 'BV1aaBBccDD1' }, body: '很久以前的一条',
  })
  const qf = path.join(dir, 'pending-queue.json')
  const items = JSON.parse(fs.readFileSync(qf, 'utf8'))
  items[0].createdAt = new Date(Date.now() - 72 * 3600_000).toISOString()
  fs.writeFileSync(qf, JSON.stringify(items, null, 2), 'utf8')
  const id = items[0].id

  const refused = await gate.release(id)
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'stale')
  assert.match(refused.reason, /小时/)
  assert.equal(gate.listQueue('pending').length, 1, '被拦下时它还在队列里')

  const ok = await gate.release(id, { staleConfirm: true })
  assert.equal(ok.ok, true, '确认了就放行')
  assert.equal(gate.listQueue('pending').length, 0)
})

test('待放行超时：没过期的正常放行（别把正常稿子也拦了）', async () => {
  const dir = tmp()
  const gate = new WriteGate({
    dataDir: dir,
    executor: async () => ({ ok: true, dynId: 'd1' }),
  })
  await gate.execute({
    kind: 'dynamic', intent: 'self', target: { bvid: 'BV1aaBBccDD1' }, body: '刚写的一条',
  })
  const id = gate.listQueue('pending')[0].id
  const ok = await gate.release(id)
  assert.equal(ok.ok, true)
})
