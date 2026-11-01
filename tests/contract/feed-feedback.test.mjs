// B4 偏好词表回流（2026-10-30 她的 OPS：「三个词从 10-25 到 10-30 一个字没变」）
// 2026-10-31 六席复核后重做：词组级（不滑窗）+ 稿子只认《书名号》，散文碎片不再进词表。
import test from 'node:test'
import assert from 'node:assert/strict'
import { learnTokens, collectLearnedTokens, likedEventsFromLedger, favItemsFromLedger } from '../../tools/lib/feed-feedback.mjs'

test('抽词：拉丁词≥2、中文按标点取 2–6 字词组、停用词/句尾虚词剔除、ownerName 剔除', () => {
  const t = learnTokens('432Hz疗愈雨声 这个广告 我为小鱼', { ownerName: '小鱼' })
  assert.ok(t.includes('hz'), '拉丁词小写收进来：' + t.join(','))
  assert.ok(t.includes('疗愈雨声'), '词组整取：' + t.join(','))
  assert.ok(!t.includes('愈雨声') && !t.includes('疗愈雨'), '不再滑窗产碎词：' + t.join(','))
  assert.ok(!t.includes('这个') && !t.includes('广告'), '停用词要剔除')
  assert.ok(!t.includes('小鱼'), '主人名字不进偏好词')
  const t2 = learnTokens('雨声ASMR')
  assert.ok(t2.length > 0 && !t2.some((x) => x.length === 1), '不出现单字垃圾：' + t2.join(','))
  assert.ok(!learnTokens('今天最想说的那件事').includes('想说的'), '散文短语不再当主题词')
  assert.ok(learnTokens('白噪音，放下焦虑').includes('白噪音'), '标点分词')
})

test('三路回流：被赞/收藏整段学；已发稿只认《书名号》片段（吐槽散文不再污染词表）', () => {
  const toks = collectLearnedTokens({
    likedEvents: [{ videoTitle: '432Hz疗愈雨声', comment: '好听' }],
    favItems: [{ title: '432Hz疗愈雨声', reason: '想再看' }],
    sentDrafts: [{ status: 'sent', text: '今晚看的是《雷雨声》，今天最想说的那件事其实不是它' }],
  })
  assert.ok(toks.length > 0)
  assert.equal(new Set(toks).size, toks.length, '去重')
  assert.ok(toks.includes('雷雨声'), '稿子里的书名号片段要能喂进词表（B4 的核心）：' + toks.join(','))
  assert.ok(!toks.includes('最想说') && !toks.includes('想说的'), '散文碎片不得进词表：' + toks.join(','))
  assert.ok(toks.includes('想再看'), '收藏理由进词表')
  assert.deepEqual(collectLearnedTokens({}), [], '空源返回空数组而不是炸')
  assert.deepEqual(collectLearnedTokens({ sentDrafts: [{ status: 'pending', text: '《未发不算》' }] }), [], '非 sent 不算品味')
})

test('点赞账本 → 回流素材：只认带标题的账目，理由缺失不影响', () => {
  const events = likedEventsFromLedger({
    items: [
      { bv: 'BV1xx', title: '雨声白噪音 十小时', reason: '听着睡着了' },
      { bv: 'BV2xx', title: '', reason: '没标题学不到' },
      { bv: 'BV3xx', title: '钢琴曲选段' },
      { title: '没有 bv 不算' },
    ],
  })
  assert.deepEqual(events, [
    { videoTitle: '雨声白噪音 十小时', comment: '听着睡着了' },
    { videoTitle: '钢琴曲选段', comment: '' },
  ])
  assert.deepEqual(likedEventsFromLedger(null), [], '账本缺失返回空数组')
})

test('点赞真的能进词表：账本 → 素材 → 抽词这条链通着', () => {
  const toks = collectLearnedTokens({ likedEvents: likedEventsFromLedger({ items: [{ bv: 'BV1xx', title: '432Hz疗愈雨声' }] }) })
  assert.ok(toks.includes('疗愈雨声'), '点赞标题要能喂进词表：' + toks.join(','))
})

test('收藏账本 → 回流素材：缺 bv 的条目丢掉', () => {
  assert.deepEqual(favItemsFromLedger({ items: [{ bv: 'BV1', title: 'a' }, { title: 'b' }] }), [{ bv: 'BV1', title: 'a' }])
  assert.deepEqual(favItemsFromLedger(undefined), [])
})
