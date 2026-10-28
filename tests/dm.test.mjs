import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDmPeek } from '../src/worlds/bili-account/dm.ts'

const hit = (over = {}) => JSON.stringify({
  hit: true, mid: '233643544', name: '主人', text: '在吗', ts: 1761760000,
  key: 'k1', receipt: 'r1', ...over,
})

test('私信解析：exit 0 + JSON → hit', () => {
  const r = parseDmPeek(0, 'log line\n' + hit())
  assert.equal(r.kind, 'hit')
  assert.equal(r.message.text, '在吗')
  assert.equal(r.message.receipt, 'r1')
})

test('私信解析：exit 1 → 正常空', () => {
  assert.deepEqual(parseDmPeek(1, '无新私信'), { kind: 'empty' })
})

test('私信解析：exit 3 → 错误，不是空', () => {
  const r = parseDmPeek(3, '私信历史读取失败，保留游标（code=-352）')
  assert.equal(r.kind, 'error')
  assert.match(r.detail, /读取失败/)
})

test('私信解析：hit:false 当空；坏 JSON/缺字段当错误', () => {
  assert.deepEqual(parseDmPeek(0, JSON.stringify({ hit: false })), { kind: 'empty' })
  assert.equal(parseDmPeek(0, 'not json').kind, 'error')
  assert.equal(parseDmPeek(0, JSON.stringify({ hit: true, text: '只有正文' })).kind, 'error')
})
