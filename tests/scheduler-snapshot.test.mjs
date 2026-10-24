// 调度器行为快照回归（借鉴 AMpath validation/snapshot-compare：种子 × 多 tick 确定性回放）
// 更新基线：node tests/scheduler-snapshot.test.mjs --update
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { makePlan, completePlan } from '../tools/lib/night-plan.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.join(HERE, 'fixtures', 'night-plan-snapshot.json')
const CFG = { windows: [{ start: '20:00', end: '24:00', wakes: 2 }], skipChance: 0.3, minGapMin: 10, maxVideos: 5 }

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function simulate(seed) {
  const random = mulberry32(seed)
  let state = {}
  const events = []
  let now = Date.parse('2026-10-21T12:00:00Z')
  for (let tick = 0; tick < 100; tick++) {
    const prev = state
    state = makePlan(CFG, state, now, random)
    if (state !== prev && !prev.done) {
      events.push({ d: state.atText?.slice(5, 10) ?? '-', a: state.action, w: state.withinWindow ?? null, r: state.reason ?? state.roll ?? null })
    }
    if (state.action !== 'done' && !state.fired && now >= state.atMs) {
      state = completePlan(state, now)
      events.push({ d: state.atText?.slice(5, 10) ?? '-', a: 'fired', w: state.withinWindow ?? null, r: null })
    }
    now += 30 * 60 * 1000 // 每 30 分钟一个 tick，跨三天
  }
  return events
}

const SEEDS = [1, 7, 42, 1234, 99991, 2 ** 20, 2 ** 31 - 1, 555, 31337, 8]

test('night-plan scheduler behaves identically to frozen snapshot', () => {
  const current = Object.fromEntries(SEEDS.map(s => [s, simulate(s)]))
  if (process.argv.includes('--update') || !fs.existsSync(FIXTURE)) {
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true })
    fs.writeFileSync(FIXTURE, JSON.stringify(current, null, 1))
    if (!process.argv.includes('--update')) throw new Error('fixture 不存在：已生成，请复核后提交')
    return
  }
  assert.deepEqual(current, JSON.parse(fs.readFileSync(FIXTURE, 'utf8')),
    '调度决策序列与快照不一致——若为有意变更，跑 --update 并在 PR 说明')
})
