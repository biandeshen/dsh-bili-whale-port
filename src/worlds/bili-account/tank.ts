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
  approve?: { approveFromPanel: (o: any) => Promise<any>; reject: (id: string, reason?: string) => any }
  traffic?: { trafficGuard: () => any }
  /** dsh 的统一配置层，只为「全部配置」页签取 DEFAULTS（哪些键是声明过的）。缺它不降级报错，只标"未声明"。 */
  cfg?: { DEFAULTS: any; configPath?: string }
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
      load('cfg', 'tools/lib/config.mjs'),
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
  // 测试上下文里禁止写真配置：2026-11-01 01:23 正式配置出现过一次没人承认的 draftMode=auto 写入
  // （7799 免口令 + 测试能碰到生产路径）。要测就显式传临时文件，否则宁可红。
  if (file === CONFIG_FILE && process.env.NODE_TEST_CONTEXT) return { ok: false, error: '测试里必须显式传临时路径，不许写正式配置' }
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

/**
 * 主人让她怎么称呼自己：只认 `owner.displayName`。
 * 不回落 `owner.name`——那字段是角色标签（现值"主人"），拿它当昵称会在下次启动时改掉她的口吻。
 * 没配就沿用代码里的默认称呼。
 */
export function ownerNameFromConfig(file = CONFIG_FILE): string {
  return String(readJson(file)?.owner?.displayName ?? '').trim()
}

/**
 * 她在这一页叫什么：来自配置 `self.name`（现值是她 B 站账号名，主人也可能只当本机称呼用）。
 * 每次渲染现读，改了不用重启就能看到标题跟着变；空/读不到时回落到默认称呼，不做二次判断。
 * 注意：这一格改的是**本机称呼**。B 站昵称是账号字段，要真改必须一次账号写操作 + 二次确认，
 * 这一页不替主人动账号；宿主导航上那个名字在 deployments/<bot>/config.json，是另一个来源。
 */
export function personaNameFromConfig(file = CONFIG_FILE): string {
  const v = String(readJson(file)?.self?.name ?? '').trim()
  return v.slice(0, 24) || '小鱼'
}

/**
 * 改名字。本机名字（配置 self.name）与 B站昵称是两件事：本机名字影响标题与提示词，
 * B站昵称别人看得见。页面一次只改一处，由调用方说明改的是哪种。
 * 与 settingsSet 同一条规矩：测试里不许写正式配置。
 */
export function renameSelf(name: string, file = CONFIG_FILE): { ok: boolean; name?: string; error?: string } {
  if (file === CONFIG_FILE && process.env.NODE_TEST_CONTEXT) return { ok: false, error: '测试里必须显式传临时路径，不许写正式配置' }
  const next = String(name ?? '').trim().slice(0, 24)
  if (!next) return { ok: false, error: '名字不能是空的：留空等于让她没有名字。' }
  const cfg = readJson(file) ?? {}
  const out = { ...cfg, self: { ...(cfg.self ?? {}), name: next } }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(out, null, 2))
    fs.renameSync(tmp, file)
  } catch (e: any) { return { ok: false, error: `写不进去：${String(e?.message ?? e)}` } }
  return { ok: true, name: next }
}

// ── 全部配置（只读总览）：主人要求"每一项都看得见"，不是去翻 JSON 文件 ──────────
const GROUP_LABEL: Record<string, string> = {
  owner: '主人', self: '她自己', preferences: '口味词表', quota: '额度上限', risk: '风控节奏',
  persona: '人设与轮次', publish: '发送策略', permissions: '权限档位', notify: '通知',
  media: '配音与视频', session: '会话', feeds: '信息流', tools: '工具路径',
  toolsPath: '工具路径', home: '数据目录', night: '夜间行为（插件时代遗留，待查实）',
  clock: '时钟（插件时代遗留，待查实）', diary: '日记', listen: '监听与直播', share: '自动分享',
  sessionRotateDays: '会话轮换天数', personaOncePerSession: '人设每轮注入一次',
}
/** 这些键 Cortico 只在启动时读一次，改完必须重启才生效（页面上要说清，别让人改了以为没生效）。 */
const RESTART_KEYS = new Set(['owner.displayName', 'owner.name', 'owner.mid', 'self.name', 'self.mid', 'home', 'toolsPath'])
/** 策略六项在页面最上方那组控件里改（那边有档位护栏与 auto 留痕），不走通用一格一改。 */
const POLICY_KEYS = new Set(['publish.draftMode', 'publish.autoDailyCap', 'publish.autoWindow', 'permissions.like', 'permissions.fav', 'permissions.dmReply'])

export interface SettingsItem { key: string; value: unknown; group: string; editable: boolean; editVia: 'policy' | 'settings' | null; needsRestart: boolean; declared: boolean }

const hasPath = (o: any, path: string) => path.split('.').reduce((acc: any, k) => (acc && typeof acc === 'object' ? acc[k] : undefined), o) !== undefined

/**
 * 摊平成一行一项，并标出三项读者最关心的事实：页面上能不能改、要不要重启、dsh 的 DEFAULTS 里有没有声明。
 * `declared:false` 不是错误——它表示这个键只存在于用户的 JSON 里，框架默认值没写它（规格里的 P0 项）。
 */
export function settingsOverview(user: any, declared: any): { total: number; undeclared: number; groups: { group: string; label: string; items: SettingsItem[] }[] } {
  const items: SettingsItem[] = []
  const walk = (o: any, prefix: string) => {
    for (const [k, v] of Object.entries(o ?? {})) {
      const key = prefix ? `${prefix}.${k}` : k
      if (v && typeof v === 'object' && !Array.isArray(v)) { walk(v, key); continue }
      const group = key.split('.')[0]
      // 能改的不是"我列出来的那几个"，而是"任何标量叶子"——主人要的是全部可见且可改，
      // 白名单少列一项就是一个必须去翻文件的漏洞。策略六项走上方那组控件（有护栏与留痕），
      // 路径类（home/toolsPath）只能在文件里改：改错会把她的家搬走。
      const kind = typeOf(v)
      const scalar = kind === 'number' || kind === 'boolean' || kind === 'string' || kind === 'array'
      const denied = DENY_KEYS.has(key) || DENY_PREFIX.some((p) => key.startsWith(p))
      const editVia = POLICY_KEYS.has(key) ? 'policy' : scalar && !denied ? 'settings' : null
      items.push({ key, value: v, group, editable: editVia !== null, editVia, needsRestart: RESTART_KEYS.has(key), declared: hasPath(declared, key) })
    }
  }
  walk(user, '')
  const byGroup = new Map<string, SettingsItem[]>()
  for (const it of items) {
    const arr = byGroup.get(it.group) ?? []
    arr.push(it)
    byGroup.set(it.group, arr)
  }
  return {
    total: items.length,
    undeclared: items.filter((i) => !i.declared).length,
    groups: [...byGroup.entries()].map(([group, groupItems]) => ({ group, label: GROUP_LABEL[group] ?? group, items: groupItems })),
  }
}

/** 数据面：配置文件 + dsh 的 DEFAULTS。config 模块没预热时按"未声明"标注，不假称已声明。 */
export function settingsState(): { ok: boolean; file: string; total: number; undeclared: number; groups: { group: string; label: string; items: SettingsItem[] }[] } {
  const user = readJson(CONFIG_FILE) ?? {}
  return { ok: true, file: CONFIG_FILE, ...settingsOverview(user, mods.cfg?.DEFAULTS ?? {}) }
}

/**
 * 页面改值（#49）。主人原话："我要所有配置都可以见到，而不是直接去改配置文件。"
 * 可见不等于随便写，所以这里有三条硬规则：
 *   ① 路径/身份类（home、toolsPath）与策略六项（publish.* / permissions.*）不在这里写
 *      —— 前两者改错会把她的整个家搬走，后六项走发送策略那格（那里有 auto 的留痕与档位护栏）；
 *   ② 值必须过类型与范围校验（按现值或 dsh 默认值推类型），非法值拒并说清哪坏了；
 *   ③ 测试上下文不许写正式配置（与 policySet 同一条，2026-11-01 01:23 那次盲写的教训）。
 */
const DENY_KEYS = new Set(['home', 'toolsPath'])
const DENY_PREFIX = ['publish.', 'permissions.']
/** 名字类：与 persona-core/src/naming.ts 一样 24 字封顶，别把叙事提示词撑爆。 */
const NAME_KEYS = new Set(['self.name', 'owner.displayName'])
/**
 * 次数/额度/间隔类：这类值负数没有意义。命名尾巴必须覆盖实际配置里的写法——
 * 2026-11-01 真机点了一次 listen.commentIntervalSec=-5 竟然写进去了，
 * 因为原来的表只列了 Seconds/Ms，没列 Sec 与 Interval/Gap。
 */
const COUNT_RE = /(Hourly|Daily|PerDay|PerHour|Cap|Max|Min|Count|Limit|Interval|Gap|Days|Hours|Minutes|Seconds|Sec|Ms|Msec|Millis)$/

function typeOf(v: unknown): 'number' | 'boolean' | 'string' | 'array' | 'object' | 'undefined' {
  if (v === undefined) return 'undefined'
  if (Array.isArray(v)) return 'array'
  if (typeof v === 'number') return 'number'
  if (typeof v === 'boolean') return 'boolean'
  if (typeof v === 'string') return 'string'
  return 'object'
}

/** 校验并归一一个值；返回 {value} 或 {error}（错误要能直接给人看懂，不写"invalid"）。 */
function coerceValue(key: string, rawValue: unknown, current: unknown): { value?: unknown; error?: string } {
  const kind = typeOf(current) === 'undefined' ? typeOf(rawValue) : typeOf(current)
  if (kind === 'object' || kind === 'undefined') return { error: `${key} 是嵌套对象或还不存在，这一格改不了 —— 那种结构请直接看文件，别在页面上半改。` }
  if (kind === 'number') {
    const n = typeof rawValue === 'number' ? rawValue : Number(String(rawValue).trim())
    if (!Number.isFinite(n)) return { error: `${key} 要的是数字，收到的是「${String(rawValue)}」。` }
    if (COUNT_RE.test(key) && (!Number.isInteger(n) || n < 0)) return { error: `${key} 要的是「0 或更大的整数」（次数/额度/天数类），收到 ${String(rawValue)}。` }
    return { value: n }
  }
  if (kind === 'boolean') {
    const s = String(rawValue).trim().toLowerCase()
    if (rawValue === true || s === 'true' || s === '1' || s === 'on') return { value: true }
    if (rawValue === false || s === 'false' || s === '0' || s === 'off' || s === '') return { value: false }
    return { error: `${key} 是开关，只能真或假，收到「${String(rawValue)}」。` }
  }
  if (kind === 'array') {
    const list = (Array.isArray(rawValue) ? rawValue : String(rawValue).split(/[、,，·|]/)).map((x) => String(x).trim()).filter(Boolean)
    if (list.length > 20) return { error: `${key} 最多 20 项，现在 ${list.length} 项。` }
    if (list.some((x) => x.length > 40)) return { error: `${key} 每一项不能超过 40 字。` }
    return { value: list }
  }
  const text = String(rawValue ?? '').trim()
  const cap = NAME_KEYS.has(key) ? 24 : 500
  if (NAME_KEYS.has(key) && !text) return { error: `${key} 不能是空的：名字留空等于让她没有名字。` }
  if (text.length > cap) return { error: `${key} 最长 ${cap} 字，现在 ${text.length} 字。` }
  return { value: text }
}

export interface SettingsChange { key: string; from: unknown; to: unknown; needsRestart: boolean }
export function settingsSet(patch: any, file = CONFIG_FILE): { ok: boolean; changed?: SettingsChange[]; error?: string; settings?: ReturnType<typeof settingsOverview> } {
  if (file === CONFIG_FILE && process.env.NODE_TEST_CONTEXT) return { ok: false, error: '测试里必须显式传临时路径，不许写正式配置' }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, error: '缺少要改的键值对象' }
  const keys = Object.keys(patch)
  if (!keys.length) return { ok: false, error: '没有要改的键' }
  if (keys.length > 12) return { ok: false, error: `一次最多改 12 项（这次 ${keys.length} 项），分批改才看得出哪一项坏了。` }
  const cfg = readJson(file) ?? {}
  const declared = mods.cfg?.DEFAULTS ?? {}
  const changes: SettingsChange[] = []
  const next = structuredClone(cfg)
  for (const key of keys) {
    if (DENY_KEYS.has(key) || DENY_PREFIX.some((p) => key.startsWith(p))) {
      const why = DENY_PREFIX.some((p) => key.startsWith(p)) ? '那几项在「发送策略」那格改（有档位护栏和 auto 留痕）' : '路径类改错会把她的家搬走，必须手工改文件并重启'
      return { ok: false, error: `${key} 不在这里改：${why}。` }
    }
    const current = key.split('.').reduce((acc: any, k) => (acc && typeof acc === 'object' ? acc[k] : undefined), cfg)
    const declaredValue = key.split('.').reduce((acc: any, k) => (acc && typeof acc === 'object' ? acc[k] : undefined), declared)
    const c = coerceValue(key, patch[key], current === undefined ? declaredValue : current)
    if (c.error) return { ok: false, error: c.error }
    if (current === c.value) continue
    const parts = key.split('.')
    let node = next
    for (const p of parts.slice(0, -1)) node = node[p] ??= {}
    node[parts.at(-1)!] = c.value
    changes.push({ key, from: current, to: c.value, needsRestart: RESTART_KEYS.has(key) })
  }
  if (!changes.length) return { ok: true, changed: [], settings: settingsOverview(next, declared) }
  try {
    const tmp = file + '.' + process.pid + '.settings-tmp'
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8')
    fs.renameSync(tmp, file)
    return { ok: true, changed: changes, settings: settingsOverview(readJson(file) ?? {}, mods.cfg?.DEFAULTS ?? {}) }
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) } }}


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
export async function draftAction(id: string, action: 'approve' | 'reject', reason = '') {
  await warm()
  if (!mods.approve) return { ok: false, error: 'dynamic-approve 未加载' }
  // #41：主人写的那句话要一路传到她能看到的地方（草稿 + 因果账），留空就如实是留空。
  const why = String(reason ?? '').trim().slice(0, 300)
  return action === 'reject'
    ? mods.approve.reject(id, why)
    : await mods.approve.approveFromPanel({ id, why })
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
