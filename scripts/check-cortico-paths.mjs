/**
 * 宿主路径门禁：脚本不许再指向第二宿主克隆。
 *
 *   node scripts/check-cortico-paths.mjs [--json] [--root <仓库根>]
 *
 * 为什么要有这条：本仓曾有 7 个脚本把 CORTICO_ROOT 的默认值写死成另一棵检出，
 * 而环境变量一处都没设 —— 那些默认值是活的，脚本安静地读了另一棵树的代码与数据，
 * 报告看起来却正常（唤醒审计审的是搬家前的人格、节奏模拟跑的是已退役的预算策略）。
 * 现在「宿主在哪」只认 CORTICO_ROOT / 本仓 .env（scripts/lib/host-root.mjs），拿不到就报错。
 *
 * 两条规则：
 *   R1 路径指向不带 -up 的那棵克隆（绝对、相对、path.join 片段三种写法都算）
 *   R2 CORTICO_ROOT 的兜底值是绝对机器路径（盘符/根路径），换台机器就是错的
 *
 * **注释里的用法示例也算**：照着注释里那句 cd 到旧克隆再跑 tsx 的示例做，就会跑错树，
 * 这跟代码里写死默认值是同一个故障。文档（docs/、attic/、spark-output/）不在扫描范围：
 * 案卷记录的是当时的真相，不许改写历史。
 *
 * 只读检查：不改任何文件，也不建目录。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SELF_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const argAt = argv.indexOf('--root')
if (argAt >= 0 && !argv[argAt + 1]) { console.error('--root 后面要跟仓库根目录'); process.exit(2) }
const ROOT = path.resolve(argAt >= 0 ? argv[argAt + 1] : (process.env.CORTICO_PATHS_REPO || SELF_REPO))
const json = argv.includes('--json')

const SCAN_DIRS = ['scripts', 'tools', 'tests', 'packages', 'adapters', 'core', 'panel']
const SKIP_DIR = new Set([
  'node_modules', '.git', 'dist', 'dist-web', '.spike-home', 'deployments', 'runtime',
  'local-resources', 'docs', 'days', 'spark-output', 'data', 'coverage', '.pnpm-store',
])
const EXT = /\.(mjs|cjs|js|ts|tsx|cmd|vbs|json)$/i
const MAX_BYTES = 2 * 1024 * 1024 // 锁文件/产物清单这类大 JSON 不是人写的路径来源

const RULES = [
  {
    id: 'R1-absolute',
    re: /WorkSpace_Qoder[\/\\]+Cortico(?!-up)/g,
    why: '绝对路径指向第二宿主克隆（不带 -up）',
    fix: '改用 scripts/lib/host-root.mjs 的 hostRoot()/hostImport()，或把路径换成 live 那棵（-up）',
  },
  {
    id: 'R1-relative',
    re: /\.\.[\/\\]+Cortico(?!-up)/g,
    why: '相对路径指向第二宿主克隆（不带 -up）',
    fix: '同上；用法示例也要改，照着跑就会跑错树',
  },
  {
    id: 'R1-segment',
    re: /['"]\.\.['"]\s*,\s*['"]Cortico['"]/g,
    why: 'path.join/resolve 的片段拼出了第二宿主克隆',
    fix: '同上',
  },
  {
    id: 'R2-hard-default',
    re: /CORTICO_ROOT['"]?\]?\s*\|\|\s*['"](?:[A-Za-z]:[\/\\]|\/|~)/g,
    why: 'CORTICO_ROOT 的兜底值是绝对机器路径',
    fix: '去掉硬默认：缺 CORTICO_ROOT 就明确报错并提示该设什么（hostRoot() 已经这么做）',
  },
]

function walk(dir, out = []) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIR.has(e.name)) walk(path.join(dir, e.name), out)
      continue
    }
    if (!e.isFile() || !EXT.test(e.name)) continue
    const abs = path.join(dir, e.name)
    try { if (fs.statSync(abs).size > MAX_BYTES) continue } catch { continue }
    out.push(abs)
  }
  return out
}

const files = []
for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files)
for (const e of fs.existsSync(ROOT) ? fs.readdirSync(ROOT, { withFileTypes: true }) : []) {
  if (e.isFile() && (EXT.test(e.name) || e.name === 'package.json')) files.push(path.join(ROOT, e.name))
}

const hits = []
for (const abs of files.sort()) {
  const rel = path.relative(ROOT, abs).replace(/\\/g, '/')
  const text = fs.readFileSync(abs, 'utf8')
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    for (const rule of RULES) {
      rule.re.lastIndex = 0
      const m = rule.re.exec(lines[i])
      if (!m) continue
      hits.push({ rule: rule.id, file: rel, line: i + 1, text: lines[i].trim().slice(0, 160), why: rule.why, fix: rule.fix })
    }
  }
}

if (json) {
  console.log(JSON.stringify({ ok: hits.length === 0, root: ROOT, scanned: files.length, rules: RULES.map((r) => r.id), hits }, null, 2))
  process.exit(hits.length === 0 ? 0 : 1)
}

console.log(`宿主路径门禁：扫了 ${files.length} 个文件（${SCAN_DIRS.join('/')} + 仓库根脚本）`)
if (hits.length === 0) {
  console.log('没有指向第二宿主克隆的路径，也没有绝对机器路径兜底。')
  process.exit(0)
}
for (const h of hits) {
  console.log(`\n${h.rule}  ${h.file}:${h.line}`)
  console.log(`  ${h.text}`)
  console.log(`  问题：${h.why}`)
  console.log(`  修法：${h.fix}`)
}
console.log(`\n${hits.length} 处违规。宿主在哪只认 CORTICO_ROOT / 本仓 .env，见 scripts/lib/host-root.mjs。`)
process.exit(1)