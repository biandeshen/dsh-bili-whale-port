/**
 * 旧家状态 → 新家的一次性迁移（方案 A4 / §8 第 9–11 步）。
 *
 * 背景：读"新优先、旧兜底"保证了兼容期内不漏数据，但**只在旧家**的那几份
 * （`pending-replies.json`、`selftest-passed.json` 实测就是）一到退场日就不读了。
 * 所以要在退场日之前把它们整份搬进新家，并且搬得可回滚。
 *
 *   node scripts/migrate-state-roots.mjs            列出计划（默认不动手）
 *   node scripts/migrate-state-roots.mjs --apply    真搬
 *   node scripts/migrate-state-roots.mjs --rollback <id>
 *
 * 三条安全规则，写死在代码里而不是靠操作者记得：
 *   1. **从不覆盖新家已有的文件**。新家那份是活的，旧家是旧的；覆盖 = 丢最新状态。
 *      两边都在（分叉）的只报告，不自动合并——合并两份计数器需要人决定以谁为准。
 *   2. 每次 --apply 落一个账本条目（id / 时间 / 每个文件的 sha256 / 前后路径 / gitSha），
 *      回滚只认账本里的 id，不猜。
 *   3. 迁移只搬"整份文件"，不搬凭据（凭据永远留旧家，见 paths.mjs R2）。
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { legacyStateDir, stateDir } from '../tools/lib/paths.mjs'
import { kinds } from '../tools/lib/state-roots.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LEDGER = path.join(stateDir(), 'migrations.json')
const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const rollbackAt = argv.indexOf('--rollback')
const ROLLBACK_ID = rollbackAt >= 0 ? argv[rollbackAt + 1] : ''

/** 不参与迁移的类：凭据固定旧家；drafts/runs 是目录且不在状态目录下。 */
const EXCLUDED = new Set(['credentials', 'drafts', 'runs'])

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

function gitSha() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim() } catch { return '' }
}

function readLedger() {
  try { return JSON.parse(fs.readFileSync(LEDGER, 'utf8')) } catch { return { entries: [] } }
}

function writeLedger(ledger) {
  fs.mkdirSync(path.dirname(LEDGER), { recursive: true })
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 2) + '\n')
}

const fresh = stateDir()
const legacy = legacyStateDir()

/** 每个候选：旧家里有、新家里没有 = 可搬；两边都有 = 分叉，只报不搬。 */
function plan() {
  const movable = []
  const split = []
  const alreadyDone = []
  for (const kind of [...kinds()].sort()) {
    if (EXCLUDED.has(kind)) continue
    const name = kind === 'fields' ? 'fields.json' : `${kind}.json`
    const a = path.join(fresh, name)
    const b = path.join(legacy, name)
    const hasFresh = fs.existsSync(a)
    const hasLegacy = fs.existsSync(b)
    if (!hasFresh && hasLegacy) movable.push({ kind, name, from: b, to: a, bytes: fs.statSync(b).size })
    else if (hasFresh && hasLegacy) split.push({ kind, name, fresh: a, legacy: b })
    else if (hasFresh) alreadyDone.push(kind)
  }
  return { movable, split, alreadyDone }
}

if (ROLLBACK_ID) {
  const ledger = readLedger()
  const entry = ledger.entries.find((e) => e.id === ROLLBACK_ID)
  if (!entry) {
    console.error(`✗ 账本里没有 ${ROLLBACK_ID}；可回滚的：${ledger.entries.map((e) => e.id).join('、') || '（空）'}`)
    process.exit(1)
  }
  if (entry.rolledBackAt) {
    console.error(`✗ ${ROLLBACK_ID} 已经回滚过（${entry.rolledBackAt}）`)
    process.exit(1)
  }
  // 回滚 = 把新家那份删掉，让读取重新退回旧家那份（旧家从没被改过）
  for (const f of entry.files) {
    try {
      if (!fs.existsSync(f.to)) continue
      const now = sha256(f.to)
      if (now !== f.sha256After) {
        console.error(`✗ ${f.name} 迁移之后又被写过（sha 不符），为免丢新数据，本次回滚中止。请人工核对。`)
        process.exit(1)
      }
      fs.unlinkSync(f.to)
    } catch (err) {
      console.error(`✗ 回滚 ${f.name} 失败：${String(err)}`)
      process.exit(1)
    }
  }
  entry.rolledBackAt = new Date().toISOString()
  writeLedger(ledger)
  console.log(`✓ 已回滚 ${ROLLBACK_ID}：删掉新家那份，读取退回旧家（旧家那份一直没动过）`)
  process.exit(0)
}

const { movable, split, alreadyDone } = plan()

console.log(`迁移计划　${APPLY ? '（--apply 会真的搬）' : '（预演，什么都没动）'}`)
console.log(`  新家：${fresh}`)
console.log(`  旧家：${legacy}`)
console.log('')

if (movable.length) {
  console.log(`  可以搬（只在旧家）${movable.length} 个：`)
  for (const m of movable) console.log(`    · ${m.name.padEnd(24)} ${m.bytes} B`)
} else {
  console.log('  可以搬：无（旧家没有"新家缺"的文件）')
}

if (split.length) {
  console.log('')
  console.log(`  ⚠ 两边都有、数值可能不同 ${split.length} 个 —— **不会自动合并**：`)
  for (const s of split) {
    const a = fs.statSync(s.fresh), b = fs.statSync(s.legacy)
    console.log(`    · ${s.name.padEnd(24)} 新 ${a.size}B/${new Date(a.mtimeMs).toISOString().slice(0, 16)}　旧 ${b.size}B/${new Date(b.mtimeMs).toISOString().slice(0, 16)}`)
  }
  console.log('      以谁为准是业务判断（例：traffic-state 的计数累加，取新家即可；待审队列要取并集）。')
  console.log('      这里不替你决定：要合并请人工处理后再跑一次。')
}

if (alreadyDone.length) console.log(`\n  早已在新家：${alreadyDone.join('、')}`)

if (!APPLY) {
  console.log('\n再跑一次加 --apply 才会动手。')
  process.exit(0)
}

if (!movable.length) {
  console.log('\n没有可搬的文件，什么都没写。')
  process.exit(0)
}

// —— 真搬 ——
const id = `mig-${Date.now().toString(36)}`
const files = []
for (const m of movable) {
  const before = sha256(m.from)
  fs.mkdirSync(path.dirname(m.to), { recursive: true })
  // copyFile 而不是 rename：旧家必须原样留着（回滚与人工核对都靠它）
  fs.copyFileSync(m.from, m.to)
  const after = sha256(m.to)
  if (after !== before) {
    console.error(`✗ ${m.name} 复制后 sha 不一致（${before} → ${after}），中止；已搬的会留在新家，请人工核对`)
    process.exit(1)
  }
  files.push({ kind: m.kind, name: m.name, from: m.from, to: m.to, sha256After: after, bytes: m.bytes })
}

const ledger = readLedger()
ledger.entries.push({
  id,
  at: new Date().toISOString(),
  gitSha: gitSha(),
  direction: 'legacy→fresh',
  files,
  note: '旧家原件保留未动；回滚 = 删除新家这份',
})
ledger.done = true
writeLedger(ledger)

console.log(`\n✓ 迁移 ${id}：${files.length} 个文件进新家，sha 逐一核对一致`)
console.log(`  账本：${LEDGER}`)
console.log(`  回滚：node scripts/migrate-state-roots.mjs --rollback ${id}`)
