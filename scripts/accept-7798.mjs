/**
 * 7798 新架构验收脚本（可重复执行，作为切换 live 前的门禁）。
 *
 *   node scripts/accept-7798.mjs [--base http://127.0.0.1:7798] [--home <部署目录>] [--report docs/evidence/]
 *
 * 检查分六组，任一 FAIL 退出码为 1：
 *   A 两个实例都在线（7798 新架构 + 7799 旧 live 未被波及，且 7799 仍是旧内建面板形态）
 *   B manifest：三个扩展注册齐全，8 个面板，client 指向扩展产物
 *   C 八个面板的读方法全部 200 且 ok:true
 *   D 写路径（走 HTTP 面板 invoke，带同源 Origin，与浏览器行为一致）：
 *     场值改+回读+复原 / 记忆塞+作废+恢复 / 日记在线编辑幂等替换 /
 *     偏好加词+复原（并验证落盘在 data/bilibili/，防 dataDir 回归）/ 急刹开+关 /
 *     待放行点单（不发网络）/ 记忆面板 git 历史可读
 *   E 磁盘与 git：卡片数、日记段、workspace 提交数
 *   F 残留检查：data/ 根不得再有 bilibili 的状态文件（此前 dataDir bug 的遗留）
 *
 * 幂等：标记串固定，重复跑不会无限累积（记忆只在不存在时创建，日记按日期+小节替换，
 * 场值与偏好先存原值再复原，急刹最后一定关掉）。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { homedir } from 'node:os'

const argv = process.argv.slice(2)
const val = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && argv[i + 1] ? argv[i + 1] : d }
const BASE = val('base', 'http://127.0.0.1:7798')
const DEPLOY = val('home', path.join(homedir(), '.xiaoyu-home', 'xiaoyu'))
const MARKER = '验收脚本标记-accept7798'

const results = []
const rec = (group, name, ok, detail = '') => {
  results.push({ group, name, ok, detail })
  console.log(`${ok ? '✔' : '✖'} [${group}] ${name}${detail ? ' — ' + detail : ''}`)
}

const enc = (s) => encodeURIComponent(s)
async function api(method, provider, panel, fn, args) {
  const url = `${BASE}/api/webui/providers/${enc(provider)}/panels/${panel}/${fn}`
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      // 同源闸按 Origin 校验（宿主 src/web/server.ts:814）；本脚本在宿主机上以同源身份调用，
      // 与浏览器发出的请求同一形状——这是 CSRF 防护，不是认证，本机验收允许。
      Origin: BASE,
    },
    body: method === 'POST' ? JSON.stringify({ args: args ?? [] }) : undefined,
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, text }
}

const P = 'persona:xiaoyu'
const B = 'world:bili-account'
const M = 'world:media-studio'

// ── A 实例在线 ─────────────────────────────────────────────────────────────
async function groupA() {
  for (const [port, note] of [[BASE, '新架构 7798'], ['http://127.0.0.1:7799', '旧 live 7799']]) {
    try {
      const r = await fetch(port + '/', { signal: AbortSignal.timeout(6000) })
      rec('A', `${note} 在线`, r.status === 200, `HTTP ${r.status}`)
    } catch (e) {
      rec('A', `${note} 在线`, false, String(e?.message ?? e))
    }
  }
  // 7799 仍是旧内建形态（证明 live 未被联调波及）
  try {
    const r = await fetch('http://127.0.0.1:7799/api/webui/manifest', { signal: AbortSignal.timeout(6000) })
    const m = await r.json()
    const bili = (m.providers ?? []).find((p) => p.id === 'world:bili-account')
    const isOld = bili && String(bili.client?.js ?? '').includes('/assets/providers/')
    rec('A', '7799 仍是旧内建 bili-account（未被波及）', Boolean(isOld), bili?.client?.js ?? '未找到')
  } catch (e) {
    rec('A', '7799 仍是旧内建 bili-account（未被波及）', false, String(e?.message ?? e))
  }
}

// ── B manifest ─────────────────────────────────────────────────────────────
async function groupB() {
  const r = await fetch(BASE + '/api/webui/manifest', { signal: AbortSignal.timeout(6000) })
  const m = await r.json()
  const byId = Object.fromEntries((m.providers ?? []).map((p) => [p.id, p]))
  for (const id of [P, B, M]) {
    const p = byId[id]
    rec('B', `${id} 已注册`, Boolean(p), p ? '' : '不在 manifest')
    if (p) {
      const ext = String(p.client?.js ?? '').includes('/assets/extensions/')
      rec('B', `${id} 用扩展产物`, ext, p.client?.js ?? '无 client')
    }
  }
  const expect = { [P]: 3, [B]: 4, [M]: 1 }
  for (const [id, n] of Object.entries(expect)) {
    const got = (byId[id]?.panels ?? []).length
    rec('B', `${id} 面板数=${n}`, got === n, `实际 ${got}`)
  }
}

// ── C 读方法冒烟 ───────────────────────────────────────────────────────────
async function groupC() {
  const smokes = [
    [P, 'tank', 'getSnapshot'],
    [P, 'memory-center', 'list'],
    [P, 'journal-board', 'getDiary'],
    [B, 'inbox', 'list'],
    [B, 'drafts-queue', 'list'],
    [B, 'preferences', 'get'],
    [B, 'gate-policy', 'get'],
    [M, 'media-studio', 'listAssets'],
  ]
  for (const [prov, panel, fn] of smokes) {
    const r = await api('GET', prov, panel, fn)
    rec('C', `${panel}.${fn}`, r.status === 200 && r.json?.ok === true, `HTTP ${r.status}`)
  }
  // ffmpeg 工具链真可用（防 binDir 默认值回归）
  const ff = await api('GET', M, 'media-studio', 'listAssets')
  rec('C', 'ffmpeg 工具链可用', ff.json?.toolchain?.ffmpegReady === true, ff.json?.toolchain?.ffmpeg ?? '')
}

// ── D 写路径 ───────────────────────────────────────────────────────────────
async function groupD() {
  // 1) 场值：改→回读→复原
  {
    const before = await api('GET', P, 'tank', 'getSnapshot')
    const orig = before.json?.fields?.energy
    const r = await api('POST', P, 'tank', 'setFields', [{ patch: { energy: 0.66 }, note: MARKER }])
    const mid = await api('GET', P, 'tank', 'getSnapshot')
    const okSet = r.status === 200 && Math.abs(Number(mid.json?.fields?.energy) - 0.66) < 1e-6
    rec('D', '场值 setFields 0.66 落盘', okSet, `回读 ${mid.json?.fields?.energy}`)
    const back = await api('POST', P, 'tank', 'setFields', [{ patch: { energy: orig }, note: MARKER + '-复原' }])
    const after = await api('GET', P, 'tank', 'getSnapshot')
    rec('D', '场值复原', back.status === 200 && Math.abs(Number(after.json?.fields?.energy) - orig) < 1e-6, `回到 ${after.json?.fields?.energy}`)
  }

  // 2) 记忆：塞（幂等）→ 作废 → 恢复
  {
    const list1 = await api('POST', P, 'memory-center', 'list', [{ tier: 'all' }])
    const existed = (list1.json?.items ?? []).find((x) => String(x.content ?? '').includes(MARKER))
    let id = existed?.id
    if (!id) {
      const c = await api('POST', P, 'memory-center', 'create', [{ content: MARKER, tags: ['验收'], tier: 'active', sender: 'player' }])
      id = c.json?.card?.id
      rec('D', '记忆 create', Boolean(id), `id=${id}`)
    } else {
      rec('D', '记忆 create（已存在，跳过）', true, `复用 id=${id}`)
    }
    const v = await api('POST', P, 'memory-center', 'void', [{ id, reason: '验收脚本作废验证，稍后恢复' }])
    rec('D', '记忆作废', v.json?.ok === true, v.json?.card?.tier ?? v.json?.error ?? '')
    const rr = await api('POST', P, 'memory-center', 'restore', [{ id, targetTier: 'active' }])
    rec('D', '记忆恢复', rr.json?.ok === true, rr.json?.card?.tier ?? rr.json?.error ?? '')
  }

  // 3) 日记：在线编辑（同日期+小节幂等替换）
  {
    const body = `${MARKER}：这一段由验收脚本写入，重复执行会原样替换。`
    const s = await api('POST', P, 'journal-board', 'saveDiarySection', [{ book: 'public', date: '2026-11-04', heading: '验收', markdown: body }])
    const g = await api('GET', P, 'journal-board', 'getDiary')
    rec('D', '日记在线编辑落盘', s.json?.ok === true && String(g.json?.body ?? '').includes(MARKER), s.json?.savedChars ?? s.json?.error ?? '')
  }

  // 4) 偏好：加词→验证落盘位置（data/bilibili/，防 dataDir 回归）→复原
  {
    const before = await api('GET', B, 'preferences', 'get')
    const origDislike = before.json?.prefs?.dislike ?? []
    if (!origDislike.includes(MARKER)) {
      const s = await api('POST', B, 'preferences', 'set', [{ dislike: [...origDislike, MARKER] }])
      const g = await api('GET', B, 'preferences', 'get')
      const fileRight = path.join(DEPLOY, 'data', 'bilibili', 'watch-prefs.json')
      const fileWrong = path.join(DEPLOY, 'data', 'watch-prefs.json')
      const inRight = fs.existsSync(fileRight) && fs.readFileSync(fileRight, 'utf8').includes(MARKER)
      rec('D', '偏好加词生效', s.json?.ok === true && (g.json?.prefs?.dislike ?? []).includes(MARKER), '')
      rec('D', '偏好落盘在 data/bilibili/（防回归）', inRight && !fs.existsSync(fileWrong), inRight ? fileRight : '位置不对')
      await api('POST', B, 'preferences', 'set', [{ dislike: origDislike }])
    } else {
      rec('D', '偏好加词（已存在，跳过）', true, '')
    }
  }

  // 5) 急刹：开→验证→关（最后一定关掉）
  {
    const on = await api('POST', B, 'gate-policy', 'set', [{ killOn: true }])
    const mid = await api('GET', B, 'gate-policy', 'get')
    rec('D', '急刹开启', on.status === 200 && mid.json?.killOn === true, `killOn=${mid.json?.killOn}`)
    const off = await api('POST', B, 'gate-policy', 'set', [{ killOn: false }])
    const end = await api('GET', B, 'gate-policy', 'get')
    rec('D', '急刹关闭（复原）', off.status === 200 && end.json?.killOn === false, `killOn=${end.json?.killOn}`)
  }

  // 6) 待放行：点单（只入事件，不发网络）
  {
    const r = await api('POST', B, 'drafts-queue', 'requestNew', [{ kind: 'dynamic', prompt: MARKER + '：点单不发声' }])
    rec('D', '待放行点单 requestNew', r.json?.ok === true, r.json?.requestedAt ? String(r.json.requestedAt) : r.json?.error ?? '')
  }

  // 7) git 历史：记忆面板能读到仓库状态
  {
    const h = await api('POST', P, 'memory-center', 'history', [{ limit: 5 }])
    rec('D', 'workspace git 历史可读', h.json?.ok === true && h.json?.status?.repo === true, `HEAD=${h.json?.status?.head ?? '?'} dirty=${h.json?.status?.dirty}`)
  }
}

// ── E 磁盘与 git ───────────────────────────────────────────────────────────
async function groupE() {
  const memoActive = path.join(DEPLOY, 'workspace', 'memo', 'active')
  const memoCore = path.join(DEPLOY, 'workspace', 'memo', 'core')
  const nA = fs.existsSync(memoActive) ? fs.readdirSync(memoActive).filter((f) => f.endsWith('.md')).length : -1
  const nC = fs.existsSync(memoCore) ? fs.readdirSync(memoCore).filter((f) => f.endsWith('.md')).length : -1
  rec('E', `记忆卡片 core=${nC} active=${nA}`, nC >= 22 && nA >= 46, '')
  const pub = fs.readFileSync(path.join(DEPLOY, 'workspace', 'diary', 'public.md'), 'utf8')
  rec('E', '公开日记含 2026-11-04 验收段', pub.includes(MARKER), '')
  try {
    const log = execFileSync('git', ['log', '--oneline', '-n', '20'], { cwd: path.join(DEPLOY, 'workspace'), encoding: 'utf8' })
    const n = log.trim().split('\n').length
    rec('E', `workspace git 提交 ≥4`, n >= 4, `最近 ${n} 条，首条 ${log.trim().split('\n')[0]}`)
  } catch (e) {
    rec('E', 'workspace git 提交 ≥4', false, String(e?.message ?? e))
  }
}

// ── F 残留检查 ─────────────────────────────────────────────────────────────
async function groupF() {
  const root = path.join(DEPLOY, 'data')
  const strays = fs.existsSync(root)
    ? fs.readdirSync(root).filter((f) => /^(watch-prefs|policy|quota|traffic-state|pending-queue|causal|KILL)/.test(f))
    : []
  rec('F', 'data/ 根无 bilibili 状态残留', strays.length === 0, strays.length ? '残留：' + strays.join(', ') + '（应移入 data/bilibili/ 并删除）' : '')
  if (strays.includes('KILL')) {
    // dataDir 修复前急刹写错了位置：真闸在 data/bilibili/KILL，根上这份是死文件，直接清掉
    try { fs.rmSync(path.join(root, 'KILL'), { force: true }); console.log('  （已清理遗留的 data/KILL 死文件）') } catch {}
  }
}

async function main() {
  console.log(`验收目标：${BASE}  部署：${DEPLOY}\n`)
  await groupA()
  await groupB()
  await groupC()
  await groupD()
  await groupE()
  await groupF()

  const failed = results.filter((r) => !r.ok)
  console.log(`\n合计 ${results.length} 项：${results.length - failed.length} 通过，${failed.length} 失败`)
  if (argv.includes('--report')) {
    const dir = val('report', 'docs/evidence')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `accept-7798-${new Date().toISOString().slice(0, 10)}.json`)
    fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), base: BASE, deploy: DEPLOY, results }, null, 2) + '\n')
    console.log(`REPORT=${file}`)
  }
  process.exit(failed.length ? 1 : 0)
}

await main()
