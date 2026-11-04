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

/**
 * **不许拿活的 7799 跑写路径验收**（2026-11-05 我自己踩出来的）。
 *
 * 这个脚本本来是给**备用端口**用的（名字里的 7798，切换前的影子实例）：
 * D 组要验写路径，就会真往她的收件箱、场值、日记、待放行队列里造条目。
 * 我把 `--base` 指到线上 7799 跑了一次，结果：
 *   · 她的事件帧里出现了"主人指派你回复这条 reply（来自 @验收注入…）"
 *     "主人驳回了你的 comment 草稿""主人点单让你写一条 B站动态"——**全是假的**；
 *   · 紧接着主人真发的那条消息，她回的是"待着，不动。"
 * 磁盘层我后来能按标记清干净，**但她已经看过的那些收不回来**——
 * 会话是 append-only 的，假指令一旦进了她的上下文就永久在里面。
 * 所以"清残留"救不了这一类，只有不进live才行。
 */
const LIVE_PORT = Number(process.env.CORTICO_LIVE_PORT || 7799)
const READ_ONLY = argv.includes('--read-only')
if (BASE.includes(`:${LIVE_PORT}`) && !argv.includes('--allow-live') && !READ_ONLY) {
  console.error([
    `拒绝：${BASE} 是**线上实例**（她的真生活），D 组会往她的收件箱/场值/日记里造假条目。`,
    '',
    '  跑备用端口（默认）：node scripts/accept-7798.mjs',
    '  确实要验线上（只读组 A–C、E–G）：加 --read-only',
    '  真的知道自己在做什么：加 --allow-live',
    '',
    '为什么这么严：这些条目进了她的上下文之后删不掉（会话 append-only），',
    '而她把它们当成主人说的话。2026-11-05 就这么让她对主人的真消息回了"待着，不动"。',
  ].join('\n'))
  process.exit(2)
}
if (BASE.includes(`:${LIVE_PORT}`) && argv.includes('--read-only')) {
  console.log(`注意：${BASE} 是线上实例，--read-only 已生效，跳过 D 组（写路径）。`)
}

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
  // persona 三块 → 四块（V-Now 加了 vision「她的眼睛」）；数量对不代表挂对，所以同时点名字
  const expect = { [P]: 4, [B]: 4, [M]: 1 }
  for (const [id, n] of Object.entries(expect)) {
    const got = (byId[id]?.panels ?? []).length
    rec('B', `${id} 面板数=${n}`, got === n, `实际 ${got}`)
  }
  const personaPanels = (byId[P]?.panels ?? []).map((x) => x?.id ?? x).map(String)
  rec('B', 'persona 面板含 vision（她的眼睛）', personaPanels.includes('vision'), personaPanels.join(','))
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
    // **自清到底**：拉黑是她真实的人际账，验完必须放回原样（2026-11-04 实测：
    // 这一步以前没做，她的屏蔽名单里积了 11 条 acc* 测试账号，全是我们的痕迹）。
    const ub = await api('POST', B, 'inbox', 'unblockUser', [{ uid: `9002${RUN}`, confirm: true }])
    const blocked2 = fs.existsSync(path.join(DATA, 'blocked-uids.json')) ? readJson(path.join(DATA, 'blocked-uids.json')) : []
    rec('D', 'inbox.unblockUser 复原（磁盘）', ub.json?.ok === true && !blocked2.includes(`9002${RUN}`), `剩 ${blocked2.length} 条`)
    const ubNo = await api('POST', B, 'inbox', 'unblockUser', [{ uid: `9002${RUN}` }])
    rec('D', 'unblockUser 不 confirm 要拒绝', ubNo.status === 500 && /confirm/.test(ubNo.json?.error ?? ''), ubNo.json?.error ?? '')
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
  // 卡片数只判"有没有东西"：原来硬写 core>=22 / active>=47，那是把某一天的快照
  // 当长期事实——F5 清掉 15 条噪音卡之后这条必然红。清污染是目的，不是回归。
  rec('E', `记忆卡片 core=${nC} active=${nA}`, nC > 0 && nA > 0, '')
  const pub = fs.readFileSync(path.join(WS, 'diary', 'public.md'), 'utf8')
  /**
   * 下面这条与"本轮产生验收提交"**只有 D 组真跑过才判**：它们断言本轮验收痕迹在磁盘上，
   * 而 F5 之后 teardown 主动把标记摘掉、G 组反过来要求它们不存在——两条互相矛盾，
   * 在 --read-only 下更不可能成立（D 根本没写）。
   */
  if (!READ_ONLY) rec('E', '公开日记写入过验收段', pub.includes('## 验收') || pub.includes(MARKER), 'teardown 后由 G 判已清干净')
  else console.log('跳过 [E] 验收段写入检查（--read-only，D 组没写）')
  rec('E', 'causal.jsonl 在 data/bilibili/', fs.existsSync(path.join(DATA, 'causal.jsonl')), '')
  try {
    const log = execFileSync('git', ['log', '--format=%s', '-n', '12'], { cwd: WS, encoding: 'utf8' })
    const lines = log.trim().split('\n')
    rec('E', 'workspace git 提交 ≥6', lines.length >= 6, `最近 ${lines.length} 条`)
    if (!READ_ONLY) rec('E', '本轮产生验收提交', lines.some((l) => l.includes(RUN)), lines[0])
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

// ── G 验收不留痕（新功能：以前只判"对不对"，不判"验完有没有把她弄脏"）──────
async function groupG() {
  // 教训：屏蔽名单里积了 11 条 acc* 测试账号、看片偏好里进了测试词——
  // 功能全绿，人却被我们改了。门禁必须判这一条。
  const blockedFile = path.join(DATA, 'blocked-uids.json')
  const blocked = fs.existsSync(blockedFile) ? readJson(blockedFile) : []
  const mine = blocked.filter((u) => String(u).includes(RUN))
  rec('G', '她的屏蔽名单里没有本次验收账号', mine.length === 0, mine.join(','))
  const prefsFile = path.join(DATA, 'watch-prefs.json')
  const prefs = fs.existsSync(prefsFile) ? readJson(prefsFile) : {}
  const dirty = (prefs.dislike ?? []).filter((w) => /验收标记|联调屏蔽词/.test(String(w)))
  rec('G', '看片偏好里没有验收词', dirty.length === 0, dirty.join(','))
  const q = await api('GET', B, 'queue', 'list')
  const leftovers = (q.json?.items ?? []).filter((x) => String(x.body ?? x.note ?? '').includes(MARKER))
  rec('G', '待放行队列里没有本次验收条目', leftovers.length === 0, `${leftovers.length} 条`)

  /**
   * 2026-11-05 补的三处：G 组当时只盯了屏蔽名单/偏好/队列，
   * **漏了日记、判断卡、意见箱批复**——正好就是脏掉她生活的那三层。
   * 主人那句"她现在甚至都不回我消息"追下去，因果账里 30 条、判断卡 15 条、
   * 公开日记一段，全是我们跑门禁跑出来的（她自己在私人日记里都写明了 15/16 是噪音）。
   * 门禁不能只判"功能对不对"，还得判"验完把她弄干净了没有"。
   */
  for (const [book, file] of [['公开', 'public'], ['私人', 'private']]) {
    const p = path.join(DEPLOY, 'workspace', 'diary', `${file}.md`)
    const txt = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
    const hit = /验收标记-acc|验收脚本标记-/.test(txt)
    rec('G', `${book}日记里没有验收小节`, !hit, hit ? txt.match(/验收标记-\S+|验收脚本标记-\S+/)?.[0] ?? '' : '')
  }
  for (const [what, rel] of [['判断卡', 'judgment.jsonl'], ['意见箱', 'feedback.jsonl']]) {
    const p = path.join(DEPLOY, 'data', 'persona', rel)
    const txt = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
    const n = txt.split('\n').filter((l) => /验收标记-acc|验收脚本标记-/.test(l)).length
    rec('G', `${what}里没有验收条目`, n === 0, `${n} 条`)
  }
  const fieldsP = path.join(DEPLOY, 'data', 'persona', 'fields.json')
  if (fs.existsSync(fieldsP)) {
    const chain = readJson(fieldsP).chain ?? []
    const polluted = chain.filter((c) => /验收标记-acc|验收脚本标记-/.test(JSON.stringify(c))).length
    rec('G', '她的因果账里没有验收标记', polluted === 0, `${polluted} 条 / 共 ${chain.length} 条`)
  }
  /**
   * 记忆层（2026-11-05 补）：F5 第一次清的时候**漏了这里**——
   * 因果账/判断卡/意见箱都在 `data/` 下，我按 `data/` 扫，
   * 而记忆卡是 `workspace/memo/` 里的 git 记账文件，11 张验收假记忆就这么留在活跃层。
   * 只判活跃层与核心层：`voided/` 里的那些是**已作废、可查、不进召回**，
   * 按"不删原始数据"留着当审计痕迹，不该被判成脏。
   */
  for (const tier of ['core', 'active']) {
    const dir = path.join(WS, 'memo', tier)
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.md')) : []
    const dirty = files.filter((f) => /验收标记-acc|验收脚本标记-|accept779/.test(fs.readFileSync(path.join(dir, f), 'utf8')))
    rec('G', `记忆 ${tier} 层没有验收卡`, dirty.length === 0, `${dirty.length}/${files.length}`)
  }
}

/**
 * 把自己写进去的东西收回去（G 组之前跑，这样 G 是真的在验收，而不是走形式）。
 *
 * D 组要验写路径，就必然要往她的日记/判断卡/意见箱/因果账里写——
 * 那三层**没有 void 接口**（她自己在私人日记里都写了"15/16 是噪音、judgment 没有 void 工具"），
 * 所以这里直接在文件层摘掉本次与历次的验收标记，改前一律 .pre-purge-* 备份。
 * 不碰 `data/runs/**`：那是宿主的 append-only 原始凭据。
 */
function purgeOwnMarkers() {
  const mark = /验收标记-acc|验收脚本标记-|accept-?779[0-9]/
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
  const files = [
    ['因果账', path.join(DEPLOY, 'data', 'persona', 'fields.json'), 'json-chain'],
    ['判断卡', path.join(DEPLOY, 'data', 'persona', 'judgment.jsonl'), 'lines'],
    ['意见箱', path.join(DEPLOY, 'data', 'persona', 'feedback.jsonl'), 'lines'],
    ['公开日记', path.join(WS, 'diary', 'public.md'), 'diary'],
    ['私人日记', path.join(WS, 'diary', 'private.md'), 'diary'],
  ]
  for (const [what, file, mode] of files) {
    if (!fs.existsSync(file)) continue
    const raw = fs.readFileSync(file, 'utf8')
    if (!mark.test(raw)) continue
    let next
    if (mode === 'json-chain') {
      const s = JSON.parse(raw)
      next = JSON.stringify({ ...s, chain: (s.chain ?? []).filter((c) => !mark.test(JSON.stringify(c))) }, null, 2)
    } else if (mode === 'lines') {
      next = raw.split('\n').filter((l) => l.trim() && !mark.test(l)).join('\n') + '\n'
    } else {
      const out = []
      let dropping = false
      for (const line of raw.split('\n')) {
        if (/^##\s+验收\s*$/.test(line)) { dropping = true; continue }
        if (dropping && /^#{1,2}\s/.test(line)) dropping = false
        if (!dropping) out.push(line)
      }
      next = out.join('\n')
    }
    fs.copyFileSync(file, file + '.pre-purge-' + stamp)
    fs.writeFileSync(file, next)
    console.log(`  · 收回${what}里的验收标记（备份 .pre-purge-${stamp}）`)
  }
}

async function main() {
  console.log(`验收目标：${BASE}  部署：${DEPLOY}\n`)
  await groupA()
  await groupB()
  await groupC()
  if (!READ_ONLY) await groupD()
  else console.log('跳过 [D] 写路径（--read-only：不往线上实例的她生活里造条目）')
  await groupE()
  await groupF()
  purgeOwnMarkers()
  await groupG()

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
