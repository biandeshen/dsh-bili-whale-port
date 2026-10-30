import test from 'node:test'
import assert from 'node:assert/strict'
import { keepCandidate, looksLikeJunk, snapshotRow, JUNK_PLAY, JUNK_DM, numOf } from '../../tools/lib/feed-quality.mjs'

// D-31：质量下限不许被"多偏好命中"绕过。
// 判定函数是纯的，这里锁的是 feed.mjs 真正调用的那一个（不是另写一份）。

test('D-31：播放 1、弹幕 0 的片子即使命中两个偏好词也被丢', () => {
  const x = { bv: 'BV1xx', t: '【雨声白噪音助眠】', play: 1, dm: 0, kw: '搜索' }
  assert.equal(looksLikeJunk(x), true)
  assert.deepEqual(keepCandidate(x), { keep: false, why: 'unverified' })
})

test('D-31：一个信号过线就保留（播放够 或 弹幕够）', () => {
  assert.equal(keepCandidate({ play: JUNK_PLAY, dm: 0, kw: '搜索' }).keep, true)
  assert.equal(keepCandidate({ play: 0, dm: JUNK_DM, kw: '搜索' }).keep, true)
  assert.equal(keepCandidate({ play: JUNK_PLAY - 1, dm: JUNK_DM - 1, kw: '搜索' }).keep, false)
})

test('关注流例外：她订阅的人的新片不看播放量', () => {
  assert.deepEqual(keepCandidate({ play: 0, dm: 0, kw: '关注' }), { keep: true, why: 'following' })
})

test('热门/排行与搜索同一把尺，没有第二条通道', () => {
  for (const kw of ['搜索', '热门', '排行']) {
    assert.equal(keepCandidate({ play: 1, dm: 0, kw }).keep, false, kw)
  }
})

test('快照行不含凭据字段，标题截断', () => {
  const row = snapshotRow(
    { bv: 'BV1', t: 'x'.repeat(200), up: 'u'.repeat(80), kw: '搜索', play: 5, dm: 1, d: 60, _hits: ['a'], _score: 4, cookie: 'SESSDATA=secret' },
    { keep: false, why: 'unverified' },
  )
  assert.equal(row.title.length, 80)
  assert.equal(row.up.length, 40)
  assert.equal(row.cookie, undefined)
  assert.equal(row.keep, false)
  assert.equal(row.why, 'unverified')
})

test('B3：numOf 宽容解析——万/亿/字符串/坏值归 0（fail-closed）', () => {
  assert.equal(numOf('1.2万'), 12000)
  assert.equal(numOf('10亿'), 1000000000)
  assert.equal(numOf('344'), 344)
  assert.equal(numOf('1,234'), 1234)
  assert.equal(numOf(344), 344)
  assert.equal(numOf(null), 0)
  assert.equal(numOf(''), 0)
  assert.equal(numOf('N/A'), 0)
  assert.equal(numOf(NaN), 0)
  // 坏值归 0 → 质量下限把它当“未验证”丢掉；NaN 比较会让 floor 悄悄放行（快照 play=null 的教训）
  assert.equal(looksLikeJunk({ play: numOf(null), dm: 0 }), true)
  assert.equal(looksLikeJunk({ play: numOf('1.2万'), dm: 40 }), false)
})
