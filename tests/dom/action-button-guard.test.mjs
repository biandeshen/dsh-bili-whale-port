/**
 * 按钮防护三件套（busy / confirm / preRun）与未保存输入闸门的行为契约。
 *
 * 对应设计走查 story-2「按按钮不再赌运气」与 story-3「打字打一半不再蒸发」。
 * 这些都必须能离线重复跑：真浏览器点一遍只能证明"这一次没坏"。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mountPanel, settle } from '../helpers/panel-harness.mjs'
import { actionButton, createDirtyGuard, debounce } from '../../packages/cortico-adapter/src/webui-helpers.ts'

test('busy：请求在飞的当口按钮是禁用的，连点第二下不会发第二次请求', async () => {
  let gate
  const h = mountPanel({
    doit: async () => { await new Promise((r) => { gate = r }); return { ok: true } },
  })
  const msg = h.ui.msgline()
  const btn = actionButton(h.ctx, h.ui, msg, '发一次', 'doit', [{ a: 1 }])
  h.root.append(btn)

  const inFlight = h.fire(btn)
  await settle(2)
  assert.equal(btn.disabled, true, '点击即禁用')
  assert.match(btn.textContent, /发一次…/, '文案要表明在忙')

  h.fire(btn)          // 连点
  await settle(2)
  gate && gate()
  await Promise.all(inFlight)
  await settle()

  assert.equal(h.calls.filter((c) => c.method === 'doit').length, 1, '连点只发一次')
  assert.equal(btn.disabled, false, '做完必须恢复可点（disable() 记录原值的顺序错了就会永久死掉）')
  assert.equal(btn.textContent, '发一次', '文案要还原')
})

test('confirm：取消这条路真的什么都不做——不请求、不刷新、连消息行都不动', async () => {
  const h = mountPanel({ doit: () => ({ ok: true }) })
  const msg = h.ui.msgline('上一轮的旧提示')
  let refreshed = 0
  const btn = actionButton(h.ctx, h.ui, msg, '解除风控', 'doit', [{ a: 1 }], {
    confirm: { title: '确认解除？', body: '解除后她立刻恢复对外写', danger: true },
    after: () => { refreshed++ },
  })
  h.root.append(btn)

  h.confirmAnswer = false
  await h.click(btn)
  assert.equal(h.calls.length, 0, '取消后一条请求都不许发')
  assert.equal(refreshed, 0, '取消后不许刷新')
  assert.equal(msg.textContent, '上一轮的旧提示', '取消 = 这一屏什么都没发生过')
  assert.equal(btn.disabled, false)
  assert.equal(h.confirms.length, 1)
  assert.equal(h.confirms[0].danger, true)

  h.confirmAnswer = true
  await h.click(btn)
  assert.equal(h.calls.length, 1, '答应了才发')
  assert.equal(refreshed, 1)
})

test('confirm 的正文是点击那一刻的输入框内容，而且是节点（字符串那一路不保留换行）', async () => {
  const h = mountPanel({ doit: () => ({ ok: true }) })
  const msg = h.ui.msgline()
  const box = { value: '第一行\n第二行：改过的正文' }
  const btn = actionButton(h.ctx, h.ui, msg, '放行', 'doit', undefined, {
    argsFactory: () => [{ id: 'q-1' }],
    confirm: { title: '确认发到 B 站？', body: () => `就是这一段：\n\n${box.value}` },
  })
  h.root.append(btn)
  await h.click(btn)
  const body = h.confirms[0].body
  assert.equal(typeof body.tagName, 'string', '确认层正文给节点')
  assert.match(body.textContent, /第一行\n第二行：改过的正文/)
  assert.equal(body.style.whiteSpace, 'pre-wrap', '正文要保留换行')
})

test('preRun：返回一句中止原因时请求不发，但那句话必须留在消息行里', async () => {
  const h = mountPanel({ doit: () => ({ ok: true }) })
  const msg = h.ui.msgline()
  const btn = actionButton(h.ctx, h.ui, msg, '拒掉', 'doit', undefined, {
    preRun: async () => '没填理由，已取消拒稿',
    argsFactory: () => [{ id: 'q-1' }],
    after: () => { h.calls.push({ method: 'AFTER' }) },
  })
  h.root.append(btn)
  await h.click(btn)
  assert.deepEqual(h.calls, [], '中止时既不发请求也不跑 after')
  assert.equal(msg.textContent, '没填理由，已取消拒稿')
  assert.ok(msg.classList.contains('bad'), '中止原因要走警示色')
})

test('失败原因在刷新之后仍然可见（回归：曾被自己的刷新擦掉）', async () => {
  const h = mountPanel({
    doit: () => { throw new Error('后端 500：闸门拒了') },
    list: () => ({ ok: true }),
  })
  const msg = h.ui.msgline()
  const btn = actionButton(h.ctx, h.ui, msg, '删掉超期的', 'doit', undefined, {
    // 模拟真实面板的刷新：refresh 一开头就会清空消息行
    after: async () => { await h.ctx.invoke('list', []) },
  })
  h.root.append(btn)
  await h.click(btn)
  assert.equal(msg.textContent, '后端 500：闸门拒了', '错误要活过刷新')
  assert.ok(msg.classList.contains('bad'))
})

test('服务端用 ok:false 表达"没做"时不当成成功', async () => {
  const h = mountPanel({ doit: () => ({ ok: false, error: '要 confirm:true 才动手' }) })
  const msg = h.ui.msgline()
  const btn = actionButton(h.ctx, h.ui, msg, '拉黑', 'doit', undefined, { confirm: { title: '确认拉黑？', body: 'x' } })
  h.root.append(btn)
  await h.click(btn)
  assert.equal(msg.textContent, '要 confirm:true 才动手')
  assert.ok(msg.classList.contains('bad'))
})

test('argsFactory 抛错不再静默：原因写进消息行', async () => {
  const h = mountPanel({ doit: () => ({ ok: true }) })
  const msg = h.ui.msgline()
  const btn = actionButton(h.ctx, h.ui, msg, '按钮', 'doit', undefined, {
    argsFactory: () => { throw new Error('取参数失败') },
  })
  h.root.append(btn)
  await h.click(btn)
  assert.equal(h.calls.length, 0)
  assert.equal(msg.textContent, '取参数失败')
})

test('dirtyGuard：没脏不问，脏了先问一句，答"丢掉"才放行刷新', async () => {
  const h = mountPanel({})
  const guard = createDirtyGuard(h.ui)
  assert.equal(await guard.guard(), true, '空的登记簿不该弹层')
  assert.equal(h.confirms.length, 0)

  const savedText = { current: '存档的那份' }
  const input = { value: '我改到一半' }
  const off = guard.watch(input, () => savedText.current)
  assert.equal(guard.dirty().length, 1)

  h.confirmAnswer = false
  assert.equal(await guard.guard(), false, '取消 = 调用方别刷新')
  assert.equal(input.value, '我改到一半', '问一句不该改动内容')

  h.confirmAnswer = true
  assert.equal(await guard.guard(), true)
  assert.match(String(h.confirms.at(-1).title), /没保存/)

  // 存好了就不该再拦人
  savedText.current = '我改到一半'
  assert.equal(guard.dirty().length, 0)
  assert.equal(await guard.guard(), true)

  off()
  input.value = '又改了'
  assert.equal(guard.dirty().length, 0, '摘掉登记后不再盯它')
})

test('debounce：打字途中只发一次搜索', async () => {
  let n = 0
  const d = debounce(() => { n++ }, 20)
  d.run(); d.run(); d.run()
  assert.equal(n, 0, '还在敲，不该发')
  await new Promise((r) => setTimeout(r, 60))
  assert.equal(n, 1, '手停了才算说完')
  d.cancel()
})
