// 意见箱 f-8b55de：读到私信 → 回复一律"过期" → 再读"没有新私信" → 死循环。
// 这里跑真实链路：bili.mjs dm-await 的 JSON 形状 → parseDmPeek → life.json 落盘/读回 → 时效门。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseDmPeek, toMs } from '../legacy/bili-account-retired/dm.ts'
import { canReply, dmAutoPlan, noteInboxRead, noteInbound, DM_REPLY_WINDOW_MS } from '../legacy/bili-account-retired/dm-reply.ts'

const DAY = 86400_000
/** dm-await 透传 B站 的 timestamp：10 位秒。*/
const MSG = (over = {}) => JSON.stringify({
  hit: true, mid: '233643544', name: '主人', text: '今晚那条草稿我想看',
  ts: Math.floor((over.tsMs ?? Date.now()) / 1000),
  key: '7702493730704828928', receipt: 'rcp-1', ...over,
})

/** 真实处理器对 life 做的三件事：命中→noteInbound、空读→noteInboxRead、读取失败不动。 */
function readInbox(life, status, out, nowMs) {
  const parsed = parseDmPeek(status, out)
  if (parsed.kind === 'empty') { noteInboxRead(life, nowMs); return { text: '[dm] 没有新私信', parsed } }
  if (parsed.kind === 'error') return { text: '[dm] 读取失败', parsed }
  noteInbound(life, parsed.message, nowMs)
  return { text: '[dm] 主人来信：' + parsed.message.text, parsed }
}

test('读到 → 立刻回复：草稿能直接进发送计划（秒级时间戳不再被判过期）', () => {
  const now = Date.now()
  const life = {}
  const r = readInbox(life, 0, MSG({ tsMs: now }), now)
  assert.equal(r.parsed.kind, 'hit')
  assert.equal(r.parsed.message.ts, now - (now % 1000), '解析边界把秒归一成毫秒')
  assert.equal(life.lastInboundAt, now - (now % 1000))

  const gate = canReply(life, now)
  assert.equal(gate.ok, true, '刚读过就回复不该是 stale：' + gate.reason)
  const plan = dmAutoPlan('好，我十分钟后发你', life, now)
  assert.equal(plan.ok, true)
  assert.deepEqual(plan.args, ['dm', '--msg', '好，我十分钟后发你', '--go'])
})

test('旧 life.json 里已经落盘的秒值不迁移也能开门（读的时候归一）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-life-'))
  const file = path.join(dir, 'life.json')
  // 正式环境此刻的真实形状：三天前的一封信，lastInboundAt 是秒、lastDmReadAt 缺失
  const threeDaysAgoSec = Math.floor((Date.now() - 3 * DAY) / 1000)
  fs.writeFileSync(file, JSON.stringify({ lastInboundKey: '7702493730704828928', lastInboundAt: threeDaysAgoSec }))
  const life = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(canReply(life, Date.now()).ok, true, '秒值按毫秒算是 1970 年，永远开门不了')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('读到 → 隔很久才回复：默认不限（主人 11-01 判定 7 天窗没必要）；设了窗口才判过期', () => {
  const t0 = Date.now()
  const life = {}
  readInbox(life, 0, MSG({ tsMs: t0 }), t0)
  const late = t0 + 8 * DAY
  assert.deepEqual(canReply(life, late), { ok: true, reason: 'ok' }, '默认窗口不限，旧消息也能回')
  assert.deepEqual(canReply(life, late, 7 * DAY), { ok: false, reason: 'stale' }, '旋钮还在：显式给窗口就会拦')

  // 第二次读：这一封已被 ack → 空读。空读刷新上下文，回信之门重开。
  const second = readInbox(life, 1, '{"hit":false}', late + 1000)
  assert.equal(second.parsed.kind, 'empty')
  assert.equal(canReply(life, late + 1000, 7 * DAY).ok, true, '空读刷新了游标')
  assert.equal(dmAutoPlan('我回来了', life, late + 1000).ok, true)

  // 第二次读：pending 未 ack 时 dm-await 会重投同一条，靶子跟着换，也不会循环。
  const again = readInbox(life, 0, MSG({ tsMs: late + 2000, key: 'k2', text: '还在吗' }), late + 2000)
  assert.equal(again.parsed.kind, 'hit')
  assert.equal(life.lastInboundKey, 'k2')
  assert.equal(canReply(life, late + 2000).ok, true)
})

test('读取失败不推进游标（没读到就是没读到）', () => {
  const t0 = Date.now()
  const life = {}
  readInbox(life, 0, MSG({ tsMs: t0 }), t0)
  const late = t0 + 8 * DAY
  const before = life.lastDmReadAt
  const r = readInbox(life, 3, '私信历史读取失败，保留游标（code=-352）', late)
  assert.equal(r.parsed.kind, 'error')
  assert.equal(life.lastDmReadAt, before, '失败那次不许把游标推到 late')
  assert.equal(canReply(life, late, DAY).reason, 'stale', '按 1 天窗口算，游标停在 t0 → 过期')
  assert.equal(canReply(life, late).ok, true, '默认窗口不限 → 仍能回，不会死循环')
})

test('重复投递的那一封仍是回信靶子（否则她拿到 no-key，而信就在眼前）', () => {
  const now = Date.now()
  const life = {}
  noteInbound(life, { key: 'k-old', ts: now - DAY }, now - DAY)
  // 效果已加过、ack 失败 → dm-await 重投，处理器只补确认；旧实现这里不动 key
  const msg = parseDmPeek(0, MSG({ tsMs: now, key: 'k-new' })).message
  noteInbound(life, msg, now)
  assert.equal(life.lastInboundKey, 'k-new')
  assert.equal(canReply(life, now).ok, true)
})

test('正文与凭据的边界：空/超长/no-key', () => {
  const now = Date.now()
  assert.equal(dmAutoPlan('   ', {}, now).reason, 'empty')
  assert.equal(dmAutoPlan('字'.repeat(501), { lastInboundKey: 'k', lastDmReadAt: now }, now).reason, 'too-long')
  assert.equal(dmAutoPlan('回你一句', {}, now).reason, 'no-key')
})

test('toMs 只把秒抬成毫秒，已经是毫秒的原样', () => {
  assert.equal(toMs(1761760000), 1761760000000)
  assert.equal(toMs(1761760000123), 1761760000123)
  assert.equal(toMs(0), 0)
})
