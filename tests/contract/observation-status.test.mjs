import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function setup({ moods = ['轻快', '平静', '好奇'], texts = ['a', 'b', 'c'], taintedDay = null } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-'))
  const drafts = path.join(home, 'drafts')
  const control = path.join(home, 'bili-whale', 'control')
  fs.mkdirSync(drafts, { recursive: true })
  fs.mkdirSync(control, { recursive: true })
  const days = ['2026-09-01', '2026-09-02', '2026-09-03']
  fs.writeFileSync(path.join(control, 'observation.json'), JSON.stringify({ startDay: days[0], days: 3 }))
  days.forEach((d, i) => {
    const dir = path.join(home, 'bili-whale', 'days', d)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'state.start.json'), JSON.stringify({ at: `${d}T09:00:00+08:00`, day: d }))
    fs.writeFileSync(path.join(dir, 'day.json'), JSON.stringify({
      day: d, tickCount: 1, wakes: 1,
      flags: { missed: false, late: false, tainted: d === taintedDay, taintReasons: [] },
    }))
    fs.writeFileSync(path.join(dir, 'counterfactual.json'), JSON.stringify({ ok: true, day: d, diffChars: 6, realMood: moods[i] }))
    fs.writeFileSync(path.join(drafts, `${d}.json`), JSON.stringify({ id: `d-${i}`, date: d, diaryHash: `h${i}`, text: texts[i], status: 'pending' }))
  })
  return { home, drafts }
}

function run(home, drafts) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'observation-status.mjs'), '--json'], {
    env: { ...process.env, WHALE_HOME: home, WHALE_DRAFTS: drafts }, encoding: 'utf8',
  })
  return JSON.parse(String(r.stdout ?? '{}'))
}

test('observation-status：K1/K2/K3 计数与 tainted 标记', () => {
  const { home, drafts } = setup({ moods: ['轻快', '平静', '好奇'], texts: ['甲', '乙', '丙'] })
  const r = run(home, drafts)
  assert.equal(r.k1_drafts.value, 3)
  assert.equal(r.k2_textDiff.value, 2)
  assert.equal(r.k3_moodNotCalm.value, 2)
  assert.equal(r.tainted, 0)
  fs.rmSync(home, { recursive: true, force: true })
})

test('observation-status：某天文本相同则该相邻对不计入 K2', () => {
  const { home, drafts } = setup({ texts: ['同', '同', '异'] })
  const r = run(home, drafts)
  assert.equal(r.k2_textDiff.value, 1)
  fs.rmSync(home, { recursive: true, force: true })
})

test('observation-status：tainted 天会被计数并阻止 ok', () => {
  const { home, drafts } = setup({ taintedDay: '2026-09-02' })
  const r = run(home, drafts)
  assert.equal(r.tainted, 1)
  assert.equal(r.ok, false)
  assert.equal(fs.existsSync(home), true)
  fs.rmSync(home, { recursive: true, force: true })
})
