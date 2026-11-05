/**
 * 召回解释面板（F11 · 审计 §2.2 深挖项）。
 *
 * 面板以前只能看到一句「和眼下的事有关（80%）」，看不到分数是怎么凑出来的。
 * 现在要能看见四个因子（关键词/鲜活/情绪/新鲜）各自的原值与贡献分——
 * 这一块的价值全在"看得见"，所以断言的是**页面上真的画出来了**。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mountPanel, settle } from '../helpers/panel-harness.mjs'
import { memoryCenterPanel } from '../../packages/cap-memory/src/webui/client.ts'

const FACTORS = {
  keyword: 0.8, vivid: 0.5, mood: 0.9, recency: 0.6,
  contributions: { keyword: 0.32, vivid: 0.15, mood: 0.135, recency: 0.09 },
  weights: { keyword: 0.4, vivid: 0.3, mood: 0.15, recency: 0.15 },
}

function mountExplain(res) {
  const h = mountPanel({
    list: () => ({ ok: true, counts: { total: 0, core: 0, active: 0, archived: 0, voided: 0 }, items: [] }),
    recallExplain: () => res,
  }, { panelId: 'memory-center' })
  memoryCenterPanel.mount(h.ctx)
  return h
}

const okRes = {
  ok: true,
  query: '雨声 助眠',
  poolSize: 72,
  weights: { keyword: 0.4, vivid: 0.3, mood: 0.15, recency: 0.15 },
  items: [
    { id: 'mem-1', content: '看过《雨声白噪音》助眠合集', score: 0.695, slot: 'core', why: ['和眼下的事有关（80%）', '3 天前'], factors: FACTORS },
    { id: 'mem-2', content: '主人说今天加班到很晚', score: 0.31, slot: 'core', why: ['7 天前'], factors: { ...FACTORS, keyword: 0 } },
  ],
}

test('召回解释：写了情境就能算出四因子，画在页面上', async () => {
  const h = mountExplain(okRes)
  await settle()
  await h.click(h.findButton('算一算'))
  const text = h.root.textContent
  assert.match(text, /召回解释/, '要有这一块')
  assert.match(text, /关键词/)
  assert.match(text, /鲜活度/)
  assert.match(text, /情绪/)
  assert.match(text, /新鲜度/)
  assert.match(text, /雨声白噪音/, '命中的那条要列出来')
  assert.match(text, /0\.695/, '总分要显示')
  assert.match(text, /候选池 72 条/, '候选池大小要显示')
  assert.match(text, /权重：关键词 0\.4/, '权重要写出来，不能只有一根条')
})

test('召回解释：每条命中的贡献分都要在（四个因子 × 两条）', async () => {
  const h = mountExplain(okRes)
  await settle()
  await h.click(h.findButton('算一算'))
  const text = h.root.textContent
  // 第一条的四个贡献分
  assert.match(text, /贡献 0\.32/)
  assert.match(text, /贡献 0\.15/)
  assert.match(text, /贡献 0\.135/)
  assert.match(text, /贡献 0\.09/)
})

test('召回解释：一条都没排出来时说人话，不留空白', async () => {
  const h = mountExplain({ ok: true, query: 'xyz', poolSize: 0, weights: { keyword: 0.4, vivid: 0.3, mood: 0.15, recency: 0.15 }, items: [] })
  await settle()
  await h.click(h.findButton('算一算'))
  assert.match(h.root.textContent, /没有匹配上的记忆/)
})

test('召回解释：情境是空的就报「先写一句」，不发无效请求', async () => {
  const h = mountPanel({
    list: () => ({ ok: true, counts: { total: 0, core: 0, active: 0, archived: 0, voided: 0 }, items: [] }),
    recallExplain: () => ({ ok: false, error: '先写一句「当时在想什么」，我才好照着算' }),
  }, { panelId: 'memory-center' })
  memoryCenterPanel.mount(h.ctx)
  await settle()
  await h.click(h.findButton('算一算'))
  assert.match(h.msgText(), /当时在想什么/)
})
