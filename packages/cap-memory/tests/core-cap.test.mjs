/**
 * 核心常驻上限**真的生效**（B13g）。
 *
 * 缺口长什么样：`residentCap` / `activeCap` / `archiveThreshold` 三个数
 * 早就在 `cap-memory` 的 `configSchema` 里声明了，但——
 *   · `residentCap` 从来没人读：核心常驻取的是硬编码 `slice(0, 8)`；
 *   · `activeCap` 从来没人读；
 *   · `archiveThreshold` 只是 `settle()` 的默认参数（0.35）。
 * 主人以为能调，页面上看不见、改了也没用——空旋钮比没旋钮更坏。
 *
 * 这一条钉住：
 *   1. 上下文里带的核心常驻条数**按配置来**（不是写死的 8）；
 *   2. 置顶进核心常驻**超上限要被拒**（core 层每轮都进上下文）；
 *   3. 超额要在上下文里**说出来**（"core 层共 N 条，本轮只带 M 条"）；
 *   4. 配置现读：改了立刻生效，不用重启。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createMemoryCapability, MEMORY_DEFAULTS } from '../src/index.ts'

function setup(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-corecap-'))
  const memoRoot = path.join(dir, 'memo')
  const cfg = { residentCap: 3, activeCap: 40, archiveThreshold: 0.35, ...over }
  const cap = createMemoryCapability({
    memoRoot,
    getCurrentMood: () => 0.2,
    getConfig: () => ({ ...cfg }),
  })
  return { dir, memoRoot, cfg, cap, panel: cap.panels().find((p) => p.id === 'memory-center') }
}

test('核心常驻上限：上下文只带上限那么多条', async () => {
  const { cap, panel } = setup({ residentCap: 3 })
  for (const t of ['第一条', '第二条', '第三条', '第四条', '第五条']) {
    // 建到 active 层（core 满了会被拒，见下一条）
    await panel.methods.create.invoke({ content: t, tier: 'active' })
  }
  // 手动置四条进 core（update 路径）
  const items = (await panel.methods.list.invoke({ tier: 'active' })).items
  for (const it of items.slice(0, 4)) {
    await panel.methods.update.invoke({ id: it.id, tier: 'core' })
  }
  const segs = await cap.contextSegments({ now: new Date(), timezone: 'Asia/Shanghai', worlds: [] })
  const text = segs.map((s) => s.text).join('\n')
  const block = text.split('【核心常驻记忆')[1] ?? ''
  const listed = (block.split('】')[1] ?? '').split('\n').filter((l) => l.startsWith('- [')).length
  assert.equal(listed, 3, `上下文里只该带 3 条，实得 ${listed}`)
})

test('超额要在上下文里说出来（主人看得见）', async () => {
  // 场景：core 层本来有 3 条，主人把上限改成 2 —— 超额的那条仍在常驻层，
  // 但这一轮不进了上下文，而且要**说出来**（不然主人以为她忘了）。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-corecap-over-'))
  const cfg = { residentCap: 3, activeCap: 40, archiveThreshold: 0.35 }
  const cap = createMemoryCapability({
    memoRoot: path.join(dir, 'memo'),
    getCurrentMood: () => 0.2,
    getConfig: () => ({ ...cfg }),
  })
  const panel = cap.panels().find((p) => p.id === 'memory-center')
  for (const t of ['甲', '乙', '丙']) {
    await panel.methods.create.invoke({ content: t, tier: 'core' })
  }
  cfg.residentCap = 2
  const segs = await cap.contextSegments({ now: new Date(), timezone: 'Asia/Shanghai', worlds: [] })
  const text = segs.map((s) => s.text).join('\n')
  assert.match(text, /【核心常驻超额】/, '要说出来')
  assert.match(text, /core 层共 3 条，本轮只带前 2 条/)
})

test('置顶进核心常驻：超上限要被拒（不许默默塞进去）', async () => {
  const { panel } = setup({ residentCap: 2 })
  const a = await panel.methods.create.invoke({ content: '甲', tier: 'core' })
  const b = await panel.methods.create.invoke({ content: '乙', tier: 'core' })
  assert.equal(a.ok, true)
  assert.equal(b.ok, true)
  const c = await panel.methods.create.invoke({ content: '丙', tier: 'core' })
  assert.equal(c.ok, false, '第三条不该放得进 core')
  assert.match(c.error, /上限/)
  // 已有的那两条不受影响
  const core = (await panel.methods.list.invoke({ tier: 'core' })).items
  assert.equal(core.length, 2)
})

test('「塞一条记忆给她」直接放核心常驻也要过上限', async () => {
  const { panel } = setup({ residentCap: 1 })
  await panel.methods.create.invoke({ content: '甲', tier: 'core' })
  const second = await panel.methods.create.invoke({ content: '乙', tier: 'core' })
  assert.equal(second.ok, false)
  assert.match(second.error, /上限/)
})

test('配置现读：改了立刻生效，不用重建能力包', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-corecap2-'))
  const cfg = { residentCap: 5, activeCap: 40, archiveThreshold: 0.35 }
  const cap = createMemoryCapability({
    memoRoot: path.join(dir, 'memo'),
    getCurrentMood: () => 0.2,
    getConfig: () => ({ ...cfg }),
  })
  const panel = cap.panels().find((p) => p.id === 'memory-center')
  const made = []
  for (const t of ['甲', '乙']) {
    const r = await panel.methods.create.invoke({ content: t, tier: 'active' })
    made.push(r.card.id)
  }
  for (const id of made) {
    await panel.methods.update.invoke({ id, tier: 'core' })
  }
  cfg.residentCap = 1   // 主人把上限改成 1
  const segs = await cap.contextSegments({ now: new Date(), timezone: 'Asia/Shanghai', worlds: [] })
  const text = segs.map((s) => s.text).join('\n')
  const block = text.split('【核心常驻记忆')[1] ?? ''
  const listed = (block.split('】')[1] ?? '').split('\n').filter((l) => l.startsWith('- [')).length
  assert.equal(listed, 1, '上限改了要立刻生效')
})

test('默认值兜底：不给配置就用 MEMORY_DEFAULTS', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-corecap3-'))
  const cap = createMemoryCapability({ memoRoot: path.join(dir, 'memo'), getCurrentMood: () => 0.2 })
  const segs = await cap.contextSegments({ now: new Date(), timezone: 'Asia/Shanghai', worlds: [] })
  assert.ok(segs.length >= 1)
  assert.equal(MEMORY_DEFAULTS.residentCap, 8)
  assert.equal(MEMORY_DEFAULTS.archiveThreshold, 0.35)
})
