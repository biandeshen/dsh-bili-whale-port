/**
 * 召回解释（F11 · 审计 §2.2 深挖项：面板要能看见"她为什么想起这条"）。
 *
 * 这一条测三件事，缺一不可：
 *   1. 面板方法真的按情境打分，并把四个因子摊开；
 *   2. **只读**：看一眼不能让她的记忆变旧（accessCount / vividness 不能被动）——
 *      面板是给人看的，主人多瞄两眼就把记忆衰减了，那是事故不是功能；
 *   3. 分数与贡献分对得上（前端画条时不能各说各话）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createMemoryCapability } from '../src/index.ts'

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-recallx-'))
  const memoRoot = path.join(dir, 'memo')
  const cap = createMemoryCapability({ memoRoot, getCurrentMood: () => 0.2 })
  return { dir, memoRoot, cap, panel: cap.panels().find((p) => p.id === 'memory-center') }
}

test('召回解释：按情境打分，四因子原值与贡献分都摊开', async () => {
  const { cap, panel } = setup()
  await panel.methods.create.invoke({ content: '看过《雨声白噪音》助眠合集', tier: 'active' })
  await panel.methods.create.invoke({ content: '主人说今天加班到很晚', tier: 'active' })

  const res = await panel.methods.recallExplain.invoke({ text: '雨声 助眠', limit: 5 })
  assert.equal(res.ok, true)
  assert.ok(res.items.length >= 1, '要排出结果')
  assert.deepEqual(res.weights, { keyword: 0.40, vivid: 0.30, mood: 0.15, recency: 0.15 })
  assert.ok(res.poolSize >= 2, '候选池是全部卡片')

  const top = res.items[0]
  assert.match(top.content, /雨声/)
  assert.ok(top.why.length >= 1, '要有命中理由')
  const f = top.factors
  for (const k of ['keyword', 'vivid', 'mood', 'recency']) {
    assert.ok(Number.isFinite(f[k]), `${k} 要是数字`)
    assert.ok(f[k] >= 0 && f[k] <= 1, `${k} 要落在 0~1`)
  }
  const sum = f.contributions.keyword + f.contributions.vivid + f.contributions.mood + f.contributions.recency
  assert.ok(Math.abs(sum - top.score) < 0.002, `分数 = 贡献分之和（${sum} vs ${top.score}）`)
  assert.ok(f.contributions.keyword > 0, '关键词命中就该有贡献分')
})

test('召回解释：空情境不编，直接说人话', async () => {
  const { panel } = setup()
  const res = await panel.methods.recallExplain.invoke({ text: '   ' })
  assert.equal(res.ok, false)
  assert.match(res.error, /情境|当时在想什么/)
})

test('召回解释：只读——看一眼不能让她的记忆变旧', async () => {
  const { cap, panel } = setup()
  const created = await panel.methods.create.invoke({ content: '看过《雨声白噪音》', tier: 'active' })
  const id = created.card?.id
  assert.ok(id, '建出来了')

  const before = JSON.parse(JSON.stringify(cap.store.readAll({ tier: 'all' }).find((c) => c.id === id)))
  // 看三次：面板开着就会反复算
  for (let i = 0; i < 3; i++) {
    const res = await panel.methods.recallExplain.invoke({ text: '雨声', limit: 5 })
    assert.equal(res.ok, true)
  }
  const after = cap.store.readAll({ tier: 'all' }).find((c) => c.id === id)
  assert.equal(after.accessCount, before.accessCount, 'accessCount 不能被"看一眼"改掉')
  assert.equal(after.vividness, before.vividness, '鲜活度不能被"看一眼"改掉')
})
