// 她 10-30 / 10-31 在私人日记里立过的选片规矩，现在由工具直接标在候选上（原来每轮要她自己数）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { annotateFeed, recentWatch, remember, emptyState } from '../src/worlds/bili-account/personaAdapter.ts'
import { watchedFromMemories } from '../persona-core/src/retrieval.ts'

const FEED = [
  '今天可以看这几条（每词最多 3 条，共 3 条）：',
  '  1. BV1seen000001   900s  弹幕   1234  白噪音合集  @雨声实验室',
  '  2. BV1fresh00002   300s  弹幕     12  原神角色演示  @李冉在冥想',
  '  3. BV1fresh00003  1800s  弹幕    340  十小时雨声  @路人甲',
].join('\n')

test('时长与同 UP 的规矩标在候选行上，长片不误伤', () => {
  const recent = { bvs: ['BV1seen000001'], ups: ['雨声实验室'], upCounts: { 雨声实验室: 3 } }
  const out = annotateFeed(FEED, recent)
  assert.match(out, /BV1seen000001.*\[近 7 天看过\]/)
  assert.match(out, /BV1seen000001.*\[短于20分钟：降级\]/)
  assert.match(out, /BV1seen000001.*\[同UP第4条：不深读\]/, '已看过 3 条 → 这是第 4 条')
  assert.match(out, /BV1fresh00002.*\[短于10分钟：跳过\]/)
  assert.doesNotMatch(out, /BV1fresh00003.*短于/, '30 分钟的不该被时长线拦')
  assert.doesNotMatch(out, /BV1fresh00003.*同UP/)
  assert.match(out, /避开同题材/)
})

test('没有 upCounts 时退回旧行为（只标已看过），不许崩', () => {
  const out = annotateFeed(FEED, { bvs: ['BV1fresh00002'], ups: [] })
  assert.match(out, /BV1fresh00002.*\[近 7 天看过\]/)
})

test('watchedFromMemories 数得出"同一个 UP 第几条"', () => {
  let s = emptyState()
  for (const [bv, up] of [['BV1aaa000001', '李冉在冥想'], ['BV1bbb000002', '李冉在冥想'], ['BV1ccc000003', '雨声实验室']]) {
    s = remember(s, `看过《某条》（${up}） —— ${bv}`, { sender: 'npc', source: 'npc_self' })
  }
  const r = watchedFromMemories(s.memories, Date.now(), 7)
  assert.equal(r.upCounts['李冉在冥想'], 2)
  assert.equal(r.upCounts['雨声实验室'], 1)
  assert.deepEqual(r.ups.slice().sort(), ['李冉在冥想', '雨声实验室'])
  const viaWorld = recentWatch(s)
  assert.equal(viaWorld.upCounts['李冉在冥想'], 2, 'World 侧拿到的必须是同一份计数')
})
