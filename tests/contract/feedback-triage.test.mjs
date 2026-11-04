// 意见箱分诊台的数据层契约（2026-11-05 设计交接 story-6：51 条堆着、19 条 high 处理不动）。
// 覆盖：未解决置顶 + 其中 high 在前 + 新的在前、severity/status/selfHandled 筛选、
// 分页（hasMore / 页间差异 / pageSize 夹紧）、总览计数按全量算而不随当前筛选变。
// 时间戳全部手写并故意打乱写入顺序：排序必须来自显式规则，不再依赖 JSONL 行序。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { appendFeedback, listFeedback, replyFeedbackByOwner } from '../../packages/cap-journal/src/judgments-feedback.ts'

function mkfile(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-triage-'))
  return path.join(dir, name)
}

function raw(file, entry) {
  fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8')
}

/** 一条她提的意见（kind:'feedback'） */
function said(file, id, { at, severity = 'low', selfHandled = false, issue = `意见 ${id}` } = {}) {
  raw(file, {
    id,
    kind: 'feedback',
    at,
    atMs: Date.parse(at),
    day: at.slice(0, 10),
    issue,
    severity,
    selfHandled,
    note: selfHandled ? '我自己先绕过去了' : '',
  })
}

/** 结案记录（kind:'feedback-resolved'，append-only 折叠） */
function closed(file, id, at) {
  raw(file, { kind: 'feedback-resolved', id, at, atMs: Date.parse(at), resolvedBy: 'owner' })
}

/**
 * 固定样本：8 条，写入顺序刻意打乱（时间都用过去，才比 appendFeedback 写的"现在"旧）。
 * 期望分诊顺序（未解决→high→新的在前）：
 *   f-new-high, f-mid-high, f-mid-high-self, f-newest-low, f-new-low-self, f-old-low,
 *   f-old-high-done, f-old-low-done
 */
function fixture() {
  const file = mkfile('feedback.jsonl')
  said(file, 'f-old-low', { at: '2026-10-01T09:00:00.000Z' })
  said(file, 'f-old-low-done', { at: '2026-10-01T08:00:00.000Z' })
  closed(file, 'f-old-low-done', '2026-10-02T08:00:00.000Z')
  said(file, 'f-new-high', { at: '2026-10-05T10:00:00.000Z', severity: 'high' })
  said(file, 'f-mid-high-self', { at: '2026-10-04T09:00:00.000Z', severity: 'high', selfHandled: true })
  said(file, 'f-newest-low', { at: '2026-10-05T11:00:00.000Z' })
  said(file, 'f-old-high-done', { at: '2026-10-02T10:00:00.000Z', severity: 'high' })
  closed(file, 'f-old-high-done', '2026-10-03T10:00:00.000Z')
  said(file, 'f-mid-high', { at: '2026-10-04T10:00:00.000Z', severity: 'high' })
  said(file, 'f-new-low-self', { at: '2026-10-05T09:00:00.000Z', selfHandled: true })
  return file
}

const ORDER = [
  'f-new-high',
  'f-mid-high',
  'f-mid-high-self',
  'f-newest-low',
  'f-new-low-self',
  'f-old-low',
  'f-old-high-done',
  'f-old-low-done',
]

test('分诊排序：未解决置顶、其中 high 在前、新的在前（与写入顺序无关）', () => {
  const r = listFeedback(fixture(), { status: 'all' })
  assert.deepEqual(
    r.items.map((x) => x.id),
    ORDER,
    '显式分诊顺序，不再靠 JSONL 行序',
  )
  const open = listFeedback(fixture(), { status: 'open' })
  assert.deepEqual(
    open.items.map((x) => x.id),
    ORDER.filter((id) => !id.endsWith('-done')),
  )
})

test('总览计数按全量算，不随当前筛选或分页变', () => {
  const all = listFeedback(fixture())
  assert.equal(all.total, 8, 'total = 全部意见条数')
  assert.equal(all.openCount, 6, 'openCount = 全量未解决')
  assert.equal(all.highCount, 4, 'highCount = 全量 high')
  assert.equal(all.highOpenCount, 3, 'highOpenCount = 未解决里的 high')
  assert.equal(all.selfHandledCount, 2, 'selfHandledCount = 她已自行对治')
  // 顶栏说「8 条 · 未解决 6 · high 4（其中未解决 3） · 她已对治 2」，下面的列表却只看第一页
  const paged = listFeedback(fixture(), { status: 'open', severity: 'high', page: 1, pageSize: 2 })
  assert.equal(paged.total, 8)
  assert.equal(paged.openCount, 6)
  assert.equal(paged.highCount, 4)
  assert.equal(paged.highOpenCount, 3)
  assert.equal(paged.selfHandledCount, 2)
  assert.equal(paged.filteredCount, 3, '当前筛选（未解决 + high）命中 3 条')
  assert.equal(paged.items.length, 2, '本页只给 2 条')
})

test('严重度筛选：high / low / all，未知值退化为 all', () => {
  const file = fixture()
  const high = listFeedback(file, { status: 'all', severity: 'high' })
  assert.deepEqual(high.items.map((x) => x.id), ['f-new-high', 'f-mid-high', 'f-mid-high-self', 'f-old-high-done'])
  assert.ok(high.items.every((x) => x.severity === 'high'))
  const low = listFeedback(file, { status: 'open', severity: 'low' })
  assert.deepEqual(low.items.map((x) => x.id), ['f-newest-low', 'f-new-low-self', 'f-old-low'])
  assert.ok(low.items.every((x) => x.severity === 'low'))
  assert.equal(listFeedback(file, { status: 'all', severity: 'urgent' }).items.length, 8, '认不出的 severity 不炸，退 all')
  assert.equal(listFeedback(file, { status: 'all', severity: 'all' }).items.length, 8)
})

test('状态筛选保持旧口径；selfHandled 筛选只影响列表不影响总览', () => {
  const file = fixture()
  assert.equal(listFeedback(file).items.length, 6, '不传 status 仍是 open（旧默认）')
  assert.equal(listFeedback(file, { status: 'open' }).items.length, 6)
  const resolved = listFeedback(file, { status: 'resolved' })
  assert.deepEqual(resolved.items.map((x) => x.id), ['f-old-high-done', 'f-old-low-done'])
  assert.equal(listFeedback(file, { status: 'all' }).items.length, 8, '历史仍在（append-only）')

  const unself = listFeedback(file, { status: 'open', selfHandled: false })
  assert.deepEqual(unself.items.map((x) => x.id), ['f-new-high', 'f-mid-high', 'f-newest-low', 'f-old-low'])
  const self = listFeedback(file, { status: 'open', selfHandled: true })
  assert.deepEqual(self.items.map((x) => x.id), ['f-mid-high-self', 'f-new-low-self'])
  assert.equal(self.openCount, 6, '「只看她未自对治」不改全量 openCount')
  assert.equal(self.selfHandledCount, 2)
})

test('分页：page/pageSize/hasMore，第二页与第一页不同，pageSize 夹在 1..100', () => {
  const file = fixture()
  const p1 = listFeedback(file, { status: 'all', page: 1, pageSize: 3 })
  const p2 = listFeedback(file, { status: 'all', page: 2, pageSize: 3 })
  assert.equal(p1.page, 1)
  assert.equal(p1.pageSize, 3)
  assert.equal(p1.hasMore, true)
  assert.deepEqual(p1.items.map((x) => x.id), ORDER.slice(0, 3))
  assert.deepEqual(p2.items.map((x) => x.id), ORDER.slice(3, 6))
  assert.equal(p2.hasMore, true)
  const p3 = listFeedback(file, { status: 'all', page: 3, pageSize: 3 })
  assert.deepEqual(p3.items.map((x) => x.id), ORDER.slice(6, 8))
  assert.equal(p3.hasMore, false, '最后一页没有更多')

  const big = listFeedback(file, { status: 'all', page: 1, pageSize: 500 })
  assert.equal(big.pageSize, 100, 'pageSize 上限 100')
  const zero = listFeedback(file, { status: 'all', pageSize: 0 })
  assert.equal(zero.pageSize, 10, 'pageSize 非法退回默认 10')
  const badPage = listFeedback(file, { status: 'all', page: 0, pageSize: 3 })
  assert.equal(badPage.page, 1, 'page 至少 1')
  const farPage = listFeedback(file, { status: 'all', page: 9, pageSize: 3 })
  assert.deepEqual(farPage.items, [], '翻过头就是空列表，不报错')
  assert.equal(farPage.hasMore, false)
})

test('旧调用方不破：{status:all, limit:20} 与 limit:MAX_SAFE_INTEGER 仍按 limit 一路走', () => {
  const file = fixture()
  const board = listFeedback(file, { status: 'all', limit: 20 })
  assert.equal(board.items.length, 8, '样本不足 20 就全给')
  assert.deepEqual(board.items.map((x) => x.id), ORDER)
  const small = listFeedback(file, { status: 'all', limit: 2 })
  assert.deepEqual(small.items.map((x) => x.id), ORDER.slice(0, 2), 'limit 取分诊序的前 N')
  assert.equal(small.hasMore, true)
  const whole = listFeedback(file, { status: 'all', limit: Number.MAX_SAFE_INTEGER })
  assert.equal(whole.items.length, 8, 'replyFeedbackByOwner 用的口径仍然看得全')
  assert.equal(whole.page, 1)
  assert.equal(whole.pageSize, Number.MAX_SAFE_INTEGER)
})

test('批复与结案分离：resolve:false 只留批复、条目仍未结案（面板两个按钮的后端契约）', () => {
  const file = fixture()
  const before = listFeedback(file, { status: 'open' })
  assert.equal(before.openCount, 6)

  const replyOnly = replyFeedbackByOwner(file, { id: 'f-new-high', ownerReply: '先记下，周末处理', resolve: false })
  assert.equal(replyOnly.ok, true)
  assert.equal(replyOnly.resolved, false, '只批复不结案')
  const open = listFeedback(file, { status: 'open' })
  assert.equal(open.openCount, 6, '未解决数不变')
  const target = open.items.find((x) => x.id === 'f-new-high')
  assert.equal(target.ownerReply, '先记下，周末处理')
  assert.equal(target.resolved, false)

  const converted = replyFeedbackByOwner(file, {
    id: 'f-mid-high',
    ownerReply: '已转成屏蔽词',
    resolve: true,
    convertRule: { kind: 'dislike', value: '引导冥想' },
  })
  assert.equal(converted.resolved, true, '批复并结案是真的结案')
  const after = listFeedback(file, { status: 'all' })
  const done = after.items.find((x) => x.id === 'f-mid-high')
  assert.equal(done.resolved, true)
  assert.deepEqual(done.convertedRule, { kind: 'dislike', value: '引导冥想' })
  assert.equal(after.openCount, 5, '两条操作里只结案了一条：6 → 5')
})

test('她新提的意见（appendFeedback）走同一套：默认落 open/low，新的在前', () => {
  const file = fixture()
  const a = appendFeedback({ issue: '分诊台没有分页，一屏渲染 51 条', severity: 'high', selfHandled: true, note: '先只看 high' }, file)
  assert.ok(a.ok)
  const r = listFeedback(file, { status: 'open' })
  assert.equal(r.openCount, 7)
  assert.equal(r.items[0].id, a.id, '刚提的未解决 high 排第一')
  assert.equal(r.highOpenCount, 4)
  assert.equal(r.selfHandledCount, 3)
})

/**
 * 排序口径写在调用点上（2026-11-05 集成时补的契约）。
 *
 * 默认 `triage`，但 `contextSegments` 给她注入"最近提过且主人批复了的"那几句用的是
 * `{status:'all',limit:20,order:'recent'}`：跟着分诊序走的话，未解决的高严重度
 * 会把最新的挤出去——**她的提示词内容会跟着变**。这种决定要写在调用点上，
 * 不能由"这次有没有分页"暗中决定。
 */
test('排序默认＝分诊序；要「最近 N 条」就明写 order:"recent"', () => {
  const file = mkfile('fb-order.jsonl')
  said(file, 'a-old-high', { at: '2026-10-01T00:00:00.000Z', severity: 'high' })
  said(file, 'b-mid-low', { at: '2026-11-04T00:00:00.000Z' })
  said(file, 'c-new-low', { at: '2026-11-05T00:00:00.000Z' })

  assert.deepEqual(
    listFeedback(file, { status: 'all', limit: 2 }).items.map((x) => x.id),
    ['a-old-high', 'c-new-low'],
    '默认分诊序：未解决的高严重度顶在前面',
  )
  assert.deepEqual(
    listFeedback(file, { status: 'all', page: 1, pageSize: 2 }).items.map((x) => x.id),
    ['a-old-high', 'c-new-low'],
    '分页与非分页同一套默认序，不按调用形状变脸',
  )
  assert.deepEqual(
    listFeedback(file, { status: 'all', limit: 2, order: 'recent' }).items.map((x) => x.id),
    ['c-new-low', 'b-mid-low'],
    '注入给她的那一路：按时间新→旧，10 月的旧账不顶掉昨天的',
  )
})
