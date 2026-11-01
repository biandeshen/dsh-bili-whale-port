/**
 * 运行态每日备份 + 恢复演练（缺口清单 #43，2026-11-01）。
 *
 * 她的"人生档案"（fields.json / causal.jsonl / days/<日>/ / 两本日记 / 两处草稿 /
 * bili-whale.config.json / 人设文件）此前不在任何版本控制里：手工 bundle 最新停在
 * 10-31，11-01 零份，没有生成脚本，也没有恢复演练。这个脚本把备份变成一条命令。
 *
 * 用法：
 *   node scripts/ops-backup.mjs                        # 打一份（默认 <whale home>/backups/）
 *   node scripts/ops-backup.mjs --to <备份根>          # 或 env WHALE_BACKUP_DIR 覆盖
 *   node scripts/ops-backup.mjs --restore <备份目录>   # 默认 dry：只报告会覆盖/新建哪些，不写盘
 *   node scripts/ops-backup.mjs --restore <备份目录> --apply   # 先把当前状态另存，再真写
 *
 * 凭据边界：**绝不打包** credentials.json / github-token.json / 任何 *token*、*secret*、
 * *.key、*.pem、cookie 命名的文件 —— 采集源本身是白名单，再过一道敏感名硬拦截；
 * 排除了什么全部写进 MANIFEST.json，恢复的人不用猜。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { whaleHome, whalePath, homePath, draftsDir } from '../tools/lib/paths.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

// 敏感名硬拦截（白名单之外的第二道闸：哪怕以后加源加错了目录也进不来）
const SENSITIVE = /(credentials|token|secret|cookie)|\.(key|pem)$/i

// 打包内容：每个源 → 备份包内的前缀。缺的源如实记 missing，不静默跳过。
function sources() {
  // 草稿两处都抓（运营席实测：observation-day 等都按 WHALE_DRAFTS→legacy→whale home 回退，
  // 只备一处会丢稿）；draftsDir() 已含 legacy 判断，不另列 LEGACY_DRAFTS 免得把"已被用户
  // 显式改向"的旧目录也拖进来。
  const draftRoots = [...new Set([draftsDir(), path.join(whaleHome, 'bili-whale', 'drafts')])]
    .map((d) => path.resolve(d)).sort()
  const cortico = process.env.CORTICO_ROOT || path.resolve(REPO, '..', 'Cortico')
  return {
    roots: {
      whale: whaleHome,
      'bili-ai': homePath('.bili-ai'),
      cortico,
      drafts: draftRoots[0],
      ...(draftRoots.length > 1 ? { 'drafts-2': draftRoots[1] } : {}),
    },
    // 单文件源：[备份内 rel, 磁盘 abs]
    singles: [
      ['whale/bili-whale/fields.json', whalePath('bili-whale', 'fields.json')],
      ['whale/bili-whale/fields-events.json', whalePath('bili-whale', 'fields-events.json')],
      ['whale/bili-whale/causal.jsonl', whalePath('bili-whale', 'causal.jsonl')],
      ['whale/whale-diary.md', whalePath('whale-diary.md')],
      ['whale/whale-diary-private.md', whalePath('whale-diary-private.md')],
      ['whale/whale-log.jsonl', whalePath('whale-log.jsonl')],
      ['whale/bili-whale.config.json', whalePath('bili-whale.config.json')],
      ['bili-ai/persona.md', homePath('.bili-ai', 'persona.md')],
      ['cortico/deployments/mybot/prompts/ORIENTATION.md', path.join(cortico, 'deployments', 'mybot', 'prompts', 'ORIENTATION.md')],
      ['cortico/deployments/mybot/workspace/CONSTITUTION.md', path.join(cortico, 'deployments', 'mybot', 'workspace', 'CONSTITUTION.md')],
    ],
    // 目录源：[前缀, 磁盘目录, 过滤说明]
    dirs: [
      ['whale/bili-whale/days', whalePath('bili-whale', 'days'), null],
      ['whale/bili-whale/feed', whalePath('bili-whale', 'feed'), null],
      ['whale/bili-whale/control', whalePath('bili-whale', 'control'), (f) => !/\.(pid|log|tmp|lock)$/.test(f)],
      ['drafts', draftRoots[0], null],
      ...(draftRoots.length > 1 ? [['drafts-2', draftRoots[1], null]] : []),
    ],
    draftRoots,
  }
}

function walk(absDir, relPrefix, keep, out, backupRoot) {
  for (const e of fs.readdirSync(absDir, { withFileTypes: true })) {
    const abs = path.join(absDir, e.name)
    const rel = relPrefix + '/' + e.name
    if (backupRoot && path.resolve(abs).startsWith(backupRoot + path.sep)) continue // 绝不把备份套进备份
    if (e.isDirectory()) { walk(abs, rel, keep, out, backupRoot); continue }
    if (!e.isFile()) continue
    if (keep && !keep(e.name)) continue
    out.push({ rel, abs })
  }
}

function collect(backupRoot) {
  const s = sources()
  const found = []
  const missing = []
  const blocked = []
  for (const [rel, abs] of s.singles) {
    if (fs.existsSync(abs)) found.push({ rel, abs })
    else missing.push(rel)
  }
  for (const [prefix, dir, keep] of s.dirs) {
    if (!dir || !fs.existsSync(dir)) { missing.push(prefix + '/（目录不存在）'); continue }
    walk(dir, prefix, keep, found, backupRoot)
  }
  // 敏感名第二道闸：命中即踢出并留痕（manifest 里如实写）
  const kept = found.filter((f) => {
    if (SENSITIVE.test(path.basename(f.abs))) { blocked.push(f.rel); return false }
    return true
  })
  return { entries: kept, missing, blocked, roots: s.roots }
}

function doBackup(to) {
  const root = path.resolve(to)
  const bundle = path.join(root, 'backup-' + stamp() + '-' + process.pid)
  const { entries, missing, blocked, roots } = collect(root)
  let totalBytes = 0
  const files = []
  fs.mkdirSync(bundle, { recursive: true })
  for (const { rel, abs } of entries.sort((a, b) => a.rel.localeCompare(b.rel))) {
    const dest = path.join(bundle, 'files', ...rel.split('/'))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(abs, dest)
    const bytes = fs.statSync(dest).size
    totalBytes += bytes
    files.push({ rel, bytes, sha256: sha256(dest), origin: abs })
  }
  const manifest = {
    kind: 'whale-ops-backup', schemaVersion: 1, at: new Date().toISOString(),
    bundle, backupRoot: root, resolvedRoots: roots,
    fileCount: files.length, totalBytes, files, missing,
    sensitiveBlocked: blocked,
    excluded: [
      'credentials.json（B站 SESSDATA/bili_jct/buvid3，永不打包）',
      'github-token.json / 任何 *token*、*secret*、*cookie*、*.key、*.pem 命名的文件（白名单 + 敏感名双闸，实测命中记在 sensitiveBlocked）',
      '~/.dsh/panel.token（面板令牌）',
      'Cortico deployments/mybot/config.json（可能含模型 API key；只取人设两文件）',
      'control/*.pid、control/*.log、*.tmp、*.lock（运行时垃圾，不是档案）',
      '备份根自身（防套娃）',
    ],
    restoreSteps: [
      `node scripts/ops-backup.mjs --restore "${bundle}"        # 默认 dry，只看会覆盖哪些`,
      `node scripts/ops-backup.mjs --restore "${bundle}" --apply # 写盘前当前状态另存到 <备份根>/pre-restore-<ts>/`,
    ],
  }
  fs.writeFileSync(path.join(bundle, 'MANIFEST.json'), JSON.stringify(manifest, null, 2))
  console.log(`备份完成：${bundle}`)
  console.log(`文件 ${files.length} 个 · ${totalBytes} 字节 · 缺失源 ${missing.length} 个（如实记录）`)
  if (blocked.length) console.log(`敏感名拦截：${blocked.join(', ')}`)
  console.log('凭据（credentials.json / token / cookie）一律不打包；排除清单见 MANIFEST.json。')
  console.log(`恢复演练：node scripts/ops-backup.mjs --restore "${bundle}"（默认 dry）`)
  return bundle
}

// rel → 当前机器上的恢复目标（备份在哪台机器打的不要紧，落在哪由现在的 home 解析说了算）
function relToTarget(rel, roots) {
  const seg = rel.split('/')
  const root = roots[seg[0]]
  if (!root) return null
  return path.join(root, ...seg.slice(1))
}

function doRestore(bundleDir, apply) {
  const bundle = path.resolve(bundleDir)
  const mPath = path.join(bundle, 'MANIFEST.json')
  if (!fs.existsSync(mPath)) { console.error(`找不到 ${mPath}`); process.exit(2) }
  const m = JSON.parse(fs.readFileSync(mPath, 'utf8'))
  if (m.kind !== 'whale-ops-backup') { console.error('MANIFEST.json 不是 ops-backup 备份包'); process.exit(2) }
  const { roots } = sources()
  let overwrite = 0, create = 0, skip = 0
  const plan = []
  for (const f of m.files) {
    const target = relToTarget(f.rel, roots)
    const src = path.join(bundle, 'files', ...f.rel.split('/'))
    if (!target || !fs.existsSync(src)) { skip++; plan.push(`跳过   ${f.rel}（当前机器没有对应落点或备份缺文件）`); continue }
    const exists = fs.existsSync(target)
    if (exists) overwrite++; else create++
    const nowBytes = exists ? fs.statSync(target).size : 0
    plan.push(`${exists ? '覆盖' : '新建'}   ${target}（现 ${nowBytes}B ← 备份 ${f.bytes}B）`)
  }
  console.log(plan.join('\n'))
  console.log(`\n共 ${m.files.length} 个文件：覆盖 ${overwrite} · 新建 ${create} · 跳过 ${skip}`)
  if (!apply) {
    console.log('—— 这是 dry-run（默认），没有写任何盘。确认真恢复请加 --apply。')
    return
  }
  // 真写前把当前状态另存一份：恢复失败还能退回去
  const root = path.resolve(m.backupRoot || whalePath('backups'))
  const pre = path.join(root, 'pre-restore-' + stamp() + '-' + process.pid)
  fs.mkdirSync(pre, { recursive: true })
  let saved = 0
  for (const f of m.files) {
    const target = relToTarget(f.rel, roots)
    if (target && fs.existsSync(target)) {
      const dest = path.join(pre, 'files', ...f.rel.split('/'))
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.copyFileSync(target, dest)
      saved++
    }
  }
  fs.writeFileSync(path.join(pre, 'MANIFEST.json'), JSON.stringify({
    kind: 'whale-ops-pre-restore', at: new Date().toISOString(), restoreSource: bundle, fileCount: saved,
  }, null, 2))
  console.log(`当前状态已另存：${pre}（${saved} 个文件）`)
  let written = 0
  for (const f of m.files) {
    const target = relToTarget(f.rel, roots)
    const src = path.join(bundle, 'files', ...f.rel.split('/'))
    if (!target || !fs.existsSync(src)) continue
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(src, target)
    if (sha256(target) !== f.sha256) { console.error(`写后校验失败：${target}`); process.exit(1) }
    written++
  }
  console.log(`恢复完成：写入 ${written} 个文件（写后逐个 sha256 校验）。`)
}

const argv = process.argv.slice(2)
const arg = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }
try {
  if (argv.includes('--restore')) {
    doRestore(arg('--restore'), argv.includes('--apply'))
  } else {
    doBackup(arg('--to') ?? process.env.WHALE_BACKUP_DIR ?? whalePath('backups'))
  }
} catch (e) { console.error('ops-backup 失败：' + e.message); process.exit(1) }
