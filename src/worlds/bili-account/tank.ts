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
const WHALE = process.env.WHALE_HOME || path.join(process.env.USERPROFILE || '', '.dsh')
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

/** 意见箱未解决数：jsonl 按 id 后写覆盖（add/resolve 同 id 一行）。 */
export function openFeedbackCount(): number {
  let open = 0
  try {
    const byId = new Map<string, any>()
    for (const line of fs.readFileSync(FEEDBACK_FILE, 'utf8').split('\n').filter(Boolean)) {
      try { const e = JSON.parse(line); if (e?.id) byId.set(String(e.id), e) } catch {}
    }
    for (const e of byId.values()) if (!e.resolved) open += 1
  } catch {}
  return open
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
