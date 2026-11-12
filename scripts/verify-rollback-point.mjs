/**
 * 回滚点核对：逐文件 sha256 + 逐目录计数 + 目录集合（空目录也算）。
 *
 * 用法：node scripts/verify-rollback-point.mjs --src=<源部署根> [--dest=<目标部署根>] [--manifest=<清单落盘路径>] [--quiet]
 *   --src      必填。不写死任何克隆路径（check-cortico-paths.mjs 禁止脚本硬编码第二宿主克隆）。
 *   --dest     缺省取 rollbackRoot()（~/.xiaoyu-home/rollback/deployments，可用 XIAOYU_ROLLBACK_ROOT 覆盖）
 *   --manifest 缺省 <dest 的父目录>/rollback-manifest.json
 *
 * 完整哈希清单默认落在目标部署根旁（私有目录，不进仓：里面有端点 .env 的哈希）。
 * 仓内 docs/evidence/ 只留计数与结论。
 * 退出码：0 全等；1 有差异；2 用法错。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { rollbackRoot } from './lib/host-root.mjs'

const argv = process.argv.slice(2)
const flag = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}
const SRC = flag('src')
const DEST = flag('dest') || rollbackRoot()
if (!SRC) {
  console.error('用法：node scripts/verify-rollback-point.mjs --src=<源部署根> [--dest=<目标部署根>]')
  process.exit(2)
}
if (!fs.existsSync(SRC)) { console.error(`源不存在：${SRC}`); process.exit(2) }
if (!fs.existsSync(DEST)) { console.error(`目标不存在：${DEST}`); process.exit(2) }

/** 收集一棵树：文件相对路径 → sha256，以及全部目录相对路径。 */
function survey(root) {
  const files = new Map()
  const dirs = []
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, ent.name)
      const rel = path.relative(root, abs).split(path.sep).join('/')
      if (ent.isDirectory()) { dirs.push(rel); walk(abs) }
      else if (ent.isFile()) files.set(rel, crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex'))
      else dirs.push(`${rel}（非文件非目录：${ent.isSymbolicLink() ? 'symlink' : 'other'}）`)
    }
  }
  walk(root)
  return { files, dirs: dirs.sort() }
}

const a = survey(SRC)
const b = survey(DEST)

const onlySrc = [...a.files.keys()].filter((k) => !b.files.has(k))
const onlyDest = [...b.files.keys()].filter((k) => !a.files.has(k))
const changed = [...a.files.keys()].filter((k) => b.files.has(k) && a.files.get(k) !== b.files.get(k))
const dirsOnlySrc = a.dirs.filter((d) => !b.dirs.includes(d))
const dirsOnlyDest = b.dirs.filter((d) => !a.dirs.includes(d))

/** 逐目录计数：按相对路径的第一段（部署名）与第二段（部署内一级子目录）各出一张表。 */
function countByPrefix(files, depth) {
  const out = new Map()
  for (const rel of files.keys()) {
    const key = rel.split('/').slice(0, depth).join('/')
    out.set(key, (out.get(key) || 0) + 1)
  }
  return [...out.entries()].sort((x, y) => x[0].localeCompare(y[0]))
}

const lines = []
const say = (s) => { lines.push(s); if (!argv.includes('--quiet')) console.log(s) }
say(`源   ${SRC}`)
say(`目标 ${DEST}`)
say(`文件 ${a.files.size} → ${b.files.size}    目录 ${a.dirs.length} → ${b.dirs.length}`)
say('')
say('逐部署计数：')
const depA = countByPrefix(a.files, 1)
const depB = new Map(countByPrefix(b.files, 1))
for (const [k, n] of depA) say(`  ${k.padEnd(24)} ${n} → ${depB.get(k) ?? 0}${depB.get(k) === n ? '' : '  ← 不等'}`)
say('')
say('逐一级子目录计数：')
const subB = new Map(countByPrefix(b.files, 2))
for (const [k, n] of countByPrefix(a.files, 2)) {
  if (k.split('/').length < 2) continue
  say(`  ${k.padEnd(34)} ${n} → ${subB.get(k) ?? 0}${subB.get(k) === n ? '' : '  ← 不等'}`)
}
say('')
say(`只在源里的文件 ${onlySrc.length}；只在目标里的文件 ${onlyDest.length}；内容不同 ${changed.length}`)
say(`只在源里的目录 ${dirsOnlySrc.length}；只在目标里的目录 ${dirsOnlyDest.length}`)
for (const list of [onlySrc, onlyDest, changed, dirsOnlySrc, dirsOnlyDest]) {
  for (const item of list.slice(0, 40)) say(`  ! ${item}`)
  if (list.length > 40) say(`  …另有 ${list.length - 40} 条`)
}

const ok = a.files.size === b.files.size && !onlySrc.length && !onlyDest.length && !changed.length && !dirsOnlySrc.length && !dirsOnlyDest.length
say('')
say(ok ? '结论：逐文件 sha256 全等，目录集合全等（含空目录）。' : '结论：有差异，回滚点不可用。')

const manifest = {
  verifiedAt: new Date().toISOString(),
  src: SRC,
  dest: DEST,
  fileCount: { src: a.files.size, dest: b.files.size },
  dirCount: { src: a.dirs.length, dest: b.dirs.length },
  perDeployment: depA.map(([k, n]) => ({ dir: k, src: n, dest: depB.get(k) ?? 0 })),
  equal: ok,
  differences: { onlySrc, onlyDest, changed, dirsOnlySrc, dirsOnlyDest },
  dirs: b.dirs,
  files: Object.fromEntries([...b.files.entries()].sort((x, y) => x[0].localeCompare(y[0]))),
}
const manifestFile = flag('manifest') || path.join(path.dirname(DEST), 'rollback-manifest.json')
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
say(`完整哈希清单（私有，不进仓）：${manifestFile}`)
process.exit(ok ? 0 : 1)