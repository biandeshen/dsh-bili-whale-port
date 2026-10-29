// G3b 就绪判定：草稿的 diaryHash 只要在该日任一 tick 出现过就算绑定当天（允许当天后续改日记）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const SCRIPT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', 'scripts', 'g3b-check.mjs')
const logicalDay = (now) => new Date(now - 4 * 3600_000).toLocaleDateString('sv-SE')

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'g3b-'))
  const control = path.join(home, 'bili-whale', 'control')
  const drafts = path.join(home, 'bili-whale', 'drafts')
  fs.mkdirSync(control, { recursive: true })
  fs.mkdirSync(drafts, { recursive: true })
  fs.writeFileSync(path.join(control, 'canary.json'), JSON.stringify({ C1: { status: 'pass' }, C2: { status: 'pass' }, C3: { status: 'pass' } }))
  const days = [1, 2, 3].map((i) => logicalDay(Date.now() - i * 86400_000))
  for (const d of days) {
    const dir = path.join(home, 'bili-whale', 'days', d)
    fs.mkdirSync(dir, { recursive: true })
    // end 用当天最后版本；草稿绑定的是更早的 tick 版本
    fs.writeFileSync(path.join(dir, 'state.end.json'), JSON.stringify({ day: d, at: d + 'T04:00:00+08:00', diary: { hash: 'H_end_' + d } }))
    fs.writeFileSync(path.join(dir, 'ticks.jsonl'), [
      JSON.stringify({ kind: 'tick', day: d, at: d + 'T20:00:00+08:00', diary: { hash: 'H_draft_' + d } }),
      JSON.stringify({ kind: 'tick', day: d, at: d + 'T23:00:00+08:00', diary: { hash: 'H_end_' + d } }),
    ].join('\n') + '\n')
    fs.writeFileSync(path.join(dir, 'counterfactual.json'), JSON.stringify({ day: d, ok: true, diffChars: 6 }))
    fs.writeFileSync(path.join(dir, 'day.json'), JSON.stringify({ day: d, flags: { missed: false, late: false, tainted: false } }))
    fs.writeFileSync(path.join(drafts, d + '.json'), JSON.stringify({ id: 'dyn-' + d, date: d, diaryHash: 'H_draft_' + d, status: 'pending' }))
  }
  return { home, drafts, days }
}

function run(home, drafts) {
  const r = spawnSync(process.execPath, [SCRIPT, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, DSH_HOME: home, WHALE_DRAFTS: drafts },
  })
  let json = null
  try { json = JSON.parse(r.stdout) } catch {}
  return { status: r.status, json, stderr: r.stderr }
}

test('三天齐全且草稿绑定当天任一时点的日记哈希 → ready', () => {
  const { home, drafts } = makeHome()
  const r = run(home, drafts)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.json.ok, true)
  assert.equal(r.json.ready, true)
})

test('草稿哈希不属于当天 → 不 ready；tainted flag 也会拦', () => {
  const { home, drafts, days } = makeHome()
  const f = path.join(drafts, days[1] + '.json')
  const d = JSON.parse(fs.readFileSync(f, 'utf8'))
  d.diaryHash = 'H_from_another_day'
  fs.writeFileSync(f, JSON.stringify(d))
  const r1 = run(home, drafts)
  assert.equal(r1.status, 1)
  assert.equal(r1.json.ok, false)
  const why = r1.json.checks.find((c) => c.name === '连续 3 天反事实')
  assert.match(why.detail, /draftHash=(n|mismatch)/)

  // 恢复草稿，改 tainted → 仍不 ready
  d.diaryHash = 'H_draft_' + days[1]
  fs.writeFileSync(f, JSON.stringify(d))
  const dayFile = path.join(home, 'bili-whale', 'days', days[1], 'day.json')
  const dj = JSON.parse(fs.readFileSync(dayFile, 'utf8'))
  dj.flags.tainted = true
  fs.writeFileSync(dayFile, JSON.stringify(dj))
  const r2 = run(home, drafts)
  assert.equal(r2.status, 1)
  assert.match(r2.json.checks.find((c) => c.name === '连续 3 天反事实').detail, /tainted/)
})
