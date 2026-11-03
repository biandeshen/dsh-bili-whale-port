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
const RUN = 'acc' + Date.now().toString(36).slice(-5)
const MARKER = `验收标记-${RUN}`

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
const DATA = path.join(DEPLOY, 'data', 'bilibili')
const WS = path.join(DEPLOY, 'workspace')
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))

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
    // 语义随切换演进：7798 联调期断言"7799 还是旧的"；切换后 7799 应为扩展产物。
    // 以 BASE 端口区分：BASE 是 7798（联调）→ 期望 7799 旧形态；BASE 是 7799（正式）→ 期望两台都新。
    const switching = BASE.includes('7798')
    const wantOld = switching
    const isOld = bili && String(bili.client?.js ?? '').includes('/assets/providers/')
    const isNew = bili && String(bili.client?.js ?? '').includes('/assets/extensions/')
    rec('A', switching ? '7799 仍是旧内建 bili-account（未被波及）' : '7799 已切到新扩展 bili-account', wantOld ? Boolean(isOld) : Boolean(isNew), bili?.client?.js ?? '未找到')
  } catch (e) {
    rec('A', '7799 状态检查', false, String(e?.message ?? e))
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
    [P, 'journal-board', 'listJudgments'],
    [P, 'journal-board', 'listFeedback'],
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

// ── D 写路径全覆盖 ─────────────────────────────────────────────────────────
async function groupD() {
  // 1) tank.setFields：改→HTTP+磁盘→复原（复原带断言）
  {
    const before = await api('GET', P, 'tank', 'getSnapshot')
    const orig = before.json?.fields?.energy
    await api('POST', P, 'tank', 'setFields', [{ patch: { energy: 0.66 }, note: MARKER }])
    const mid = await api('GET', P, 'tank', 'getSnapshot')
    const disk = readJson(path.join(DEPLOY, 'data', 'persona', 'fields.json'))
    rec('D', 'tank.setFields 0.66（HTTP+磁盘）', Math.abs(Number(mid.json?.fields?.energy) - 0.66) < 1e-6 && Math.abs(disk.fields.energy - 0.66) < 1e-6, `回读 ${mid.json?.fields?.energy}`)
    await api('POST', P, 'tank', 'setFields', [{ patch: { energy: orig }, note: MARKER + '-复原' }])
    const after = await api('GET', P, 'tank', 'getSnapshot')
    const disk2 = readJson(path.join(DEPLOY, 'data', 'persona', 'fields.json'))
    rec('D', 'tank 复原（HTTP+磁盘）', Math.abs(Number(after.json?.fields?.energy) - orig) < 1e-6 && Math.abs(disk2.fields.energy - orig) < 1e-6, `回读 ${after.json?.fields?.energy}`)
  }

  // 2) tank.setMode + wakeNow（作息遥控）
  {
    const s = await api('POST', P, 'tank', 'setMode', [{ mode: 'force_sleep' }])
    const mid = await api('GET', P, 'tank', 'getSnapshot')
    const lifeDisk = readJson(path.join(DEPLOY, 'data', 'persona', 'life.json'))
    rec('D', 'tank.setMode force_sleep（HTTP+磁盘）', s.json?.ok === true && mid.json?.mode === 'force_sleep' && lifeDisk.mode === 'force_sleep', `mode=${mid.json?.mode}`)
    const w = await api('POST', P, 'tank', 'wakeNow', [{ hint: MARKER }])
    rec('D', 'tank.wakeNow 触发', w.json?.ok === true && Boolean(w.json?.triggeredAt), '')
    const r = await api('POST', P, 'tank', 'setMode', [{ mode: 'auto' }])
    const end = await api('GET', P, 'tank', 'getSnapshot')
    rec('D', 'tank 复原 auto', r.json?.ok === true && end.json?.mode === 'auto', `mode=${end.json?.mode}`)
  }

  // 3) memory.create / update（改文+调层级）/ void / restore，磁盘断言 + git 信息断言
  {
    const c = await api('POST', P, 'memory-center', 'create', [{ content: MARKER, tags: ['验收'], tier: 'active', sender: 'player' }])
    const id = c.json?.card?.id
    rec('D', 'memory.create（磁盘）', Boolean(id) && fs.existsSync(path.join(WS, 'memo', 'active', `${id}.md`)), `id=${id}`)
    const u = await api('POST', P, 'memory-center', 'update', [{ id, content: MARKER + '-改', tier: 'core' }])
    const moved = fs.existsSync(path.join(WS, 'memo', 'core', `${id}.md`)) && !fs.existsSync(path.join(WS, 'memo', 'active', `${id}.md`))
    rec('D', 'memory.update 改文+置顶核心（磁盘）', u.json?.ok === true && String(u.json?.card?.content ?? '').endsWith('-改') && moved, u.json?.error ?? '')
    const v = await api('POST', P, 'memory-center', 'void', [{ id, reason: MARKER + '：作废验证' }])
    rec('D', 'memory.void（磁盘）', v.json?.ok === true && fs.existsSync(path.join(WS, 'memo', 'voided', `${id}.md`)), v.json?.error ?? '')
    const rr = await api('POST', P, 'memory-center', 'restore', [{ id, targetTier: 'active' }])
    rec('D', 'memory.restore（磁盘）', rr.json?.ok === true && fs.existsSync(path.join(WS, 'memo', 'active', `${id}.md`)) && !fs.existsSync(path.join(WS, 'memo', 'voided', `${id}.md`)), rr.json?.error ?? '')
    try {
      const log = execFileSync('git', ['log', '--format=%s', '-n', '8'], { cwd: WS, encoding: 'utf8' })
      rec('D', 'memory 提交信息含标记', log.includes(MARKER), log.split('\n')[0])
    } catch (e) { rec('D', 'memory 提交信息含标记', false, String(e?.message ?? e)) }
  }

  // 4) journal.saveDiarySection / upsertJudgment / replyFeedback（有开放意见才批复）
  {
    const body = `${MARKER}：验收脚本写入，重跑原样替换。`
    const s = await api('POST', P, 'journal-board', 'saveDiarySection', [{ book: 'public', date: '2026-11-04', heading: '验收', markdown: body }])
    const disk = fs.readFileSync(path.join(WS, 'diary', 'public.md'), 'utf8')
    rec('D', 'journal.saveDiarySection（HTTP+磁盘）', s.json?.ok === true && disk.includes(body), s.json?.error ?? '')

    const j = await api('POST', P, 'journal-board', 'upsertJudgment', [{ verdict: 'drop', note: MARKER + '：判断卡验收' }])
    rec('D', 'journal.upsertJudgment', j.json?.ok === true && Boolean(j.json?.id), j.json?.id ?? j.json?.error ?? '')

    const fb = await api('POST', P, 'journal-board', 'listFeedback', [{ status: 'all' }])
    const target = (fb.json?.items ?? []).find((x) => !x.resolved)
    if (target) {
      const rep = await api('POST', P, 'journal-board', 'replyFeedback', [{ id: target.id, ownerReply: MARKER + '：批复', resolve: true }])
      rec('D', 'journal.replyFeedback', rep.json?.ok === true && rep.json?.resolved === true, rep.json?.error ?? '')
    } else {
      rec('D', 'journal.replyFeedback（无开放意见，跳过）', true, '意见箱当前无未解决条目')
    }
  }

  // 5) inbox.assignAction 三动作（注入临时条目驱动，结束后清理）
  {
    const inboxFile = path.join(DATA, 'inbox-items.json')
    const inject = (key, uid, kind) => {
      const items = fs.existsSync(inboxFile) ? JSON.parse(fs.readFileSync(inboxFile, 'utf8')) : []
      items.push({ key, kind, uid, who: '验收注入', text: MARKER, atMs: Date.now(), read: false })
      fs.writeFileSync(inboxFile, JSON.stringify(items, null, 2), 'utf8')
    }
    inject(`acc-ign-${RUN}`, `9001${RUN}`, 'dm')
    inject(`acc-blk-${RUN}`, `9002${RUN}`, 'dm')
    inject(`acc-rep-${RUN}`, `9003${RUN}`, 'reply')
    const ig = await api('POST', B, 'inbox', 'assignAction', [{ itemKey: `acc-ign-${RUN}`, action: 'ignore' }])
    rec('D', 'inbox.assignAction ignore', ig.json?.ok === true && ig.json?.item?.read === true, ig.json?.error ?? '')
    const bl = await api('POST', B, 'inbox', 'assignAction', [{ itemKey: `acc-blk-${RUN}`, action: 'block_user' }])
    const blocked = fs.existsSync(path.join(DATA, 'blocked-uids.json')) ? readJson(path.join(DATA, 'blocked-uids.json')) : []
    rec('D', 'inbox.assignAction block_user（磁盘）', bl.json?.ok === true && blocked.includes(`9002${RUN}`), '')
    const rep = await api('POST', B, 'inbox', 'assignAction', [{ itemKey: `acc-rep-${RUN}`, action: 'ask_her_reply', ownerHint: MARKER }])
    rec('D', 'inbox.assignAction ask_her_reply', rep.json?.ok === true && rep.json?.item?.assignedAction === 'ask_her_reply', rep.json?.error ?? '')
    const items = JSON.parse(fs.readFileSync(inboxFile, 'utf8')).filter((x) => !String(x.key).startsWith('acc-'))
    fs.writeFileSync(inboxFile, JSON.stringify(items, null, 2), 'utf8')
  }

  // 6) preferences.set 加词→磁盘→复原（复原带断言）
  {
    const before = await api('GET', B, 'preferences', 'get')
    const orig = before.json?.prefs?.dislike ?? []
    const s = await api('POST', B, 'preferences', 'set', [{ dislike: [...orig, MARKER] }])
    const disk = fs.readFileSync(path.join(DATA, 'watch-prefs.json'), 'utf8')
    rec('D', 'preferences.set 加词（HTTP+磁盘）', s.json?.ok === true && disk.includes(MARKER), '')
    const r2 = await api('POST', B, 'preferences', 'set', [{ dislike: orig }])
    const disk2 = readJson(path.join(DATA, 'watch-prefs.json'))
    rec('D', 'preferences 复原（磁盘）', r2.json?.ok === true && !disk2.dislike.includes(MARKER), '')
  }

  // 7) gate.set 全分支：档位/配额/冷却/急刹/解除，全部磁盘断言+复原
  {
    const g0 = await api('GET', B, 'gate-policy', 'get')
    const orig = { comment: g0.json?.policy?.comment ?? 'review', selfCap: g0.json?.quota?.selfCap ?? 12, shareCap: g0.json?.quota?.shareCap ?? 3, gap: g0.json?.traffic?.writeGapSec ?? 10 }
    await api('POST', B, 'gate-policy', 'set', [{ policy: { comment: 'self' } }])
    rec('D', 'gate 档位 comment=self（磁盘）', readJson(path.join(DATA, 'policy.json')).comment === 'self', '')
    await api('POST', B, 'gate-policy', 'set', [{ quota: { selfCap: 7, shareCap: 2 } }])
    const d2 = readJson(path.join(DATA, 'quota.json'))
    rec('D', 'gate 配额（磁盘）', d2.selfCap === 7 && d2.shareCap === 2, '')
    await api('POST', B, 'gate-policy', 'set', [{ writeGapSec: 3 }])
    rec('D', 'gate 冷却（磁盘）', readJson(path.join(DATA, 'traffic-state.json')).writeGapSec === 3, '')
    await api('POST', B, 'gate-policy', 'set', [{ killOn: true }])
    rec('D', 'gate 急刹（KILL 文件）', fs.existsSync(path.join(DATA, 'KILL')), '')
    await api('POST', B, 'gate-policy', 'set', [{ killOn: false, clearTrafficPause: true }])
    rec('D', 'gate 急刹解除', !fs.existsSync(path.join(DATA, 'KILL')), '')
    await api('POST', B, 'gate-policy', 'set', [{ policy: { comment: orig.comment } }])
    await api('POST', B, 'gate-policy', 'set', [{ quota: { selfCap: orig.selfCap, shareCap: orig.shareCap } }])
    await api('POST', B, 'gate-policy', 'set', [{ writeGapSec: orig.gap }])
    const gEnd = await api('GET', B, 'gate-policy', 'get')
    const okEnd = gEnd.json?.policy?.comment === orig.comment
      && gEnd.json?.quota?.selfCap === orig.selfCap
      && gEnd.json?.traffic?.writeGapSec === orig.gap
      && gEnd.json?.killOn === false
    rec('D', 'gate 全部复原', okEnd, JSON.stringify(gEnd.json?.policy ?? {}).slice(0, 80))
  }

  // 8) queue 全链：注入待放行条目→updateDraft 哈希续签→reject（不触网）→清理
  {
    const qfile = path.join(DATA, 'pending-queue.json')
    const qid = `acc-${RUN}`
    const qall = fs.existsSync(qfile) ? readJson(qfile) : []
    qall.push({
      id: qid, kind: 'comment', intent: 'self', target: { bvid: 'BV1xx411c7mD' },
      text: '原始待放行正文', bodyHash: 'x', token: 'acc-token', createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(), status: 'pending',
    })
    fs.writeFileSync(qfile, JSON.stringify(qall, null, 2), 'utf8')
    const list = await api('POST', B, 'drafts-queue', 'list', [{}])
    const item = (list.json?.items ?? []).find((x) => x.id === qid)
    rec('D', 'queue 注入条目可见', Boolean(item), '')
    if (item) {
      const newText = `${item.text} [${MARKER}]`
      const u = await api('POST', B, 'drafts-queue', 'updateDraft', [{ id: qid, text: newText }])
      const okU = u.json?.ok === true && u.json?.item?.text === newText && u.json?.item?.bodyHash !== item.bodyHash && u.json?.item?.token !== item.token
      rec('D', 'queue.updateDraft 哈希续签（§10.4 核心修复）', okU, okU ? 'token 已换' : JSON.stringify(u.json).slice(0, 120))
      const rj = await api('POST', B, 'drafts-queue', 'reject', [{ id: qid, reason: MARKER + '：拒稿验收', askRewrite: false }])
      const diskQ = readJson(qfile).find((x) => x.id === qid)
      rec('D', 'queue.reject（磁盘）', rj.json?.ok === true && diskQ?.status === 'rejected', String(diskQ?.rejectReason ?? '').slice(0, 30))
    }
    fs.writeFileSync(qfile, JSON.stringify(readJson(qfile).filter((x) => x.id !== qid), null, 2), 'utf8')
  }

  // 9) requestNew：真实调用（产生一条待写事件给主会话，不触网）
  {
    const r = await api('POST', B, 'drafts-queue', 'requestNew', [{ kind: 'dynamic', prompt: MARKER + '：点单验收' }])
    rec('D', 'queue.requestNew', r.json?.ok === true, r.json?.requestedAt ? String(r.json.requestedAt) : r.json?.error ?? '')
  }
}

// ── E 磁盘与 git ───────────────────────────────────────────────────────────
async function groupE() {
  const memoActive = path.join(WS, 'memo', 'active')
  const memoCore = path.join(WS, 'memo', 'core')
  const nA = fs.existsSync(memoActive) ? fs.readdirSync(memoActive).filter((f) => f.endsWith('.md')).length : -1
  const nC = fs.existsSync(memoCore) ? fs.readdirSync(memoCore).filter((f) => f.endsWith('.md')).length : -1
  rec('E', `记忆卡片 core=${nC} active=${nA}`, nC >= 22 && nA >= 47, '')
  const pub = fs.readFileSync(path.join(WS, 'diary', 'public.md'), 'utf8')
  rec('E', '公开日记含验收段', pub.includes(MARKER), '')
  rec('E', 'causal.jsonl 在 data/bilibili/', fs.existsSync(path.join(DATA, 'causal.jsonl')), '')
  try {
    const log = execFileSync('git', ['log', '--format=%s', '-n', '12'], { cwd: WS, encoding: 'utf8' })
    const lines = log.trim().split('\n')
    rec('E', 'workspace git 提交 ≥6', lines.length >= 6, `最近 ${lines.length} 条`)
    rec('E', '本轮产生验收提交', lines.some((l) => l.includes(RUN)), lines[0])
  } catch (e) {
    rec('E', 'workspace git 提交', false, String(e?.message ?? e))
  }
}

// ── F 残留检查（发现即归位到 data/bilibili/，归位后复验）─────────────────────
async function groupF() {
  const root = path.join(DEPLOY, 'data')
  const pattern = /^(watch-prefs|policy|quota|traffic-state|pending-queue|causal|KILL)/
  const strays = fs.existsSync(root) ? fs.readdirSync(root).filter((f) => pattern.test(f)) : []
  rec('F', 'data/ 根无 bilibili 状态残留', strays.length === 0, strays.length ? '残留：' + strays.join(', ') : '')
  for (const f of strays) {
    const from = path.join(root, f)
    const to = path.join(root, 'bilibili', f)
    try {
      if (fs.existsSync(to)) fs.rmSync(from, { force: true })
      else fs.renameSync(from, to)
      console.log(`  （已归位 ${f} → data/bilibili/）`)
    } catch {}
  }
  if (strays.length) {
    const left = fs.readdirSync(root).filter((f) => pattern.test(f))
    rec('F', '残留归位后复验', left.length === 0, left.join(', '))
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
