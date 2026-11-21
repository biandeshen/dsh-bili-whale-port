// 记忆冲突提示的**端到端**链路（2026-11-21，记忆域分析 ②）。
//
// 底层 supersedeCandidates 已有单测；这条测的是"真的接进写入路径了没有"——
// 一个只在函数里正确、却没人调用的能力，等于不存在（本项目吃过这个亏：
// `applyActionRecord` 曾经"实现了但零调用者"）。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createMemoryCapability } from '../packages/capabilities/cap-memory/src/index.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'conflict-'))

function mount() {
  const dir = tmp()
  const cap = createMemoryCapability({
    memoRoot: dir,
    getConfig: () => ({ residentCap: 8, activeCap: 200, archiveThreshold: 0.35 }),
  })
  const tool = (n) => cap.tools().find((t) => t.name === n)
  return { cap, tool, dir }
}

test('记下与旧说法矛盾的新说法 → 回执里点名旧那条（只提示，不改旧卡）', (t) => {
  const { tool, dir } = mount()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  const first = tool('memory_remember').execute({ content: '主人不喜欢猫' })
  assert.equal(first.ok, true)
  assert.equal(first.conflicts, undefined, '第一条没有可矛盾的，不该报')

  const second = tool('memory_remember').execute({ content: '主人其实很喜欢猫' })
  assert.equal(second.ok, true)
  assert.ok(Array.isArray(second.conflicts) && second.conflicts.length === 1, '要提示与旧说法矛盾')
  assert.equal(second.conflicts[0].id, first.id)
  assert.match(second.receipt, /哪条算数要你定/, '必须写明决定权不在系统')

  // **旧卡不许被自动改动**——这是"只提示不覆盖"的硬判据
  const oldCard = tool('memory_recall').execute({ query: '不喜欢猫', k: 5 })
  const stillThere = (oldCard.items ?? []).find((x) => x.id === first.id)
  assert.ok(stillThere, '旧记忆必须还在，不许被自动作废')
})

test('无关内容不报冲突（宁缺勿滥）', (t) => {
  const { tool, dir } = mount()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  tool('memory_remember').execute({ content: '主人不喜欢猫' })
  const r = tool('memory_remember').execute({ content: '今天窗外下了很久的雨' })
  assert.equal(r.ok, true)
  assert.equal(r.conflicts, undefined)
})

test('memory_supersede：标取代后旧条降权，但仍召得回并注明"过去的"', (t) => {
  const { tool, dir } = mount()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const old = tool('memory_remember').execute({ content: '主人不喜欢猫' })
  const neu = tool('memory_remember').execute({ content: '主人其实很喜欢猫' })

  const marked = tool('memory_supersede').execute({ id: old.id, byId: neu.id })
  assert.equal(marked.ok, true, marked.error)
  assert.equal(marked.card.supersededBy, neu.id)
  assert.ok(marked.card.validUntil, '取代的时刻就是旧说法失效的时刻')

  const r = tool('memory_recall').execute({ query: '猫', k: 5 })
  const hit = (r.items ?? []).find((x) => x.id === old.id)
  assert.ok(hit, '旧记忆仍召得回——不许因为被取代就消失')
  assert.ok(
    hit.why.join(' ').includes('过去的'),
    `回执要标明这是过去的，实际：${hit.why.join(' / ')}`,
  )
})

test('memory_supersede 拒绝自我取代（防手滑）', (t) => {
  const { tool, dir } = mount()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const a = tool('memory_remember').execute({ content: '主人不喜欢猫' })
  const r = tool('memory_supersede').execute({ id: a.id, byId: a.id })
  assert.equal(r.ok, false)
  assert.match(r.error, /不能自己取代自己/)
})

test('memory_supersede 缺 byId → 明确拒绝，不是静默成功', (t) => {
  const { tool, dir } = mount()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const a = tool('memory_remember').execute({ content: '主人不喜欢猫' })
  const r = tool('memory_supersede').execute({ id: a.id, byId: '' })
  assert.equal(r.ok, false)
  assert.match(r.error, /被哪条取代/)
})
