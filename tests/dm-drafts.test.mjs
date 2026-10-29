// 私信回信草稿：只落盘、同封来信去重、长度与哈希
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { addDraft, loadDrafts, findDraft, setStatus, attachAck, textHash, MAX_TEXT } from '../tools/lib/dm-drafts.mjs'

const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dm-drafts-')), 'dm-drafts.json')

test('入队一条：pending、带正文哈希、同封来信不重复', () => {
  const f = file()
  const a = addDraft(f, { text: '  我在。  ', inboundKey: 'msg-1', who: '鱼片' })
  assert.equal(a.ok, true)
  assert.equal(a.item.status, 'pending')
  assert.equal(a.item.text, '我在。')
  assert.equal(a.item.textHash, textHash('我在。'))
  assert.match(a.item.id, /^dm-\d{8}-[0-9a-f]{6}$/)

  const b = addDraft(f, { text: '另一句', inboundKey: 'msg-1' })
  assert.equal(b.ok, false)
  assert.match(b.error, /已经有一条/)
  assert.equal(loadDrafts(f).items.length, 1)
})

test('空正文/超长拒收，边界长度可入', () => {
  const f = file()
  assert.equal(addDraft(f, { text: '   ' }).ok, false)
  assert.equal(addDraft(f, { text: 'x'.repeat(MAX_TEXT + 1) }).ok, false)
  assert.equal(addDraft(f, { text: 'x'.repeat(MAX_TEXT) }).ok, true)
})

test('状态与令牌挂载：sent 后仍在库里，可查', () => {
  const f = file()
  const a = addDraft(f, { text: '好', inboundKey: 'msg-2' })
  attachAck(f, a.item.id, { ackId: 'ack-test', expiresAt: '2030-01-01T00:00:00.000Z' })
  const hit = findDraft(f, a.item.id)
  assert.equal(hit.ackId, 'ack-test')
  setStatus(f, a.item.id, 'sent', { sentAt: '2026-10-29T00:00:00.000Z' })
  assert.equal(findDraft(f, a.item.id).status, 'sent')
  assert.equal(findDraft(f, 'dm-nope'), null)
})

test('坏文件按空库处理，不抛', () => {
  const f = file()
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, '{not json')
  assert.deepEqual(loadDrafts(f), { items: [] })
})
