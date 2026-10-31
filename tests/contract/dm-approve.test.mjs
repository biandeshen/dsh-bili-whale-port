// 回信审批契约：dry 不消耗 token / go 必须 token / 改稿后哈希不符拒绝 / 冷却退回 token / sent 不可重放
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const WHALE = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-approve-'))
process.env.DSH_HOME = WHALE
fs.mkdirSync(path.join(WHALE, 'bili-whale', 'control'), { recursive: true })
const lib = await import('../../tools/lib/dm-drafts.mjs')
const ack = await import('../../scripts/ack.mjs')
const { approve, reject, list } = await import('../../scripts/dm-approve.mjs')
const FILE = path.join(WHALE, 'bili-whale', 'control', 'dm-drafts.json')

function draft(text, inbound = 'msg-' + Math.random().toString(16).slice(2)) {
  const r = lib.addDraft(FILE, { text, inboundKey: inbound, who: '鱼片' })
  assert.equal(r.ok, true)
  const it = ack.enqueue(WHALE, { kind: 'dm', draftId: r.item.id, textHash: r.item.textHash, inboundKey: inbound })
  lib.attachAck(FILE, r.item.id, { ackId: it.id, expiresAt: it.expiresAt })
  return { id: r.item.id, token: it.token }
}
const goodRunner = (calls) => (args) => {
  calls.push(args)
  return { status: 0, stdout: args.includes('--go') ? '  ✓ 已发送（HTTP 200）' : '  [dry] 预检通过，未发送 ✓' }
}

test('list 打印完整 token；dry 不消耗 token', async () => {
  const d = draft('我在呢。')
  const row = list().find((x) => x.id === d.id)
  assert.equal(row.token, d.token)
  const calls = []
  const r = await approve({ id: d.id, runner: goodRunner(calls) })
  assert.equal(r.ok, true)
  assert.equal(r.status, 'dry-run')
  assert.deepEqual(calls[0], ['dm', '--msg', '我在呢。', '--dry'])
  // token 还能用
  assert.ok(ack.listPending(WHALE).some((x) => x.payload?.draftId === d.id))
})

test('go 没 token / 错 token 都拒发，runner 不被调用', async () => {
  const d = draft('在的。')
  const calls = []
  const noToken = await approve({ id: d.id, go: true, runner: goodRunner(calls) })
  assert.equal(noToken.ok, false)
  const bad = await approve({ id: d.id, token: 'deadbeef', go: true, runner: goodRunner(calls) })
  assert.equal(bad.ok, false)
  assert.equal(bad.code, 'bad-token')
  assert.equal(calls.length, 0)
})

test('token 正确才发；正文改过（哈希不符）拒绝且 token 不消耗', async () => {
  const d = draft('原话。')
  // 审批前被改稿：模拟外部改写
  const db = lib.loadDrafts(FILE)
  const hit = db.items.find((x) => x.id === d.id)
  hit.text = '改过的话。'
  lib.saveDrafts(FILE, db)
  const blocked = await approve({ id: d.id, token: d.token, go: true, runner: goodRunner([]) })
  assert.equal(blocked.ok, false)
  assert.match(blocked.error, /哈希不符/)
  // 改成原文后再批，token 还在
  const db2 = lib.loadDrafts(FILE)
  db2.items.find((x) => x.id === d.id).text = '原话。'
  lib.saveDrafts(FILE, db2)
  const ok = await approve({ id: d.id, token: d.token, go: true, runner: goodRunner([]) })
  assert.equal(ok.ok, true)
  assert.equal(ok.status, 'sent')
  assert.ok(!ack.listPending(WHALE).some((x) => x.payload?.draftId === d.id), 'token 已作废')
  assert.equal((await approve({ id: d.id, token: d.token, go: true, runner: goodRunner([]) })).ok, false, 'sent 不可重放')
})

test('冷却失败退回 token，可原 token 重试成功', async () => {
  const d = draft('等等我。')
  const cool = await approve({
    id: d.id, token: d.token, go: true,
    runner: () => ({ status: 1, stdout: '', stderr: '冷却中，请稍后' }),
  })
  assert.equal(cool.ok, false)
  assert.equal(cool.status, 'cooldown')
  assert.ok(ack.listPending(WHALE).some((x) => x.payload?.draftId === d.id), 'token 被退回')
  const ok = await approve({ id: d.id, token: d.token, go: true, runner: goodRunner([]) })
  assert.equal(ok.ok, true)
})

test('reject 后不可再批，令牌释放', async () => {
  const d = draft('算了。')
  assert.equal(reject(d.id).ok, true)
  assert.equal(reject(d.id).ok, true) // 幂等：重复拒绝不报错
  assert.equal((await approve({ id: d.id, token: d.token, go: true, runner: goodRunner([]) })).ok, false)
  assert.ok(!ack.listPending(WHALE).some((x) => x.payload?.draftId === d.id))
})
