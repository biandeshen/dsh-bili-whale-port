/**
 * P3-a 的离线演示：上游不通时，心跳退避到底变成什么节奏（不花钱、不联网、不重启）。
 *
 *   node scripts/verify-stall-backoff.mjs
 *
 * 评审的验收口径第 3 条要的是"能演示"：把 provider 端点设为不可达时，排拍转入长间隔，
 * 而不是每 30–90 秒撞一次。真把 baseUrl 改掉需要重启实例，而现在是欠费期间——
 * 主人明确说过别再点模型，所以这里用**同一份判定 + 同一份退避公式**做离线演示：
 *
 *   · 判定来自 `cost-today.readCostToday()`，喂给它的是临时目录里的合成 `usage.jsonl`
 *     （真格式，字段与宿主落盘一致），不碰她的真账、不联网；
 *   · 退避序列直接复用投递处那一个函数 `stallScheduleMs`（从 `cortico-persona.ts` 里导出来，
 *     不在这里另抄一份公式——抄一份就会两边漂）。
 *
 * 演示输出的是三件事：通道判定的翻转、每一拍"投不投递"、以及累计省下了多少次撞门。
 * 它证明的是**逻辑与口径**，不证明线上进程今天就这么跑了；后者要等一次真重启后回看日志，
 * 这条我在回报里单独列，不含糊过去。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readCostToday } from '../packages/cap-state-rhythm/src/cost-today.ts'
import { stallScheduleMs } from '../packages/cortico-bot-xiaoyu/src/stall-backoff.ts'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-demo-'))
const file = path.join(dir, 'usage.jsonl')
const t0 = Date.parse('2026-11-07T04:00:00.000Z')

const row = (iso, extra) => JSON.stringify({ version: 2, attempt: { startedAt: iso, ...extra } })

/** 场景 A：04:00 之前她正常说过话，04:00 起上游开始 402。 */
function sceneStalled() {
  const lines = [row('2026-11-07T03:50:00.000Z', { outcome: 'success', status: 200, meters: { input: 500000, output: 200 } })]
  for (let m = 0; m < 60; m += 1) lines.push(row(new Date(t0 + m * 60_000).toISOString(), { outcome: 'failed', status: 402, meters: {} }))
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8')
}

/** 场景 B：同一个钟点，额度恢复后每拍都成功。 */
function sceneRecovered() {
  const lines = []
  for (let m = 0; m < 60; m += 1) lines.push(row(new Date(t0 + m * 60_000).toISOString(), { outcome: 'success', status: 200, meters: { input: 500000, output: 200 } }))
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8')
}

const read = (nowMs) => readCostToday({ dataDir: dir, basis: 'utc', now: nowMs })

console.log('# P3-a 离线演示：每 60 秒一拍，连打 90 拍（4 个心跳拍/分钟 × 约 1.5 小时）\n')

for (const [name, build] of [['上游不通（402）', sceneStalled], ['上游恢复（200）', sceneRecovered]] as const) {
  build()
  let st = { until: 0, step: 0 }
  let delivered = 0
  let skipped = 0
  const log = []
  for (let i = 0; i < 90; i += 1) {
    const now = t0 + i * 60_000
    const c = read(now)
    const stalled = c.verdict === 'stalled-auth' || c.verdict === 'throttled'
    if (stalled) {
      if (now < st.until) { skipped += 1; continue }
      st.step = Math.min(st.step + 1, 5)
      st.until = now + stallScheduleMs(st.step)
      skipped += 1
      log.push(`第 ${i + 1} 拍：判为 ${c.verdict} → 本拍不投递，退避 ${Math.round(stallScheduleMs(st.step) / 60_000)} 分钟`)
    } else {
      if (st.until !== 0) { log.push(`第 ${i + 1} 拍：判为 ${c.verdict} → 退避清零，恢复投递节奏`); st = { until: 0, step: 0 } }
      delivered += 1
    }
  }
  console.log(`## ${name}`)
  for (const l of log.slice(0, 8)) console.log(`   ${l}`)
  if (log.length > 8) console.log(`   …（共 ${log.length} 条状态变化）`)
  console.log(`   合计：投递 ${delivered} 拍 · 退避/不投递 ${skipped} 拍`
    + `（对照原节奏 90 拍全投，省掉 ${skipped} 次对着端点的空转）\n`)
}

console.log('口径：这里证的是判定与退避公式（与投递处同一份 stall-backoff.ts），')
console.log('     不等于"线上进程今天已经这么跑"——那句要等一次真重启后回看日志才敢说。')
fs.rmSync(dir, { recursive: true, force: true })
