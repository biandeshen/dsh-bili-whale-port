/**
 * 目标完成审计：把本线程目标拆成可核对的条件，一条命令给出 PASS/PENDING。
 *
 *   node scripts/goal-audit.mjs [--json]
 *
 * 目标（不可缩小的范围）：
 *   A. G3b 通过：canary 3/3 + 验收脚本哈希 + 连续 3 天反事实
 *   B. 已进入 14 天观测（control/observation.json）
 *   C. 观测完成：14 天窗口结束 + K1≥11 / K2≥9 / K3≥3 + tainted+missing 不超限
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { DSH_HOME as WHALE_HOME } from '../tools/lib/paths.mjs'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const asJson = process.argv.includes('--json')
const CONTROL = path.join(WHALE_HOME, 'bili-whale', 'control')
const OBS = path.join(CONTROL, 'observation.json')

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
function runJson(script) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', script), '--json'], { encoding: 'utf8', timeout: 60000 })
  try { return JSON.parse(String(r.stdout ?? '')) } catch { return null }
}

const checks = []
const add = (name, ok, detail, evidence) => checks.push({ name, ok, detail, evidence })

const g3b = runJson('g3b-check.mjs')
add('G3b 通过', g3b?.ready === true,
  (g3b?.checks ?? []).filter((c) => !c.ok).map((c) => c.name).join(', ') || '全部满足',
  'scripts/g3b-check.mjs --json')

const cfg = readJson(OBS)
add('已进入 14 天观测', !!cfg?.startDay,
  cfg ? `startDay=${cfg.startDay} days=${cfg.days ?? 14}` : 'control/observation.json 未创建',
  'scripts/observation-start.mjs')

let obs = null
if (cfg?.startDay) {
  obs = runJson('observation-status.mjs')
  const endedAll = (obs?.endedDays ?? 0) >= (obs?.days ?? 14)
  add('观测窗口已结束', endedAll, `已结束 ${obs?.endedDays ?? 0}/${obs?.days ?? 14} 天`, 'scripts/observation-status.mjs')
  add('K1 有稿 ≥11', (obs?.k1_drafts?.value ?? 0) >= 11, `${obs?.k1_drafts?.value ?? 0}/11`, 'days/*/draft + diaryHash')
  add('K2 文本不同 ≥9', (obs?.k2_textDiff?.value ?? 0) >= 9, `${obs?.k2_textDiff?.value ?? 0}/9`, '相邻日草稿归一化比较')
  add('K3 情绪非平静 ≥3', (obs?.k3_moodNotCalm?.value ?? 0) >= 3, `${obs?.k3_moodNotCalm?.value ?? 0}/3`, 'days/*/counterfactual.json')
  add('tainted+missing ≤3', (obs?.tainted ?? 0) + (obs?.missing ?? 0) <= 3, `${(obs?.tainted ?? 0) + (obs?.missing ?? 0)}`, 'days/*/day.json')
} else {
  add('观测窗口已结束', false, '未开始', '—')
  add('K1/K2/K3', false, '未开始', '—')
}

const bad = checks.filter((c) => !c.ok)
const result = { ok: bad.length === 0, objectiveAchieved: bad.length === 0, checks }
if (asJson) console.log(JSON.stringify(result, null, 2))
else {
  console.log('# 目标完成审计')
  for (const c of checks) console.log(`${c.ok ? 'PASS   ' : 'PENDING'}  ${c.name}  ${c.detail}`)
  console.log(`\n${result.ok ? '目标已达成' : bad.length + ' 项未满足'}`)
  console.log('证据路径列在每项末尾；不接受"测试全绿"替代。')
}
process.exit(result.ok ? 0 : 1)
