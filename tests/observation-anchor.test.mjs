// 观测窗锚点必须来自落盘文件，不是每次向今天回推（评审 P5 那类"判据被写软"的一个具体形态）。
// 为什么要专门钉这一条：锚点一旦漂成滑动窗，14 天窗口就永远走不完——K1/K2/K3 的分子永远
// 只数"刚才那几天"，看上去一直在跑，实际永远到不了终点，而没人会报错。
// 这个测试只认一个事实：**窗口第一天 == control/observation.json 里的 startDay**。
// 谁把锚点改成现算，这里就当众变红。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(ROOT, 'scripts', 'observation-status.mjs')

/** 一个假的 whale home：锚点写死成很久以前的 2026-10-01，跑多少天都该从它起算。 */
function home(t, cfg) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-anchor-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const whale = path.join(root, '.dsh')
  const control = path.join(whale, 'bili-whale', 'control')
  fs.mkdirSync(control, { recursive: true })
  if (cfg) fs.writeFileSync(path.join(control, 'observation.json'), JSON.stringify(cfg, null, 2), 'utf8')
  // 锚点定在 2026-10-01：如果脚本改成"向今天回推"，第一行就会变成最近几天，断言当场红
  return { whale, env: { ...process.env, WHALE_HOME: whale, DSH_HOME: whale } }
}

const run = (env) => {
  const r = spawnSync(process.execPath, [SCRIPT, '--json'], { env, encoding: 'utf8' })
  // 这个脚本用退出码表达"窗口达标与否"（未达标=1），**不是**脚本跑坏了：
  // 所以这里不能断言 status===0，否则等于把门禁的正常红当成工具故障。
  assert.ok(r.stdout.trim().startsWith('{'), `没有 JSON 输出：${r.stderr.slice(0, 200)}`)
  return JSON.parse(r.stdout)
}

test('窗口起点读落盘的 startDay，不是每次现算', (t) => {
  const h = home(t, { startDay: '2026-10-01', days: 14, createdAt: '2026-10-01T00:00:00.000Z' })
  const j = run(h.env)
  assert.equal(j.startDay, '2026-10-01', '锚点要原样带出来')
  assert.equal(j.days, 14)
  const first = new Date(Date.parse(j.rows[0].day)).toISOString().slice(0, 10)
  assert.equal(first, '2026-10-01', '第一天必须是 startDay——漂成滑动窗就是这条红')
  assert.equal(j.rows.length, 14, '窗口长度也按落盘的 days，不受今天影响')
})

test('锚点比今天晚很多时，endedDays=0 而不是硬凑一个窗口', (t) => {
  const h = home(t, { startDay: '2035-01-01', days: 14, createdAt: '2035-01-01T00:00:00.000Z' })
  const j = run(h.env)
  assert.equal(j.endedDays, 0, '未来的窗还没有任何一天结束，不能拿"最近 3 天"冒充进度')
  assert.equal(j.k1_drafts.value, 0)
})

test('没落锚点就明说 not-started，不许悄悄用今天回推一个窗口', (t) => {
  const h = home(t, null)
  const j = run(h.env)
  assert.equal(j.ok, false)
  assert.equal(j.status, 'not-started')
  assert.ok(!Array.isArray(j.rows), '没开窗就不该有窗口逐日表')
})
