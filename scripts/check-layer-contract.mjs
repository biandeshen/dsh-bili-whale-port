/**
 * 分层契约门禁（#91）：`packages/` 的四层各自能认识谁、不能认识谁。
 *
 * 为什么需要它：2026-11-19 #90 把平铺的 11 个包分成了四层
 * （kernel / capabilities / adapters / shared），但**目录本身不拦人**——
 * 只要有人给内核加一句指向业务域的跨层 import，分层就又退回装饰。
 * 这条门禁把"层"变成可执行的断言。
 *
 * 规则（每条都对应一条真实理由，不是审美）：
 *
 *   shared/       工具层。**不许认识任何人**——它被所有层用，反向依赖立刻成环。
 *                 实际它只认 node 标准库（fs/path/crypto），这里断言它不 import 任何包。
 *
 *   kernel/       人格内核。只认 shared/ 与自身。**不许认 capabilities/ 或 adapters/**——
 *                 内核若认识业务域，"换一个世界观"就得改内核，宿主无关性就没了。
 *
 *   capabilities/ 业务域能力包。可以认 kernel/ 与 shared/，以及**同层**（cap-journal → cap-memory）。
 *                 **不许认 adapters/**——能力包是宿主无关的，认识转接头就等于绑死某个宿主。
 *
 *   adapters/     转接头。什么都能认（它就是干装配的）。
 *
 * 另外单独钉一条历史教训：**cap-* 不许 import 'cortico/*'**（三条铁律之二）。
 *
 *   node scripts/check-layer-contract.mjs
 *   node scripts/check-layer-contract.mjs --json
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKGS = path.join(ROOT, 'packages')
const AS_JSON = process.argv.includes('--json')
const LAYERS = ['kernel', 'capabilities', 'adapters', 'shared']

/** 层 → 允许认识的目标层（不含自身层，自身同层另行判断）。 */
const ALLOWED = {
  shared: [],
  kernel: ['shared'],
  capabilities: ['kernel', 'shared'],
  adapters: ['kernel', 'capabilities', 'adapters', 'shared'],
}

function allPackages() {
  const out = []
  for (const layer of LAYERS) {
    const dir = path.join(PKGS, layer)
    if (!fs.existsSync(dir)) continue
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'package.json'))) {
        out.push({ layer, name: e.name, dir: path.join(dir, e.name) })
      }
    }
  }
  return out
}

/** 一个包源码里所有跨包引用：从相对路径算出它指向哪个包/哪一层。 */
function crossRefs(pkg) {
  const srcDir = path.join(pkg.dir, 'src')
  const refs = []
  const walk = (dir) => {
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!/\.(ts|mjs|js)$/.test(e.name)) continue
      const text = fs.readFileSync(p, 'utf8')
      for (const m of text.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)'([^']+)'/g)) {
        refs.push({ file: p, spec: m[1] })
      }
    }
  }
  walk(srcDir)
  return refs
}

/** 说明符 → 目标包（跨包才算；同包内返回 null）。 */
function targetOf(pkg, ref) {
  if (!ref.spec.startsWith('.')) return { kind: 'bare', name: ref.spec }
  const abs = path.resolve(path.dirname(ref.file), ref.spec)
  const rel = path.relative(PKGS, abs).split(path.sep)
  if (rel[0] === '..') return { kind: 'outside', name: rel.join('/') }
  const [layer, name] = rel
  if (!LAYERS.includes(layer)) return { kind: 'unknown', name: rel.join('/') }
  // 同包：目标解析回自己
  if (layer === pkg.layer && name === pkg.name) return null
  // 层目录本身（例如 packages/shared/... 但下一段不是包）
  return { kind: 'package', layer, name }
}

const violations = []
const edges = []

for (const pkg of allPackages()) {
  for (const ref of crossRefs(pkg)) {
    const t = targetOf(pkg, ref)
    if (!t) continue
    if (t.kind === 'bare') {
      // 三条铁律之二：能力包不认识宿主
      if (pkg.layer === 'capabilities' && /^cortico(\/|$)/.test(t.name)) {
        violations.push({ pkg: `${pkg.layer}/${pkg.name}`, file: path.relative(ROOT, ref.file), spec: ref.spec, why: '能力包不许 import cortico/*（宿主无关铁律）' })
      }
      continue
    }
    if (t.kind !== 'package') continue
    edges.push(`${pkg.layer}/${pkg.name} → ${t.layer}/${t.name}`)
    const allowed = ALLOWED[pkg.layer] ?? []
    if (t.layer === pkg.layer) continue // 同层互认（cap-journal → cap-memory 是有意的）
    if (!allowed.includes(t.layer)) {
      violations.push({
        pkg: `${pkg.layer}/${pkg.name}`,
        file: path.relative(ROOT, ref.file),
        spec: ref.spec,
        why: `${pkg.layer}/ 不许依赖 ${t.layer}/（允许：${allowed.join(', ') || '无'}）`,
      })
    }
  }
}

if (AS_JSON) {
  console.log(JSON.stringify({ packages: allPackages().map((p) => `${p.layer}/${p.name}`), edges: [...new Set(edges)].sort(), violations }, null, 2))
} else {
  console.log(`分层契约门禁　${allPackages().length} 个包，${new Set(edges).size} 条跨包依赖边`)
  for (const e of [...new Set(edges)].sort()) console.log(`  ${e}`)
  if (violations.length) {
    console.log(`\n✗ ${violations.length} 处违规：`)
    for (const v of violations) console.log(`  ${v.pkg}  ${v.file}\n     ${v.spec}\n     ${v.why}`)
  } else {
    console.log('\n✓ 四层依赖方向全部合规（shared 不认人 / kernel 不认业务域 / capabilities 不认转接头）')
  }
}
process.exit(violations.length ? 1 : 0)
