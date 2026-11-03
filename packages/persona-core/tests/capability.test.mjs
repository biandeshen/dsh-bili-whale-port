import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validateCapabilityContract,
  circadianPhase,
  season,
  buildTemporalMeta,
  nowSentence,
} from '../src/index.ts'

test('validateCapabilityContract accepts valid capability with writable POST panel method', () => {
  const res = validateCapabilityContract({
    id: 'state-rhythm',
    title: '状态与作息',
    kind: 'internal',
    configSchema: { type: 'object', title: '状态配置', properties: {} },
    defaultConfig: {},
    tools: () => [
      {
        name: 'mood_read',
        summary: '读取心情',
        description: '读取当前场值与心情',
        parameters: { type: 'object', properties: {} },
        execute: () => ({ ok: true }),
      },
    ],
    panels: () => [
      {
        id: 'tank',
        title: '鱼缸与作息遥控台',
        description: '场值滑块与作息控制',
        methods: {
          getSnapshot: { name: 'getSnapshot', verb: 'GET', summary: '读快照', writable: false, invoke: () => ({}) },
          setFields: { name: 'setFields', verb: 'POST', summary: '改场值', writable: true, invoke: () => ({ ok: true }) },
        },
      },
    ],
  })
  assert.equal(res.ok, true)
  assert.deepEqual(res.errors, [])
})

test('validateCapabilityContract rejects read-only blackbox panel without POST writable method', () => {
  const res = validateCapabilityContract({
    id: 'memory',
    title: '记忆系统',
    kind: 'internal',
    configSchema: { type: 'object', title: '记忆配置', properties: {} },
    defaultConfig: {},
    tools: () => [
      {
        name: 'memory_recall',
        summary: '召回记忆',
        description: '检索记忆',
        parameters: { type: 'object', properties: {} },
        execute: () => [],
      },
    ],
    panels: () => [
      {
        id: 'memory-readonly',
        title: '只读记忆看板',
        description: '没有写入口',
        methods: {
          list: { name: 'list', verb: 'GET', summary: '只读列表', writable: false, invoke: () => [] },
        },
      },
    ],
  })
  assert.equal(res.ok, false)
  assert.ok(res.errors.some((e) => e.includes('read-only')))
})

test('temporal pure functions compute circadianPhase, season, and nowSentence', () => {
  assert.equal(circadianPhase(6).name, 'dawn')
  assert.equal(circadianPhase(2).name, 'late_night')
  assert.equal(season(4), 'spring')
  assert.equal(season(11), 'autumn')
  const dt = new Date(2026, 10, 3, 14, 30, 0) // 2026-11-03 14:30
  const meta = buildTemporalMeta(dt)
  assert.equal(meta.circadianPhase, 'afternoon')
  assert.equal(meta.season, 'autumn')
  assert.equal(meta.isNight, false)
  assert.ok(nowSentence(dt).includes('2026年11月3日'))
  assert.ok(nowSentence(dt).includes('下午'))
})
