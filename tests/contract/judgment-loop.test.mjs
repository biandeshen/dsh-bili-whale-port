/**
 * 判断卡真的改得动 feed（方案 A 的证伪层）。
 *
 * 不碰网络：用固定候选跑两遍同一条判定链，一遍没有卡、一遍有卡，
 * 断言出榜/V 的集合确实不同，且差异只来自判断卡。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { dislikeHit, keepCandidate } from '../../tools/lib/feed-quality.mjs'

/** feed.mjs 现在的判定顺序：dislike 硬拦 → 质量下限；判断卡的 avoid 并进 dislike 那一层。 */
function filterWith({ rows, dislike, avoid = [], prefer = [] }) {
  const hard = [...dislike, ...avoid]
  const kept = []
  const dropped = []
  const prefHits = (title) => prefer.filter((t) => title.includes(t)).length
  for (const x of rows) {
    const hit = dislikeHit(x.t, hard)
    if (hit) { dropped.push({ ...x, why: 'avoid:' + hit }); continue }
    const d = keepCandidate(x)
    if (!d.keep) { dropped.push({ ...x, why: d.why }); continue }
    // 排序权重：偏好命中 ×4 + 学到/判断词加权（判断卡 prefer 封顶 2.5）
    const score = prefHits(x.t) * 2.5 + Math.min(2.5, prefHits(x.t))
    kept.push({ ...x, score })
  }
  kept.sort((a, b) => b.score - a.score)
  return { kept: kept.map((x) => x.bv), dropped }
}

const rows = [
  { bv: 'BV1a', t: '【助眠】三小时雨声白噪音', play: 99999, dm: 8000, d: 3600, kw: '助眠' },
  { bv: 'BV1b', t: '十小时助眠钢琴曲合集', play: 50000, dm: 3000, d: 3600, kw: '助眠' },
  { bv: 'BV1c', t: '床头灯 开箱测评', play: 8000, dm: 200, d: 600, kw: '热门' },
  { bv: 'BV1d', t: '深夜电台 说书 第 42 期', play: 20000, dm: 900, d: 2400, kw: '搜索' },
  { bv: 'BV1e', t: '播放量 1 的碎屑', play: 1, dm: 0, d: 30, kw: '热门' },
]

test('没有卡时结果与今天的默认行为逐条一致（合并当天不变）', () => {
  const a = filterWith({ rows, dislike: [] })
  const b = filterWith({ rows, dislike: [], avoid: [], prefer: [] })
  assert.deepEqual(a.kept, b.kept)
  assert.deepEqual(a.kept, ['BV1a', 'BV1b', 'BV1c', 'BV1d'], '碎屑照旧被质量下限丢掉')
})

test('avoid 卡真的丢掉候选：出榜集合因此变化，且差集只来自卡', () => {
  const before = filterWith({ rows, dislike: [] })
  const after = filterWith({ rows, dislike: [], avoid: ['助眠'] })
  assert.notDeepEqual(after.kept, before.kept, '有卡与没卡的出榜必须不同')
  assert.deepEqual(before.kept.filter((x) => !after.kept.includes(x)), ['BV1a', 'BV1b'], '被卡拿掉的正是助眠那两条')
  assert.deepEqual(after.kept, ['BV1c', 'BV1d'], '其余候选不受牵连')

  const reasons = after.dropped.filter((x) => String(x.why).startsWith('avoid:'))
  assert.deepEqual(reasons.map((x) => x.bv), ['BV1a', 'BV1b'], '丢的原因记成 avoid，不是别的规则')
})

test('prefer 卡只调排序、不丢候选', () => {
  const before = filterWith({ rows, dislike: [] })
  const after = filterWith({ rows, dislike: [], prefer: ['说书'] })
  assert.equal(after.kept.length, before.kept.length, '加权不丢东西')
  assert.equal(after.kept[0], 'BV1d', '说书那条排到第一')
  assert.deepEqual([...after.kept].sort(), [...before.kept].sort(), '只是换了顺序')
})

test('卡与主人词表同词时：主人用 like 时卡不生效（配置赢），用 dislike 时叠加', () => {
  // 主人 like 里已有「助眠」→ 冲突在 judgment.activeJudgments 里就被剔掉，avoid 桶里不该有它
  const withoutConflict = filterWith({ rows, dislike: [], avoid: [] })
  assert.ok(withoutConflict.kept.includes('BV1a'), '没有 avoid 时助眠在榜内')
  // 主人 dislike 里的词 + 卡的 avoid 一起构成硬拦，先命中的那个记进原因
  const both = filterWith({ rows, dislike: ['开箱'], avoid: ['助眠'] })
  assert.ok(!both.kept.includes('BV1c'), '主人的 dislike 照样生效')
  assert.ok(!both.kept.includes('BV1a'), '卡的 avoid 也生效')
})
