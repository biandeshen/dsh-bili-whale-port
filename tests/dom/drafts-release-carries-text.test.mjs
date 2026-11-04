/**
 * 待放行改稿台：改了字直接点放行，发出去的是新稿还是旧稿？
 *
 * 这是控制台改版走查里最贵的一个 blocker（spark-output/context/audit.json F1）：
 * 「✓ 放行发布」原来只发 `{ id }`，后端拿的是**队列里存的旧正文**——
 * 主人在线改完字直接点放行，改动被静默丢弃，B 站收到改前的稿子，而且撤不回来。
 * 这里把"绝不发旧稿"钉成可重复跑的行为契约。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mountPanel, settle, pendingItem } from '../helpers/panel-harness.mjs'
import { draftsQueuePanel } from '../../packages/cap-bilibili/src/webui/client.ts'

/** 造一个"队列"后端：updateDraft 会清洗+重算哈希+续签令牌，release 只认队列里那份。 */
const hashOf = (text) => `hash-of-${String(text ?? '').trim().length}`

function makeQueue(item = pendingItem()) {
  const state = { item: { ...item, bodyHash: hashOf(item.text) }, released: [], saved: [] }
  const handlers = {
    list: () => ({ ok: true, count: 1, items: [state.item] }),
    updateDraft: ({ id, text }) => {
      if (id !== state.item.id) return { ok: false, error: `找不到待放行项: ${id}` }
      const cleaned = String(text ?? '').trim()
      state.item = { ...state.item, text: cleaned, bodyHash: hashOf(cleaned), token: 'ack-new', updatedAt: new Date().toISOString() }
      state.saved.push(cleaned)
      return { ok: true, item: state.item }
    },
    release: ({ id }) => {
      const it = state.item
      if (id !== it.id) return { ok: false, reason: `找不到待放行项: ${id}` }
      // 后端那道哈希校验：队列正文与 bodyHash 不一致就不发
      if (it.bodyHash !== hashOf(it.text)) {
        return { ok: false, reason: '草稿正文哈希不匹配，请先保存修改后再放行' }
      }
      state.released.push(it.text)
      return { ok: true, dynId: 'dyn-1' }
    },
    reject: ({ id, reason }) => { state.rejected = reason; return { ok: true, item: { ...state.item, status: 'rejected' } } },
    requestNew: () => ({ ok: true, item: state.item }),
  }
  return { state, handlers }
}

function mountDrafts(item) {
  const { state, handlers } = makeQueue(item)
  const h = mountPanel(handlers, { panelId: 'drafts-queue' })
  draftsQueuePanel.mount(h.ctx)
  return { h, state }
}

test('改过字直接点放行：先发 updateDraft 再发 release，B 站收到的是新稿', async () => {
  const { h, state } = mountDrafts()
  await settle()
  const ta = h.textareas()[0]
  assert.equal(ta.value, '今天想说的是原来的那句')

  ta.value = '改成这一句才对'
  h.confirmAnswer = true
  await h.click(h.findButton('放行发布'))

  assert.deepEqual(h.calls.map((c) => c.method), ['list', 'updateDraft', 'release', 'list'],
    '放行前必须先存，存成才放行，最后才刷新')
  assert.deepEqual(h.calls[1].args[0], { id: 'q-dynamic-1', text: '改成这一句才对' })
  assert.deepEqual(h.calls[2].args[0], { id: 'q-dynamic-1' }, 'release 只带 id：正文已经存档，不存在"顺手带一份"的第二次真相')
  assert.deepEqual(state.released, ['改成这一句才对'], '真正发出去的是改后的正文')
  assert.match(h.confirms[0].body.textContent, /改成这一句才对/, '确认层要显示即将发布的完整正文')
  assert.match(h.confirms[0].body.textContent, /撤不回/, '确认层要写清不可撤回')
})

test('确认层点取消：一条请求都不发，打的字也还在', async () => {
  const { h, state } = mountDrafts()
  await settle()
  const ta = h.textareas()[0]
  ta.value = '还在犹豫的一句'
  h.confirmAnswer = false
  await h.click(h.findButton('放行发布'))

  assert.deepEqual(h.calls.map((c) => c.method), ['list'], '取消 = 什么都没发生')
  assert.deepEqual(state.released, [])
  assert.equal(h.textareas()[0].value, '还在犹豫的一句', '取消不该把话弄丢')
})

test('没改字时不瞎保存：直接放行，只发一次 updateDraft 都没有', async () => {
  const { h, state } = mountDrafts()
  await settle()
  h.confirmAnswer = true
  await h.click(h.findButton('放行发布'))
  assert.deepEqual(h.calls.map((c) => c.method), ['list', 'release', 'list'])
  assert.deepEqual(state.released, ['今天想说的是原来的那句'])
})

test('保存没成就不放行（宁可什么都不发，也不能发旧稿）', async () => {
  const item = pendingItem()
  const { h, state } = mountDrafts(item)
  await settle()
  // 让 updateDraft 失败：模拟后端拒了（找不到项 / 磁盘写失败）
  h.ctx.invoke = async (method, args) => {
    if (method === 'updateDraft') return { ok: false, error: '磁盘只读' }
    if (method === 'release') { state.released.push('不该被调用'); return { ok: true } }
    if (method === 'list') return { ok: true, count: 1, items: [item] }
    return { ok: true }
  }
  const ta = h.textareas()[0]
  ta.value = '改了但存不下去'
  h.confirmAnswer = true
  await h.click(h.findButton('放行发布'))

  assert.deepEqual(state.released, [], '存不住就中止，绝不发旧稿')
  assert.match(h.msgLine().textContent, /已中止放行/, '中止要给出原因')
})

test('💾 保存是这一行局部更新：不重建整列表，输入框对齐后端清洗后的那份', async () => {
  const { h, state } = mountDrafts()
  await settle()
  const ta = h.textareas()[0]
  ta.value = '  前后有空格的一句  '
  await h.click(h.findButton('保存修改'))

  assert.deepEqual(h.calls.map((c) => c.method), ['list', 'updateDraft'], '保存之后不必再拉一次全列表')
  assert.equal(ta.value, '前后有空格的一句', '以清洗并续签后的存档为准')
  assert.equal(state.item.bodyHash, 'hash-of-8')
  assert.match(h.msgLine().textContent, /已保存并续签令牌/)
})

test('刚保存完再点放行，不会被"你有没保存的修改"再拦一道', async () => {
  const { h, state } = mountDrafts()
  await settle()
  const ta = h.textareas()[0]
  ta.value = '先存一次'
  await h.click(h.findButton('保存修改'))
  h.confirmAnswer = true
  await h.click(h.findButton('放行发布'))
  assert.deepEqual(state.released, ['先存一次'])
  // 只有一次确认（放行本身），没有多弹一次"未保存"拦截
  assert.equal(h.confirms.length, 1, `确认层只该出现一次，实际 ${h.confirms.length} 次：${h.confirms.map((c) => c.title).join('｜')}`)
})

test('拒稿的 prompt 按取消 = 什么都不做（那道 prompt 本身就是确认层）', async () => {
  const { h, state } = mountDrafts()
  await settle()
  h.prompts = []            // 队列空 = 假 window.prompt 按浏览器规矩返回 null（取消）
  await h.click(h.findButton('拒掉'))
  assert.deepEqual(h.calls.map((c) => c.method), ['list'], '取消填理由就不该发 reject')
  assert.match(h.msgLine().textContent, /已取消拒稿/)
  assert.equal(state.rejected, undefined)
})

test('拒稿填了理由才发，而且带 askRewrite', async () => {
  const { h, state } = mountDrafts()
  await settle()
  h.prompts = ['太空泛，重写']
  await h.click(h.findButton('拒掉'))
  const rej = h.calls.find((c) => c.method === 'reject')
  assert.ok(rej, '该发 reject')
  assert.deepEqual(rej.args[0], { id: 'q-dynamic-1', reason: '太空泛，重写', askRewrite: true })
  assert.equal(state.rejected, '太空泛，重写')
})

test('正在改另一条稿时点了别处的刷新：先问一句，不让字静默蒸发', async () => {
  const { h } = mountDrafts()
  await settle()
  const ta = h.textareas()[0]
  ta.value = '这条还没保存'
  h.confirmAnswer = false   // 拦截刷新
  await h.click(h.findButton('点单让她写一条'))

  assert.deepEqual(h.calls.map((c) => c.method), ['list', 'requestNew'], '被拦下时不该再拉列表')
  assert.match(String(h.confirms.at(-1)?.title ?? ''), /没保存/, '要弹的是"有还没保存的修改"')
  assert.equal(h.textareas()[0].value, '这条还没保存', '取消 = 打的字原样留着')
})
