/**
 * 鱼缸控制台数据层 —— 世界页（world:bili-account）的数据面。
 *
 * 2026-10-31 主人拍板「功能聚合成一个控制中心」：原独立面板（panel/ 8447，移植期权宜）
 * 的全部能力搬进 Cortico WebUI 的世界页。数据面**复用 dsh 的现成模块**（timeline/drafts/
 * feedback/vitals/审批），这里只做宿主侧的加载与降级，不复制业务逻辑。
 *
 * 两档加载：本地文件（fields/causal/kill）同步直读；dsh 模块动态 import + 缓存，
 * 未预热时灯显 loading（lamps 语义允许），World.start() 与每次 webUi() 都会补火。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadState, readMood, describeState } from './personaAdapter.ts'

const ROOT = process.env.BILI_WHALE_ROOT || 'E:/WorkSpace_Qoder/dsh-bili-whale'
// home 优先级与 dsh `tools/lib/paths.mjs:resolveWhaleHome` 一致（WHALE_HOME → DSH_HOME → ~/.dsh）。
// 少一档就会读另一个 home：页上的意见箱列表来自 dsh 模块（它认 DSH_HOME），计数却来自这里，两处会不自洽。
const WHALE = process.env.WHALE_HOME || process.env.DSH_HOME || path.join(process.env.USERPROFILE || '', '.dsh')
const FIELDS_FILE = path.join(WHALE, 'bili-whale', 'fields.json')
const CAUSAL_FILE = path.join(WHALE, 'bili-whale', 'causal.jsonl')
const KILL_FILE = path.join(WHALE, 'bili-whale', 'control', 'kill')
const FEEDBACK_FILE = path.join(WHALE, 'bili-whale', 'control', 'feedback.jsonl')
const DRAFTS_DIR = process.env.BILI_DRAFTS || path.join(WHALE, 'bili-whale', 'drafts')
const AVATAR_FILE = path.join(WHALE, 'avatar.png')
const NEEDS = new Set(['pending', 'failed', 'cooldown', 'dry-run'])

// ── dsh 模块缓存（动态 import，找不到/坏了 = 各能力单独降级） ────────────────
type Mods = {
  data?: { timeline: (h: string, o?: object) => any; diary: (h: string) => any; vitals: (o: any) => any }
  drafts?: { collectDrafts: (o: any) => any }
  feedback?: { listFeedback: () => any; resolveFeedback: (id: string, by: string) => any }
  approve?: { approveFromPanel: (o: any) => Promise<any>; reject: (id: string) => any }
  traffic?: { trafficGuard: () => any }
}
const mods: Mods = {}
let warming: Promise<void> | null = null

async function warm(): Promise<void> {
  if (warming) return warming
  warming = (async () => {
    const load = async <K extends keyof Mods>(key: K, rel: string) => {
      if (mods[key]) return
      try { mods[key] = (await import(pathToFileURL(path.join(ROOT, rel)).href)) as any } catch { /* 单能力降级 */ }
    }
    await Promise.all([
      load('data', 'panel/data.js'),
      load('drafts', 'panel/drafts.mjs'),
      load('feedback', 'panel/feedback.mjs'),
      load('approve', 'scripts/dynamic-approve.mjs'),
      load('traffic', 'tools/lib/traffic.mjs'),
    ])
  })()
  return warming
}
/** World.start() 与 webUi() 调它；已预热时立即返回。 */
export function warmConsole(): Promise<void> { return warm() }
export const consoleReady = () => !!(mods.data && mods.drafts && mods.feedback && mods.approve && mods.traffic)

// ── 本地直读（同步、缺文件不炸） ───────────────────────────────────────────
const readJson = (p: string): any => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }

export function lastTickAt(): string | null {
  try {
    const lines = fs.readFileSync(CAUSAL_FILE, 'utf8').trim().split('\n')
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try { const e = JSON.parse(lines[i]); if (e.at) return String(e.at) } catch {}
    }
  } catch {}
  return null
}

export function pendingDraftCount(): number {
  try {
    return fs.readdirSync(DRAFTS_DIR).filter((f) => f.endsWith('.json')).reduce((n, f) => {
      try { return NEEDS.has(readJson(path.join(DRAFTS_DIR, f))?.status) ? n + 1 : n } catch { return n }
    }, 0)
  } catch { return 0 }
}

/**
 * 意见箱未解决数。折叠规则归 dsh 模块所有：同 id 出现 `kind:'feedback-resolved'` 行 = 已解决，
 * 原始条目永不删（历史可回放）。模块未预热时按同一条规则本地兜底——
 * 原先"后写覆盖再判 `!e.resolved`"是错的：resolved 行本身没有 resolved 字段，
 * 会让已解决项永久计入未解决灯。
 */
export function openFeedbackCount(file?: string): number {
  if (!file && mods.feedback) {
    try { return (mods.feedback.listFeedback()?.items ?? []).filter((x: any) => !x.resolved).length } catch { return 0 }
  }
  const resolved = new Set<string>()
  const open = new Set<string>()
  try {
    for (const line of fs.readFileSync(file ?? FEEDBACK_FILE, 'utf8').split('\n').filter(Boolean)) {
      let e: any
      try { e = JSON.parse(line) } catch { continue }
      if (!e?.id) continue
      if (e.kind === 'feedback-resolved') { resolved.add(String(e.id)); open.delete(String(e.id)) }
      else if (e.kind === 'feedback') open.add(String(e.id))
    }
  } catch { return 0 }
  return open.size
}

export function tankLocal() {
  const state = (() => { try { return loadState(FIELDS_FILE) } catch { return null } })()
  if (!state) return { ok: false, error: 'fields.json 读不到', fields: null, mood: null }
  const mood = readMood(state)
  return {
    ok: true,
    fields: state.fields,
    mood: {
      primary: mood.primary,
      secondary: mood.secondary?.slice(0, 2).join(' · ') || null,
      cause: mood.reason || null,
    },
    described: describeState(state),
    lastAppliedAt: state.lastAppliedAt ?? null,
  }
}

export function killOn(): boolean { return fs.existsSync(KILL_FILE) }

// ── 发送策略（单一事实源 = dsh 的 bili-whale.config.json，主人 2026-10-31 拍板） ──
const CONFIG_FILE = process.env.BILI_WHALE_CONFIG || path.join(WHALE, 'bili-whale.config.json')

export function policyState(file = CONFIG_FILE): { policy: any; file: string; exists: boolean } {
  const cfg = readJson(file) ?? {}
  return { policy: readPolicyLite(cfg), file, exists: fs.existsSync(file) }
}

export function policySet(patch: any, file = CONFIG_FILE): { ok: boolean; policy?: any; error?: string } {
  if (!patch || typeof patch !== 'object') return { ok: false, error: '缺策略对象' }
  const cfg = readJson(file) ?? {}
  const next = {
    ...cfg,
    publish: { ...(cfg.publish ?? {}), ...pick(patch.publish ?? {}, ['draftMode', 'autoDailyCap', 'autoWindow']) },
    permissions: { ...(cfg.permissions ?? {}), ...pick(patch.permissions ?? {}, ['like', 'fav', 'dmReply']) },
  }
  // 读回时统一收敛（readPolicy 语义）：写进去的必须先合法
  const normalized = readPolicyLite(next)
  next.publish = { draftMode: normalized.draftMode, autoDailyCap: normalized.autoDailyCap, autoWindow: normalized.autoWindow }
  next.permissions = { like: normalized.like, fav: normalized.fav, dmReply: normalized.dmReply }
  try {
    const tmp = file + '.' + process.pid + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8')
    fs.renameSync(tmp, file)
    return { ok: true, policy: normalized }
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) } }
}

const pick = (o: any, keys: string[]) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]))

/** 与 dsh tools/lib/publish-policy.mjs 的 readPolicy 同语义（TS 侧一份小镜像，值语义在此测试锁）。 */
export function readPolicyLite(cfg: any) {
  const p = cfg?.publish ?? {}
  const t = cfg?.permissions ?? {}
  return {
    draftMode: p.draftMode === 'auto' ? 'auto' : 'review',
    autoDailyCap: Math.max(0, Number(p.autoDailyCap ?? 0) || 0),
    autoWindow: typeof p.autoWindow === 'string' ? p.autoWindow.trim() : '',
    like: t.like === 'review' ? 'review' : 'self',
    fav: t.fav === 'review' ? 'review' : 'self',
    dmReply: t.dmReply === 'queue' ? 'queue' : 'direct',
  }
}

/** 时段判断（与 dsh 侧同规则：空/非法=不限，支持跨午夜）。 */
export function policyInWindow(now: Date, spec: string): boolean {
  const m = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(String(spec ?? '').trim())
  if (!spec || !m) return true
  const a = hm2(m[1]); const b = hm2(m[2])
  if (a === null || b === null) return true
  const cur = now.getHours() * 60 + now.getMinutes()
  return a <= b ? (cur >= a && cur < b) : (cur >= a || cur < b)
}
const hm2 = (s: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null }

/**
 * 草稿自带的一次性令牌（出稿时 draft-dynamic 就入队了）。只给 auto 分支用：
 * **不铸造、不续期** —— 缺失/过期/已用/不匹配一律 null，auto 退回人工放行。
 * 令牌值只在本进程内使用，绝不写进 causal、面板响应或日志。
 */
/**
 * 草稿自带且仍有效的一次性令牌（出稿时 draft-dynamic 就入队了）。只给 auto 用：
 * **不铸造、不续期** —— 缺失/过期/已用/绑定不符一律 null，auto 退回人工。
 * 令牌值只在本进程内使用，绝不写进 causal、面板响应或日志。
 */
export function freshAckToken(draft: { id: string; ackId: string } | null, whaleHome = WHALE): string | null {
  try {
    const ackId = String(draft?.ackId ?? '')
    if (!ackId) return null
    const pend = readJson(path.join(whaleHome, 'bili-whale', 'control', 'pending', ackId + '.json')) as any
    if (!pend?.token || pend.used || Number(pend.expiresAt ?? 0) <= Date.now()) return null
    if (String(pend.payload?.draftId ?? '') !== String(draft?.id ?? '')) return null
    return String(pend.token)
  } catch { return null }
}

/**
 * 今天这一份草稿（磁盘事实源 `<day>.json`）。auto 用它拿 draftId，
 * 不从工具 stdout 正则抠 id —— 她写进日记/稿子里的文本不该能指向别的草稿（安全席 P1）。
 */
export function draftForDay(day: string, draftsDir = DRAFTS_DIR): { id: string; textHash: string; ackId: string; status: string } | null {
  try {
    const d = readJson(path.join(draftsDir, day + '.json')) as any
    if (!d?.id) return null
    return { id: String(d.id), textHash: String(d.textHash ?? ''), ackId: String(d.ackId ?? ''), status: String(d.status ?? '') }
  } catch { return null }
}

/**
 * 今天已经 auto 发过几条。attempts=true 把**失败尝试**也计入：
 * 否则"失败不占额度"会让 autoDailyCap 被反复失败绕过（安全席 P1）。
 */
export function autoSentToday(opts: { attempts?: boolean; file?: string; day?: string } = {}): number {
  const { attempts = false, file = CAUSAL_FILE, day = new Date().toLocaleDateString('sv-SE') } = opts
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).reduce((n, l) => {
      try {
        const e = JSON.parse(l)
        if (e?.kind === 'auto-publish' && String(e?.at ?? '').slice(0, 10) === day && (attempts || e?.ok)) return n + 1
      } catch {}
      return n
    }, 0)
  } catch { return 0 }
}

export function feedbackListSafe(): { ok: boolean; items?: any[]; error?: string } {
  if (!mods.feedback) return { ok: false, error: 'feedback 模块未预热' }
  try {
    const r = mods.feedback.listFeedback() ?? {}
    return { ok: true, items: r.items ?? [] }
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) } }
}

// ── dsh 数据面（invoke 里用；模块未就绪时显式报错，不装成功） ──────────────
export async function timelineState(cursor = 0, limit = 50) {
  await warm()
  if (!mods.data) return { ok: false, error: 'panel/data 未加载（BILI_WHALE_ROOT 指错？）' }
  return mods.data.timeline(WHALE, { cursor, limit })
}
export async function diaryState() {
  await warm()
  if (!mods.data) return { ok: false, error: 'panel/data 未加载' }
  return mods.data.diary(WHALE)
}
export async function draftsState() {
  await warm()
  if (!mods.drafts) return { ok: false, error: 'panel/drafts 未加载' }
  return mods.drafts.collectDrafts({ whaleHome: WHALE })
}
export async function draftAction(id: string, action: 'approve' | 'reject') {
  await warm()
  if (!mods.approve) return { ok: false, error: 'dynamic-approve 未加载' }
  return action === 'reject'
    ? mods.approve.reject(id)
    : await mods.approve.approveFromPanel({ id })
}
export async function feedbackResolve(id: string) {
  await warm()
  if (!mods.feedback) return { ok: false, error: 'feedback 模块未加载' }
  return mods.feedback.resolveFeedback(id, 'webui')
}
export async function vitalsState() {
  await warm()
  if (!mods.data || !mods.traffic) return { ok: false, error: 'vitals 依赖模块未加载' }
  return mods.data.vitals({
    whaleHome: WHALE,
    home: path.dirname(WHALE),
    traffic: mods.traffic.trafficGuard(),
    schedStatusGetter: () => ({ ok: false, reason: 'Cortico 宿主：节奏由状态驱动，无独立时钟' }),
  })
}
export function avatarBinary(): { mime: string; base64: string } | null {
  try {
    const buf = fs.readFileSync(AVATAR_FILE)
    return { mime: 'image/png', base64: buf.toString('base64') }
  } catch { return null }
}

/** 发布通道状态：undefined=未预热，null=读失败，否则 {paused, hint}。 */
export function trafficStatus(): { paused: boolean; hint: string } | null | undefined {
  if (!mods.traffic) return undefined
  try {
    const s = mods.traffic.trafficGuard().status() ?? {}
    const raw = s.until
    const until = typeof raw === 'number' ? raw : Date.parse(String(raw ?? '')) || 0
    const paused = until > Date.now()
    return {
      paused,
      hint: paused
        ? `写操作暂停至 ${new Date(until).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
        : '额度正常',
    }
  } catch { return null }
}
export const consolePaths = { ROOT, WHALE, FIELDS_FILE, DRAFTS_DIR, FEEDBACK_FILE, AVATAR_FILE }
export { readJson }
