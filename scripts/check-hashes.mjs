/**
 * 冻结验收脚本：记录/校验 sha256，防止"验收期改判据"。
 *
 *   node scripts/check-hashes.mjs           # 校验，不一致退出 1
 *   node scripts/check-hashes.mjs --write   # 重新生成（只允许在 G1/G3b 冻结时跑）
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const MANIFEST = path.join(ROOT, 'scripts', 'hashes.json')

const FILES = [
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
  const out = { frozenAt: new Date().toISOString(), files: {}, missing: [] }
  for (const rel of FILES) {
    const abs = path.join(ROOT, rel)
    if (fs.existsSync(abs)) out.files[rel] = sha256(abs)
    else out.missing.push(rel)
  }
  fs.writeFileSync(MANIFEST, JSON.stringify(out, null, 2) + '\n', 'utf8')
  console.log(JSON.stringify({ ok: true, manifest: MANIFEST, frozen: Object.keys(out.files).length, missing: out.missing }, null, 2))
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
