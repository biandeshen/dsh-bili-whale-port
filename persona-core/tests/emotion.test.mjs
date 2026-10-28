import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_ATOMIC_FIELDS } from '../src/types.ts'
import { EMOTION_LABELS, projectEmotion } from '../src/emotion-projection.ts'
import { readMood } from '../src/emotion.ts'

const rngOf = (seed) => {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

test('情绪投影：10,000 个七维随机点至少出 10 种标签，最高频 ≤35%', () => {
  const rng = rngOf(42)
  const counts = {}
  for (let i = 0; i < 10000; i++) {
    const f = {
      energy: rng(), stimulation: rng(), connection: rng(), social: rng(),
      mood: rng() * 2 - 1, curiosity: rng(), creativity: rng(),
    }
    const p = projectEmotion(f)
    counts[p.primary.label] = (counts[p.primary.label] ?? 0) + 1
  }
  const labels = Object.keys(counts)
  const maxShare = Math.max(...Object.values(counts)) / 10000
  assert.ok(labels.length >= 10, '只有 ' + labels.length + ' 种: ' + labels.join(','))
  assert.ok(maxShare <= 0.35, '最高频 ' + (maxShare * 100).toFixed(1) + '%')
})

test('情绪投影：标签集合就是 15 个参考情绪', () => {
  assert.equal(EMOTION_LABELS.length, 15)
  const p = projectEmotion({ ...DEFAULT_ATOMIC_FIELDS })
  assert.ok(EMOTION_LABELS.includes(p.primary.label))
  assert.equal(new Set(EMOTION_LABELS).size, 15)
})

test('情绪强度：滑动参照会跟着她漂，不钉在 1', () => {
  const base = { ...DEFAULT_ATOMIC_FIELDS }
  const steady = { fields: { ...base }, chain: [], history: Array.from({ length: 12 }, () => ({ ...base })) }
  assert.ok(readMood(steady).intensity < 0.01)

  const moved = {
    fields: { ...base, mood: 0.8, stimulation: 0.9, connection: 0.1 },
    chain: [],
    history: Array.from({ length: 12 }, () => ({ ...base })),
  }
  const hi = readMood(moved).intensity
  assert.ok(hi > 0.4 && hi <= 1, '强度 ' + hi)

  // 新状态住久了，参照跟上，强度回落（不恒为 1）
  const settled = {
    fields: { ...moved.fields },
    chain: [],
    history: Array.from({ length: 12 }, () => ({ ...moved.fields })),
  }
  assert.ok(readMood(settled).intensity < 0.01)
})

test('情绪强度：样本不足 5 条时用默认基线参照', () => {
  const s = { fields: { ...DEFAULT_ATOMIC_FIELDS }, chain: [], history: [{ ...DEFAULT_ATOMIC_FIELDS }] }
  assert.ok(readMood(s).intensity < 0.01)
})
