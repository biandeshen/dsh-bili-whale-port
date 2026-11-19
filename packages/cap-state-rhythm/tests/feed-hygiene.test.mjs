/**
 * 她 10-30 / 10-31 在私人日记里立过的选片规矩，要由工具直接标在候选上
 * （原来每轮要她自己数，数错了就重复深读同一个 UP）。
 *
 * 从宿主 tests/feed-hygiene.test.mjs 搬来（#88 退役第二份内核前的对账）。
 * 搬家时发现的洞：`annotateFeed` 在本仓**零调用者**——算得出，送不到她眼前。
 * 生产 bili_feed 只内联标了 minDurationSec 与 dislike，
 * 「近 7 天看过」「同UP第N条不深读」两条规矩整条断线。最后两条钉的就是这条接线。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { annotateFeed, recentWatch, remember, emptyState } from '../src/state-store.ts'
import { watchedFromMemories } from '../../persona-core/src/retrieval.ts'

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
  const viaStore = recentWatch(s)
  assert.equal(viaStore.upCounts['李冉在冥想'], 2, '状态层拿到的必须是同一份计数')
})

// ── 接线：算出来的规矩必须真的出现在她的候选回执里 ──────────────────
// BV 号必须是真形状（BV + 10 位）：生产 fetchFeed 会把不合形状的整条丢掉。
const SEEN = 'BV1seen00001'
const FRESH = 'BV1fresh0003'
const VIDEOS = [
  { bvid: SEEN, title: '白噪音合集', durationSec: 900, up: '雨声实验室' },
  { bvid: FRESH, title: '十小时雨声', durationSec: 1800, up: '路人甲' },
]

function feedFetch(items) {
  return async (input) => {
    if (String(input).includes('/popular')) {
      return new Response(JSON.stringify({
        code: 0,
        data: { item: items.map((it) => ({ bvid: it.bvid, title: it.title, duration: it.durationSec, owner: { name: it.up } })) },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ code: -404, data: null }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}

async function mkFeed(recentWatch) {
  const { createBilibiliCapability } = await import('../../cap-bilibili/src/index.ts')
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-hygiene-'))
  const cap = createBilibiliCapability({
    dataDir: path.join(home, 'data', 'bilibili'),
    readContext: { cred: { sessdata: 'S', bili_jct: 'J', buvid3: 'B' }, fetch: feedFetch(VIDEOS) },
    ...(recentWatch ? { recentWatch } : {}),
  })
  return cap.tools().find((t) => t.name === 'bili_feed')
}

test('bili_feed 要把「近 7 天看过」标在她真拿到的那条上', async () => {
  const tool = await mkFeed(() => ({ bvs: [SEEN], ups: ['雨声实验室'], upCounts: { 雨声实验室: 3 } }))
  const r = await tool.execute({ count: 5 })
  assert.equal(r.ok, true)
  const seen = r.items.find((x) => x.bvid === SEEN)
  assert.match(seen.title, /近 7 天看过/, '看过的没标出来 = 她会再深读一遍')
  assert.match(seen.title, /同UP第4条/, '同 UP 第几条也要标（她 10-30 立的规矩）')
  const fresh = r.items.find((x) => x.bvid === FRESH)
  assert.doesNotMatch(fresh.title, /近 7 天看过|同UP/, '没看过的不许误标')
})

test('没接看片史时照常出候选（不许因为缺注入就报错）', async () => {
  const tool = await mkFeed(null)
  const r = await tool.execute({ count: 5 })
  assert.equal(r.ok, true)
  assert.equal(r.items.length, 2)
})