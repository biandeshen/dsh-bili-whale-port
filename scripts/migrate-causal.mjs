/**
 * 把 causal.jsonl 里旧实现的场值字段标注出来（不删数据，只加标记）。
 *
 * 背景：早先的 World 用的是 trust / boredom / fulfillment 三场，后来统一到
 * persona-core 的 7 场（energy/stimulation/connection/social/mood/curiosity/creativity）。
 * 旧记录留在盘上没问题，但如果不标，回读历史时会把不存在的场当成真的。
 *
 * 用法：node scripts/migrate-causal.mjs [--dry]
 */
import fs from 'node:fs'
import path from 'node:path'
import { whaleHome } from '../tools/lib/paths.mjs'

const LEGACY_FIELDS = ['trust', 'boredom', 'fulfillment']
const dry = process.argv.includes('--dry')
const file = path.join(whaleHome, 'bili-whale', 'causal.jsonl')

if (!fs.existsSync(file)) {
  console.log(JSON.stringify({ ok: true, file, rows: 0, migrated: 0, note: 'no causal file' }))
  process.exit(0)
}

const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
let migrated = 0
const out = lines.map((line) => {
  let row
  try { row = JSON.parse(line) } catch { return line }
  if (row.legacyFields) return line
  const touched = new Set()
  for (const key of ['before', 'after']) {
    const snap = row[key]
    if (!snap || typeof snap !== 'object') continue
    for (const f of LEGACY_FIELDS) if (f in snap) touched.add(f)
  }
  for (const e of row.effects ?? []) if (LEGACY_FIELDS.includes(e?.field)) touched.add(e.field)
  if (!touched.size) return line
  migrated++
  return JSON.stringify({
    ...row,
    legacyFields: [...touched],
    legacyNote: '旧实现的场值（' + [...touched].join('/') + '），现已并入 persona-core 7 场；这条只作历史留档',
  })
})

if (!dry && migrated) {
  const tmp = file + '.migrate-' + process.pid + '.tmp'
  fs.writeFileSync(tmp, out.join('\n') + '\n')
  fs.copyFileSync(file, file + '.bak')
  fs.renameSync(tmp, file)
}

console.log(JSON.stringify({ ok: true, file, rows: lines.length, migrated, dry }, null, 2))
