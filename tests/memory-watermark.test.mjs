// 记忆容量水位（2026-11-21，记忆域分析 ③ 的最小落地）。
//
// 问题：召回每次都 `readdirSync` + 逐张 `readFileSync` 全量扫（card-store.ts:160/164）。
// 线上现在 76 张卡（core 21 / active 46 / voided 9），所以没事——
// **但这是"还小"不是"设计对"**：一年后 500 张，每次召回的 I/O 线性增长，
// 而且没有人会注意到它在变慢。
//
// 这一版只做**看得见**，不做自动压缩：
//   · 统计当前规模（各层张数、总字节）
//   · 给水位判级（ok / watch / full）
//   · 到线就明说"该压了"，并把压缩接口的位置写清楚
//
// 为什么不做自动摘要：摘要要调模型、要定"压什么留什么"的语义、
// 还要防止把有用的细节压没了。那是独立一批活，不该混在容量可见里。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createMemoryCapability } from '../packages/capabilities/cap-memory/src/index.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'water-'))

function mount(activeCap = 200) {
  const dir = tmp()
  const cap = createMemoryCapability({
    memoRoot: dir,
    getConfig: () => ({ residentCap: 8, activeCap, archiveThreshold: 0.35 }),
  })
  return { cap, dir, tool: (n) => cap.tools().find((t) => t.name === n) }
}

test('③ 水位能数出各层张数与总字节', (t) => {
  const { cap, dir } = mount()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const panel = cap.panels().find((p) => p.id === 'memory-center')
  assert.ok(panel.methods.watermark, '面板要有 watermark 方法')

  const w = panel.methods.watermark.invoke({})
  assert.equal(w.ok, true)
  assert.equal(typeof w.total, 'number')
  assert.equal(typeof w.bytes, 'number')
  assert.ok(w.tiers && typeof w.tiers === 'object')
  for (const k of ['core', 'active', 'archived', 'voided']) {
    assert.equal(typeof w.tiers[k], 'number', `缺口：${k} 层没数`)
  }
})

test('③ 空库是 ok 级，且理由说得出话', (t) => {
  const { cap, dir } = mount()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const panel = cap.panels().find((p) => p.id === 'memory-center')
  const w = panel.methods.watermark.invoke({})
  assert.equal(w.level, 'ok')
  assert.match(w.line, /ok|正常|水位/, '要有一句人话，不是只有一个枚举值')
})

test('③ 张数上去 → 升到 watch；再上去 → full（阈值必须可解释）', (t) => {
  /**
   * 用小 activeCap 跑：watchAt = activeCap/4、fullAt = activeCap*3/4。
   * 用默认 200 要写 150 张才到 full，测试会慢到没人愿意跑——
   * 而"阈值随配置缩放"这件事本身，用小配置验更能证明它没有硬编码。
   */
  const { cap, dir, tool } = mount(20)
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const panel = cap.panels().find((p) => p.id === 'memory-center')

  const base = panel.methods.watermark.invoke({})
  const watchAt = base.watchAt
  const fullAt = base.fullAt
  assert.ok(Number.isFinite(watchAt) && watchAt > 0, 'watchAt 必须是个明确的数')
  assert.ok(fullAt > watchAt, 'fullAt 必须比 watchAt 大')

  for (let i = 0; i < watchAt; i += 1) tool('memory_remember').execute({ content: `第 ${i} 件小事` })
  const w2 = panel.methods.watermark.invoke({})
  assert.ok(w2.total >= watchAt, `写了 ${watchAt} 条，水位却只数到 ${w2.total}`)
  assert.notEqual(w2.level, 'ok', '过线了就不能还报 ok')

  // full 级：补到 fullAt 张
  const need = fullAt - w2.total
  for (let i = 0; i < need; i += 1) tool('memory_remember').execute({ content: `又一件小事 ${w2.total + i}` })
  const w3 = panel.methods.watermark.invoke({})
  assert.equal(w3.level, 'full', `写了 ${w3.total} 条 / fullAt=${fullAt}，应该报 full`)
  assert.match(w3.line, /压缩|该压|摘要/, '到线了要明说该压缩')
})

test('③ 阈值随 activeCap 缩放，不是写死的数', (t) => {
  const a = mount(20); const b = mount(80)
  t.after(() => { fs.rmSync(a.dir, { recursive: true, force: true }); fs.rmSync(b.dir, { recursive: true, force: true }) })
  const wa = a.cap.panels().find((p) => p.id === 'memory-center').methods.watermark.invoke({})
  const wb = b.cap.panels().find((p) => p.id === 'memory-center').methods.watermark.invoke({})
  assert.ok(wb.watchAt > wa.watchAt, 'activeCap 大的，watchAt 也该大')
})

test('③ 水位是只读的——不许因为看一眼就改动任何卡', (t) => {
  const { cap, dir, tool } = mount()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  tool('memory_remember').execute({ content: '一件小事' })
  const panel = cap.panels().find((p) => p.id === 'memory-center')
  const before = JSON.stringify(panel.methods.list.invoke({ tier: 'all' }))
  panel.methods.watermark.invoke({})
  const after = JSON.stringify(panel.methods.list.invoke({ tier: 'all' }))
  assert.equal(after, before, '水位统计不许改动任何记忆')
})
