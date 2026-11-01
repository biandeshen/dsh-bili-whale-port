/** B站账号 World：只读 + 草稿 + 场值情绪。所有对外写操作只入队，不发送。 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describeTools, type WorldContext, type WorldDefinition, type WorldSection } from '../../world.ts'
import { extensionsDir, readInstalled } from '../../extensions.ts'
import { repoRoot } from '../../paths.ts'
import type { DescribeText, ToolDescribe, ToolOutcome, WorldWebUiDecl } from '../../core/types.ts'
import { canDraft, draftRefusal, canApplyWatched, watchedRefusal, violationNotice, diaryFresh, diaryRefusal } from './gates.ts'
import { upsertDiarySection, sectionStats, diaryDefaultHeader, paginateDiary, diaryHeadings, summarizeDiaryRange } from './diary.ts'
import { loadState, saveState, applyEffects, remember, rememberFirst, describeStateWithTrace, applyRecall, recentWatch, annotateFeed, findMemories, voidMemory, PRESETS, WATCH_VERDICTS } from './personaAdapter.ts'
import type { WatchVerdict } from './personaAdapter.ts'
import type { PresetEffect } from './personaAdapter.ts'
import { buildVoiceBrief } from '../../../persona-core/src/voice-brief.ts'
import { pickActivities, ACTIVITY_LABELS } from '../../../persona-core/src/life-activities.ts'
import { ownerName, setOwnerName } from '../../../persona-core/src/naming.ts'
import { readQueue, writeQueue, newTask, dueTasks, markDelivered, markAttempt, prune, expireStale, type QueueTask } from './task-queue.ts'
import { parseDmPeek } from './dm.ts'
import { dmAutoPlan, noteInboxRead, noteInbound } from './dm-reply.ts'
import type { Language } from '../../core/language.ts'
import {
  warmConsole, consoleReady, tankLocal, killOn, lastTickAt, pendingTotal, openFeedbackCount,
  timelineState, diaryState, draftsState, draftAction, feedbackResolve, feedbackListSafe, judgmentList, judgmentAdopt, judgmentReject, judgmentActive, vitalsState, avatarBinary, trafficStatus,
  policyState, policySet, policyInWindow, autoSentToday, draftForDay, freshAckToken, ownerNameFromConfig, personaNameFromConfig, hostDisplayName, settingsState, settingsSet, renameSelf,
  consolePaths,
} from './tank.ts'
import { decideAction, restRecoveryDelta, actionCost, nextCheckDelay, dayKey, MIN_GAP_MS } from '../../../persona-core/src/rhythm.ts'

const ROOT = process.env.BILI_WHALE_ROOT || 'E:/WorkSpace_Qoder/dsh-bili-whale'
const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url))
const BILI = path.join(ROOT, 'tools', 'bili.mjs')
// home 优先级与 dsh `tools/lib/paths.mjs:resolveWhaleHome` 一致（WHALE_HOME → DSH_HOME → ~/.dsh）；
// 少一档就会和 dsh 子进程读不到同一片数据。
const WHALE = process.env.WHALE_HOME || process.env.DSH_HOME || path.join(process.env.USERPROFILE || '', '.dsh')
const FIELDS_FILE = path.join(WHALE, 'bili-whale', 'fields.json')
const ROUND_FILE = path.join(WHALE, 'bili-whale', 'control', 'round.json')
const LIFE_FILE = path.join(WHALE, 'bili-whale', 'control', 'life.json')
const LEGACY_RHYTHM_FILE = path.join(WHALE, 'bili-whale', 'control', 'rhythm.json')
const LIFE_STATUS_FILE = path.join(WHALE, 'bili-whale', 'control', 'life-status.json')
const QUEUE_FILE = path.join(WHALE, 'bili-whale', 'control', 'queue.json')
const PUBLIC_DIARY = path.join(WHALE, 'whale-diary.md')
const PRIVATE_DIARY = path.join(WHALE, 'whale-diary-private.md')
const killPath = path.join(WHALE, 'bili-whale', 'control', 'kill')
const CAUSAL_FILE = path.join(WHALE, 'bili-whale', 'causal.jsonl')
const DM_APPLIED_FILE = path.join(WHALE, 'bili-whale', 'control', 'dm-applied.json')

function readAppliedDmKeys(): string[] {
  try {
    const raw = JSON.parse(fs.readFileSync(DM_APPLIED_FILE, 'utf8'))
    return Array.isArray(raw?.keys) ? raw.keys.map(String) : []
  } catch { return [] }
}
function writeAppliedDmKeys(keys: string[]): void {
  try {
    fs.mkdirSync(path.dirname(DM_APPLIED_FILE), { recursive: true })
    const tmp = DM_APPLIED_FILE + '.' + process.pid + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify({ keys: keys.slice(-200) }, null, 2))
    fs.renameSync(tmp, DM_APPLIED_FILE)
  } catch {}
}
const ROUND_STALE_MS = 12 * 3600_000
function readLifeFile(): any {
  try { return JSON.parse(fs.readFileSync(LIFE_FILE, 'utf8')) } catch {}
  // 旧文件迁移：只取新字段，别把 wakesToday/lastWakeAt 再写回去
  try {
    const old = JSON.parse(fs.readFileSync(LEGACY_RHYTHM_FILE, 'utf8'))
    return { ...old, actionsToday: old.actionsToday ?? old.wakesToday ?? 0, lastActionAt: old.lastActionAt ?? old.lastWakeAt, wakesToday: undefined, lastWakeAt: undefined }
  } catch { return {} }
}
function writeLifeFile(o: any) {
  try {
    fs.mkdirSync(path.dirname(LIFE_FILE), { recursive: true })
    const tmp = LIFE_FILE + '.' + process.pid + '.' + Math.random().toString(36).slice(2, 8) + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(o, null, 2))
    fs.renameSync(tmp, LIFE_FILE)
  } catch {}
}
/**
 * 从 append-only 因果链数某个逻辑日的行动。
 * 并发实例会把 life.json 的 actionsToday 覆盖回旧值（D-32）：启动时以因果链对账，只增不减。
 * 读失败按 0 处理——不能因为没有账本就阻止她启动。
 */
export function countCausalActions(file: string, day: string): { count: number; lastAt: number } {
  let count = 0
  let lastAt = 0
  let raw = ''
  try { raw = fs.readFileSync(file, 'utf8') } catch { return { count, lastAt } }
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line)
      if (e?.kind !== 'action') continue
      const at = Number(e.atMs)
      if (!Number.isFinite(at) || dayKey(at) !== day) continue
      count += 1
      if (at > lastAt) lastAt = at
    } catch {}
  }
  return { count, lastAt }
}
let round: { feedAt?: number; debriefed?: boolean; bvid?: string; debriefedAt?: number } = readRound()
if (round.feedAt && Date.now() - round.feedAt > ROUND_STALE_MS) round = {}

function readRound() {
  try { return JSON.parse(fs.readFileSync(ROUND_FILE, 'utf8')) } catch { return {} }
}
function writeRound(o: any) {
  try {
    fs.mkdirSync(path.dirname(ROUND_FILE), { recursive: true })
    const tmp = ROUND_FILE + '.' + process.pid + '.' + Math.random().toString(36).slice(2, 8) + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(o, null, 2))
    fs.renameSync(tmp, ROUND_FILE)
  } catch {}
}
const ATOMIC_FIELDS = ['energy', 'stimulation', 'connection', 'social', 'mood', 'curiosity', 'creativity'] as const

/** 模型传来的 custom 效果是外部输入：只收 7 个原子场、|delta|≤0.5、最多 8 条。 */
export function sanitizeEffects(input: any): PresetEffect[] {
  if (!Array.isArray(input)) return []
  const out: PresetEffect[] = []
  for (const e of input.slice(0, 8)) {
    const field = String(e?.field ?? '')
    const delta = Number(e?.delta)
    if (!(ATOMIC_FIELDS as readonly string[]).includes(field)) continue
    if (!Number.isFinite(delta) || Math.abs(delta) > 0.5) continue
    // 来源固定成 custom：不接受模型自己填的 source（否则能伪造成 masterReplied 骗过情绪/回流判断）
    out.push({ field: field as PresetEffect['field'], delta, source: 'custom', priority: 5 })
  }
  return out
}
/**
 * 因果账。写失败不许吞：autoSentToday 就是数这个文件里的条目，吞掉等于 autoDailyCap 形同虚设，
 * 而且她/主人在时间线上都看不到"这件事发生过"。所以失败往上抛，由调用方决定是拒绝还是亮红。
 *
 * `actor` 是署名：这份账有两个写者（宿主结算与 CLI 的 dm/草稿），事后查"这条是谁做的"
 * 只能靠它。历史条目没有这个字段（补不回来），新写入一律带上。
 */
function causal(o: any): void {
  fs.mkdirSync(path.dirname(CAUSAL_FILE), { recursive: true })
  fs.appendFileSync(CAUSAL_FILE, JSON.stringify({ at: new Date().toISOString(), actor: 'host', ...o }) + String.fromCharCode(10))
}

/**
 * 正当"变更已经发生、只是记账失败"时用：手头的结果照常返回，同时把失败挂上去给主人看。
 * 不能因为账本坏了就把已经改好的配置说成没改，也不能假装记上了。
 */
function withLedgerError<T extends { ok?: boolean; error?: string }>(result: T, entry: any): T {
  try { causal(entry); return result }
  catch (e: any) {
    const note = `因果账写不进去：${String(e?.message ?? e)}（这次改动已经生效，但时间线上不会有这条）`
    return { ...result, ok: false, error: result.error ? `${result.error}；${note}` : note }
  }
}
function readCausal(): any[] {
  try {
    return fs.readFileSync(CAUSAL_FILE, 'utf8').split(String.fromCharCode(10)).slice(-2000)
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l) } catch { return null } })
      .filter(Boolean)
  } catch { return [] }
}

/** 从 debrief 回执里抠出能当记忆的内容：标题 + UP 主。解析不出来就返回空。 */
export function parseDebriefMemory(receipt: string): { title: string; up: string } | null {
  const text = String(receipt ?? '')
  const title = (text.match(/^标题:\s*(.+)$/m) || [])[1]
  if (!title) return null
  const up = (text.match(/^UP:\s*(\S+)/m) || [])[1] ?? ''
  return { title: title.trim().slice(0, 120), up: up.trim() }
}

/**
 * 看完一条视频就记一条。记忆不写进去，「有连续记忆」就只是文档里的话：
 * 她第二天看到的是空 memories，describeState 也不会带出任何往事。
 * 编码强度按当时的刺激量（Yerkes-Dodson 峰在 0.6），所以特别上头的片子记得更牢。
 */
function rememberWatch(state: any, receipt: string, bvid: string): any {
  const parsed = parseDebriefMemory(receipt)
  if (!parsed) return state
  const content = `看过《${parsed.title}》` + (parsed.up ? `（${parsed.up}）` : '') + ` —— ${bvid}`
  return remember(state, content, {
    sender: 'npc',
    intensity: Math.max(0.1, Math.min(1, state.fields.stimulation)),
    tags: [],
    source: 'npc_self',
  })
}

// 草稿目录只认 tank.ts 那一条解析：面板、badge、灯、CLI 必须读同一个数，
// 以前两处各写一份，第二份漏了旧路径，于是 badge 报「待放行=0」而面板列得出草稿。
const DRAFTS_DIR = consolePaths.DRAFTS_DIR

/** 公开日记的尾部：给"记得"当情境词，让召回跟今天写的事有关，而不是永远最鲜活三条。 */
function diaryTail(n = 2000): string {
  try { return fs.readFileSync(PUBLIC_DIARY, 'utf8').slice(-n) } catch { return '' }
}

/**
 * 策略切成 auto 时她该看到什么。纯函数，便于不碰真日记文件也能锁住措辞。
 * 存在的理由：7799 本机免口令，任何本地进程都能 POST 改策略；盲改必须留下她自己也读得到的痕迹。
 */
export function exportPolicyNotice(policy: { draftMode?: string; autoDailyCap?: number; autoWindow?: string }): { heading: string; body: string } | null {
  if (policy?.draftMode !== 'auto') return null
  const cap = Number(policy.autoDailyCap) > 0 ? `${policy.autoDailyCap} 条` : '不限'
  const win = String(policy.autoWindow ?? '').trim() || '不限'
  return {
    heading: '策略变了',
    body: `发送策略被切到 auto：从现在起我的草稿不等主人点头就会发出去（每日上限 ${cap}，时段 ${win}）。`
      + `\n- 这不是我改的，我也改不了：只有这台机器上的进程能这么写。`
      + `\n- 如果主人没打算让我自动发，去「发送策略」改回人工审核，或者拉 kill。`,
  }
}

/**
 * 给她的状态描述，并把这一轮**真的想起来**的记忆写回（accessCount +1、鲜活度上升）。
 * 面板的只读路径不走这里——看她的状态不该改变她的记忆。
 */
function statePrompt(state: any, opts: { queryText?: string; seed?: string } = {}): string {
  const { text, recalledIds } = describeStateWithTrace(state, 5, opts)
  if (recalledIds.length) saveState(FIELDS_FILE, applyRecall(state, recalledIds))
  return text
}

/** 今天是否已经出过草稿（多醒几轮时不重复出稿）。 */
function todayDraftLine(): string {
  try {
    const date = dayKey(Date.now())
    const d = JSON.parse(fs.readFileSync(path.join(DRAFTS_DIR, date + '.json'), 'utf8'))
    const zh: Record<string, string> = { pending: '等你审批', 'dry-run': '试发过', sent: '已发出', rejected: '被拒', cooldown: '冷却中', failed: '失败' }
    return `今天已经出过草稿（${d.id} · ${zh[d.status] ?? d.status}）——这一轮不用再出稿，写日记、看看就好。`
  } catch { return '' }
}

/** 审批结果回写游标：记到哪一条已经吃掉了，避免重复结算。 */
const DRAFT_RESULT_FILE = path.join(WHALE, 'bili-whale', 'control', 'draft-result.json')
function readDraftResultCursor(): number {
  try { return Number(JSON.parse(fs.readFileSync(DRAFT_RESULT_FILE, 'utf8')).consumedAt) || 0 } catch { return 0 }
}
function writeDraftResultCursor(at: number) {
  try {
    fs.mkdirSync(path.dirname(DRAFT_RESULT_FILE), { recursive: true })
    const tmp = DRAFT_RESULT_FILE + '.' + process.pid + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify({ consumedAt: at }, null, 2))
    fs.renameSync(tmp, DRAFT_RESULT_FILE)
  } catch {}
}

/**
 * 自我修正的落地：审批结果由 dynamic-approve.mjs 写进 causal（kind=draft-result），
 * 这里在醒来时**由代码**结算成 draftApproved / draftRejected 并落盘。
 * 不指望模型自觉调 mood_apply —— 它不调，被拒稿就永远不影响她下次的选择。
 */
export function consumeDraftResults(state: any, entries: any[], cursor: number): { state: any; consumedAt: number; applied: string[] } {
  const fresh = entries
    .filter((e) => e && e.kind === 'draft-result' && Number.isFinite(Date.parse(String(e.at))) && Date.parse(String(e.at)) > cursor)
    .sort((a, b) => Date.parse(String(a.at)) - Date.parse(String(b.at)))
  if (!fresh.length) return { state, consumedAt: cursor, applied: [] }
  let next = state
  const applied: string[] = []
  const RESULT_LINE: Record<string, string> = {
    sent: '主人把我那条草稿发出去了',
    rejected: '主人没让发那条草稿',
    failed: '那条草稿想发没发出去（网络/风控），不是主人拒的',
    cooldown: '那条草稿还在本地冷却，暂时发不了',
  }
  for (const e of fresh) {
    // 一次审批只影响一次心情；同一批里取最近一条，避免积压的旧稿一次性灌爆场值
    const preset = e.result === 'sent' ? 'draftApproved' : e.result === 'rejected' ? 'draftRejected' : null
    if (preset) applied.push(preset)
    // 四种结果都进记忆：以前 failed/cooldown 等于没发生，她既记不住"发不出去"，也不会去查原因。
    // 只有第一次点亮 flashbulb，之后同类结果是重复刺激，不该一直"刻在心里"。
    const base = RESULT_LINE[String(e.result)]
    // #41：她要从被拒里学习，光知道"没通过"学不到东西。理由来自主人放行/拒绝时写的那句
    // （dsh 把它记进 draft-result 因果账）。没写就如实说没写，绝不替主人编一个原因。
    const reason = String((e as any).reason ?? '').trim()
    const line = base ? (reason ? `${base}（主人的理由：${reason}）` : (e.result === 'rejected' ? `${base}（主人没写理由——别替他想一个）` : base)) : ''
    if (line) next = rememberFirst(next, `${line}（${e.draftId ?? ''}）`, `draft-${e.result}`, { sender: 'npc', intensity: 0.6, source: 'npc_self' })
  }
  const last = applied[applied.length - 1]
  if (last) {
    next = applyEffects(next, PRESETS[last].effects, PRESETS[last].description + `（${fresh[fresh.length - 1].draftId ?? ''}）`, { source: last })
  }
  return { state: next, consumedAt: Date.parse(String(fresh[fresh.length - 1].at)), applied }
}

/** 上一条草稿的审批结果，如果她还没用 mood_apply 消化，就在醒来时提醒一次。 */
function latestDraftFeedback(state: any): string {  try {
    const drafts = fs.readdirSync(DRAFTS_DIR).filter((f) => f.endsWith('.json')).map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(DRAFTS_DIR, f), 'utf8')) } catch { return null }
    }).filter(Boolean)
    const done = drafts
      .filter((d: any) => d.status === 'sent' || d.status === 'rejected')
      .sort((a: any, b: any) => Date.parse(b.result?.at || b.rejectedAt || 0) - Date.parse(a.result?.at || a.rejectedAt || 0))[0]
    if (!done) return ''
    const at = Date.parse(done.result?.at || done.rejectedAt || '')
    const last = [...state.chain].reverse().find((e: any) => e.source === 'draftApproved' || e.source === 'draftRejected')
    if (last && last.timestamp.getTime() >= at) return ''
    // #41：提醒里也带理由——她醒来第一眼看到的就该是"主人为什么没让发"。
    const why = String((done as any).rejectReason ?? '').trim()
    const note = String((done as any).ownerNote ?? '').trim()
    return done.status === 'sent'
      ? `上次那条草稿（${done.id}）主人放行了${note ? `，他说：「${note}」` : ''}——记得用 bili_mood_apply {"preset":"draftApproved"} 记下来。`
      : `上次那条草稿（${done.id}）主人没让发${why ? `，理由：「${why}」` : '（他没写理由，别自己编一个）'}——用 bili_mood_apply {"preset":"draftRejected"} 记下来，想想是不是选题偏了。`
  } catch { return '' }
}

/** 异步执行，避免长任务（debrief 最长 240s）阻塞 Cortico 事件循环。 */
const runNodeAsync = (script: string, args: string[], timeout = 180000, extraEnv: Record<string, string> = {}): Promise<{ status: number; out: string }> => {
  if (fs.existsSync(killPath)) return Promise.resolve({ status: -2, out: '[blocked] kill switch is on' })
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      windowsHide: true,
      env: { ...process.env, WHALE_HOME: WHALE, ...extraEnv },
    })
    let out = ''
    let done = false
    const finish = (status: number, extra = '') => {
      if (done) return
      done = true
      resolve({ status, out: (out + extra).slice(0, 12000) })
    }
    const timer = setTimeout(() => { try { child.kill() } catch {}; finish(-1, '\n[timeout]') }, timeout)
    child.stdout?.on('data', (d) => { if (out.length < 200_000) out += d })
    child.stderr?.on('data', (d) => { if (out.length < 200_000) out += d })
    child.on('error', (e) => { clearTimeout(timer); finish(-1, '\n' + String(e.message || e)) })
    child.on('close', (code) => { clearTimeout(timer); finish(code ?? -1) })
  })
}
const runAsync = (args: string[], timeout = 180000) => runNodeAsync(BILI, args, timeout)

// ── 手脚清单：她要先看得见自己有什么手脚，才提得出有依据的选择 ──────────────
/** Core 给的工具表条目；owner 是提供方（World id 或 'persona'）。 */
interface AssembledTool { name: string; description: string; tags: readonly string[]; owner: string }

const TAG_TEXT: Record<string, string> = { read: '读', write: '写', speak: '说', act: '动', flow: '排', snapshot: '快照' }
const tagLine = (tags: readonly string[]): string => (tags.map((t) => TAG_TEXT[t] ?? t).join('·') || '没标')

/** 包名里的类别段：`cortico-world-<id>` 这类命名是约定，加载器认的是包导出的 id，所以这里只当推测。 */
const PKG_ID = /^(?:@[^/]+\/)?cortico-(?:world|provider|bot)-([a-z0-9][a-z0-9._-]*)$/

function readJsonSafe(file: string): any {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

/**
 * 她此刻有什么手脚：装配好的工具表 + 已装扩展 + 这份部署的开关。全部来自磁盘与 Core 的只读查询，
 * 输出是给人看的文本；启用、安装、改配置都不在这件事的能力范围里，所以这份清单不给任何写路径。
 */
export function capabilityText(src: {
  /** 宿主没接入 listTools 时为 null：只能报自己声明的那一份，并说明看不见别的 World。 */
  assembled: readonly AssembledTool[] | null
  /** Core 的装配表（id + 可见性 + 它自己声明的工具数）；宿主没接 listWorlds 时为 null，退回从工具表反推并自报是推断。 */
  worlds: readonly { id: string; visible: boolean; tools: number }[] | null
  /** 本 World 的自描述（名字 + 给人看的一句话 + 标签）。 */
  mine: readonly ToolDescribe[]
  extDir: string
  configFile: string | null
}): string {
  const zh = new Map<string, string>()
  for (const t of src.mine) {
    const s = t.summary
    const line = (typeof s === 'string' ? s : (s?.zh ?? s?.en) ?? t.description).split('\n')[0].trim()
    zh.set(t.name, line)
  }
  const out: string[] = [
    '【我的手脚 · 只读清单】',
    '（这份清单我只能用眼睛看：启用扩展、装扩展、改配置都不是我能做的事，只有主人在 WebUI 里做。）',
    '',
  ]

  out.push('一、这一轮真的能调的工具')
  if (src.assembled) {
    const grouped = new Map<string, AssembledTool[]>()
    for (const t of src.assembled) {
      const list = grouped.get(t.owner)
      if (list) list.push(t)
      else grouped.set(t.owner, [t])
    }
    out.push(`（共 ${src.assembled.length} 个；标签：读=不改东西，其余（写/说/动/排/快照）都会动东西或留下记录）`)
    for (const [owner, tools] of grouped) {
      out.push(`〔${owner}〕`)
      for (const t of tools) out.push(`- ${t.name} · ${zh.get(t.name) ?? t.description.split('\n')[0].trim()} · ${tagLine(t.tags)}`)
    }
    const missing = src.mine.filter((t) => !src.assembled!.some((a) => a.name === t.name))
    if (missing.length) out.push(`〔bili-account 声明过但这一轮没有〕${missing.map((t) => t.name).join('、')} —— World 被停用，或改了配置没重启。`)
  } else {
    out.push(`（共 ${src.mine.length} 个，只有我这个 World 的：宿主没给整份工具表，别的 World 有什么我看不到）`)
    for (const t of src.mine) out.push(`- ${t.name} · ${zh.get(t.name) ?? t.description} · ${tagLine(t.tags)}`)
  }

  const cfg = src.configFile ? readJsonSafe(src.configFile) : null
  const mountedByTools = new Set((src.assembled ?? []).map((t) => t.owner))
  const mountTable = new Map((src.worlds ?? []).map((w) => [w.id, w]))
  // 宿主没接挂载表时才退回"从工具表反推"，并且必须自报这是推断：只出画面/事件的 World
  // 在工具表里根本不存在，反推会把"挂着"说成"没挂"（11-01 figure 实测报错过一次）。
  const inferredMount = src.worlds == null
  /** 这个 World 这轮挂没挂：挂载表优先；没表时只能看它在工具表里露过面没有。 */
  const isMounted = (id: string): boolean => mountTable.has(id) || (inferredMount && mountedByTools.has(id))
  /** 它露了几个工具：null = 说不清（既没挂载表，工具表里也没见过它）。 */
  const toolCount = (id: string): number | null => mountTable.get(id)?.tools ?? (mountedByTools.has(id) ? 1 : null)
  const mountLine = (id: string): string => {
    if (!isMounted(id)) return inferredMount ? '这轮没挂（从工具表反推的，看不见它未必代表没挂）' : '这轮没装配'
    const n = toolCount(id)
    const vis = mountTable.get(id)?.visible
    return `这轮挂着${n ? `，露 ${n} 个工具` : '，但它不出工具（画面/事件类），工具表里看不见它'}${vis === false ? '；对这轮模型不可见' : ''}`
  }
  const providerKinds = new Set<string>(Object.values((cfg?.providers ?? {}) as Record<string, any>).map((p) => String(p?.kind ?? '')))
  const activeBot = src.configFile ? String(readJsonSafe(path.join(path.dirname(src.configFile), 'deployment.json'))?.bot ?? '') : ''
  const worldSwitches = new Map<string, boolean>()
  for (const [id, section] of Object.entries((cfg?.worlds ?? {}) as Record<string, any>)) {
    if (section && typeof section === 'object' && typeof section.enabled === 'boolean') worldSwitches.set(id, section.enabled)
  }

  out.push('', `二、装在这台机器上的扩展（${src.extDir}）`)
  let deps: Array<{ name: string; spec: string }> | null = null
  try {
    deps = readInstalled(src.extDir)
  } catch (e: any) {
    out.push(`- 读不到这个目录的 package.json：${String(e?.message ?? e)}`)
  }
  if (deps && deps.length === 0) out.push('- 一个都没有：这份部署没装扩展，能用的只有仓内自带的 World 与 Provider。')
  for (const d of deps ?? []) {
    const pkg = readJsonSafe(path.join(src.extDir, 'node_modules', ...d.name.split('/'), 'package.json'))
    if (!pkg) {
      out.push(`- ${d.name} · 登记在 package.json（${d.spec}），但 node_modules 里没有这个包 = 没装上，需要主人重装`)
      continue
    }
    const kind = String((pkg.cortico as any)?.kind ?? '类别不明')
    const guess = PKG_ID.exec(d.name)?.[1] ?? ''
    let state: string
    if (kind === 'world' && guess) {
      if (isMounted(guess)) state = toolCount(guess) ? '这轮挂上了（它给我的工具就在上面那张表里）' : '这轮挂上了，但它不出工具（画面/事件类），所以工具表里看不到它'
      else if (worldSwitches.get(guess) === true) state = `配置里 worlds.${guess}.enabled=true，但这轮没装配：改动要重启，或它加载失败`
      else if (worldSwitches.get(guess) === false) state = `装了，但这份部署没启用（worlds.${guess}.enabled=false）`
      else state = `装了，但这份部署没有 worlds.${guess} 这一项 = 没启用`
    } else if (kind === 'provider' && guess) {
      state = providerKinds.has(guess) ? '有端点在用它' : `装了，但没有端点选它（providers 里没有 kind=${guess}）`
    } else if (kind === 'bot') {
      state = activeBot && activeBot === d.name ? '这份部署正在用它' : `装了，但这份部署的代码包是「${activeBot || '未记'}」`
    } else {
      state = '装了；包名推不出 id（或不认识这个类别），启用与否要主人到扩展页看'
    }
    out.push(`- ${d.name} · ${kind} · ${pkg.version ?? '版本不明'} · ${state}`)
  }

  out.push('', '三、这份部署的 World 开关（config.json 的 worlds.*）')
  if (!src.configFile) out.push('- 没拿到部署目录（ctx 缺席），读不到 config.json')
  else if (!cfg) out.push(`- 读不到 ${src.configFile}（这份部署还没写过配置文件）`)
  else if (worldSwitches.size === 0) out.push('- config.json 里没有 worlds 段：哪些 World 挂上由 bot 的默认值决定（这轮挂上的见第一节〔〕分组）')
  for (const [id, on] of worldSwitches) out.push(`- ${id} · ${on ? '开' : '关'} · ${mountLine(id)}`)

  // 口径按能力事实写：装/卸扩展、改配置归主人；**启用/停用**主人让她自己在扩展页点。
  // 以前这里一句"别自己改"把后者也否掉了，跟她被明确告知的授权相反（f-af013b）。
  out.push('', `（来源：工具表=Core 这一轮装配的结果；扩展=${path.join(src.extDir, 'package.json')}；开关=${src.configFile ?? '无'}。`
    + '装/卸扩展和改配置归主人；启用或停用某个已装的扩展，主人让过她自己到扩展页点。'
    + '想试某个扩展、或哪一项看起来该开，先在 bili_feedback 里写一句，让主人知道。）')
  return out.join('\n')
}

const TOOL_SUMMARIES: Record<string, DescribeText> = {
  bili_traffic: { zh: '读取请求预算/熔断状态', en: 'Read traffic budget state.' },
  bili_feed: { zh: '拉取候选视频（只读）', en: 'Fetch candidate videos (read-only).' },
  bili_debrief: { zh: '读懂一条视频（只读）', en: 'Understand one video (read-only).' },
  bili_diary_read: { zh: '分页读日记：一页几天，回执会写明整本还有多少没给（别把一页当全部）', en: 'Read diaries by page; the receipt states what is still unserved.' },
  bili_mood_read: { zh: '读取她此刻的场值与情绪（含成因）', en: 'Read her fields and current emotion with cause.' },
  bili_mood_apply: { zh: '按事件更新场值（预设或自定义）', en: 'Apply emotional effects after an event.' },
  bili_draft_dynamic: { zh: '生成动态草稿（不发送）', en: 'Create a dynamic draft (never posts).' },
  bili_diary_append: { zh: '写日记（公开/私人两本）：同日同名小节整节替换（回执「已替换」），新小节才追加（回执「已追加」），没有增量模式', en: 'Write a diary section (replace-if-exists, append-if-new; receipt says which).' },
  bili_dm_read: { zh: '看主人有没有来信（只读，失败不当成没人写信）', en: 'Check for new owner DMs (read-only; failure is not emptiness).' },
  bili_dm_reply: { zh: '回主人的私信（直接发送；被拒才退回草稿队列等放行）', en: 'Reply to the owner (sends directly; falls back to the draft queue only if refused).' },
  bili_feedback: { zh: '她的意见箱：add 记一条问题 / list 看清单 / resolve 标已解决（本地文件，不联网、不发帖）', en: 'Local issue box: add / list / resolve (never touches Bilibili).' },
  bili_like: { zh: '给她看完觉得好的视频点赞（自己发，过风控）', en: 'Like a video she enjoyed (self-sent, traffic-guarded).' },
  bili_fav: { zh: '收藏视频（自己发；五条判据+每天 3 条上限，不过就拒）', en: 'Favorite a video (self-sent; five criteria + 3/day cap, refuses on failure).' },
  bili_capabilities: { zh: '看清自己此刻有什么手脚：能调的工具（读/写）、装着的扩展、这份部署的开关（只读；装/卸与改配置归主人，启用/停用她自己能点）', en: 'List the tools callable now, the installed extensions and this deployment\'s world switches (read-only; install and config belong to the owner, enable/disable is hers to toggle).' },
  bili_alarm: { zh: '给自己设闹钟：到点带着那句话醒来，重启后也照响', en: 'Set an alarm for herself that survives restarts.' },
  bili_memory_void: { zh: '更正记忆：写错的那条可以盖作废章（不再被想起，但原文留着可复盘）；只准点名一条', en: 'Void one wrongly-recorded memory (it stops being recalled; text kept for review).' },
  bili_judgment: { zh: '判断卡：把你对片子的判断落成结构化的一条（立场+词+理由），主人在世界页采纳后才影响 feed；采纳与驳回只有主人能点', en: 'File a structured judgment card (stance + tokens + reason); it affects the feed only after the owner adopts it.' },
  bili_look: { zh: '真的看一眼片子的画面：封面 / 九宫格 / 字幕条，图随回执一起交回；模型不收图时回执会明说，别描述没看见的东西', en: 'Actually look at a video\'s pictures (cover / frame sheet / subtitle strip); images come back with the receipt. If the model does not accept images the receipt says so — do not describe what you did not see.' },
}

const DECLS = [
  { name: 'bili_traffic', description: 'Bilibili request-budget state (read-only).', tags: ['read'], parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'bili_feed', description: 'Fetch candidate videos from the feed (read-only).', tags: ['read'], parameters: { type: 'object', properties: { n: { type: 'number', description: 'How many candidates (1-6)' } }, additionalProperties: false } },
  { name: 'bili_debrief', description: 'Understand one video via subtitles, danmaku, comments (read-only).', tags: ['read'], parameters: { type: 'object', properties: { bvid: { type: 'string' } }, required: ['bvid'], additionalProperties: false } },
  { name: 'bili_diary_read', description: "Read her diaries BY PAGE (read-only). One call = one page of day-blocks (newest first) plus a header stating how many days/chars the whole book has and whether this page is the end. Never assume a page is the whole book: if the header says 还剩 N 块, ask for the next page or a date. Call it without filters first: the receipt lists the section headings this book has.", tags: ['read'], parameters: { type: 'object', properties: { book: { type: 'string', enum: ['public', 'private', 'both'], description: '默认 both' }, page: { type: 'number', description: '第几页（0 起，按天从新到旧）' }, days: { type: 'number', description: '每页几天（1-30，默认 3）' }, budget: { type: 'number', description: '每页字数上限（200-9000，默认 4000）' }, date: { type: 'string', description: '只取某一天 YYYY-MM-DD（给了就忽略 page）' }, heading: { type: 'string', description: '只要这个小节（如 看过 / 想说 / 今日指标），可与 date 一起用；回执会写清有多少天有这一节' }, summary: { type: 'boolean', description: '只给统计不给正文：区间内的天数、看过几个 BV、想说几节、判断小节里收/不收各几条。用来回答「这周判了多少」' }, from: { type: 'string', description: 'summary 用：起始日 YYYY-MM-DD' }, to: { type: 'string', description: 'summary 用：截止日 YYYY-MM-DD' } }, additionalProperties: false } },
  { name: 'bili_mood_read', description: "Read her current emotion (fields + cause + label) plus what she recalls. Recalling marks those memories as thought-of-again: they get clearer.", tags: ['read'], parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'bili_mood_apply', description: 'Apply emotional effects after an event. Optionally record which life activity you picked and a short note. For watchedVideo, say what you actually concluded with verdict (keep / drop / unclear); without it nothing is counted as a positive.', tags: ['write'], parameters: { type: 'object', properties: { preset: { type: 'string', description: 'watchedVideo | masterReplied | masterSilentDay | draftApproved | draftRejected | trafficPaused' }, verdict: { type: 'string', enum: ['keep', 'drop', 'unclear'], description: '只给 watchedVideo 用：你这条到底收不收。keep=收 / drop=不收 / unclear=无从判断（不传按 unclear 记，不替你判成喜欢）' }, custom: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, delta: { type: 'number' }, source: { type: 'string' } }, required: ['field', 'delta', 'source'] } }, note: { type: 'string', description: '一句留给自己的话（会写进记忆）' }, activity: { type: 'string', enum: ['rest', 'explore', 'create', 'social', 'reflect', 'exercise', 'consume'], description: '这轮挑的生活活动 id' } }, additionalProperties: false } },
  { name: 'bili_draft_dynamic', description: "Create a dynamic draft from today's diary and an unused image. Never posts.", tags: ['write'], parameters: { type: 'object', properties: { force: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'bili_diary_append', description: "Write a section into one of her diaries (public/private). Policy is FIXED: same day+heading = WHOLE-section replace (receipt says 已替换); a heading not yet present = append as a NEW section (receipt says 已追加). There is no incremental append — rewrite the whole section each time.", tags: ['write'], parameters: { type: 'object', properties: { book: { type: 'string', enum: ['public', 'private'], description: 'public = 给人看的；private = 只给自己看的偏好校准' }, heading: { type: 'string', description: '小节标题，如 看过 / 想说 / 今日指标 / 本轮留下的判断' }, text: { type: 'string', description: '这一节的正文（markdown）' } }, required: ['book', 'heading', 'text'], additionalProperties: false } },
  { name: 'bili_dm_read', description: "Check whether 主人 (the owner) sent a new DM since last check. Read-only: never sends or marks anything read on Bilibili; advances only her local cursor. If reading fails it says so — it is NOT the same as 'no message'.", tags: ['read'], parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'bili_dm_reply', description: "Reply to 主人's latest DM. Sends directly (owner DMs are auto-approved since 2026-10-31; still traffic-guarded); if the send is refused it falls back to the local draft queue. Requires having read a message first.", tags: ['write'], parameters: { type: 'object', properties: { text: { type: 'string', description: '回信正文（≤500 字，第一人称）' } }, required: ['text'], additionalProperties: false } },
  { name: 'bili_feedback', description: "Her local issue box (never touches Bilibili): add = report a tool/system problem in one sentence (you do NOT fix code); list = show open items; resolve = mark one resolved (yours or owner's). Use it instead of silently enduring defects.", tags: ['write'], parameters: { type: 'object', properties: { action: { type: 'string', enum: ['add', 'list', 'resolve'] }, issue: { type: 'string', description: '一句话现象（≤500 字）' }, severity: { type: 'string', enum: ['low', 'high'], description: 'high = 卡住主链路；low = 体验瑕疵' }, note: { type: 'string', description: '你已如何对治（可选）' }, selfHandled: { type: 'boolean', description: '你自己已绕开/对治 = true' }, id: { type: 'string', description: 'resolve 时必填（先 list）' } }, additionalProperties: false } },
  { name: 'bili_like', description: "Like a video she actually enjoyed (self-sent since 2026-10-31, still traffic-guarded). A like is a light signal — no cap, but do not like everything.", tags: ['write'], parameters: { type: 'object', properties: { bvid: { type: 'string' }, reason: { type: 'string', description: '为什么赞（一句话，写进偏好账）' } }, required: ['bvid'], additionalProperties: false } },
  { name: 'bili_fav', description: "Add a video to her favorites (self-sent since 2026-10-31). Five criteria still apply and the tool REFUSES when they fail: reason ≥6 chars, ≤3/day, no repeat within 30 days, ≤2 per kind unless better. A refusal is final — do not retry.", tags: ['write'], parameters: { type: 'object', properties: { bvid: { type: 'string' }, reason: { type: 'string', description: '为什么留（≥6 字）' }, better: { type: 'boolean', description: '比同类别已收的明显更好时置 true' } }, required: ['bvid', 'reason'], additionalProperties: false } },
  { name: 'bili_capabilities', description: 'Inventory of her own capabilities right now, one line each: every tool actually callable this turn (name + one-line function + read/write tag), every extension package installed on this machine with its enabled state, and this deployment\'s world switches. Read-only: it changes, enables and installs nothing.', tags: ['read'], parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'bili_look', description: "Actually look at a video's pictures: cover, the 3x3 frame sheet, or the subtitle strip. The images come back with the receipt so the next request carries them. Only works when the running model accepts images — if it does not, the receipt says so and you must not describe what you did not see. Cheap when the files already exist on disk; otherwise it takes a minute to fetch frames.", tags: ['read'], parameters: { type: 'object', properties: { bvid: { type: 'string', description: '看哪条视频' }, what: { type: 'string', enum: ['cover', 'sheet', 'strip', 'all'], description: 'cover=封面；sheet=九宫格（要跑抽帧）；strip=字幕条（要 --substrip）；all=三样都要' } }, required: ['bvid'], additionalProperties: false } },
  { name: 'bili_alarm', description: "Set an alarm for herself. At that time she wakes up with a bili.action_due event carrying the note, so it works across restarts. Use it when something is worth coming back to (a video she wants to finish, checking whether a reply arrived), not as a timer for its own sake.", tags: ['flow'], parameters: { type: 'object', properties: { minutes: { type: 'number', description: '多少分钟后叫你（1–1440）' }, note: { type: 'string', description: '到点要做什么（一句话，会原样出现在唤醒提示里）' } }, required: ['minutes', 'note'], additionalProperties: false } },
  { name: 'bili_memory_void', description: "Void one memory she now believes was recorded wrongly (local only, never touches Bilibili). The original text stays in her state for later review but stops coming back to mind. She must name ONE memory: an exact id, or a text match that hits exactly one. 0 hits or 2+ hits is REFUSED with the candidate list — never void a pile on a guess, and a refusal is not a bug to retry.", tags: ['write'], parameters: { type: 'object', properties: { id: { type: 'string', description: '记忆 id（从工具上一次给的候选清单里取，最准）' }, match: { type: 'string', description: '正文片段；只有唯一命中才生效' }, reason: { type: 'string', description: '为什么作废（≥6 字，留在条上供她日后复盘）' } }, required: ['reason'], additionalProperties: false } },
  { name: 'bili_judgment', description: "File a judgment card: your own structured conclusion about what to watch more or less of. stance=prefer (soft boost, capped) / avoid (hard drop) / noise (hard drop); tokens are 1-6 words of 2-12 characters; reason needs at least 6 characters. Cards affect nothing until the owner adopts them on the world page — you cannot adopt them yourself, and this tool has no access to the owner's word list.", tags: ['write'], parameters: { type: 'object', properties: { action: { type: 'string', enum: ['add', 'list'], description: '默认 list' }, scope: { type: 'string', enum: ['feed', 'draft', 'dm', 'any'], description: '作用域；本轮 feed 只吃 feed 与 any' }, stance: { type: 'string', enum: ['prefer', 'avoid', 'noise'], description: 'prefer=多给这类（加权）；avoid/noise=直接丢掉这类（硬拦）' }, tokens: { type: 'string', description: '1-6 个词，逗号分隔，每词 2-12 字（如 "助眠,白噪音"）' }, reason: { type: 'string', description: '为什么这么判（≥6 字，≤200 字）' }, bvid: { type: 'string', description: '触发这条判断的那条片子（可选）' } }, additionalProperties: false } },
] as const

/** 自描述与手脚清单共用同一份"给人看的一句话"。 */
const BILI_TOOL_DECLS = describeTools(DECLS, TOOL_SUMMARIES)

class BiliAccountWorld {
  readonly id = 'bili-account'
  private host: any = null
  private dailyTimer: any = null
  private life: any = null
  private queue: QueueTask[] = []

  /** ctx 缺席只发生在测试里直接 new：手脚清单退回默认检出根，其余能力不受影响。 */
  constructor(private readonly ctx: WorldContext<WorldSection> | null = null) {}

  /** 把到期任务推给宿主；成功后标记 delivered，失败按次重试（5 次 dead）。 */
  private async deliverDue(now: number): Promise<void> {
    if (this.host == null) return
    const due = dueTasks(this.queue, now)
    if (!due.length) return
    let changed = false
    for (const t of due) {
      try {
        await this.host.pushEvent({ type: 'bili.action_due', ts: new Date(now).toISOString(), source: 'bili-account', text: t.text }, { trigger: 'flush' })
        this.queue = markDelivered(this.queue, t.id, now)
        changed = true
      } catch (e: any) {
        this.queue = markAttempt(this.queue, t.id)
        changed = true
        try { this.host.log.warn('task deliver failed: ' + String(e?.message ?? e)) } catch {}
      }
    }
    if (changed) {
      this.queue = prune(this.queue, now)
      try { writeQueue(QUEUE_FILE, this.queue) } catch {}
    }
  }

  private enqueue(kind: string, text: string, now: number): void {
    this.queue = prune([...this.queue, newTask(kind, text, now)], now)
    try { writeQueue(QUEUE_FILE, this.queue) } catch {}
  }

  /** 她给自己设的闹钟：走同一条持久队列，所以重启后仍会响；到点是一条 bili.action_due 事件。 */
  private setAlarm(minutes: number, note: string): string {
    const now = Date.now()
    const at = now + minutes * 60_000
    const text = `【闹钟】${note}（${minutes} 分钟后，${new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}）`
    this.enqueue('alarm', text, at)
    return `[alarm] 已设：${minutes} 分钟后叫你 —— ${note}`
  }

  /**
   * 世界页「小鱼 · 鱼缸」—— 2026-10-31 主人拍板功能聚合：原独立面板（panel/8447）
   * 的时间线/审批/意见箱/体征/日记全部收进这一页，与聊天同一个入口。
   * 数据面在 tank.ts（复用 dsh 模块）；浏览器面板在 webui/client.ts。
   */
  webUi(language: Language = 'zh'): WorldWebUiDecl {
    const zh = language !== 'en'
    const t = (a: string, b: string) => (zh ? a : b)
    void warmConsole()

    const tick = lastTickAt()
    const tickAgeMin = tick ? Math.max(0, Math.round((Date.now() - Date.parse(tick)) / 60000)) : null
    const pending = pendingTotal()
    const kill = killOn()
    const tank = tankLocal()
    const ready = consoleReady()
    const life = readLifeFile() ?? {}
    const traffic = trafficStatus()

    const trafficState: 'online' | 'loading' | 'error' | 'offline' =
      traffic === undefined ? 'loading'
      : traffic === null ? 'offline'
      : traffic.paused ? 'error' : 'online'

    return {
      // 标题跟配置里的 self.name 走（每次渲染现读）；工具描述里一律不写名字，
      // 否则改了名字那些句子就成了假话。
      label: t(`${personaNameFromConfig()} · 鱼缸`, `${personaNameFromConfig()} · Tank`),
      lamps: [
        {
          label: t('生活循环', 'Life loop'),
          state: tick === null ? 'offline' : tickAgeMin !== null && tickAgeMin <= 30 ? 'online' : 'offline',
          hint: tick === null ? t('还没动过', 'no activity yet') : t(`${tickAgeMin} 分钟前有动静`, `last activity ${tickAgeMin}m ago`),
        },
        { label: 'kill', state: kill ? 'error' : 'online', hint: kill ? t('已触发——所有写被拦', 'engaged — all writes blocked') : t('未触发', 'not engaged') },
        { label: t('发布通道', 'Publish gate'), state: trafficState, hint: traffic?.hint ?? (trafficState === 'loading' ? t('模块预热中', 'warming up') : undefined) },
        {
          label: t('待审稿', 'Drafts'),
          state: ready ? 'online' : 'loading',
          hint: pending > 0 ? t(`${pending} 条等你放行`, `${pending} awaiting approval`) : t('没有等放行的稿', 'nothing to approve'),
        },
        { label: t('数据面', 'Data plane'), state: ready ? 'online' : 'loading', hint: ready ? t('dsh 模块已就绪', 'dsh modules ready') : t('dsh 模块预热中', 'warming dsh modules') },
      ],
      badges: [
        { label: t('心情', 'Mood'), value: tank.ok ? String(tank.mood?.primary ?? '—') : '—', tone: 'plain' },
        { label: t('今日行动', 'Actions today'), value: Number(life.actionsToday ?? 0), tone: Number(life.actionsToday ?? 0) > 0 ? 'on' : 'plain' },
        { label: t('待放行', 'Pending'), value: pending, tone: pending > 0 ? 'off' : 'on' },
        { label: t('意见箱', 'Issues'), value: openFeedbackCount(), tone: 'plain' },
      ],
      panels: [
        { id: 'tank', title: t('鱼缸', 'Tank'), description: t('她的场值、心情与头像', 'Her fields, mood and avatar'), getMethods: ['state'] },
        { id: 'drafts', title: t('待审稿', 'Drafts'), description: t('放行或拒掉她的动态草稿', 'Approve or reject her dynamic drafts'), getMethods: ['state'] },
        { id: 'timeline', title: t('她的一天', 'Her day'), description: t('因果链事件（只读）', 'Causal events (read-only)'), getMethods: ['state'] },
        { id: 'diary', title: t('日记', 'Diary'), description: t('公开与私人两本', 'Public and private books'), getMethods: ['state'] },
        { id: 'feedback', title: t('意见箱', 'Issues'), description: t('她报的问题与处理', 'Her reported issues'), getMethods: ['state'] },
        { id: 'judgment', title: t('判断卡', 'Judgments'), description: t('她提的判断：采纳后 feed 按它筛，采纳与驳回归你', 'Her judgment cards: adopting one makes the feed follow it'), getMethods: ['state'] },
        { id: 'policy', title: t('发送策略', 'Send policy'), description: t('草稿人工/自动、档位收回、护栏', 'Draft review/auto, tier switches, guardrails'), getMethods: ['state'] },
        { id: 'vitals', title: t('体征', 'Vitals'), description: t('风控额度与今日计数', 'Traffic budget and today counts'), getMethods: ['state'] },
      ],
      invoke: async (panel, method, args) => {
        if (panel === 'tank') {
          if (method === 'state') return tankLocal()
          if (method === 'avatar') {
            const a = avatarBinary()
            if (!a) throw new Error('还没放头像（把 png 放到 whale home 根下的 avatar.png）')
            return { $binary: a }
          }
          throw new Error('unknown method ' + method)
        }
        if (panel === 'drafts') {
          if (method === 'state') return draftsState()
          // args[1] = 主人放行/拒绝时写的那句话（#41，可留空）
          if (method === 'approve') return draftAction(String(args[0]), 'approve', String(args[1] ?? ''))
          if (method === 'reject') return draftAction(String(args[0]), 'reject', String(args[1] ?? ''))
          throw new Error('unknown method ' + method)
        }
        if (panel === 'timeline') {
          if (method === 'state') return timelineState(Number(args[0] ?? 0), Number(args[1] ?? 50))
          throw new Error('unknown method ' + method)
        }
        if (panel === 'diary') {
          if (method === 'state') return diaryState()
          throw new Error('unknown method ' + method)
        }
        if (panel === 'feedback') {
          if (method === 'state') return feedbackListSafe()
          if (method === 'resolve') return feedbackResolve(String(args[0]))
          throw new Error('unknown method ' + method)
        }
        if (panel === 'judgment') {
          // 采纳/驳回只有这一条通道能走到：工具与 CLI 都没有对应入口（见 dsh tools/lib/judgment.mjs 头部红线）。
          if (method === 'state') return { ...(await judgmentList()), active: await judgmentActive() }
          if (method === 'adopt') {
            const r = await judgmentAdopt(String(args[0] ?? ''))
            if (r.ok) causal({ kind: 'judgment-adopted', id: String(args[0] ?? ''), atMs: Date.now() })
            return r
          }
          if (method === 'reject') {
            const r = await judgmentReject(String(args[0] ?? ''), String(args[1] ?? ''))
            if (r.ok) causal({ kind: 'judgment-rejected', id: String(args[0] ?? ''), atMs: Date.now() })
            return r
          }
          throw new Error('unknown method ' + method)
        }
        if (panel === 'vitals') {
          if (method === 'state') return vitalsState()
          throw new Error('unknown method ' + method)
        }
        if (panel === 'policy') {
          if (method === 'state') return { ...policyState(), autoSentToday: autoSentToday(), settings: settingsState() }
          if (method === 'set') {
            const r = policySet(args[0])
            if (!r.ok) return r
            let result = withLedgerError(r, { kind: 'policy-change', policy: r.policy, atMs: Date.now() })
            // 7799 是本机免口令端口：任何本地进程都能 POST 这里，一次盲写就把她从"要我审"变成"她自己发"。
            // 所以 auto 一旦生效必须写进她自己的日记（主人和 her 都看得见），不能只留一条 causal。
            // 写失败要报出来：日记里没有这条，她就不知道自己已经被切到自动发送了。
            if (r.policy?.draftMode === 'auto') {
              const note = exportPolicyNotice(r.policy)
              if (note) {
                try {
                  const day = dayKey(Date.now())
                  const cur = fs.existsSync(PRIVATE_DIARY) ? fs.readFileSync(PRIVATE_DIARY, 'utf8') : ''
                  fs.writeFileSync(PRIVATE_DIARY, upsertDiarySection(cur, { book: 'private', heading: note.heading, body: note.body, date: day }))
                } catch (e: any) {
                  const why = `私人日记写不进去：${String(e?.message ?? e)} —— auto 已生效，但她日记里没有这条记录`
                  result = { ...result, ok: false, error: result.error ? `${result.error}；${why}` : why }
                }
              }
            }
            return result
          }
          // #49：全部配置里除禁改项之外的每一项都能在这一页改，不用去翻 bili-whale.config.json。
          if (method === 'settings/set') {
            const r = settingsSet(args[0])
            if (r.ok && r.changed?.length) {
              return withLedgerError(r, { kind: 'settings-change', changed: r.changed, atMs: Date.now() })
            }
            return r
          }
          // #48：两个名字是两件事——本机名字进标题和提示词，B站昵称别人看得见。
          // 页面分别改，并各自报清改了哪一个；B站 那次是真的账号写，走 rename 命令（有 --dry/--go 与改后复核）。
          if (method === 'name/state') {
            const local = personaNameFromConfig()
            const r = await runNodeAsync(BILI, ['rename', '--status'], 30000)
            const remote = r.status === 0 ? r.out.trim().split('\n').at(-1)?.trim() ?? null : null
            return {
              local,
              // 宿主导航读部署 config.json 的 displayName：页面把它一并露出来，好让主人看见两边是不是同一个名字。
              host: hostDisplayName(this.botConfigFile()),
              remote,
              remoteError: r.status === 0 ? null : String(r.out).trim().slice(0, 200) || `rename 退出码 ${r.status}`,
            }
          }
          if (method === 'name/local') {
            const r = renameSelf(String(args[0] ?? ''), undefined, this.botConfigFile())
            if (r.ok) return withLedgerError(r, { kind: 'name-change', scope: 'local', to: r.name, hostUpdated: r.hostUpdated, atMs: Date.now() })
            return r
          }
          if (method === 'name/bili') {
            const to = String(args[0] ?? '').trim()
            if (!to) return { ok: false, error: '新昵称不能是空的' }
            const r = await runNodeAsync(BILI, ['rename', '--to', to, '--go'], 60000)
            // 真的改成了才记因果账：退出码 0 表示平台复核后的名字就是它。
            const out = { ok: r.status === 0, out: String(r.out).trim().slice(0, 600), code: r.status }
            return r.status === 0 ? withLedgerError(out, { kind: 'name-change', scope: 'bili', to, atMs: Date.now() }) : out
          }
          throw new Error('unknown method ' + method)
        }
        throw new Error('unknown panel ' + panel)
      },
      promptDocs: [{
        key: 'worlds.bili-account.envPrompt',
        title: t('她此刻的身心状态', 'Her state this turn'),
        description: t('每一轮由系统读给她自己的心情、成因、七个状态条、今天发生过的事和想起来的旧事；改这份模板不改她的数据。', 'Renders her own mood, causes, fields, today and recalls each turn. Editing this template does not touch her data.'),
        path: ENV_PROMPT_FILE,
        role: 'envPrompt',
        vars: [{ name: 'bili.state', description: t('系统现算的状态读数文本', 'Rendered state text') }],
      }],
    }
  }

  async start(host: any): Promise<void> {
    this.host = host
    // 称呼只有一个来源（配置 owner.displayName）：情绪独白、禁称表、日记抬头、私信草稿都跟着它
    setOwnerName(ownerNameFromConfig())
    void warmConsole()   // 世界页数据面的 dsh 模块预热（不阻塞启动；未好时灯显 loading）
    this.queue = expireStale(readQueue(QUEUE_FILE), Date.now())
    if (this.queue.some((t) => t.status === 'dead')) { try { writeQueue(QUEUE_FILE, this.queue) } catch {} }
    host.log.info('bili-account ready')

    const writeJsonFile = (f: string, o: any) => {
      try {
        fs.mkdirSync(path.dirname(f), { recursive: true })
        const tmp = f + '.' + process.pid + '.' + Math.random().toString(36).slice(2, 8) + '.tmp'
        fs.writeFileSync(tmp, JSON.stringify(o, null, 2))
        fs.renameSync(tmp, f)
      } catch {}
    }

    // 生活循环：不是定时唤醒，每 3–7 分钟看她想不想做点什么（无聊/想他/歇够了 + 抖动）
    this.life = readLifeFile()
    const today = dayKey(Date.now())
    if (this.life.day !== today) this.life = { ...this.life, day: today, actionsToday: 0 }
    // 并发实例可能把 actionsToday 覆盖回 0（D-32）：用 append-only 因果链对账，只增不减。
    const ledger = countCausalActions(CAUSAL_FILE, today)
    this.life.actionsToday = Math.max(Number(this.life.actionsToday ?? 0), ledger.count)
    this.life.lastActionAt = Math.max(Number(this.life.lastActionAt ?? 0), ledger.lastAt)
    this.life.lastCheckAt = this.life.lastCheckAt || Date.now()
    writeLifeFile(this.life)

    const lifeTick = async () => {
      if (this.host == null) return
      let nextDelay = nextCheckDelay(Math.random)
      try {
        const now = Date.now()
        const mem = this.life
        const today = dayKey(now)
        if (mem.day !== today) { mem.day = today; mem.actionsToday = 0 }
        // 并发实例可能在我们两次 tick 之间把 life.json 写回旧值：每轮对一次账，只增不减。
        const disk = readLifeFile()
        const ledger = countCausalActions(CAUSAL_FILE, today)
        mem.actionsToday = Math.max(
          Number(mem.actionsToday ?? 0),
          disk?.day === today ? Number(disk.actionsToday ?? 0) : 0,
          ledger.count,
        )
        mem.lastActionAt = Math.max(
          Number(mem.lastActionAt ?? 0),
          Number(disk?.lastActionAt ?? 0),
          ledger.lastAt,
        )

        // 每次评估都先让时间真的流逝：场值衰减 + 睡着恢复。
        // （旧实现只在"攒够 0.005"时才写盘，决策一直看上次的旧值，导致刺激量永不下降、再也不会醒）
        const state0 = loadState(FIELDS_FILE)
        // 审批结果由代码结算（不依赖她自觉调用 mood_apply）
        const settled = consumeDraftResults(state0, readCausal(), readDraftResultCursor())
        if (settled.applied.length) {
          writeDraftResultCursor(settled.consumedAt)
          causal({ kind: 'draft-result-consumed', applied: settled.applied, at: new Date().toISOString() })
        }
        const hours = Math.max(0, (now - Date.parse(state0.lastAppliedAt || '')) / 3600_000)
        // 醒着不回体力：一轮行动后至少 6h 没有动作才算睡下，恢复只在睡着时生效。
        // 这不是给她排作息表，而是"刚忙完不会立刻又满血"——醒睡由她自己的动作推导。
        const sinceActionH = mem.lastActionAt ? (now - Number(mem.lastActionAt)) / 3600_000 : Infinity
        const asleep = sinceActionH >= 6
        const recovery = asleep ? restRecoveryDelta(settled.state.fields, hours) : 0
        const restEffects = recovery > 0 ? [{ field: 'energy' as const, delta: recovery, source: 'rest', priority: 2 }] : []
        let state = applyEffects(settled.state, restEffects, '睡着的时候，体力慢慢回来', { source: 'rest', now })
        saveState(FIELDS_FILE, state)
        mem.lastCheckAt = now

        const decision = decideAction({
          fields: state.fields,
          relation: state.npcState?.current ?? 'normal',
          now,
          mem,
          rng: Math.random,
        })

        if (decision.act) {
          let after = applyEffects(state, actionCost(), '她想去做点什么', { source: 'action', now })
          if (decision.kind === 'connect') {
            // 连着几次主动找他都没等到人 → 她会越来越少去等
            mem.connectMisses = Number(mem.connectMisses ?? 0) + 1
            mem.lastMissAt = now
            const lastReply = [...after.chain].reverse().find((e) => e.source === 'masterReplied')
            const silentDays = lastReply ? (now - lastReply.timestamp.getTime()) / 86400_000 : 99
            if (silentDays >= 1 && mem.lastSilentDay !== today) {
              // 又一天没等到他——她自己会难过，不需要别人提醒
              after = applyEffects(after, PRESETS.masterSilentDay.effects, PRESETS.masterSilentDay.description, { source: 'masterSilentDay', now })
              mem.lastSilentDay = today
            }
          }
          mem.actionsToday = Number(mem.actionsToday ?? 0) + 1
          mem.lastActionAt = now
          mem.lastKind = decision.kind
          // 账本会被并发实例覆盖（实测 22:21 动作后 life.json actionsToday 变回 0），
          // causal.jsonl 是 append-only：每次行动都留一条，复盘/门禁以它为准。
          causal({ kind: 'action', actionKind: decision.kind, reason: decision.reason, atMs: now })

          writeLifeFile(mem)   // 先记账再触发：触发后重启不会再补一次
          saveState(FIELDS_FILE, after)
          const fresh = violationNotice(readCausal())
          const feedback = latestDraftFeedback(after)
          const todayDraft = todayDraftLine()
          const activities = pickActivities(after.fields, { now, rng: Math.random, k: 3 })
          // M4 决策钩子：这一轮要是想去看片，先告诉她最近看过什么，别又挑同一路
          const recent = decision.kind === 'explore' ? recentWatch(after) : { bvs: [], ups: [] }
          const recentLine = recent.bvs.length
            ? '最近 7 天看过 ' + recent.bvs.length + ' 条'
              + (recent.ups.length ? '（' + recent.ups.slice(0, 3).join('、') + '）' : '')
              + '——挑片时避开同题材和同 UP。'
            : ''
          this.enqueue('action-due', [
            '【你想做点什么】',
            statePrompt(after, { seed: today }),
            '',
            '起因：' + decision.reason + '。',
            ...(decision.kind === 'connect' ? ['他可能留了话——先 bili_dm_read 看一眼。'] : []),
            recentLine,
            '看完还有余力，可以再挑一件小事：\n' + activities.map((x) => `- [${x.type}] ${x.label.split('{{owner}}').join(ownerName())}：${x.description.split('{{owner}}').join(ownerName())}`).join('\n'),
            '挑好了，在 bili_mood_apply 里带上 activity=<id>，让我记下来。',
            todayDraft,
            feedback,
            fresh,
            '这一轮先看：mood_read → traffic → feed → debrief → 读/写当天两本日记。这几步不能跳。',
            '看完再决定要不要出草稿（第 6 步）；今天已经有稿就不要再出。不想发，就在私人日记里写清原因。',
          ].filter((x) => x !== '').join('\n'), now)
          await this.deliverDue(now)
          host.log.info('action: ' + decision.kind + ' · ' + decision.reason)
        }

        const gapLeft = Math.max(0, Number(mem.lastActionAt || 0) + MIN_GAP_MS - now)
        // 只抽一次延迟：写进文件的"下次评估"和真正 setTimeout 用同一个值
        nextDelay = nextCheckDelay(Math.random)
        const nextCheckAt = now + nextDelay
        writeLifeFile({ ...mem, nextCheckAt })
        writeJsonFile(LIFE_STATUS_FILE, {
          mode: 'state-driven',
          nextWakeAt: Math.max(nextCheckAt, now + gapLeft),
          nextCheckAt,
          actionsToday: mem.actionsToday,
          lastActionAt: mem.lastActionAt ?? null,
          lastKind: mem.lastKind ?? null,
          asleep,
          queuePending: this.queue.filter((t) => t.status === 'pending').length,
          queueDead: this.queue.filter((t) => t.status === 'dead').length,
          updatedAt: new Date(now).toISOString(),
        })
      } catch (e: any) {
        try { host.log.warn('rhythm tick failed: ' + String(e?.message ?? e)) } catch {}
      } finally {
        // 出错也继续排下一轮（否则一次写盘失败就永久停摆）
        this.dailyTimer = setTimeout(lifeTick, nextDelay)
        ;(this.dailyTimer as any)?.unref?.()
      }
    }

    this.dailyTimer = setTimeout(lifeTick, 5000)
    ;(this.dailyTimer as any)?.unref?.()
    host.log.info('life loop armed（每 3–7 分钟看一眼她想不想做点什么；没有作息表、没有定时唤醒）')

    // 崩溃/重启后补投 pending 任务（at-least-once；重复一条提示好过丢掉她的意愿）
    const pending = this.queue.filter((t) => t.status === 'pending').length
    if (pending) host.log.info('task queue: pending=' + pending + '，启动补投')
    this.deliverDue(Date.now()).catch((e: any) => { try { host.log.warn('queue boot deliver failed: ' + String(e?.message ?? e)) } catch {} })

    if (process.env.BILI_ACCOUNT_FORCE_ACTION === '1') setTimeout(() => {
      if (this.host == null) return
      // 手动验证轮：只留 manual 标记，不写 lastKind、不占当日额度（E-10）
      this.life.manualForcedAt = Date.now()
      writeLifeFile(this.life)
      this.enqueue('manual', '【手动验证轮】按 ORIENTATION 走一轮：先 bili_mood_read，再 traffic → feed（n=1）→ debrief（选中的 BV）→ 写今天的两本日记 → draft_dynamic → mood_apply；完成后用中文汇报。', Date.now())
      this.deliverDue(Date.now()).catch((e: any) => this.host?.log.warn('forced action failed', { err: String(e) }))
    }, 5000)
  }

  async stop(): Promise<void> { try { clearTimeout(this.dailyTimer) } catch {}; this.host = null }
  /**
   * 每一轮拼系统前缀时给她读自己的身心状态（含这一轮想起来的旧事，并按"回想"写回记忆）。
   * 之前这里返回 null：控制台对话里的那个她不知道鱼缸里的她心情如何、记得什么——同一个 bot 两套人。
   */
  envPromptVars(): Record<string, string> | null {
    try {
      return { 'bili.state': statePrompt(loadState(FIELDS_FILE), { queryText: diaryTail(), seed: dayKey(Date.now()) }) }
    } catch { return null }
  }

  /**
   * 这一轮她到底能不能看图：既要宿主装配出读图工具（名字里带 read/view/see/analyze + image），
   * 也要当前模型真收图——工具拿得到字节，模型不收等于没看。
   * 任一条件读不到就按看不见处理：宁可少给一条指令。
   */
  /**
   * 这一轮她能不能真看到图。两个条件都成立才算：当前模型收图，且有一个能取到字节的工具。
   *
   * 后半句以前只认「名字里带 read/view/see + image」的宿主工具，于是本 World 自己的
   * `bili_look` 不被承认——能力明明装上了却仍报 false（交接文档 §0 点名的那处误读）。
   * 现在本 World 的读图工具也算数。
   */
  private canSeeImages(): boolean {
    try {
      if (this.host?.modelFacts && !this.host.modelFacts.accepts('image/png')) return false
      const list = typeof this.host?.listTools === 'function' ? this.host.listTools() : null
      if (!list) return false
      return list.some((t: any) => {
        const name = String(t?.name ?? '')
        return /(?:^|_)(?:read|view|see|analyze|look)_?(?:image|at)?/i.test(name) && /image|look|see/i.test(name)
      })
    } catch { return false }
  }

  /** 本部署的 config.json（宿主导航名字在里面）；ctx 缺席时返回 null，调用方按"没有第二个来源"处理。 */
  private botConfigFile(): string | null {
    return this.ctx ? path.join(this.ctx.botDir, 'config.json') : null
  }

  tools() {
    const mk = (decl: any, handler: (args: any) => Promise<string | ToolOutcome>) => ({ ...decl, handler })
    return [
      mk(DECLS[0], async () => (await runAsync(['traffic', 'status'], 60000)).out),
      mk(DECLS[1], async (a) => {
        const n = Math.max(1, Math.min(6, Number(a?.n) || 3))
        const r = await runAsync(['feed', '--n', String(n)])
        round = { feedAt: Date.now(), debriefed: false }
        writeRound(round)
        if (r.status !== 0) return `[bili_feed failed] ${r.out}`
        const bv = (r.out.match(/BV[0-9A-Za-z]{10}/) || [])[0]
        // 日记里的"看过"表未必全（她换过日记/导入过回忆）；再按近 7 天记忆补一层避重
        const annotated = annotateFeed(r.out, recentWatch(loadState(FIELDS_FILE)))
        return annotated + (bv ? `\n\n[NEXT] 立刻调用 bili_debrief，参数 {"bvid":"${bv}"}；成功后才能调用 bili_draft_dynamic。` : '')
      }),
      mk(DECLS[2], async (a) => {
        const bv = String(a?.bvid || '').trim()
        if (!/^BV[0-9A-Za-z]{8,}$/.test(bv)) return '[bili_debrief failed] bvid invalid'
        // f-17767a：debrief 过去硬写「交给 read_image 看」，而这条路从来没有过。
        // 读图能力只有宿主知道（工具是装配出来的），所以这里如实告诉脚本有没有。
        // debrief 不抽帧（慢），只读文字那几路；要看画面她自己调 bili_look——
        // 那条路会把封面/九宫格作为附件交回，模型收图时下一轮才真看见。
        const sees = this.canSeeImages()
        const r = await runNodeAsync(BILI, ['debrief', bv, '--no-frames', '--top', '3', '--comments', '3', '--bucket', '60'], 240000, { BILI_VISION: sees ? '1' : '0' })
        if (r.status === 0 && sees) r.out += `

[NEXT] 想看画面就调 bili_look {"bvid":"${bv}","what":"all"}——封面/九宫格会作为附件交给你，下一轮才看得见。`
        if (r.status === 0) {
          round = { ...round, feedAt: round.feedAt ?? Date.now(), debriefed: true, bvid: bv, debriefedAt: Date.now() }
          writeRound(round)
          causal({ kind: 'watched', bvid: bv })
          // 记忆必须落盘，否则"有连续记忆"永远只是文档里的话
          const withMem = rememberWatch(loadState(FIELDS_FILE), r.out, bv)
          saveState(FIELDS_FILE, withMem)
        }
        return r.status === 0 ? r.out : `[bili_debrief failed] ${r.out}`
      }),
      mk(DECLS[3], async (a) => {
        // #56：整本拼接 + slice(0,12000) 会让她把截断当全部，从而下错结论。
        // 现在按天成页，回执自己说清楚"这一本共多少、这页给了多少、还剩多少、怎么继续翻"。
        const want = a?.book === 'public' || a?.book === 'private' ? a.book : 'both'
        const specs = [
          { book: 'public', file: 'whale-diary.md', label: '公开日记（给主人看的）' },
          { book: 'private', file: 'whale-diary-private.md', label: '私人日记（偏好校准）' },
        ].filter((s) => want === 'both' || s.book === want)
        return specs.map((s) => {
          let raw = ''
          try { raw = fs.readFileSync(path.join(WHALE, s.file), 'utf8') } catch {
            return `【${s.label} · ${s.file}】\n这个文件不存在 —— 是"真的还没有"，不是"被截断没给你"。`
          }
          const heading = a?.heading ? String(a.heading).trim() : undefined
          // 汇总模式（意见箱 f-f976ed）：她要"这一周判了多少条、收了几条、尺子改了几次"，
          // 过去只能一页页读回来手工数。这里只数她自己写下的东西，不替她推断结论。
          if (a?.summary) {
            const sum = summarizeDiaryRange(raw, {
              ...(a?.from ? { from: String(a.from) } : {}),
              ...(a?.to ? { to: String(a.to) } : {}),
            })
            return [
              `【${s.label} · 汇总】${sum.from ?? '?'} → ${sum.to ?? '?'}（${sum.days} 天 · ${sum.chars} 字）`,
              `看过里出现 ${sum.watched} 个不同的 BV`,
              `「想说」写了 ${sum.notes} 节`,
              sum.verdicts
                ? `判断小节里：收 ${sum.verdicts.keep} · 不收 ${sum.verdicts.drop}`
                : '判断小节：这本里没有以「判断」或「尺子」开头的小节，所以数不出收/不收（不是 0，是没这么写）',
              sum.yardstickMentions ? `涉及尺子/判断的小节 ${sum.yardstickMentions} 节` : '',
            ].filter(Boolean).join('\n')
          }
          const p = paginateDiary(raw, {
            page: Number(a?.page ?? 0), days: Number(a?.days ?? 3), budget: Number(a?.budget ?? 4000),
            date: a?.date ? String(a.date) : undefined,
            ...(heading ? { heading } : {}),
          })
          // 没有给出小节过滤时，把这一本里有哪些节列出来：她要"上个月所有的《看过》"得先知道
          // 那几节叫什么，否则只能按天翻着猜。
          const sections = heading ? '' : (() => {
            const names = diaryHeadings(raw)
            return names.length ? `\n这一本的小节有：${names.slice(0, 12).join(' / ')}${names.length > 12 ? ' …' : ''}（只要其中一节：{"heading":"看过"}）` : ''
          })()
          return `【${s.label} · ${s.file} · 第 ${p.page + 1} 页】\n${p.receipt}${sections}`
        }).join('\n\n────────────────\n\n')
      }),
      mk(DECLS[4], async () => statePrompt(loadState(FIELDS_FILE), { queryText: diaryTail(), seed: dayKey(Date.now()) })),
      mk(DECLS[5], async (a) => {
        if (a?.preset === 'watchedVideo' && !canApplyWatched(round.debriefed === true)) {
          causal({ kind: 'discipline-violation', reason: 'watched-without-debrief', atMs: Date.now() })
          return watchedRefusal()
        }
        const presetName = String(a?.preset ?? '')
        // 主人来信只能来自传感器（bili_dm_read）；模型不能自己假装被回复
        if (presetName === 'masterReplied' || presetName === 'inbound') {
          return '[mood_apply] ' + presetName + ' 只能由私信传感器触发（bili_dm_read）；不要自己假装主人来信。'
        }
        const custom = sanitizeEffects(a?.custom)
        const hasCustom = custom.length > 0
        const activityId = String(a?.activity ?? '')
        if (activityId && !(activityId in ACTIVITY_LABELS)) {
          return '[mood_apply] activity 无效：只能是 ' + Object.keys(ACTIVITY_LABELS).join(' / ')
        }
        if (!hasCustom && !presetName) {
          // 只记活动、不加效果也允许（这轮她只是过了个小日子）
          if (activityId && this.life) {
            this.life.lastActivity = activityId
            this.life.lastKind = activityId
            writeLifeFile(this.life)
            causal({ kind: 'activity', activity: activityId, atMs: Date.now() })
            return statePrompt(loadState(FIELDS_FILE), { queryText: diaryTail(), seed: dayKey(Date.now()) })
              + '\n（已记下这轮活动：' + activityId + '）'
          }
          return '[mood_apply] 需要 preset 或 custom'
        }
        if (!hasCustom && !PRESETS[presetName]) {
          if (Array.isArray(a?.custom) && a.custom.length > 0) {
            return '[mood_apply] custom 无效：field 只能是 energy/stimulation/connection/social/mood/curiosity/creativity，|delta|≤0.5'
          }
          return '[mood_apply] 未知预设：' + presetName
        }
        // 看完一条视频的结论由她自己给；不给就按「无从判断」记，不默认成喜欢
        let verdict: WatchVerdict | null = null
        if (!hasCustom && presetName === 'watchedVideo') {
          if (a?.verdict === undefined) verdict = 'unclear'
          else if (String(a.verdict) in WATCH_VERDICTS) verdict = String(a.verdict) as WatchVerdict
          else return '[mood_apply] verdict 无效：只能是 keep（收）/ drop（不收）/ unclear（无从判断）；不传按 unclear 记，不替你判成喜欢'
        } else if (a?.verdict !== undefined) {
          return '[mood_apply] verdict 只给 preset=watchedVideo 用，别的预设没有"这条收不收"可判'
        }
        const picked = verdict ? WATCH_VERDICTS[verdict] : null
        const description = hasCustom ? '自定义事件' : (picked?.description ?? PRESETS[presetName].description)
        const effects = hasCustom ? custom : (picked?.effects ?? PRESETS[presetName].effects)
        const before = loadState(FIELDS_FILE)
        let after = applyEffects(before, effects, description, {
          source: hasCustom ? 'custom' : (picked?.source ?? presetName),
          userJustMessaged: presetName === 'masterReplied',
        })
        // 这句是她自己留的（source=npc_self）；强度只决定编码强度，不再替她判定"刻在心里"
        if (a?.note) after = remember(after, String(a.note), {
          sender: 'npc',
          intensity: Math.max(0.1, Math.min(1, after.fields.stimulation)),
          tags: [],
          source: 'npc_self',
        })
        saveState(FIELDS_FILE, after)
        if (presetName === 'masterReplied' && this.life) {
          // 他回来了：之前"等不到人"的次数清零，她又愿意等了
          this.life.connectMisses = 0
          writeLifeFile(this.life)
        }
        if (activityId && this.life) {
          this.life.lastActivity = activityId
          this.life.lastKind = activityId
          writeLifeFile(this.life)
        }
        causal({
          kind: hasCustom ? 'custom' : presetName,
          verdict: verdict ?? null,
          note: a?.note ?? null,
          activity: activityId || null,
          description,
          effects,
          before: before.fields,
          after: after.fields,
          chainDelta: after.chain.length - before.chain.length,
          relation: after.npcState.current,
        })
        const verdictLine = picked
          ? '\n（这轮的结论：' + picked.label + '；写进账本的是「' + picked.description + '」；场值：'
            + (picked.effects.map((e) => e.field + (e.delta > 0 ? '+' : '') + e.delta).join(' ') || '没动') + '）'
          : ''
        return statePrompt(after, { queryText: diaryTail(), seed: dayKey(Date.now()) }) + verdictLine
      }),
      mk(DECLS[6], async (a) => {
        if (!canDraft(round.feedAt ?? 0, round.debriefed === true)) {
          causal({ kind: 'discipline-violation', reason: 'draft-without-debrief', feedAt: round.feedAt ?? 0, atMs: Date.now() })
          return draftRefusal()
        }
        const diaryMtime = (() => { try { return fs.statSync(PUBLIC_DIARY).mtimeMs } catch { return 0 } })()
        if (!diaryFresh(diaryMtime)) {
          causal({ kind: 'discipline-violation', reason: 'draft-with-stale-diary', diaryMtime, atMs: Date.now() })
          return diaryRefusal()
        }
        // 把人她此刻的状态交给草稿管线：缺 voice 会被 draft-dynamic 直接拒稿
        const st = loadState(FIELDS_FILE)
        let diaryText = ''
        try { diaryText = fs.readFileSync(PUBLIC_DIARY, 'utf8') } catch {}
        // 召回按"今天写了什么"取上下文，不按最鲜活的三条
        const voice = buildVoiceBrief(st, {
          now: Date.now(),
          query: { text: diaryText.slice(-2000), seed: dayKey(Date.now()) },
        })
        if (!voice.stance.share) {
          return `[skipped] 这一轮不想发：${voice.stance.because}（心情 ${voice.mood.label}）`
        }
        const day = dayKey(Date.now())
        const voiceFile = path.join(WHALE, 'bili-whale', 'control', `voice-${day}.json`)
        try {
          fs.mkdirSync(path.dirname(voiceFile), { recursive: true })
          const tmp = voiceFile + '.' + process.pid + '.tmp'
          fs.writeFileSync(tmp, JSON.stringify(voice, null, 2))
          fs.renameSync(tmp, voiceFile)
        } catch (e: any) {
          return '[bili_draft_dynamic failed] 无法写入 voiceBrief：' + String(e?.message ?? e)
        }
        const args = [...(a?.force ? ['--force'] : []), '--drafts', DRAFTS_DIR, '--voice', voiceFile]
        const r = await runNodeAsync(path.join(ROOT, 'scripts', 'draft-dynamic.mjs'), args, 90000)
        // 发送策略 auto：与人工点同一份审批语义（严格一次性令牌 + draftId/正文哈希绑定 + 防双发）。
        // draftId 取磁盘事实源 `<day>.json`，不从工具 stdout 抠 —— 她写的文本不该能指向别的草稿。
        if (r.status === 0) {
          const pol = policyState().policy
          if (pol.draftMode === 'auto') {
            const today0 = dayKey(Date.now())
            const draft = draftForDay(today0)
            if (!draft) return r.out + '\n（策略：auto 找不到今天的草稿文件——转人工）'
            if (!policyInWindow(new Date(), pol.autoWindow)) {
              return r.out + `\n（策略：当前在 autoWindow ${pol.autoWindow} 之外——草稿留给人工放行）`
            }
            // 上限把失败尝试也算上：否则一直失败可以无限重试绕过 autoDailyCap
            if (pol.autoDailyCap > 0 && autoSentToday({ attempts: true }) >= pol.autoDailyCap) {
              return r.out + `\n（策略：今天 auto 已达上限 ${pol.autoDailyCap} 条——后续草稿留给人工放行）`
            }
            // auto **不许自己造令牌**：只用出稿时入队的那一张，缺失/过期/已用一律转人工
            const token = freshAckToken(draft)
            if (!token) {
              causal({ kind: 'auto-publish', draftId: draft.id, ok: false, reason: 'no-fresh-token', atMs: Date.now() })
              return r.out + '\n（策略：auto 要求草稿的一次性令牌仍有效——这条转人工放行）'
            }
            // 令牌走环境变量，不进 argv（进程列表/崩溃栈同机可读）
            const pub = await runNodeAsync(
              path.join(ROOT, 'scripts', 'dynamic-approve.mjs'),
              ['approve', draft.id, '--token-env', 'CORTICO_ACK_TOKEN', '--go'],
              300000,
              { CORTICO_ACK_TOKEN: token },
            )
            const okPub = pub.status === 0 && /"ok":\s*true/.test(pub.out)
            const mask = (s: string) => s.split(token).join('***')
            // 令牌值绝不落盘：causal 与整条回执都打码（含 draft-dynamic 那段）
            causal({ kind: 'auto-publish', draftId: draft.id, ok: okPub, atMs: Date.now(), out: mask(pub.out).slice(-400) })
            return mask(r.out) + `\n（auto 发布${okPub ? '成功 ✓' : '失败——已记 auto 额度，转人工，原因见下'}）\n` + mask(pub.out).slice(-600)
          }
        }
        return r.out
      }),
      mk(DECLS[7], async (a) => {
        const book = String(a?.book ?? '')
        if (book !== 'public' && book !== 'private') return '[diary] book 只能是 public 或 private'
        const heading = String(a?.heading ?? '').replace(/^#+\s*/, '').replace(/[\r\n]+/g, ' ').trim().slice(0, 40)
        const body = String(a?.text ?? '').trim()
        if (!heading) return '[diary] 缺少 heading'
        if (/^\d{4}-\d{2}-\d{2}$/.test(heading)) return '[diary] heading 不能是日期'
        if (!body) return '[diary] 这一节是空的'
        if (body.length > 6000) return '[diary] 太长了（>6000 字），精简一下'
        if (/^#{1,4}\s+\d{4}-\d{2}-\d{2}/m.test(body)) return '[diary] 正文里不能出现日期标题（会打乱按天解析）'
        const file = book === 'public' ? PUBLIC_DIARY : PRIVATE_DIARY
        let cur = ''
        try { cur = fs.readFileSync(file, 'utf8') } catch {}
        if (!cur) cur = diaryDefaultHeader(book as 'public' | 'private')
        const date = dayKey(Date.now())
        // OPS B2（2026-10-30）：替换/追加必须在回执里说死——判定与 upsert 同源（sectionStats），不猜
        const prev = sectionStats(cur, date, heading, book as 'public' | 'private')
        const next = upsertDiarySection(cur, { book: book as 'public' | 'private', heading, body, date })
        fs.mkdirSync(path.dirname(file), { recursive: true })
        const tmp = file + '.' + process.pid + '.' + Math.random().toString(36).slice(2, 8) + '.tmp'
        fs.writeFileSync(tmp, next)
        fs.renameSync(tmp, file)
        causal({ kind: 'diary', book, heading, chars: body.length })
        const modeNote = prev.existed ? `已替换原小节（原 ${prev.chars} 字）` : '已追加新小节'
        return `[diary] 已写入${book === 'public' ? '公开日记' : '私人日记'} · ${date} · ${heading}（${body.length} 字 · ${modeNote}）`
      }),
      mk(DECLS[8], async () => {
        const r = await runAsync(['dm-await', '--json', '--peek'], 60000)
        if (r.status === -2) return r.out
        const parsed = parseDmPeek(r.status, r.out)
        // 时效只由 dm-reply.ts 的这两个函数推进：读一次刷一次，读取失败不刷。
        const touchInbox = () => { if (this.life) { noteInboxRead(this.life); writeLifeFile(this.life) } }
        if (parsed.kind === 'empty') { touchInbox(); return '[dm] 没有新私信（收件箱刚读过，回信窗口已刷新）' }
        if (parsed.kind === 'error') {
          causal({ kind: 'dm-read-failed', detail: parsed.detail, atMs: Date.now() })
          return '[dm] 读取失败（不要当成没人写信）：' + parsed.detail
        }
        const msg = parsed.message
        // 已加过效果但上次 ack 没成功：只补确认，不重复加 connection
        if (readAppliedDmKeys().includes(msg.key)) {
          if (this.life) { noteInbound(this.life, msg); writeLifeFile(this.life) }
          await runAsync(['dm-await', '--ack', msg.receipt], 30000)
          return '[dm] 这条之前已经处理过（补确认，不重复加效果）；回信的靶子还是它。'
        }
        touchInbox()
        const before = loadState(FIELDS_FILE)
        let after = applyEffects(before, PRESETS.inbound.effects, PRESETS.inbound.description, {
          source: 'inbound',
          userJustMessaged: true,
        })
        after = remember(after, msg.text.slice(0, 500), { sender: 'player', intensity: 0.7, tags: ['dm'], source: 'user_said' })
        saveState(FIELDS_FILE, after)
        writeAppliedDmKeys([...readAppliedDmKeys(), msg.key])
        if (this.life) {
          this.life.lastContactAt = msg.ts || Date.now()
          // 记下"这封"的 key：回信草稿只能对着他刚说的话写，不能凭空发
          noteInbound(this.life, msg)
          writeLifeFile(this.life)
        }
        const ack = await runAsync(['dm-await', '--ack', msg.receipt], 30000)
        causal({ kind: 'inbound', key: msg.key, chars: msg.text.length, ack: ack.status === 0, atMs: Date.now() })
        return '[dm] 主人来信：' + msg.text.slice(0, 200)
          + '\n（connection 已上升；想回的话用 bili_dm_reply——给主人的回信可以直接发，不用等审批。）'
      }),
      mk(DECLS[9], async (a) => {
        const text = String(a?.text ?? '').trim()
        const key = String(this.life?.lastInboundKey ?? '')
        const plan = dmAutoPlan(text, this.life, Date.now())
        if (!plan.ok) {
          const why = plan.reason === 'empty' ? '正文是空的'
            : plan.reason === 'too-long' ? '太长（>500 字），砍短一点'
            : plan.reason === 'no-key' ? '最近没有他的新消息（先 bili_dm_read）；不凭空写私信'
            : '上下文过期（7 天没读过收件箱）：先 bili_dm_read——空读也刷新窗口，读完这一封仍然能回'
          return `[dm_reply] ${why}`
        }
        const sent = policyState().policy.dmReply === 'queue'
          ? { status: 9, out: '（策略：回信档位=queue，不直发）' }
          : await runAsync(plan.args, 180000)
        if (sent.status === 0 && sent.out.includes('已发送')) {
          causal({ kind: 'dm-auto-sent', inboundKey: key, chars: text.length, atMs: Date.now() })
          return '[dm_reply] 回信已直接发出（给主人的私信免人工审批，仍过风控/冷却/互关检查）。\n' + sent.out
        }
        // 直发被拒（互关断了 / 风控 / 发送失败）→ 退回草稿队列，主人可在面板放行
        const r = await runAsync(['dm-draft', 'add', '--text', text, '--inbound', key, '--who', ownerName()], 30000)
        if (r.status === 0) causal({ kind: 'dm-draft', inboundKey: key, chars: text.length, fallback: true, atMs: Date.now() })
        const why = (sent.out || `exit ${sent.status}`).trim().split('\n').slice(-2).join(' ').slice(0, 200)
        return `[dm_reply] 直发没成功（${why}）——已退回草稿队列，主人可在面板放行。\n` + r.out
      }),
      mk(DECLS[10], async (a) => {
        const action = String(a?.action ?? 'list')
        if (action === 'add') {
          const issue = String(a?.issue ?? '').trim()
          if (!issue) return '[feedback] 缺 issue：一句话现象就够'
          const args = ['feedback', 'add', '--issue', issue, '--severity', a?.severity === 'high' ? 'high' : 'low']
          if (a?.selfHandled) args.push('--self')
          if (a?.note) args.push('--note', String(a.note).slice(0, 200))
          const r = await runAsync(args, 30000)
          if (r.status === 0) causal({ kind: 'feedback', issue: issue.slice(0, 80), severity: a?.severity === 'high' ? 'high' : 'low', selfHandled: !!a?.selfHandled, atMs: Date.now() })
          return r.out
        }
        if (action === 'resolve') {
          const id = String(a?.id ?? '')
          if (!id) return '[feedback] resolve 需要 id（先 list）'
          const r = await runAsync(['feedback', 'resolve', id, '--by', 'whale'], 30000)
          return r.out
        }
        const r = await runAsync(['feedback', 'list'], 30000)
        return r.out
      }),
      mk(DECLS[11], async (a) => {
        const bvid = String(a?.bvid ?? '').trim()
        if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) return '[like] 缺 bvid 或格式不对（BV 号 = BV + 10 位）'
        const args = ['like', bvid]
        const reason = String(a?.reason ?? '').trim()
        if (reason) args.push('--reason', reason.slice(0, 120))
        args.push('--go')
        const r = await runAsync(args, 60000)
        if (r.status === 0) causal({ kind: 'like', bvid, atMs: Date.now() })
        return r.out
      }),
      mk(DECLS[12], async (a) => {
        const bvid = String(a?.bvid ?? '').trim()
        if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) return '[fav] 缺 bvid 或格式不对（BV 号 = BV + 10 位）'
        const reason = String(a?.reason ?? '').trim()
        if (reason.length < 6) return '[fav] 理由太短（≥6 字）——说不清为什么留，就不收'
        const args = ['fav', bvid, '--reason', reason.slice(0, 200)]
        if (a?.better) args.push('--better')
        args.push('--go')
        const r = await runAsync(args, 60000)
        if (r.status === 0) causal({ kind: 'fav', bvid, atMs: Date.now() })
        return r.out
      }),
      mk(DECLS[13], async () => capabilityText({
        assembled: typeof this.host?.listTools === 'function' ? this.host.listTools() : null,
        worlds: typeof this.host?.listWorlds === 'function' ? this.host.listWorlds() : null,
        mine: BILI_TOOL_DECLS,
        extDir: extensionsDir(this.ctx?.repoRoot ?? repoRoot()),
        configFile: this.ctx ? path.join(this.ctx.botDir, 'config.json') : null,
      })),
      mk(DECLS[14], async (a) => {
        // 她能看图了（#57 / 交接文档 §0 的"一处不许误读"）：封面/九宫格/字幕条作为
        // 附件放进回执，下一轮请求就把字节交给模型——和 console_see_image 同一条路。
        // 模型不收图就明说，不让她对着文件名编内容。
        const bv = String(a?.bvid ?? '').trim()
        if (!/^BV[0-9A-Za-z]{10}$/.test(bv)) return '[bili_look] 需要合法的 BV 号'
        const what = String(a?.what ?? 'all')
        const wants = (k: string) => what === 'all' || what === k
        const found: Array<{ bytes: Buffer; mime: string; name: string }> = []
        const missing: string[] = []
        // 封面：debrief/feed 早就下好的那份
        if (wants('cover')) {
          const p = path.join(WHALE, 'shots', 'covers', `${bv}.jpg`)
          if (fs.existsSync(p)) found.push({ bytes: fs.readFileSync(p), mime: 'image/jpeg', name: `${bv}-cover.jpg` })
          else missing.push('封面（还没下过；跑一次 bili_debrief 就会存下来）')
        }
        // 九宫格 / 字幕条：取该 BV 最新的一份
        for (const [k, suffix, label] of [['sheet', '-3x3.jpg', '九宫格'], ['strip', '-substrip.png', '字幕条']] as const) {
          if (!wants(k)) continue
          const dir = path.join(WHALE, 'shots', 'video')
          let pick: string | null = null
          try {
            pick = fs.readdirSync(dir)
              .filter((f) => f.startsWith(bv + '-') && f.endsWith(suffix))
              .sort().at(-1) ?? null
          } catch { /* 目录不存在 = 没抽过帧 */ }
          if (pick) {
            const p = path.join(dir, pick)
            found.push({ bytes: fs.readFileSync(p), mime: suffix.endsWith('.png') ? 'image/png' : 'image/jpeg', name: pick })
          } else missing.push(`${label}（还没抽；debrief 时加 --substrip 或等它跑抽帧）`)
        }
        const canSee = this.canSeeImages()
        const head = `[bili_look] ${bv} · ${what} · 取到 ${found.length} 张${missing.length ? `；缺 ${missing.join('、')}` : ''}`
        if (!found.length) return `${head}
没有可看的图。`
        if (!canSee) {
          // 关键：不能假装看过。文件在盘上但模型不收图，说清楚。
          return `${head}
⚠ 当前模型不收图像，这些图我看了也收不到——别描述它们。要让主人换一个支持视觉的模型，或让主人直接把图发到控制台。
（文件位置：${found.map((f) => f.name).join('、')}）`
        }
        return { text: head, blobs: found.map((f) => ({ bytes: f.bytes, mime: f.mime, name: f.name, fallbackText: `${f.name}` })) }
      }),
      mk(DECLS[15], async (a) => {
        const minutes = Math.round(Number(a?.minutes))
        const note = String(a?.note ?? '').trim()
        if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440)
          return '[alarm] 分钟数要 1–1440 之间 —— 一天以上就不再是"想起来"，那是排期。'
        if (note.length < 2) return '[alarm] 写清到点要做什么（≥2 字），空闹钟只会叫醒一个不知道要干什么的人。'
        return this.setAlarm(minutes, note.slice(0, 200))
      }),
      mk(DECLS[16], async (a) => {
        // #55：写错的记忆以前只能等它慢慢衰减，期间她照常拿它下结论。
        // 更正要有通道，但一次只准点一条：模糊命中多条时把候选还给她，绝不批量作废。
        const reason = String(a?.reason ?? '').trim()
        if (reason.length < 6) return '[memory_void] 先写清为什么作废（≥6 字）。这个理由会留在条上，是给她自己日后复盘用的，不是删除按钮。'
        const id = String(a?.id ?? '').trim()
        const match = String(a?.match ?? '').trim()
        if (!id && !match) return '[memory_void] 要给我 id 或 match 其中一个 —— 点名才能更正，我不替你猜是哪条。'
        const before = loadState(FIELDS_FILE)
        const hits = findMemories(before, { id: id || undefined, match: id ? undefined : match })
        const alive = hits.filter((m) => m.voided !== true)
        if (!alive.length) {
          return hits.length
            ? `[memory_void] 这几条早就作废了：${hits.map((m) => m.id).join('、')}。不用重复作废。`
            : `[memory_void] 没点到记忆（${id ? `id=${id}` : `「${match}」`} 一条都没有）。先 bili_mood_read 看她现在记得什么，或把片段换短一点。`
        }
        if (alive.length > 1) {
          const list = alive.slice(0, 6).map((m) => `- ${m.id}：${String(m.content ?? '').replace(/\s+/g, ' ').slice(0, 46)}`).join('\n')
          return `[memory_void] 「${match || id}」命中 ${alive.length} 条，一次只能作废一条，我不替你选。把要作废的那条 id 填进 id 再调一次：\n${list}${alive.length > 6 ? `\n- （还有 ${alive.length - 6} 条没列出来）` : ''}`
        }
        const target = alive[0]
        const after = voidMemory(before, target.id, reason)
        saveState(FIELDS_FILE, after)
        causal({ kind: 'memory-voided', memoryId: target.id, reason, atMs: Date.now() })
        return `[memory_void] 已作废 ${target.id}：「${String(target.content ?? '').replace(/\s+/g, ' ').slice(0, 60)}」\n理由：${reason}\n从今天起它不会再被想起来；原文仍留在 fields.json（这是更正，不是删除）。要恢复得主人动手——我没有撤销通道。`
      }),
      mk(DECLS[17], async (a) => {
        // 判断卡：她只能提与看。采纳/驳回挂在世界页的 invoke 上，这条工具触达不到。
        const action = String(a?.action ?? 'list')
        if (action === 'add') {
          const args = ['judgment', 'add',
            '--scope', String(a?.scope ?? 'feed'),
            '--stance', String(a?.stance ?? 'prefer'),
            '--tokens', String(a?.tokens ?? ''),
            '--reason', String(a?.reason ?? '')]
          const bvid = String(a?.bvid ?? '').trim()
          if (bvid) args.push('--bvid', bvid)
          const r = await runAsync(args, 30000)
          if (r.status === 0) causal({ kind: 'judgment', stance: String(a?.stance ?? 'prefer'), tokens: String(a?.tokens ?? '').slice(0, 80), atMs: Date.now() })
          return r.out
        }
        const r = await runAsync(['judgment', 'list'], 30000)
        return r.out + '\n（采纳与驳回只有主人能在世界页点；你提的卡在那之前不影响 feed。）'
      }),
    ]
  }
}

export const BILI_ACCOUNT: WorldDefinition<any> = {
  id: 'bili-account',
  label: 'B站账号（只读 + 草稿 + 情绪）',
  defaults: () => ({ enabled: false }),
  create: (ctx) => new BiliAccountWorld(ctx),
  describe: {
    tools: BILI_TOOL_DECLS,
    events: [{ type: 'bili.action_due', description: { zh: '她想做点什么（状态驱动，不固定在几点）', en: 'She wants to do something (state-driven, no fixed clock).' }, trigger: 'flush' }],
  },
}
