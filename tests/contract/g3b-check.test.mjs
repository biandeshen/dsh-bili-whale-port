// G3b 就绪判定：草稿的 diaryHash 只要在该日任一 tick 出现过就算绑定当天（允许当天后续改日记）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const SCRIPT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..', 'scripts', 'g3b-check.mjs')
const START = path.resolve(path.dirname(SCRIPT), 'observation-start.mjs')
const logicalDay = (now) => new Date(now).toLocaleDateString('sv-SE') // 自然日（2026-10-31 拍板）

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'g3b-'))
  // 部署家单独隔离（判据要读新架构的日记页与运行记录）
  const deploy = fs.mkdtempSync(path.join(os.tmpdir(), 'g3b-deploy-'))
  const control = path.join(home, 'bili-whale', 'control')
  const drafts = path.join(home, 'bili-whale', 'drafts')
  fs.mkdirSync(control, { recursive: true })
  fs.mkdirSync(drafts, { recursive: true })
  fs.writeFileSync(path.join(control, 'canary.json'), JSON.stringify({ C1: { status: 'pass' }, C2: { status: 'pass' }, C3: { status: 'pass' } }))
  const days = [1, 2, 3].map((i) => logicalDay(Date.now() - i * 86400_000))
  fs.writeFileSync(path.join(home, 'bili-whale', 'causal.jsonl'),
    days.map((d) => JSON.stringify({ kind: 'action', atMs: Date.parse(d + 'T12:00:00+08:00') })).join('\n') + '\n')
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
    // 新架构的当天对外凭据：日记页有正文
    seedDayDiary(deploy, d)
  }
  return { home, drafts, days, deploy }
}

/**
 * 新架构的「当天对外凭据」：部署家下的日记页（2026-11-06 起判据认这个）。
 *
 * 部署家由 `CORTICO_HOME` 决定（paths.mjs 的 deployHome）。测试必须显式给一个
 * 隔离的部署家——不设的话会落到 whale home 的同级目录（Temp/.xiaoyu-home），
 * 多个用例共用一个目录会互相污染。
 */
function seedDayDiary(deploy, day, text = '她今天写下的东西。') {
  const root = path.join(deploy, 'xiaoyu', 'workspace', 'diary')
  fs.mkdirSync(root, { recursive: true })
  fs.appendFileSync(path.join(root, 'public.md'), `## ${day}\n\n## 想说\n\n${text}\n\n`)
  return root
}

function run(home, drafts, deploy) {
  const r = spawnSync(process.execPath, [SCRIPT, '--json'], {
    encoding: 'utf8',
    env: { ...process.env, WHALE_HOME: home, DSH_HOME: home, WHALE_DRAFTS: drafts, CORTICO_HOME: deploy, CORTICO_BOT: 'xiaoyu' },
  })
  let json = null
  try { json = JSON.parse(r.stdout) } catch {}
  return { status: r.status, json, stderr: r.stderr }
}

function runStart(home, drafts, deploy, args = []) {
  const r = spawnSync(process.execPath, [START, ...args], {
    encoding: 'utf8',
    env: { ...process.env, WHALE_HOME: home, DSH_HOME: home, WHALE_DRAFTS: drafts, CORTICO_HOME: deploy, CORTICO_BOT: 'xiaoyu' },
  })
  let json = null
  try { json = JSON.parse(r.stdout) } catch {}
  return { status: r.status, json, stderr: r.stderr }
}

test('三天齐全且草稿绑定当天任一时点的日记哈希 → ready', () => {
  const { home, drafts, deploy } = makeHome()
  const r = run(home, drafts, deploy)
  assert.equal(r.status, 0, JSON.stringify(r.json?.checks ?? r.stderr))
  assert.equal(r.json.ok, true)
  assert.equal(r.json.ready, true)
})

test('当天没有任何对外凭据 → 计入不达标；tainted flag 也会拦', () => {
  const { home, drafts, days, deploy } = makeHome()
  // 清掉两天的日记页 + 草稿（= 那天什么都没留下）→ 只剩 1/3 天达标 → 不 ready
  fs.writeFileSync(path.join(deploy, 'xiaoyu', 'workspace', 'diary', 'public.md'), '')
  fs.rmSync(path.join(drafts, days[1] + '.json'))
  fs.rmSync(path.join(drafts, days[2] + '.json'))
  const r1 = run(home, drafts, deploy)
  assert.equal(r1.status, 1)
  assert.equal(r1.json.ok, false)
  const why = r1.json.checks.find((c) => c.name === '连续 3 天反事实')
  assert.match(why.detail, /evidence=n/)
  // 只毁一天仍应 ready（2026-11-06 主人拍板：连续 3 天里 2 天达标即可开窗）
  seedDayDiary(deploy, days[1])
  fs.writeFileSync(path.join(drafts, days[1] + '.json'),
    JSON.stringify({ id: 'dyn-' + days[1], date: days[1], diaryHash: 'H_draft_' + days[1], status: 'pending' }))
  const r1b = run(home, drafts, deploy)
  assert.equal(r1b.status, 0, JSON.stringify(r1b.json?.checks ?? r1b.stderr))

  // 恢复凭据，改 tainted → 仍不 ready
  seedDayDiary(deploy, days[2])
  fs.writeFileSync(path.join(drafts, days[2] + '.json'),
    JSON.stringify({ id: 'dyn-' + days[2], date: days[2], diaryHash: 'H_draft_' + days[2], status: 'pending' }))
  const dayFile = path.join(home, 'bili-whale', 'days', days[1], 'day.json')
  const dj = JSON.parse(fs.readFileSync(dayFile, 'utf8'))
  dj.flags.tainted = true
  fs.writeFileSync(dayFile, JSON.stringify(dj))
  const r2 = run(home, drafts, deploy)
  assert.equal(r2.status, 1)
  assert.match(r2.json.checks.find((c) => c.name === '连续 3 天反事实').detail, /tainted/)
})

test('G3b ready 后：--dry 不写，正式才写 observation.json', () => {
  const { home, drafts, deploy } = makeHome()
  const obs = path.join(home, 'bili-whale', 'control', 'observation.json')
  const dry = runStart(home, drafts, deploy, ['--dry'])
  assert.equal(dry.status, 0, dry.stderr)
  assert.equal(dry.json.dry, true)
  assert.ok(!fs.existsSync(obs))

  const real = runStart(home, drafts, deploy)
  assert.equal(real.status, 0, real.stderr)
  const j = JSON.parse(fs.readFileSync(obs, 'utf8'))
  assert.equal(j.days, 14)
  assert.match(j.startDay, /^\d{4}-\d{2}-\d{2}$/)
})

test('G3b 未就绪时拒绝开窗，不留下 observation.json', () => {
  const { home, drafts, days, deploy } = makeHome()
  // 两天没有反事实报告 → 只剩 1/3 天达标 → 未就绪（2/3 口径下少一天仍 ready）
  fs.rmSync(path.join(home, 'bili-whale', 'days', days[0], 'counterfactual.json'))
  fs.rmSync(path.join(home, 'bili-whale', 'days', days[1], 'counterfactual.json'))
  const r = runStart(home, drafts, deploy)
  assert.equal(r.status, 1)
  assert.equal(r.json.error, 'g3b-not-ready')
  assert.ok(!fs.existsSync(path.join(home, 'bili-whale', 'control', 'observation.json')))
})

test('某天没有自然 action → 计入不达标（两天没有才拦）', () => {
  const { home, drafts, days, deploy } = makeHome()
  const causal = path.join(home, 'bili-whale', 'causal.jsonl')
  // 两天没有自然行动 → 只剩 1/3 天达标 → 不 ready
  fs.writeFileSync(causal, days.filter((d) => d !== days[1] && d !== days[2])
    .map((d) => JSON.stringify({ kind: 'action', atMs: Date.parse(d + 'T12:00:00+08:00') })).join('\n') + '\n')
  const r = run(home, drafts, deploy)
  assert.equal(r.status, 1)
  assert.match(r.json.checks.find((c) => c.name === '连续 3 天反事实').detail, /action=n/)
})
