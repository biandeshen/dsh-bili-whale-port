/**
 * 教训账一致性门禁：`docs/LESSONS.md` 与 `docs/lessons.jsonl` 必须对得上。
 *
 *   node scripts/check-lessons.mjs [--json]
 *
 * 为什么要有它：教训用两层记——md 给人读、jsonl 给机器筛。两层一旦漂移，
 * 机器筛出来的结论就和写作时想表达的不是一回事，而且**看不出来**。
 * 同类的坑本仓踩过：文档与代码各说各的，读的人无法判断哪份是真。
 *
 * 五条判据：
 *   L1 jsonl 每行是合法 JSON，字段齐全（id/category/severity/title/rule/when/why/evidence/since）
 *   L2 id 唯一
 *   L3 evidence 里写的仓内路径都存在（这条与文档门禁 R2 同一口径：写下来的必须真在）
 *   L4 md 里每个「### <ID> ·」小节在 jsonl 里都有；反过来每个 jsonl 条目在 md 里都有小节
 *   L5 severity 只能是 critical / important / normal
 *
 * 只读检查：不改任何文件。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MD = path.join(ROOT, 'docs', 'LESSONS.md')
const JSONL = path.join(ROOT, 'docs', 'lessons.jsonl')
const asJson = process.argv.includes('--json')

const FIELDS = ['id', 'category', 'severity', 'title', 'rule', 'when', 'why', 'evidence', 'since']
const SEVERITIES = new Set(['critical', 'important', 'normal'])
const problems = []

if (!fs.existsSync(MD)) problems.push({ rule: 'L0 缺文件', where: 'docs/LESSONS.md', detail: '不存在' })
if (!fs.existsSync(JSONL)) problems.push({ rule: 'L0 缺文件', where: 'docs/lessons.jsonl', detail: '不存在' })

const entries = []
if (fs.existsSync(JSONL)) {
  const lines = fs.readFileSync(JSONL, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (!line.trim()) return
    let o
    try {
      o = JSON.parse(line)
    } catch (e) {
      problems.push({ rule: 'L1 jsonl 不是合法 JSON', where: `docs/lessons.jsonl:${i + 1}`, detail: e.message })
      return
    }
    const missing = FIELDS.filter((k) => o[k] === undefined || o[k] === null || o[k] === '')
    if (missing.length) problems.push({ rule: 'L1 字段缺失', where: `docs/lessons.jsonl:${i + 1}`, detail: missing.join(', ') })
    if (o.severity && !SEVERITIES.has(o.severity)) {
      problems.push({ rule: 'L5 severity 非法', where: `docs/lessons.jsonl:${i + 1}`, detail: String(o.severity) })
    }
    if (Array.isArray(o.evidence)) {
      for (const rel of o.evidence) {
        if (!fs.existsSync(path.join(ROOT, rel))) {
          problems.push({ rule: 'L3 evidence 路径不存在', where: o.id ?? `line ${i + 1}`, detail: rel })
        }
      }
    }
    entries.push(o)
  })
}

const seen = new Set()
for (const o of entries) {
  if (!o.id) continue
  if (seen.has(o.id)) problems.push({ rule: 'L2 id 重复', where: o.id, detail: '同一条被记了两次' })
  seen.add(o.id)
}

if (fs.existsSync(MD)) {
  const text = fs.readFileSync(MD, 'utf8')
  const inMd = new Set([...text.matchAll(/^###\s+([A-Z]+-\d+)\s*·/gm)].map((m) => m[1]))
  for (const id of seen) if (!inMd.has(id)) problems.push({ rule: 'L4 jsonl 条目在 md 里没有小节', where: id, detail: '两层漂移' })
  for (const id of inMd) if (!seen.has(id)) problems.push({ rule: 'L4 md 小节在 jsonl 里没有条目', where: id, detail: '两层漂移' })
}

const report = { ok: problems.length === 0, entries: entries.length, problems }
if (asJson) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`# 教训账一致性\n  docs/LESSONS.md ↔ docs/lessons.jsonl：${entries.length} 条`)
  if (problems.length) {
    console.log(`  ✗ ${problems.length} 条违规`)
    for (const p of problems) console.log(`    - [${p.rule}] ${p.where}：${p.detail}`)
  } else {
    console.log('  ✓ 五条判据全绿（字段 / id / evidence 路径 / 两层对应 / severity）')
  }
}
process.exit(problems.length ? 1 : 0)
