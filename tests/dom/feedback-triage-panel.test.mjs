/**
 * 意见箱分诊台的行为契约（设计交接 story-6：51 条堆着、批复与结案分不开）。
 *
 * 这里钉的是"点下去到底发生了什么"：
 *   ① 只批复 ≠ 结案（`resolve:false`，这是 story-6 的核心分离）；
 *   ② 空批复 / 空规则值**一条请求都不发**（审计 D10：空值会写进一条没内容的规则）；
 *   ③ 分页参数与首尾页的禁用态；
 *   ④ 刚批复完不会被自己的"你有没保存的修改"再拦一道。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mountPanel, settle } from '../helpers/panel-harness.mjs'
import { feedbackTriagePanel } from '../../packages/cap-journal/src/webui/client.ts'

function mkItem(over = {}) {
  return {
    id: 'f-1',
    at: '2026-11-04T10:00:00.000Z',
    day: '2026-11-04',
    issue: '心跳自我对话太吵，我一句话要说三遍',
    severity: 'high',
    selfHandled: false,
    note: '',
    resolved: false,
    resolvedBy: null,
    ownerReply: null,
    convertedRule: null,
    ...over,
  }
}

function mountTriage(items = [mkItem()]) {
  const state = { items: items.map((x) => ({ ...x })), replies: [] }
  const h = mountPanel({
    listFeedback: (p = {}) => {
      const size = Number(p.pageSize ?? 10) || 10
      const page = Number(p.page ?? 1) || 1
      let pool = state.items.filter((x) => {
        if (p.status === 'open' && x.resolved) return false
        if (p.status === 'resolved' && !x.resolved) return false
        if (p.severity && p.severity !== 'all' && x.severity !== p.severity) return false
        if (typeof p.selfHandled === 'boolean' && x.selfHandled !== p.selfHandled) return false
        return true
      })
      const total = pool.length
      const start = (page - 1) * size
      pool = pool.slice(start, start + size)
      return {
        ok: true,
        total: state.items.length,
        openCount: state.items.filter((x) => !x.resolved).length,
        highCount: state.items.filter((x) => x.severity === 'high').length,
        highOpenCount: state.items.filter((x) => x.severity === 'high' && !x.resolved).length,
        selfHandledCount: state.items.filter((x) => x.selfHandled).length,
        filteredCount: total,
        page,
        pageSize: size,
        hasMore: start + pool.length < total,
        items: pool,
      }
    },
    replyFeedback: (p = {}) => {
      state.replies.push({ ...p })
      const it = state.items.find((x) => x.id === p.id)
      if (it) {
        if (typeof p.ownerReply === 'string') it.ownerReply = p.ownerReply
        if (p.resolve) it.resolved = true
        if (p.convertRule) it.convertedRule = p.convertRule
      }
      return { ok: true, id: p.id, resolved: Boolean(p.resolve), ownerReply: p.ownerReply ?? null }
    },
  }, { panelId: 'feedback-triage' })
  feedbackTriagePanel.mount(h.ctx)
  return { h, state }
}

test('挂载就按分诊口径取数：未解决 + 第 1 页 + 每页 10 条', async () => {
  const { h } = mountTriage()
  await settle()
  const call = h.calls.find((c) => c.method === 'listFeedback')
  assert.ok(call, '要拉一次列表')
  assert.deepEqual(call.args[0], { status: 'open', severity: 'all', page: 1, pageSize: 10 })
  assert.match(h.root.textContent, /1 条 · 未解决 1 · high 1/, '顶部总览一行要说清优先级')
})

test('批复是空的就不发请求（只批复不结案时总得写一句）', async () => {
  const { h, state } = mountTriage()
  await settle()
  await h.click(h.findButton('只写批复'))
  assert.equal(state.replies.length, 0, '空批复不许落盘')
  assert.equal(h.calls.filter((c) => c.method === 'replyFeedback').length, 0, '连请求都不该发')
  assert.match(h.msgLine().textContent, /批复是空的/)
})

test('只写批复：resolve:false，条目仍未结案（这就是 story-6 要的分离）', async () => {
  const { h, state } = mountTriage()
  await settle()
  h.textareas()[0].value = '我知道，这就去修心跳'
  await h.click(h.findButton('只写批复'))
  assert.deepEqual(state.replies, [{ id: 'f-1', ownerReply: '我知道，这就去修心跳', resolve: false }])
  assert.equal(state.items[0].resolved, false, '批复不等于结案')
  assert.equal(state.items[0].ownerReply, '我知道，这就去修心跳')
})

test('批复并结案：resolve:true，结案后这条从"未解决"里消失', async () => {
  const { h, state } = mountTriage([mkItem({ id: 'f-9' })])
  await settle()
  h.textareas()[0].value = '行，这条我认'
  await h.click(h.findButton('批复并结案'))
  assert.deepEqual(state.replies[0], { id: 'f-9', resolve: true, ownerReply: '行，这条我认' })
  assert.equal(state.items[0].resolved, true)
  // 默认筛的是"未解决"，结案之后这一行就该没了——空态而不是残留
  assert.match(h.root.textContent, /这一档没有要处理的意见/)
})

test('转成过滤规则：resolve:false + 后端真认的 kind（不假装能转偏好词/转待办）', async () => {
  const { h, state } = mountTriage([mkItem({ id: 'f-8' })])
  await settle()
  const inputs = []
  const walk = (el) => { if (el.tagName === 'INPUT') inputs.push(el); for (const c of el.children) walk(c) }
  walk(h.root)
  const ruleValue = inputs.find((i) => String(i.placeholder).includes('必填'))
  assert.ok(ruleValue, '每条要有规则值输入框')
  ruleValue.value = '引导冥想'
  await h.click(h.findButton('转成过滤规则'))
  const conv = state.replies.at(-1)
  assert.equal(conv.resolve, false, '转规则不等于结案')
  assert.deepEqual(conv.convertRule, { kind: 'dislike', value: '引导冥想' })
  assert.deepEqual(state.items[0].convertedRule, { kind: 'dislike', value: '引导冥想' })

  const selects = []
  const walkSel = (el) => { if (el.tagName === 'SELECT') selects.push(el); for (const c of el.children) walkSel(c) }
  walkSel(h.root)
  const kinds = selects[0].options.map((o) => o.value)
  assert.deepEqual(kinds, ['dislike', 'keyword', 'exemptUp'], '下拉只给后端真认的三种去向')
})

test('规则值是空的就不发请求（审计 D10：空值会写进一条没内容的规则）', async () => {
  const { h, state } = mountTriage()
  await settle()
  await h.click(h.findButton('转成过滤规则'))
  assert.equal(state.replies.length, 0)
  assert.match(h.msgLine().textContent, /转规则要给内容/)
})

test('刚批复完不会被"你有没保存的修改"再拦一道', async () => {
  const { h } = mountTriage()
  await settle()
  h.textareas()[0].value = '写完就存档的那句'
  h.confirmAnswer = false      // 万一真的弹了拦截，这里会拒绝 → 断言能抓住
  await h.click(h.findButton('只写批复'))
  const blocked = h.confirms.filter((c) => /没保存/.test(String(c.title)))
  assert.equal(blocked.length, 0, `保存成功后不该再拦：${blocked.map((b) => b.title).join('｜')}`)
  assert.equal(h.calls.filter((c) => c.method === 'listFeedback').length, 2, '批复之后照常刷新了一次')
})

test('没存盘的批复要换筛选/翻页时，先问一句（打字打一半不再蒸发）', async () => {
  const { h } = mountTriage([mkItem({ id: 'f-a' }), mkItem({ id: 'f-b', issue: '另一条' })])
  await settle()
  h.textareas()[0].value = '写到一半的批复'
  const before = h.calls.filter((c) => c.method === 'listFeedback').length
  h.confirmAnswer = false
  await h.click(h.findButton('↻ 刷新'))
  assert.equal(h.calls.filter((c) => c.method === 'listFeedback').length, before, '答"别动"就不该重新取数')
  assert.match(String(h.confirms.at(-1)?.title ?? ''), /没保存/)

  h.confirmAnswer = true
  await h.click(h.findButton('↻ 刷新'))
  assert.equal(h.calls.filter((c) => c.method === 'listFeedback').length, before + 1, '答应丢掉才刷新')
})

test('翻页：第 2 页带得上 page=2，到头按钮禁用，页数说人话', async () => {
  const many = Array.from({ length: 12 }, (_, i) => mkItem({ id: `f-${i}`, issue: `第 ${i} 条意见` }))
  const { h } = mountTriage(many)
  await settle()
  assert.match(h.root.textContent, /第 1 \/ 2 页/)
  assert.equal(h.findButton('上一页').disabled, true, '第一页不该能往前翻')
  assert.equal(h.findButton('下一页').disabled, false)

  await h.click(h.findButton('下一页'))
  const last = h.calls.filter((c) => c.method === 'listFeedback').at(-1)
  assert.equal(last.args[0].page, 2)
  assert.match(h.root.textContent, /第 2 \/ 2 页/)
  assert.equal(h.findButton('下一页').disabled, true, '最后一页该禁用')
})

test('空态只在真的没有时铺占位，不跟数据行并存（上一周真浏览器实测踩过）', async () => {
  const { h } = mountTriage([])
  await settle()
  assert.match(h.root.textContent, /这一档没有要处理的意见/)

  const { h: h2 } = mountTriage([mkItem()])
  await settle()
  assert.doesNotMatch(h2.root.textContent, /这一档没有要处理的意见/, '有数据时不许同时出现空态占位')
  assert.match(h2.root.textContent, /心跳自我对话太吵/)
})
