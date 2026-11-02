/**
 * live 代码锚点（2026-11-02）。
 *
 * 要解决的是一件协议里写了、但机器上没管住的事：`OBSERVATION-PROTOCOL.md` §2 说
 * 「证据归因靠 live 冻结在同一份代码保证」，可开窗时记录的只有 `{startDay,days,createdAt}`
 * （`observation-start.mjs` 是哈希冻住的，不动它），**没有任何地方记下"live 当时是哪份代码"**。
 *
 * 而本项目的 live 恰恰是最容易悄悄漂移的那种：World 每个工具调用都是
 * `spawn(node tools/bili.mjs …)`——**改 dsh 不需要重启就立刻生效**。
 * 所以"这轮没重启"根本不构成"live 冻结"，观测窗里任何一次 dsh 提交都会改变她的行为，
 * 而事后复盘看不出来。这个脚本就是那条缺失的读数：开窗前锚一次，之后每天对一次账。
 *
 *   node scripts/live-code-anchor.mjs --set [--cortico ../Cortico-up]   # 记下现在的两份指纹
 *   node scripts/live-code-anchor.mjs --check [--json]                  # 对账：漂移退出码 2
 *
 * 只读 git 元信息，不碰状态文件以外的东西；落盘位置 `control/live-code.json`。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { whaleHome } from '../tools/lib/paths.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 锚点文件跟着 WHALE_HOME 走（测试把它指到临时目录）。 */
export function anchorFile() {
  const home = process.env.WHALE_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh')
  return path.join(home, 'bili-whale', 'control', 'live-code.json')
}

/** 一份代码目录的指纹：HEAD 提交 + 工作区是否干净。git 不可用（非仓库）时 sha 为空串。 */
export function codeFingerprint(dir) {
  const abs = path.resolve(dir)
  const git = (args) => {
    try {
      return execFileSync('git', args, { cwd: abs, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch { return null }
  }
  const sha = git(['rev-parse', 'HEAD']) ?? ''
  const porcelain = git(['status', '--porcelain'])
  return { dir: abs, sha, short: sha.slice(0, 7), dirty: porcelain === null ? null : porcelain.length > 0 }
}

/** 锚定：把当前 live 的两份代码指纹写进 control/live-code.json。 */
export function setAnchor({ cortico = path.resolve(ROOT, '..', 'Cortico-up'), note = '', now = Date.now() } = {}) {
  const hosts = [
    { name: 'dsh', ...codeFingerprint(ROOT) },
    { name: 'cortico', ...codeFingerprint(cortico) },
  ]
  const payload = { at: new Date(now).toISOString(), hosts, note: String(note).slice(0, 200) }
  const file = anchorFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.' + process.pid + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n')
  fs.renameSync(tmp, file)
  return payload
}

/**
 * 对账：逐个 host 用**当初记下的那个目录**重新取指纹。
 * 漂移定义：sha 变了，或 dirty 从干净变成有改动。找不到锚点文件不算漂移（报 missing）。
 */
export function checkAnchor({ nowHosts } = {}) {
  const file = anchorFile()
  if (!fs.existsSync(file)) return { state: 'missing', file, drift: [], hosts: [] }
  const anchor = JSON.parse(fs.readFileSync(file, 'utf8'))
  const hosts = Array.isArray(anchor.hosts) ? anchor.hosts : []
  const drift = []
  const fresh = hosts.map((h) => {
    const cur = (nowHosts ?? []).find((x) => x.name === h.name) || codeFingerprint(h.dir)
    const shaMoved = String(cur.sha ?? '') !== String(h.sha ?? '')
    const becameDirty = h.dirty === false && cur.dirty === true
    if (shaMoved || becameDirty) {
      drift.push({
        name: h.name,
        why: shaMoved ? `提交变了 ${String(h.sha).slice(0, 7)}→${String(cur.sha).slice(0, 7)}` : '工作区从干净变成有未提交改动',
      })
    }
    return { ...h, cur: { sha: cur.sha, short: String(cur.sha ?? '').slice(0, 7), dirty: cur.dirty } }
  })
  return { state: drift.length ? 'drift' : 'ok', file, at: anchor.at, drift, hosts: fresh }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  const json = argv.includes('--json')
  const i = argv.indexOf('--cortico')
  const r = argv.includes('--set')
    ? { state: 'set', ...setAnchor({ cortico: i >= 0 ? argv[i + 1] : undefined, note: argv.includes('--note') ? argv[argv.indexOf('--note') + 1] : '' }) }
    : checkAnchor()
  if (json) console.log(JSON.stringify(r, null, 2))
  else if (r.state === 'set') console.log(`✓ 已锚定 live 代码指纹：` + r.hosts.map((h) => `${h.name}=${h.short}${h.dirty ? '(dirty)' : ''}`).join(' · '))
  else if (r.state === 'missing') console.log('未锚定：' + r.file + ' 不存在。开观测窗前跑一次 --set。')
  else if (r.state === 'drift') console.error('✗ live 代码相对锚点漂移了（' + r.at + ' 锚的）：\n' + r.drift.map((d) => `  · ${d.name}：${d.why}`).join('\n'))
  else console.log('✓ live 代码与锚点一致（' + r.at + '）：' + r.hosts.map((h) => `${h.name}=${h.cur.short}`).join(' · '))
  process.exit(r.state === 'drift' ? 2 : 0)
}
