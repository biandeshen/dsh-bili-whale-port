/**
 * 自动发布的两道安全档位（审计 §2.7「安全闸补 2 档位」）。
 *
 * 缺口长什么样：`autoDailyCap`（每天最多自动发几条）与 `autoWindow`（允许自动发的时段）
 * 这两个字段**只存在于配置声明里，没有任何代码读它们**——
 * 主人以为设了"每天最多自动发 3 条"，其实她想发多少发多少。
 * 空的旋钮比没有旋钮更坏，所以这一片把它们变成真判据。
 *
 * 要钉的：
 *   1. 撞上限 / 不在时段 → 动态**降级进待放行队列**（不是拦下来不发：她照样写，主人照看）；
 *   2. 主人手动放行（bypassQueueWithToken）不受这两道档位影响；
 *   3. 自动发布成功要记账（今天自动发了几条）；
 *   4. 旧 CLI 的口径不变：空/非法时段 = 不限，cap<=0 = 不限，含起点不含终点，跨午夜可用。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { WriteGate, parseAutoWindow } from '../src/domain/write-gate.ts'

function mkGate(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-auto-'))
  const sent = []
  const gate = new WriteGate({
    dataDir: dir,
    executor: async (action) => {
      sent.push(action)
      return { ok: true, dynId: `dyn-${sent.length}` }
    },
    ...over,
  })
  return { dir, gate, sent }
}

const dynAction = (text = '今天的一条动态') => ({
  kind: 'dynamic',
  intent: 'self',
  target: { bvid: 'BV1aaBBccDD1' },
  body: text,
})

test('时段解析：空/非法 = 不限；含起点不含终点；跨午夜可用', () => {
  const at = (h, m) => new Date(2026, 10, 5, h, m).getTime()
  assert.equal(parseAutoWindow('', at(3, 0)).inWindow, true, '空 = 不限')
  assert.equal(parseAutoWindow('白天', at(3, 0)).inWindow, true, '读不懂 = 不限（不许因为主人写错一个字就让她整晚不能发）')
  assert.equal(parseAutoWindow('10:00-23:00', at(10, 0)).inWindow, true, '含起点')
  assert.equal(parseAutoWindow('10:00-23:00', at(23, 0)).inWindow, false, '不含终点')
  assert.equal(parseAutoWindow('23:00-07:00', at(3, 0)).inWindow, true, '跨午夜')
  assert.equal(parseAutoWindow('23:00-07:00', at(8, 0)).inWindow, false)
})

test('每日上限：撞上了就降级进待放行队列（不是拦下来不发）', async () => {
  const { gate } = mkGate()
  gate.saveTraffic({ writeGapSec: 0 })
  gate.savePolicy({ draftMode: 'auto', autoDailyCap: 1, autoWindow: '00:00-24:00' })

  const first = await gate.execute(dynAction('第一条'))
  assert.equal(first.ok, true, '第一条自动发得出去')

  const second = await gate.execute(dynAction('第二条'))
  assert.equal(second.ok, false)
  assert.equal(second.code, 'auto-downgraded', '超上限要降级')
  assert.match(second.reason, /上限/)
  assert.ok(second.pendingId, '要有待放行项（她写好的稿子进队列，不是丢掉）')
  const queued = gate.listQueue('pending')
  assert.equal(queued.length, 1)
  assert.equal(queued[0].text, '第二条')
})

test('不在允许时段里也降级（时段 = 夜里就别自动发）', async () => {
  const { gate } = mkGate()
  // 造一个"现在"肯定不在窗口里的时段：取当前小时往后推 2 小时开始、1 小时后结束
  const now = new Date()
  const start = new Date(now.getTime() + 2 * 3600_000)
  const end = new Date(now.getTime() + 3 * 3600_000)
  const hh = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  gate.savePolicy({ draftMode: 'auto', autoDailyCap: 0, autoWindow: `${hh(start)}-${hh(end)}` })

  const res = await gate.execute(dynAction('夜里的稿子'))
  assert.equal(res.ok, false)
  assert.equal(res.code, 'auto-downgraded')
  assert.match(res.reason, /时段/)
})

test('主人手动放行不受这两道档位影响（那是主人自己的决定）', async () => {
  const { gate } = mkGate()
  gate.saveTraffic({ writeGapSec: 0 })
  gate.savePolicy({ draftMode: 'auto', autoDailyCap: 1, autoWindow: '00:00-24:00' })
  await gate.execute(dynAction('第一条'))
  const manual = await gate.execute({ ...dynAction('主人点的那条'), bypassQueueWithToken: 'ack-token' })
  assert.equal(manual.ok, true, '主人手动放行不该被自动档位拦')
})

test('自动发布成功要记账：今天自动发了几条', async () => {
  const { gate } = mkGate()
  gate.saveTraffic({ writeGapSec: 0 })
  gate.savePolicy({ draftMode: 'auto', autoDailyCap: 0, autoWindow: '00:00-24:00' })
  assert.equal(gate.readQuota().autoPublished, 0)
  await gate.execute(dynAction('第一条'))
  assert.equal(gate.readQuota().autoPublished, 1)
  await gate.execute(dynAction('第二条'))
  assert.equal(gate.readQuota().autoPublished, 2)
})

test('review 档位下这两道档位不参与（本来就每条都要放行）', async () => {
  const { gate } = mkGate()
  gate.savePolicy({ draftMode: 'review', autoDailyCap: 1, autoWindow: '00:00-24:00' })
  const res = await gate.execute(dynAction('要审的'))
  assert.equal(res.ok, false)
  assert.equal(res.code, 'needs-approval', '还是原来的 needs-approval，不是 auto-downgraded')
})

test('draftMode=auto 时，评论那些档位照旧各走各的（只管动态发布这一路）', async () => {
  const { gate } = mkGate()
  gate.savePolicy({ draftMode: 'auto', comment: 'self', danmaku: 'self', autoDailyCap: 1, autoWindow: '00:00-24:00' })
  const c = await gate.execute({ kind: 'comment', intent: 'self', target: { bvid: 'BV1aaBBccDD1', rpid: '123' }, body: '评论一条' })
  assert.equal(c.ok, true, '评论不归自动发布档位管')
})
