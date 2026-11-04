/**
 * 记忆中心：切档要真的换数据、搜索要防抖、保存只重画那一张、没保存的字不能被抹掉。
 *
 * 对应设计走查 story-3（打字打一半不再蒸发）。里面那条切档不刷新是真点出来的 bug：
 * 层级分段选择器原来只给 `tier` 赋值，不重新取数，主人点「核心常驻」列表根本不动。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mountPanel, settle } from '../helpers/panel-harness.mjs'
import { memoryCenterPanel } from '../../packages/cap-memory/src/webui/client.ts'

function mkCard(over = {}) {
  return {
    id: 'm-1',
    tier: 'active',
    content: '主人喜欢听雨声，别在深夜放吵的东西',
    tags: ['雨声', '偏好'],
    vividness: 0.9,
    accessCount: 3,
    voidReason: '',
    ...over,
  }
}

function mountMemory(cards = [mkCard(), mkCard({ id: 'm-2', tier: 'core', content: '她住在深海里' })]) {
  const state = { cards: cards.map((c) => ({ ...c })), updates: [], voids: [] }
  const findCard = (id) => state.cards.find((c) => c.id === id)
  const h = mountPanel({
    list: (p = {}) => {
      const q = String(p.query ?? '').trim()
      const pool = state.cards.filter((c) => {
        if (p.tier && p.tier !== 'all' && c.tier !== p.tier) return false
        if (q && !`${c.content} ${(c.tags ?? []).join(' ')} ${c.id}`.includes(q)) return false
        return true
      })
      return {
        ok: true,
        counts: {
          total: state.cards.length,
          core: state.cards.filter((c) => c.tier === 'core').length,
          active: state.cards.filter((c) => c.tier === 'active').length,
          archived: state.cards.filter((c) => c.tier === 'archived').length,
          voided: state.cards.filter((c) => c.tier === 'voided').length,
        },
        items: pool,
      }
    },
    update: (p = {}) => {
      state.updates.push({ ...p })
      const c = findCard(p.id)
      if (!c) return { ok: false, error: `找不到记忆卡片: ${p.id}` }
      if (p.content !== undefined) c.content = String(p.content).trim()
      if (p.tags !== undefined) c.tags = p.tags
      if (p.vividness !== undefined) c.vividness = p.vividness
      if (p.tier !== undefined) c.tier = p.tier
      return { ok: true, card: { ...c } }
    },
    void: (p = {}) => {
      state.voids.push({ ...p })
      const c = findCard(p.id)
      if (!c) return { ok: false, error: '找不到' }
      c.tier = 'voided'
      c.voidReason = p.reason
      return { ok: true, card: { ...c } }
    },
    restore: (p = {}) => {
      const c = findCard(p.id)
      if (!c) return { ok: false, error: '找不到' }
      c.tier = p.targetTier ?? 'active'
      c.voidReason = ''
      return { ok: true, card: { ...c } }
    },
  }, { panelId: 'memory-center' })
  memoryCenterPanel.mount(h.ctx)
  return { h, state }
}

/** 收集当前 DOM 里某种标签的控件 */
function collect(rootEl, tag) {
  const out = []
  const walk = (el) => {
    if (el.tagName === tag) out.push(el)
    for (const c of el.children) walk(c)
  }
  walk(rootEl)
  return out
}

const listCalls = (h) => h.calls.filter((c) => c.method === 'list').length
const lastListArgs = (h) => h.calls.filter((c) => c.method === 'list').at(-1).args[0]

test('切层级会重新取数（原来只赋值不刷新，点了列表根本不动）', async () => {
  const { h } = mountMemory()
  await settle()
  const before = listCalls(h)
  await h.click(h.findButton('核心常驻'))
  assert.equal(listCalls(h), before + 1, '点「核心常驻」要再拉一次')
  assert.equal(lastListArgs(h).tier, 'core')
  assert.match(h.root.textContent, /她住在深海里/)
  assert.doesNotMatch(h.root.textContent, /主人喜欢听雨声/, '非核心的那条该从这一档里消失')
})

test('搜索防抖 300ms：连打五个字只发一次请求', async () => {
  const { h } = mountMemory()
  await settle()
  const before = listCalls(h)
  const search = collect(h.root, 'INPUT').find((i) => String(i.placeholder).includes('搜正文'))
  assert.ok(search, '要有搜索框')
  for (const ch of ['雨', '声', '的', '偏', '好']) {
    search.value += ch
    for (const fn of search.listeners.get('input') ?? []) fn({})
  }
  assert.equal(listCalls(h), before, '还在敲，一次都不该发')
  await new Promise((r) => setTimeout(r, 420))
  assert.equal(listCalls(h), before + 1, '手停下来了才搜一次')
  assert.equal(lastListArgs(h).query, '雨声的偏好')
})

test('保存修改只重画这一张：不重新取数', async () => {
  const { h, state } = mountMemory()
  await settle()
  const before = listCalls(h)
  const tas = h.textareas()
  assert.equal(tas.length, 3, '两张卡的正文框 + 底下"塞一条记忆给她"的正文框')
  tas[0].value = '改成：主人喜欢听雨声，深夜别放吵的'
  tas[1].value = '另一张写到一半'

  await h.click(h.findButton('保存修改'))
  assert.deepEqual(state.updates[0], {
    id: 'm-1',
    content: '改成：主人喜欢听雨声，深夜别放吵的',
    tags: ['雨声', '偏好'],
    vividness: 0.9,
  })
  assert.equal(listCalls(h), before, '按 id 局部更新，不该整列表重建')
  assert.equal(state.cards[0].content, '改成：主人喜欢听雨声，深夜别放吵的')
  assert.equal(h.textareas()[1].value, '另一张写到一半', '别的卡上没保存的字不该被动到')
})

test('卡片重画之后旧登记失效：不会一直拦着刷新（isConnected 那条路）', async () => {
  const { h } = mountMemory()
  await settle()
  h.textareas()[0].value = '改过并已保存的一句'
  await h.click(h.findButton('保存修改'))
  h.confirmAnswer = false
  await h.click(h.findButton('核心常驻'))
  const blocked = h.confirms.filter((c) => /没保存/.test(String(c.title)))
  assert.equal(blocked.length, 0, `保存过了就不该再拦：${blocked.map((b) => b.title).join('｜')}`)
})

test('置顶进核心要确认，取消就什么都不发（它会改变她每一轮带着什么）', async () => {
  const { h, state } = mountMemory([mkCard({ id: 'm-7', tier: 'active' })])
  await settle()
  h.confirmAnswer = false
  await h.click(h.findButton('置顶进核心'))
  assert.equal(state.updates.length, 0, '没答应就不许改她的记忆层级')
  assert.match(String(h.confirms.at(-1)?.title ?? ''), /核心常驻/)

  h.confirmAnswer = true
  await h.click(h.findButton('置顶进核心'))
  assert.deepEqual(state.updates.at(-1), { id: 'm-7', tier: 'core' })
  assert.equal(state.cards[0].tier, 'core')
})

test('作废的 prompt 按取消＝不作废（原来会把空理由写进去）', async () => {
  const { h, state } = mountMemory([mkCard({ id: 'm-8' })])
  await settle()
  h.prompts = []                     // 假 window.prompt 返回 null，等同浏览器里按了取消
  // 「🚫 作废」而不是「作废」：层级筛选那颗按钮就叫「已作废」，标签撞车会误点到它
  await h.click(h.findButton('🚫 作废'))
  assert.equal(state.voids.length, 0, '取消就不该动')
  assert.match(h.msgLine().textContent, /已取消作废/)

  h.prompts = ['这条记错了，她记的是另一场雨']
  await h.click(h.findButton('🚫 作废'))
  assert.deepEqual(state.voids.at(-1), { id: 'm-8', reason: '这条记错了，她记的是另一场雨' })
  assert.equal(state.cards[0].tier, 'voided')
})

test('读数说人话：层级中文化、鲜活度是百分比不是 0.8999999', async () => {
  const { h } = mountMemory([mkCard({ id: 'm-9', tier: 'core', vividness: 0.8999999 })])
  await settle()
  assert.match(h.root.textContent, /核心常驻/)
  assert.match(h.root.textContent, /鲜活 90%/)
  assert.doesNotMatch(h.root.textContent, /0\.8999/, '别把原始浮点摊在页面上')
})
