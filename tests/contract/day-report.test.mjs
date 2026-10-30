// day-report 也要按 D-35 口径：草稿 hash 在当天任一 tick 出现过就算绑定
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const SCRIPT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', 'scripts', 'day-report.mjs')
const logicalDay = (now = Date.now()) => new Date(now - 4 * 3600_000).toLocaleDateString('sv-SE')
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex')

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dayreport-'))
  const d = logicalDay()
  const dayDir = path.join(home, 'bili-whale', 'days', d)
  const drafts = path.join(home, 'bili-whale', 'drafts')
  fs.mkdirSync(dayDir, { recursive: true })
  fs.mkdirSync(drafts, { recursive: true })
  const draftDiary = `## ${d}\n\n## 看过\n\n| BV | 标题 |\n|---|---|\n| BV1x | t |\n\n## 想说\n\n- 出稿时只有这一条。\n`
  fs.writeFileSync(path.join(home, 'whale-diary.md'), draftDiary + '\n- 后来她又写了一条。\n')
  fs.writeFileSync(path.join(dayDir, 'state.start.json'), JSON.stringify({ at: `${d}T05:00:00+08:00`, day: d }))
  const ticks = [
    { at: `${d}T05:30:00+08:00`, day: d, diary: { hash: sha1(draftDiary) } },
    { at: `${d}T06:00:00+08:00`, day: d, diary: { hash: sha1(draftDiary + '\n- 后来她又写了一条。\n') } },
  ]
  fs.writeFileSync(path.join(dayDir, 'ticks.jsonl'), ticks.map((t) => JSON.stringify(t)).join('\n') + '\n')
  fs.writeFileSync(path.join(dayDir, 'day.json'), JSON.stringify({ day: d, flags: { missed: false, late: false, tainted: false } }))
  const draft = { id: 'dyn-' + d, date: d, diaryHash: sha1(draftDiary), text: 'x', status: 'pending' }
  fs.writeFileSync(path.join(drafts, d + '.json'), JSON.stringify(draft))
  return { home, drafts, d, draft }
}

function run(home, drafts) {
  return spawnSync(process.execPath, [SCRIPT, '--date', logicalDay(), '--json'], {
    encoding: 'utf8',
    env: { ...process.env, WHALE_HOME: home, DSH_HOME: home, WHALE_DRAFTS: drafts },
  })
}

test('day-report：草稿 hash 在该日任一 tick 出现过 → match(tick)', () => {
  const { home, drafts } = makeHome()
  const r = run(home, drafts)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const j = JSON.parse(r.stdout)
  const item = j.items.find((x) => x.name === 'draft.diaryHash 绑定当天')
  assert.equal(item.ok, true)
  assert.equal(item.detail, 'match(tick)')
})

test('day-report：草稿 hash 不属于当天任何版本 → MISMATCH', () => {
  const { home, drafts, d } = makeHome()
  const f = path.join(drafts, d + '.json')
  const draft = JSON.parse(fs.readFileSync(f, 'utf8'))
  draft.diaryHash = sha1('另一个版本')
  fs.writeFileSync(f, JSON.stringify(draft))
  const r = run(home, drafts)
  assert.equal(r.status, 1)
  const j = JSON.parse(r.stdout)
  const item = j.items.find((x) => x.name === 'draft.diaryHash 绑定当天')
  assert.equal(item.ok, false)
  assert.equal(item.detail, 'MISMATCH')
})
