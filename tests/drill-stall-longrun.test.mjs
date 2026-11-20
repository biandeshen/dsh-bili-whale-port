// 对抗演练（2026-11-21）：停摆保护在**跨天 / 跨重启**时还成立吗？
//
// 演练方式：正方主张"现在的止损够用"，反方主张"它会在长停摆里漏"。
// 判据必须能落到代码上，不认比喻。
//
// 反方找到的两处可疑：
//   ① `stall-state` 超过 6 小时就整份丢弃（含 step）。而 402 欠费**不会自己好**，
//      主人可能隔一天才充值 → 丢弃之后 step 归零，退避从 2 分钟重新爬，
//      一夜又要撞十几次，正是 2026-11-14 修过的那个毛病在长停摆下复发。
//   ② `readCostToday` 按**当天**算账。跨天之后 `lastErrMs` 落在昨天，
//      如果实现只数当天行，verdict 会变成 `quiet` → 被当成"上游恢复" → 清零退避。
//
// 这两条都要用真函数验证，不许看注释下结论。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readStallState, writeStallState } from '../packages/adapters/cortico-bot-xiaoyu/src/stall-state.ts'
import { readCostToday } from '../packages/capabilities/cap-state-rhythm/src/cost-today.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'drill-'))

test('反方①：长停摆 7 小时后，退避步数不该归零（否则从 2 分钟重爬）', (t) => {
  const dir = tmp()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const now = Date.parse('2026-11-22T10:00:00.000Z')
  // 8 小时前就爬到了第 6 步（封顶），退避窗口早已过去
  writeStallState(dir, {
    until: now - 8 * 3600_000,
    step: 6,
    kind: 'stalled-auth',
    lastFailureAt: new Date(now - 9 * 3600_000).toISOString(),
  })
  const s = readStallState(dir, now)
  assert.equal(s.step, 6, '欠费不会自己好，步数必须留着；归零就会从 2 分钟重新开始撞')
})

test('反方②：402 发生在昨天、今天还没调用过 → 不许判成 quiet（那会被当成已恢复）', (t) => {
  const dir = tmp()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const yesterday = '2026-11-21T20:00:00.000Z'
  const today = '2026-11-22T09:00:00.000Z'
  fs.writeFileSync(
    path.join(dir, 'usage.jsonl'),
    JSON.stringify({ attempt: { startedAt: yesterday, outcome: 'failed', status: 402, meters: { input: null } } }) + '\n',
    'utf8',
  )
  const c = readCostToday({ dataDir: dir, basis: 'utc', now: Date.parse(today) })
  assert.notEqual(c.verdict, 'quiet', '昨天 402、今天没调用 ≠ 通道恢复；quiet 会被心跳读成"可以继续"')
  assert.equal(c.verdict, 'stalled-auth', '欠费跨天仍然是欠费，直到出现一次成功调用')
})
