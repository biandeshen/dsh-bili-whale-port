/**
 * 记忆分层的配置组（B13g）。
 *
 * 这一组存在的全部理由：`residentCap` / `activeCap` / `archiveThreshold`
 * **早就声明在 cap-memory 的 configSchema 里，却从来没有代码读过**——
 * 核心常驻上限是硬编码的 `slice(0, 8)`，归档阈值是 `settle()` 的默认参数。
 * 主人以为能调，页面上看不见、改了也没用。
 *
 * 所以这一组配得上一条断言：**只声明代码里真读的键**。
 * 挂一个改了没反应的旋钮，比不挂更坏。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createXiaoyuBotDefinition } from '../src/cortico-definition.ts'
import { XIAOYU_MEMORY_DEFAULTS } from '../src/memory-config.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoyu-memcfg-'))

test('记忆分层配置组：键与实现对得上', () => {
  const def = createXiaoyuBotDefinition(tmp())
  const parts = def.build({ config: def.defaults(), memoryDir: tmp() })
  const g = (parts.webUi?.configGroups ?? []).find((x) => x.id === 'xiaoyu-memory')
  assert.ok(g, '要有这一组')
  assert.equal(g.owner, 'persona')
  const keys = Object.keys(g.schema.properties)
  assert.deepEqual(keys, ['memory.residentCap', 'memory.activeCap', 'memory.archiveThreshold'])
  for (const k of keys) {
    const p = g.schema.properties[k]
    assert.ok(p.title, `${k} 缺 title（页面上只剩键名）`)
    assert.equal(p['x-hot'], true, `${k} 应当是热改项（改完不等重启）`)
    assert.ok(p.description, `${k} 缺 description`)
  }
})

test('默认配置带着记忆分层三个数（不是只在页面上的空声明）', () => {
  const def = createXiaoyuBotDefinition(tmp())
  const cfg = def.defaults()
  assert.equal(cfg.memory.residentCap, XIAOYU_MEMORY_DEFAULTS.residentCap)
  assert.equal(cfg.memory.activeCap, XIAOYU_MEMORY_DEFAULTS.activeCap)
  assert.equal(cfg.memory.archiveThreshold, XIAOYU_MEMORY_DEFAULTS.archiveThreshold)
})

test('部署配置里的 memory 段真的传进了能力包（现读）', async () => {
  const def = createXiaoyuBotDefinition(tmp())
  const cfg = { ...def.defaults(), memory: { residentCap: 5, activeCap: 33, archiveThreshold: 0.5 } }
  const parts = def.build({ config: cfg, memoryDir: tmp() })
  const persona = parts.persona
  const mem = persona.hub.capabilities.find((c) => c.id === 'memory')
  assert.ok(mem, '要有记忆能力包')
  const panel = mem.panels().find((p) => p.id === 'memory-center')
  // 建三条进 core：上限 5，放得下三条
  const made = []
  for (const t of ['甲', '乙', '丙']) {
    const r = await panel.methods.create.invoke({ content: t, tier: 'core' })
    assert.equal(r.ok, true, r.error)
    made.push(r.card.id)
  }
  // 上下文里带的条数要受上限约束
  const segs = await mem.contextSegments({ now: new Date(), timezone: 'Asia/Shanghai', worlds: [] })
  const text = segs.map((s) => s.text).join('\n')
  assert.match(text, /【核心常驻记忆（3 条）】/)
})
