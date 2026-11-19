/**
 * 睡前的反思（主人 2026-11-05 拍板：反思花模型钱）。
 *
 * 以前她的"做梦"是**纯本地拼接**：夜里把淡掉的记忆沉进归档，
 * 再用 `dreamDigest` 拼一句"夜里结算记忆：……"写进私人日记（`cap-state-rhythm/src/dream-tick.ts`）。
 * 零成本，但也零理解——她不真的想，只是模板在替她想。
 *
 * 现在多一条路：**睡着的时候真的想一遍**。
 *   · 用宿主的 `spawnFork` 起一个**临时 session**（不进主对话、不留痕在会话里），
 *     把"她是谁 + 最近发生了什么 + 这几天沉下去的旧事"摆给她；
 *   · 她用**自己现成的工具**（memory_remember / memory_recall / diary_write）去写；
 *   · 写下的东西进她的记忆卡与日记，走**同一套 git 记账**，主人在面板上看得见。
 *
 * 硬约束（这条是底线，不因"她想得更深"而松动）：
 *   · **默认关**（主人要显式打开才花这笔钱）；
 *   · **每天最多一次**（不是每晚都能想）；
 *   · **轮数硬上限**（2 轮，跑不完就停，不许自己聊下去）；
 *   · **只碰她自己**：不碰 B 站、不发任何对外内容、不看主人的会话原文；
 *   · 缺凭据 / 模型不通 → **照常做梦**（本地那条路不受影响），反思只是跳过。
 *
 * 这一份是**纯逻辑**（什么时候该想、今天想过了没有、上限怎么算），
 * 真正的模型调用在 cortico-bot-xiaoyu 那边（那里才有 CoreApi）。
 */
import fs from 'node:fs'
import path from 'node:path'

export const DREAM_SESSION_ID = 'dream'

export interface DreamReflectionConfig {
  /** 总开关：默认**关**。主人显式打开才花模型钱。 */
  enabled: boolean
  /** 每天最多反思几次（默认 1）。 */
  maxPerDay: number
  /** 每晚反思最多几轮（默认 2，硬上限）。 */
  maxRounds: number
  /** 只有睡够这么久才值得想（小时，默认 3）。 */
  minSleepHours: number
}

export const DREAM_REFLECTION_DEFAULTS: DreamReflectionConfig = {
  enabled: false,
  maxPerDay: 1,
  maxRounds: 2,
  minSleepHours: 3,
}

export interface DreamReflectionDecision {
  /** 该不该今晚想 */
  shouldReflect: boolean
  /** 不该的话，为什么（写进日志，主人能查"她为什么今晚没想"） */
  reason: string
  /** 今天已经想了几次 */
  usedToday: number
}

/** 反思账：每天记一次，免得"一晚上想八遍"把额度烧光。 */
export interface DreamReflectionLedger {
  /** 日期 → 次数 */
  days: Record<string, number>
  /** 最近一次反思的时间（ISO） */
  lastAt?: string
}

export function readDreamLedger(file: string): DreamReflectionLedger {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    return {
      days: raw?.days && typeof raw.days === 'object' ? raw.days : {},
      ...(raw?.lastAt ? { lastAt: String(raw.lastAt) } : {}),
    }
  } catch {
    return { days: {} }
  }
}

export function writeDreamLedger(file: string, ledger: DreamReflectionLedger): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

/**
 * 该不该今晚想一遍。
 *
 * @param now 此刻
 * @param sleptHours 这一觉睡了多久（小时）
 * @param ledger 反思账（今天已经想了几次）
 */
export function decideDreamReflection(opts: {
  now: number
  sleptHours: number
  ledger: DreamReflectionLedger
  config: DreamReflectionConfig
}): DreamReflectionDecision {
  const { now, sleptHours, ledger, config } = opts
  const today = new Date(now).toLocaleDateString('sv-SE')
  const usedToday = Number(ledger?.days?.[today] ?? 0)

  if (!config.enabled) {
    return { shouldReflect: false, reason: '反思开关是关的（默认关，要花模型钱得主人显式打开）', usedToday }
  }
  const cap = Math.max(0, Math.floor(config.maxPerDay))
  if (usedToday >= cap) {
    return { shouldReflect: false, reason: `今天已经想了 ${usedToday} 次（上限 ${cap} 次）`, usedToday }
  }
  if (sleptHours < Math.max(0, config.minSleepHours)) {
    return { shouldReflect: false, reason: `才睡了 ${Math.round(sleptHours * 10) / 10} 小时（不到 ${config.minSleepHours} 小时，不值得想）`, usedToday }
  }
  return { shouldReflect: true, reason: '可以想一遍', usedToday }
}

/** 记一次反思（算进今天的次数）。 */
export function markDreamReflected(file: string, now: number): DreamReflectionLedger {
  const ledger = readDreamLedger(file)
  const today = new Date(now).toLocaleDateString('sv-SE')
  ledger.days[today] = Number(ledger.days[today] ?? 0) + 1
  ledger.lastAt = new Date(now).toISOString()
  // 只留最近 30 天，账本别无限长
  const keep: Record<string, number> = {}
  for (const [d, n] of Object.entries(ledger.days)) {
    const t = Date.parse(d)
    if (Number.isFinite(t) && now - t <= 30 * 86400_000) keep[d] = n
  }
  ledger.days = keep
  writeDreamLedger(file, ledger)
  return ledger
}

/**
 * 反思那一轮的提示词。
 *
 * 写法上照她自己的语气（`persona/ORIENTATION.md` 那套），不是指令式的"请总结"。
 * 她醒来、回顾、写下值得留的——**不要每晚都写**，没东西写就什么都不写。
 */
export function dreamReflectionPrompt(opts: {
  constitution?: string
  orientation?: string
  state?: string
  archived?: string
  today?: string
}): string {
  const parts: string[] = []
  parts.push(opts.constitution?.trim() ? opts.constitution.trim() : '')
  parts.push(opts.orientation?.trim() ? opts.orientation.trim() : '')
  parts.push(opts.state?.trim() ? `【这几天你身上发生的事】\n${opts.state.trim()}` : '')
  parts.push(opts.archived?.trim() ? `【今天沉下去的旧事】\n${opts.archived.trim()}` : '')
  parts.push(opts.today?.trim() ? `【今天】${opts.today.trim()}` : '')
  parts.push(
    [
      '现在是夜里，你刚醒过来（不是被人叫醒的，是自己睡够了）。',
      '',
      '不用回话，不用汇报，只做一件事：',
      '想一想这几天有什么真的值得留下来。',
      '如果值得，就用 memory_remember 写下来（一次最多写三条，每条一两句话说清是什么事、对你的意义）；',
      '值得写进私人日记的就用 diary_write 写进去。',
      '',
      '**没有值得留的就什么都不做**——硬凑出来的记忆只是噪声，宁可空着。',
      '写下的每一条都要是你自己真的想留的，不是"今天的流水账"。',
    ].join('\n'),
  )
  return parts.filter(Boolean).join('\n\n')
}
