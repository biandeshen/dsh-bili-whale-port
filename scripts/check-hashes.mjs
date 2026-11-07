/**
 * 冻结验收脚本：记录/校验 sha256，防止"验收期改判据"。
 *
 *   node scripts/check-hashes.mjs                     # 校验，不一致退出 1
 *   node scripts/check-hashes.mjs --write --note "..."  # 重新冻结；**不给 --note 就拒绝改写**
 *                                                       # （npm run hashes:write 走环境变量 FREEZE_NOTE）
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const MANIFEST = path.join(ROOT, 'scripts', 'hashes.json')

const FILES = [
  // 校验器自己也进冻结名单：不然改弱这条防线的人只需要改 `check-hashes.mjs` 本身，
  // 而哈希账上看不出来（2026-11-07 加）。--write 会把当下这份的自我哈希一并记进去。
  'scripts/check-hashes.mjs',
  'scripts/day-report.mjs',
  'scripts/day-snapshot.mjs',
  'scripts/day-watchdog.mjs',
  'scripts/counterfactual.mjs',
  'scripts/run-mjs-tests.mjs',
  'scripts/check-consumers.mjs',
  'scripts/g3b-check.mjs',
  'scripts/observation-start.mjs',
  'scripts/goal-audit.mjs',
  'scripts/c2-offline.mjs',
  'scripts/observation-status.mjs',
  'tests/contract/voice.test.mjs',
]

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

if (process.argv.includes('--write')) {
  /**
   * 改冻结判据**必须留理由**（2026-11-07 加）。以前 `--write` 一句话就把整本哈希重写，
   * "验收期改判据"这条防线只剩一个日期字段——谁能改哈希，谁就能把任何结果变成绿。
   * 现在：不给 `--note` 不写；给了就把"哪些文件从哪个哈希改到什么哈希、为什么"追加进 `history`。
   */
  const ni = process.argv.indexOf('--note')
  const note = (ni >= 0 ? String(process.argv[ni + 1] ?? '') : String(process.env.FREEZE_NOTE ?? '')).trim()
  let prev = null
  try { prev = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) } catch { /* 首次冻结没有前一份 */ }
  if (prev && !note) {
    console.error('拒绝改写冻结：必须带 --note "为什么改这份判据"（或环境变量 FREEZE_NOTE），写清谁改的、哪一批、依据是什么。')
    process.exit(1)
  }
  const out = {
    frozenAt: new Date().toISOString(),
    firstFrozenAt: prev?.firstFrozenAt ?? prev?.frozenAt ?? new Date().toISOString(),
    files: {},
    missing: [],
    history: prev?.history ?? [],
  }
  const changed = []
  for (const rel of FILES) {
    const abs = path.join(ROOT, rel)
    if (!fs.existsSync(abs)) { out.missing.push(rel); continue }
    const got = sha256(abs)
    out.files[rel] = got
    const was = prev?.files?.[rel]
    if (was && was !== got) changed.push({ at: out.frozenAt, file: rel, from: was, to: got, reason: note })
    if (!was) changed.push({ at: out.frozenAt, file: rel, from: null, to: got, reason: note || '首次冻结' })
  }
  out.history.push(...changed)
  fs.writeFileSync(MANIFEST, JSON.stringify(out, null, 2) + '\n', 'utf8')
  console.log(JSON.stringify({
    ok: true, manifest: MANIFEST, frozen: Object.keys(out.files).length,
    missing: out.missing, rewritten: changed.length, note,
  }, null, 2))
  process.exit(0)
}

let manifest
try { manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) } catch {
  console.error('MISSING  scripts/hashes.json（先跑 --write 冻结）')
  process.exit(1)
}
let bad = 0
for (const [rel, want] of Object.entries(manifest.files ?? {})) {
  const abs = path.join(ROOT, rel)
  if (!fs.existsSync(abs)) { console.log(`MISSING  ${rel}`); bad++; continue }
  const got = sha256(abs)
  const ok = got === want
  console.log(`${ok ? 'OK      ' : 'CHANGED '}${rel}`)
  if (!ok) bad++
}
const stillMissing = (manifest.missing ?? []).filter((rel) => !fs.existsSync(path.join(ROOT, rel)))
for (const rel of stillMissing) console.log(`PENDING  ${rel}（冻结时尚未创建）`)
console.log(`\n${bad === 0 ? '一致' : bad + ' 个文件被改动'}`)
process.exit(bad === 0 ? 0 : 1)
