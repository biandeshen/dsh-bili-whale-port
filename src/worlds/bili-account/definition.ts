/** B站账号 World：只读 + 草稿 + 场值情绪。所有对外写操作只入队，不发送。 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { describeTools, type WorldDefinition } from '../../world.ts'
import { canDraft, draftRefusal, canApplyWatched, watchedRefusal, violationNotice, diaryFresh, diaryRefusal } from './gates.ts'
import { upsertDiarySection, DIARY_DEFAULT_HEADER } from './diary.ts'
import { loadState, saveState, applyEffects, remember, describeState, recentWatch, annotateFeed, PRESETS } from './personaAdapter.ts'
import type { PresetEffect } from './personaAdapter.ts'
import { buildVoiceBrief } from '../../../persona-core/src/voice-brief.ts'
import { pickActivities, ACTIVITY_LABELS } from '../../../persona-core/src/life-activities.ts'
import { readQueue, writeQueue, newTask, dueTasks, markDelivered, markAttempt, prune, expireStale, type QueueTask } from './task-queue.ts'
import { parseDmPeek } from './dm.ts'
import { decideAction, restRecoveryDelta, actionCost, nextCheckDelay, dayKey, MIN_GAP_MS } from '../../../persona-core/src/rhythm.ts'

const ROOT = process.env.BILI_WHALE_ROOT || 'E:/WorkSpace_Qoder/dsh-bili-whale'
const BILI = path.join(ROOT, 'tools', 'bili.mjs')
const WHALE = process.env.WHALE_HOME || path.join(process.env.USERPROFILE || '', '.dsh')
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
function causal(o: any) { try { fs.mkdirSync(path.dirname(CAUSAL_FILE), { recursive: true }); fs.appendFileSync(CAUSAL_FILE, JSON.stringify({ at: new Date().toISOString(), ...o }) + String.fromCharCode(10)) } catch {} }
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

const DRAFTS_DIR = process.env.WHALE_DRAFTS
  || (fs.existsSync('D:/AI/养鱼/drafts') ? 'D:/AI/养鱼/drafts' : path.join(WHALE, 'bili-whale', 'drafts'))

/** 公开日记的尾部：给"记得"当情境词，让召回跟今天写的事有关，而不是永远最鲜活三条。 */
function diaryTail(n = 2000): string {
  try { return fs.readFileSync(PUBLIC_DIARY, 'utf8').slice(-n) } catch { return '' }
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
  for (const e of fresh) {
    // 一次审批只影响一次心情；同一批里取最近一条，避免积压的旧稿一次性灌爆场值
    const preset = e.result === 'sent' ? 'draftApproved' : e.result === 'rejected' ? 'draftRejected' : null
    if (preset) applied.push(preset)
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
    return done.status === 'sent'
      ? `上次那条草稿（${done.id}）主人放行了——记得用 bili_mood_apply {"preset":"draftApproved"} 记下来。`
      : `上次那条草稿（${done.id}）主人没让发——用 bili_mood_apply {"preset":"draftRejected"} 记下来，想想是不是选题偏了。`
  } catch { return '' }
}

/** 异步执行，避免长任务（debrief 最长 240s）阻塞 Cortico 事件循环。 */
const runNodeAsync = (script: string, args: string[], timeout = 180000): Promise<{ status: number; out: string }> => {
  if (fs.existsSync(killPath)) return Promise.resolve({ status: -2, out: '[blocked] kill switch is on' })
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      windowsHide: true,
      env: { ...process.env, WHALE_HOME: WHALE },
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

const DECLS = [
  { name: 'bili_traffic', description: 'Bilibili request-budget state (read-only).', tags: ['read'], parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'bili_feed', description: 'Fetch candidate videos from the feed (read-only).', tags: ['read'], parameters: { type: 'object', properties: { n: { type: 'number', description: 'How many candidates (1-6)' } }, additionalProperties: false } },
  { name: 'bili_debrief', description: 'Understand one video via subtitles, danmaku, comments (read-only).', tags: ['read'], parameters: { type: 'object', properties: { bvid: { type: 'string' } }, required: ['bvid'], additionalProperties: false } },
  { name: 'bili_diary_read', description: 'Read the two diary files (read-only).', tags: ['read'], parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'bili_mood_read', description: "Read Xiaoyu's current emotion (fields + cause + label).", tags: ['read'], parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'bili_mood_apply', description: 'Apply emotional effects after an event. Optionally record which life activity you picked and a short note.', tags: ['write'], parameters: { type: 'object', properties: { preset: { type: 'string', description: 'watchedVideo | masterReplied | masterSilentDay | draftApproved | draftRejected | trafficPaused' }, custom: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, delta: { type: 'number' }, source: { type: 'string' } }, required: ['field', 'delta', 'source'] } }, note: { type: 'string', description: '一句留给自己的话（会写进记忆）' }, activity: { type: 'string', enum: ['rest', 'explore', 'create', 'social', 'reflect', 'exercise', 'consume'], description: '这轮挑的生活活动 id' } }, additionalProperties: false } },
  { name: 'bili_draft_dynamic', description: "Create a dynamic draft from today's diary and an unused image. Never posts.", tags: ['write'], parameters: { type: 'object', properties: { force: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'bili_diary_append', description: 'Write a section into one of her diaries (public/private). Same day+heading is replaced, not duplicated.', tags: ['write'], parameters: { type: 'object', properties: { book: { type: 'string', enum: ['public', 'private'], description: 'public = 给人看的；private = 只给自己看的偏好校准' }, heading: { type: 'string', description: '小节标题，如 看过 / 想说 / 今日指标 / 本轮留下的判断' }, text: { type: 'string', description: '这一节的正文（markdown）' } }, required: ['book', 'heading', 'text'], additionalProperties: false } },
  { name: 'bili_dm_read', description: "Check whether 主人 (the owner) sent a new DM since last check. Read-only: never sends or marks anything read on Bilibili; advances only her local cursor. If reading fails it says so — it is NOT the same as 'no message'.", tags: ['read'], parameters: { type: 'object', properties: {}, additionalProperties: false } },
] as const

class BiliAccountWorld {
  readonly id = 'bili-account'
  private host: any = null
  private dailyTimer: any = null
  private life: any = null
  private queue: QueueTask[] = []

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

  async start(host: any): Promise<void> {
    this.host = host
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
    if (this.life.day !== dayKey(Date.now())) this.life = { ...this.life, day: dayKey(Date.now()), actionsToday: 0 }
    this.life.lastCheckAt = this.life.lastCheckAt || Date.now()

    const lifeTick = async () => {
      if (this.host == null) return
      let nextDelay = nextCheckDelay(Math.random)
      try {
        const now = Date.now()
        const mem = this.life
        const today = dayKey(now)
        if (mem.day !== today) { mem.day = today; mem.actionsToday = 0 }

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
            describeState(after, 5, { seed: today }),
            '',
            '起因：' + decision.reason + '。',
            ...(decision.kind === 'connect' ? ['他可能留了话——先 bili_dm_read 看一眼。'] : []),
            recentLine,
            '这轮可以先挑一件小事（也可以不做）：\n' + activities.map((x) => `- [${x.type}] ${x.label}：${x.description}`).join('\n'),
            '挑好了，在 bili_mood_apply 里带上 activity=<id>，让我记下来。',
            todayDraft,
            feedback,
            fresh,
            '按 ORIENTATION 走一轮；做多少、做不做，由你定。',
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
  envPromptVars(): Record<string, string> | null { return null }

  tools() {
    const mk = (decl: any, handler: (args: any) => Promise<string>) => ({ ...decl, handler })
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
        const r = await runAsync(['debrief', bv, '--no-frames', '--top', '3', '--comments', '3', '--bucket', '60'], 240000)
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
      mk(DECLS[3], async () => {
        return ['whale-diary.md', 'whale-diary-private.md'].map((f) => {
          try { return `## ${f}\n` + fs.readFileSync(path.join(WHALE, f), 'utf8') } catch { return `## ${f}\n(missing)` }
        }).join('\n\n').slice(0, 12000)
      }),
      mk(DECLS[4], async () => describeState(loadState(FIELDS_FILE), 5, { queryText: diaryTail(), seed: dayKey(Date.now()) })),
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
            return describeState(loadState(FIELDS_FILE), 5, { queryText: diaryTail(), seed: dayKey(Date.now()) })
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
        const description = hasCustom ? '自定义事件' : PRESETS[presetName].description
        const effects = hasCustom ? custom : PRESETS[presetName].effects
        const before = loadState(FIELDS_FILE)
        let after = applyEffects(before, effects, description, {
          source: hasCustom ? 'custom' : presetName,
          userJustMessaged: presetName === 'masterReplied',
        })
        // 这句是她自己留的；强度取当时的刺激量，避免 flashbulb 永远触发不到（D-26）
        if (a?.note) after = remember(after, String(a.note), {
          sender: 'npc',
          intensity: Math.max(0.1, Math.min(1, after.fields.stimulation)),
          tags: [],
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
          note: a?.note ?? null,
          activity: activityId || null,
          description,
          effects,
          before: before.fields,
          after: after.fields,
          chainDelta: after.chain.length - before.chain.length,
          relation: after.npcState.current,
        })
        return describeState(after, 5, { queryText: diaryTail(), seed: dayKey(Date.now()) })
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
        const args = [...(a?.force ? ['--force'] : []), '--voice', voiceFile]
        const r = await runNodeAsync(path.join(ROOT, 'scripts', 'draft-dynamic.mjs'), args, 90000)
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
        if (!cur) cur = DIARY_DEFAULT_HEADER[book as 'public' | 'private']
        const date = dayKey(Date.now())
        const next = upsertDiarySection(cur, { book: book as 'public' | 'private', heading, body, date })
        fs.mkdirSync(path.dirname(file), { recursive: true })
        const tmp = file + '.' + process.pid + '.' + Math.random().toString(36).slice(2, 8) + '.tmp'
        fs.writeFileSync(tmp, next)
        fs.renameSync(tmp, file)
        causal({ kind: 'diary', book, heading, chars: body.length })
        return `[diary] 已写入${book === 'public' ? '公开日记' : '私人日记'} · ${date} · ${heading}（${body.length} 字）`
      }),
      mk(DECLS[8], async () => {
        const r = await runAsync(['dm-await', '--json', '--peek'], 60000)
        if (r.status === -2) return r.out
        const parsed = parseDmPeek(r.status, r.out)
        if (parsed.kind === 'empty') return '[dm] 没有新私信'
        if (parsed.kind === 'error') {
          causal({ kind: 'dm-read-failed', detail: parsed.detail, atMs: Date.now() })
          return '[dm] 读取失败（不要当成没人写信）：' + parsed.detail
        }
        const msg = parsed.message
        // 已加过效果但上次 ack 没成功：只补确认，不重复加 connection
        if (readAppliedDmKeys().includes(msg.key)) {
          await runAsync(['dm-await', '--ack', msg.receipt], 30000)
          return '[dm] 这条之前已经处理过（补确认，不重复加效果）'
        }
        const before = loadState(FIELDS_FILE)
        let after = applyEffects(before, PRESETS.inbound.effects, PRESETS.inbound.description, {
          source: 'inbound',
          userJustMessaged: true,
        })
        after = remember(after, msg.text.slice(0, 500), { sender: 'player', intensity: 0.7, tags: ['dm'] })
        saveState(FIELDS_FILE, after)
        writeAppliedDmKeys([...readAppliedDmKeys(), msg.key])
        if (this.life) {
          this.life.lastContactAt = Number(msg.ts) || Date.now()
          writeLifeFile(this.life)
        }
        const ack = await runAsync(['dm-await', '--ack', msg.receipt], 30000)
        causal({ kind: 'inbound', key: msg.key, chars: msg.text.length, ack: ack.status === 0, atMs: Date.now() })
        return '[dm] 主人来信：' + msg.text.slice(0, 200)
          + '\n（connection 已上升；想回的话按 ORIENTATION 走——发信仍然需要审批，不能直接发。）'
      }),
    ]
  }
}

export const BILI_ACCOUNT: WorldDefinition<any> = {
  id: 'bili-account',
  label: 'B站账号（只读 + 草稿 + 情绪）',
  defaults: () => ({ enabled: false }),
  create: () => new BiliAccountWorld(),
  describe: {
    tools: describeTools(DECLS as any, {
      bili_traffic: { zh: '读取请求预算/熔断状态', en: 'Read traffic budget state.' },
      bili_feed: { zh: '拉取候选视频（只读）', en: 'Fetch candidate videos (read-only).' },
      bili_debrief: { zh: '读懂一条视频（只读）', en: 'Understand one video (read-only).' },
      bili_diary_read: { zh: '读取两本日记', en: 'Read the two diary files.' },
      bili_mood_read: { zh: '读取小鱼的场值与当前情绪（含成因）', en: "Read Xiaoyu's fields and current emotion with cause." },
      bili_mood_apply: { zh: '按事件更新场值（预设或自定义）', en: 'Apply emotional effects after an event.' },
      bili_draft_dynamic: { zh: '生成动态草稿（不发送）', en: 'Create a dynamic draft (never posts).' },
      bili_diary_append: { zh: '写日记（公开/私人两本，按天按小节）', en: 'Write a diary section (public or private).' },
      bili_dm_read: { zh: '看主人有没有来信（只读，失败不当成没人写信）', en: 'Check for new owner DMs (read-only; failure is not emptiness).' },
    }),
    events: [{ type: 'bili.action_due', description: { zh: '她想做点什么（状态驱动，不固定在几点）', en: 'She wants to do something (state-driven, no fixed clock).' }, trigger: 'flush' }],
  },
}
