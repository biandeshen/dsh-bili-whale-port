// B4 偏好词表回流（2026-10-30 她的 OPS：「三个词从 10-25 到 10-30 一个字没变」）
// 抽词规则 + 三路信号合并的纯函数契约。
import test from 'node:test'
import assert from 'node:assert/strict'
import { learnTokens, collectLearnedTokens } from '../../tools/lib/feed-feedback.mjs'

test('B4：抽词——拉丁词≥2、中文 3-4 字 n-gram、停用词剔除、ownerName 剔除', () => {
  const t = learnTokens('432Hz疗愈雨声 这个广告 我为小鱼', { ownerName: '小鱼' })
  assert.ok(t.includes('hz'), '拉丁词要小写收进来：' + t.join(','))
  assert.ok(t.includes('疗愈雨声') || t.includes('愈雨声'), '中文 4/3 gram：' + t.join(','))
  assert.ok(!t.includes('这个') && !t.includes('广告'), '停用词要剔除')
  assert.ok(!t.includes('小鱼'), '主人名字不进偏好词')
  // ownerName 为空时不能炸、不能把字符串拆成单字
  const t2 = learnTokens('雨声ASMR')
  assert.ok(Array.isArray(t2) && t2.length > 0)
  assert.ok(!t2.some((x) => x.length === 1), '不应出现单字垃圾：' + t2.join(','))
})

test('B4：三路回流（被赞/收藏/已发稿）合并去重；空源不炸', () => {
  const toks = collectLearnedTokens({
    likedEvents: [{ videoTitle: '432Hz疗愈雨声', comment: '好听' }],
    favItems: [{ title: '432Hz疗愈雨声', reason: '想再看' }],
    sentDrafts: [{ status: 'sent', text: '今晚读了一条雷雨声，283 个桶' }],
  })
  assert.ok(toks.length > 0)
  assert.equal(new Set(toks).size, toks.length, '去重')
  assert.ok(toks.some((x) => x.includes('雷雨声')), '已发稿要能喂进词表（B4 的核心）')
  assert.deepEqual(collectLearnedTokens({}), [], '空源返回空数组而不是炸')
  assert.deepEqual(collectLearnedTokens({ sentDrafts: [{ status: 'pending', text: '未发不算' }] }).filter((x) => x.includes('未发')), [], '非 sent 不算品味')
})
