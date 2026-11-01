// #56 日记分页（2026-11-01）：过去 bili_diary_read 把两本整本拼接后 slice(0,12000)，
// 她从被截断的回执里以为"日记读完了"，据此得出"这一周只判了两条"这类错结论。
// 分页不是省 token，是让"没给她的部分"变成她看得见的事实——回执必须自己说清楚。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paginateDiary } from '../src/worlds/bili-account/diary.ts'

const day = (d, lines) => [`## ${d}`, '', ...lines.map((l) => l), ''].join('\n')
const BOOK = [
  '# 鲸鱼日记 · 给主人',
  '',
  day('2026-10-29', ['- 那天很闷。', '- **爱看**：猫 · 鬼畜']),
  day('2026-10-30', ['- 看了三条，收了一条。']),
  day('2026-10-31', ['- 今天把私信回了。', '- 想过要不要改尺子。']),
  day('2026-11-01', ['- 主人说我像活着了。']),
].join('\n')

test('第 0 页：从最新一天往回数，回执写明整本规模与"还剩几块"', () => {
  const p = paginateDiary(BOOK, { days: 2 })
  assert.equal(p.totalDays, 4)
  assert.deepEqual(p.dates, ['2026-11-01', '2026-10-31'])
  assert.equal(p.hasMore, true)
  assert.match(p.receipt, /共 4 个日期块/)
  assert.match(p.receipt, /还剩 2 块/)
  assert.match(p.receipt, /别把本页当成全部/)
  assert.match(p.receipt, /\{"page":1\}/)
  assert.ok(p.body.includes('# 鲸鱼日记'), '第一页应带上整本抬头')
  assert.ok(!p.body.includes('2026-10-29'), '第 0 页不该混进更早的天')
})

test('翻到最后一页：明确说"翻完了，没有截断"，不再让她猜', () => {
  const p = paginateDiary(BOOK, { days: 2, page: 1 })
  assert.deepEqual(p.dates, ['2026-10-30', '2026-10-29'])
  assert.equal(p.hasMore, false)
  assert.match(p.receipt, /翻完了/)
  assert.ok(!p.receipt.includes('还剩'), '最后一页不该再说还剩')
})

test('page 越界：不给正文，也不谎称"这本是空的"', () => {
  const p = paginateDiary(BOOK, { days: 2, page: 9 })
  assert.deepEqual(p.dates, [])
  assert.equal(p.hasMore, false)
  assert.match(p.receipt, /取不到内容/)
  assert.match(p.receipt, /整本 4 块/)
  assert.ok(!p.receipt.includes('这一本没有日记块'), '越界页不该说成本是空的')
})

test('date 精确取某一天：忽略 page，只给那一块', () => {
  const p = paginateDiary(BOOK, { date: '2026-10-30' })
  assert.deepEqual(p.dates, ['2026-10-30'])
  assert.ok(p.body.includes('看了三条') && !p.body.includes('主人说我像活着了'))
  assert.equal(p.hasMore, false)
})

test('单日超长：截断要写在回执里，不能静默砍', () => {
  const big = day('2026-11-01', [Array.from({ length: 400 }, (_, i) => `第 ${i} 行 filler`).join('\n')])
  const p = paginateDiary(`# 抬头\n\n${big}`, { budget: 300 })
  assert.match(p.receipt, /本日超长，已截断/)
  assert.ok(p.body.includes('（截断）') || p.returnedChars <= 320, '正文必须真的被截断')
})

test('空本：说"真的还没有"，不写成"没内容被截"', () => {
  const p = paginateDiary('# 鲸鱼日记 · 给主人\n\n', {})
  assert.equal(p.totalDays, 0)
  assert.match(p.receipt, /没有日记块/)
})
