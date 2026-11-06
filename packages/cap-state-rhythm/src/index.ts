/**
 * @xiaoyu/cap-state-rhythm —— 状态与作息能力扩展包（100% 宿主无关）。
 *
 * 包含：
 * - 6 场值与情绪状态持久化（loadState / saveState / applyEffects / setFieldsDirect）
 * - 五阶段昼夜作息循环（reconcileLife / isAsleep / restRecovery / decideStage / applyActionRecord）
 * - 模型工具：mood_read、mood_apply（支持 watchedVideo 的 keep/drop/unclear 三值结论）
 * - 主人操作台 `tank`（鱼缸与作息遥控台）：getSnapshot / setFields / wakeNow / setMode
 */
import fs from 'node:fs'
import path from 'node:path'
import type {
  XiaoyuCapability,
  CapabilityHost,
  TurnContext,
  DeliveryContext,
  PrefixBlock,
} from '../../persona-core/src/capability.ts'
import type { AtomicFields } from '../../persona-core/src/types.ts'
import { dayKey } from '../../persona-core/src/rhythm.ts'
import { readCostToday, costSummary } from './cost-today.ts'
import {
  emptyState,
  loadState,
  saveState,
  applyEffects,
  applyEvent,
  setFieldsDirect,
  remember,
  rememberFirst,
  findMemories,
  voidMemory,
  describeState,
  describeStateWithTrace,
  applyRecall,
  recentWatch,
  annotateFeed,
  readMood,
  PRESETS,
  WATCH_VERDICTS,
  WATCH_VERDICT_IDS,
  type PersonaState,
  type PresetEffect,
  type WatchVerdict,
  type RememberOptions,
} from './state-store.ts'
import {
  reconcileLife,
  isAsleep,
  restState,
  restRecovery,
  decideStage,
  applyActionRecord,
  gapLeft,
  SLEEP_AFTER_MS,
  DEFAULT_SLEEP_WINDOW,
  REST_BELOW_ENERGY,
  type RhythmMode,
  type SleepWindow,
  type LifeMemoryView,
} from './life-stages.ts'
// 作息对账一拍要用到的纯函数（persona-core 里那一份，不另抄；dayKey 已在上面导入）
import { nextCheckDelay, actionCost } from '../../persona-core/src/rhythm.ts'
import { ACTIVITY_TYPES, ACTIVITY_LABELS, type ActivityType } from '../../persona-core/src/life-activities.ts'
import { appendActionRecord, readActionLedger, type ActionRecord } from './action-ledger.ts'

export {
  emptyState,
  loadState,
  saveState,
  applyEffects,
  applyEvent,
  setFieldsDirect,
  remember,
  rememberFirst,
  findMemories,
  voidMemory,
  describeState,
  describeStateWithTrace,
  applyRecall,
  recentWatch,
  annotateFeed,
  readMood,
  PRESETS,
  WATCH_VERDICTS,
  WATCH_VERDICT_IDS,
  reconcileLife,
  isAsleep,
  restState,
  restRecovery,
  decideStage,
  applyActionRecord,
  gapLeft,
  SLEEP_AFTER_MS,
  DEFAULT_SLEEP_WINDOW,
  REST_BELOW_ENERGY,
}
export type {
  PersonaState,
  PresetEffect,
  WatchVerdict,
  RememberOptions,
  RhythmMode,
  LifeMemoryView,
}

export interface StateRhythmConfig {
  checkIntervalMinMinutes: number
  checkIntervalMaxMinutes: number
  defaultMode: RhythmMode
}

export interface StateRhythmCapabilityOptions {
  fieldsFile: string
  lifeFile: string
  /**
   * 行动账（append-only NDJSON）。默认与 life.json 同目录的 `actions.ndjson`。
   * 这是"她真做过什么"的凭据，life.json 里的计数只是它的汇总。
   */
  actionsFile?: string
  onWakeTriggered?: (info: { reason: string; hint?: string; atMs: number }) => void
  /** 她自己记下一笔行动时通知外层（转接头用它复位心跳的"安静时长"） */
  onActionRecorded?: (rec: ActionRecord) => void
  /** 她所在的时区；睡眠时段按它算（不传就用系统本地时区） */
  timezone?: string
}

/**
 * 读她的作息账；**顺手把过了期的强制模式收回 auto 并落盘**。
 *
 * 为什么在读的地方收，而不是等谁想起来改：
 *   · 强制模式是**临时**的（主人戳一下"醒着"），到期就该自动失效；
 *   · 以前只落盘不回收，于是她被叫醒之后**再也睡不着**——除非主人手动改回去；
 *   · 收在这里而不是收在某条业务路径上，是因为读账的地方最全：
 *     状态面板、作息对账、健康检查、戳醒都会经过它，不会漏。
 */
function loadLifeFile(file: string): LifeMemoryView {
  let life: LifeMemoryView
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    // sleepWindow 要区分"没设过"（undefined → 用默认时段）与"主人明确关掉"（null → 不按时段判睡）：
    // 这个区别丢了，主人关掉时段判据这件事会在下一次读档时悄悄复原。
    const win = raw.sleepWindow === null
      ? null
      : (raw.sleepWindow && /^\d{1,2}:\d{2}$/.test(String(raw.sleepWindow.start)) && /^\d{1,2}:\d{2}$/.test(String(raw.sleepWindow.end))
        ? { start: String(raw.sleepWindow.start), end: String(raw.sleepWindow.end) }
        : undefined)
    life = {
      day: String(raw.day ?? dayKey(Date.now())),
      actionsToday: Number(raw.actionsToday ?? 0),
      lastActionAt: Number(raw.lastActionAt ?? 0),
      lastCheckAt: Number(raw.lastCheckAt ?? 0),
      lastKind: raw.lastKind ?? null,
      mode: (raw.mode === 'force_sleep' || raw.mode === 'force_awake') ? raw.mode : 'auto',
      modeExpiresAt: Number(raw.modeExpiresAt ?? 0) || undefined,
      nextCheckAt: Number(raw.nextCheckAt ?? 0),
      ...(win === undefined ? {} : { sleepWindow: win }),
    }
  } catch {
    return {
      day: dayKey(Date.now()),
      actionsToday: 0,
      lastActionAt: 0,
      lastCheckAt: 0,
      lastKind: null,
      mode: 'auto',
    }
  }
  // 到期就收回：mode 回 auto，并且**把到期时间也抹掉**（留着会让下一个人以为还有效）
  const until = Number(life.modeExpiresAt ?? 0)
  if (life.mode !== 'auto' && until > 0 && Date.now() >= until) {
    const reverted: LifeMemoryView = { ...life, mode: 'auto', modeExpiresAt: undefined }
    try { saveLifeFile(file, reverted) } catch { /* 落盘失败不影响这次读 */ }
    return reverted
  }
  return life
}

function saveLifeFile(file: string, life: LifeMemoryView): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.' + process.pid + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(life, null, 2))
  fs.renameSync(tmp, file)
}

export function createStateRhythmCapability(
  opts: StateRhythmCapabilityOptions,
): XiaoyuCapability<StateRhythmConfig> {
  let hostRef: CapabilityHost | null = null
  const actionsFile = opts.actionsFile ?? path.join(path.dirname(opts.lifeFile), 'actions.ndjson')

  /**
   * 她记下一笔"真的做过的小事"（`life_do` 工具的唯一实现）。
   *
   * 为什么需要它（2026-11-06 三层诊断的第三层）：`applyActionRecord` / `actionCost`
   * 在生产里**都没有调用者**——她的账永远是 0 件、`lastActionAt` 永远是 0，
   * 于是"距上次行动 999 小时"、`restPressure` 顶着 1.0，而行动本身不花体力。
   * 五阶段循环只跑了"对账 + 决定"两步。
   *
   * 为什么由她自己报，而不是自动数工具调用：7 类日常活动里只有一部分会留下别的痕迹
   * （写日记、存记忆），"动一动""想想事"没有任何外部回执；自动把 `mood_apply`
   * 这类反应式调用算成行动，又会把她和主人聊天时的每一次情绪变化都记成"自主行动"。
   * 所以口径写死：**她自己按下这个工具，才算一笔**；回执 = 真的扣了体力 +
   * life.json 汇总 + 只追加的行动账一行。没做却记，是假账，比少记更坏。
   */
  const recordActionImpl = (params: { activity?: string; note?: string; source?: 'self' | 'owner' }) => {
    const activity = String(params?.activity ?? '').trim() as ActivityType
    if (!ACTIVITY_TYPES.includes(activity)) {
      return { ok: false, error: `activity 只能是 ${ACTIVITY_TYPES.join(' / ')} 之一` }
    }
    const note = String(params?.note ?? '').trim().slice(0, 200)
    const nowMs = Date.now()
    // ① 真花体力：以前行动是零成本的，"累了就歇"这条反馈根本触发不了。
    const withCost = applyEffects(
      loadState(opts.fieldsFile),
      actionCost(),
      `${ACTIVITY_LABELS[activity]}${note ? `（${note}）` : ''}`,
      { now: nowMs, source: 'action' },
    )
    saveState(opts.fieldsFile, withCost)
    // ② 记账：汇总进 life.json，凭据进只追加的行动账。
    const life = loadLifeFile(opts.lifeFile)
    const today = dayKey(nowMs)
    const base: LifeMemoryView = life.day === today ? life : { ...life, day: today, actionsToday: 0 }
    const rec: ActionRecord = {
      at: nowMs,
      day: today,
      activity,
      label: ACTIVITY_LABELS[activity],
      ...(note ? { note } : {}),
      source: params?.source === 'owner' ? 'owner' : 'self',
    }
    const next = applyActionRecord(base, { kind: activity, reason: note || ACTIVITY_LABELS[activity] }, {
      now: nowMs,
      writeLife: (m) => saveLifeFile(opts.lifeFile, m),
      // 写账失败不能让"已经发生过的行动"跟着丢：先兜住异常，再由下面的 total 反映真实条数。
      writeCausal: () => {
        try { appendActionRecord(actionsFile, rec) } catch { /* 汇总已落盘，流水下次补齐 */ }
      },
    })
    try { opts.onActionRecorded?.(rec) } catch { /* 通知失败不影响记账本身 */ }
    return {
      ok: true,
      activity,
      label: rec.label,
      at: nowMs,
      actionsToday: Number(next.actionsToday ?? 0),
      lastActionAt: Number(next.lastActionAt ?? 0),
      energy: Number(Number(withCost.fields.energy ?? 0).toFixed(3)),
      receipt: note ? `记下了：${rec.label}——${note}` : `记下了：${rec.label}`,
    }
  }

  /**
   * 「戳醒她」的唯一实现：鱼缸与「她的一天」两个入口都走这里，不各写一份。
   *
   * 回执（story-1 欠的那条）：主人戳完必须看得见**做了什么、还没看到什么**，
   * 而不是一个含糊的"已发送"。「她这一轮会说什么」不在这里承诺——那是下一拍的事，
   * 承诺了就是编。
   */
  const wakeNowImpl = (params: { hint?: string }) => {
    const nowMs = Date.now()
    const life = loadLifeFile(opts.lifeFile)
    const nextLife: LifeMemoryView = {
      ...life,
      lastCheckAt: nowMs,
      nextCheckAt: nowMs,
      // 戳醒是把"强制休息"解除；强制清醒保持不变（但到期时间照旧，到点照样回 auto）
      mode: life.mode === 'force_sleep' ? 'auto' : (life.mode ?? 'auto'),
      ...(life.mode === 'force_sleep' ? { modeExpiresAt: undefined } : {}),
    }
    saveLifeFile(opts.lifeFile, nextLife)
    const hint = typeof params?.hint === 'string' ? params.hint.trim() : ''
    const delivered = Boolean(hostRef)
    if (hostRef) {
      hostRef.pushEvent({
        type: 'persona.wake_now',
        source: 'owner-panel',
        text: hint ? `主人戳了戳你让你醒来：「${hint}」` : '主人戳了戳你，让你现在醒来活动一轮。',
        atMs: nowMs,
        meta: { hint },
      })
    }
    opts.onWakeTriggered?.({ reason: 'owner_wake_now', hint, atMs: nowMs })
    return {
      ok: true,
      triggeredAt: nowMs,
      hint,
      mode: nextLife.mode,
      delivered,
      receipt: {
        did: [
          '把作息账的「下一拍」拨到了现在',
          delivered ? '叫她的话已经投进她的收件队列' : '没接上宿主：只改了账，这一拍她不会被叫醒',
          hint ? `带上了你的叮嘱：「${hint}」` : '没带叮嘱',
        ],
        notYet: '她这一轮具体做了什么，要等下一拍落进因果账；刷新这一页就看得见。',
      },
    }
  }

  return {
    id: 'state-rhythm',
    title: '状态与作息',
    kind: 'internal',
    configSchema: {
      type: 'object',
      title: '状态与作息节律配置',
      description: '控制昼夜评估间隔与默认作息模式（热生效）',
      properties: {
        checkIntervalMinMinutes: {
          type: 'number',
          title: '最小唤醒评估间隔（分钟）',
          default: 3,
          minimum: 1,
          maximum: 60,
          'x-hot': true,
        },
        checkIntervalMaxMinutes: {
          type: 'number',
          title: '最大唤醒评估间隔（分钟）',
          default: 7,
          minimum: 1,
          maximum: 120,
          'x-hot': true,
        },
        defaultMode: {
          type: 'string',
          title: '作息运行模式',
          enum: ['auto', 'force_sleep', 'force_awake'],
          default: 'auto',
          'x-hot': true,
        },
      },
    },
    defaultConfig: {
      checkIntervalMinMinutes: 3,
      checkIntervalMaxMinutes: 7,
      defaultMode: 'auto',
    },

    start(host: CapabilityHost) {
      hostRef = host
    },

    stop() {
      hostRef = null
    },

    async contextSegments(ctx: TurnContext): Promise<readonly PrefixBlock[]> {
      const state = loadState(opts.fieldsFile)
      // live:false —— 会话级前缀**不带场值数字**（审计 §1.4）。
      // 宿主整场只建一次前缀，长会话里这里会变成旧值；每事件注入才带真值。
      // 两个都在同一次请求里，她就拿到"体力38 与体力88 同时在场"的自相矛盾状态。
      const { text, recalledIds } = describeStateWithTrace(state, 5, { seed: dayKey(ctx.now.getTime()), live: false })
      if (recalledIds.length > 0) {
        saveState(opts.fieldsFile, applyRecall(state, recalledIds))
      }
      return [
        {
          title: '当前场值与心情',
          text,
          sourceKey: 'persona.state-rhythm',
        },
      ]
    },

    async onMessageDelivery(ctx: DeliveryContext): Promise<readonly string[]> {
      const queryText = ctx.events.map((e) => e.text).join(' ')
      const state = loadState(opts.fieldsFile)
      // live:true（默认）—— **场值数字只在这一条路出现**，而且每次都重读，
      // 所以同一次请求里只有一个真值（审计 §1.4）。
      const { text } = describeStateWithTrace(state, 3, {
        queryText,
        seed: dayKey(ctx.now.getTime()),
        live: true,
      })
      return [text]
    },

    tools() {
      return [
        {
          name: 'mood_read',
          summary: '读取当前场值、情绪成因与作息状态',
          description: '返回当前的 7 个原子场值、主导与次要情绪、成因以及最近的状态变化链。',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '可选：当前正在想的话题词，用于关联记忆' },
            },
          },
          execute(args: { query?: string }) {
            const s = loadState(opts.fieldsFile)
            const { text, recalledIds } = describeStateWithTrace(s, 5, { queryText: args?.query })
            if (recalledIds.length) saveState(opts.fieldsFile, applyRecall(s, recalledIds))
            return { ok: true, mood: readMood(s), fields: s.fields, text }
          },
        },
        {
          name: 'mood_apply',
          summary: '记录事件引起的场值与心情变化',
          description: '应用预设事件（如 watchedVideo + verdict: keep/drop/unclear）或自定义场值增减，并可附带一条记忆笔记。',
          parameters: {
            type: 'object',
            properties: {
              preset: { type: 'string', description: '预设名：watchedVideo / inbound / masterReplied / draftApproved / draftRejected / trafficPaused' },
              verdict: { type: 'string', enum: ['keep', 'drop', 'unclear'], description: 'watchedVideo 时的结论（仅 keep 给正向加成）' },
              note: { type: 'string', description: '本轮留下的简短感受或记忆笔记' },
            },
          },
          mutatesState: true,
          execute(args: { preset?: string; verdict?: WatchVerdict; note?: string }) {
            let s = loadState(opts.fieldsFile)
            let appliedDesc = ''
            if (args?.preset === 'watchedVideo') {
              const v: WatchVerdict = args.verdict ?? 'unclear'
              if (!WATCH_VERDICT_IDS.includes(v)) {
                return { ok: false, error: `非法 verdict: ${String(args.verdict)}，只能是 keep / drop / unclear` }
              }
              const spec = WATCH_VERDICTS[v]
              s = applyEffects(s, spec.effects, spec.description, { source: spec.source })
              appliedDesc = `${spec.description}（verdict=${v}）`
            } else if (args?.preset && PRESETS[args.preset]) {
              s = applyEvent(s, args.preset)
              appliedDesc = PRESETS[args.preset].description
            }
            if (args?.note && String(args.note).trim()) {
              s = remember(s, String(args.note).trim(), { sender: 'npc', source: 'npc_self' })
            }
            saveState(opts.fieldsFile, s)
            return { ok: true, applied: appliedDesc || '已记录', mood: readMood(s), fields: s.fields }
          },
        },
        {
          name: 'life_do',
          summary: '做完一件小事后记一笔（7 类日常活动，都不需要凭据）',
          description:
            '这一拍你想动的时候，就真的去做 7 类里的某一类；做完用这个记一笔。'
            + '它真的会扣体力，并在只追加的行动账里留一行。'
            + '**没做就别记**——账上多一笔假的比少一笔更坏；也不用等指令、素材或登录凭据，'
            + '这些事都不需要。activity 取值：'
            + ACTIVITY_TYPES.map((t) => `${t}=${ACTIVITY_LABELS[t]}`).join('、'),
          parameters: {
            type: 'object',
            properties: {
              activity: { type: 'string', enum: ACTIVITY_TYPES as readonly string[], title: '做了哪一类' },
              note: { type: 'string', title: '具体做了什么（可选，一句话）' },
            },
            required: ['activity'],
          },
          mutatesState: true,
          execute(args: { activity?: string; note?: string }) {
            return recordActionImpl(args ?? {})
          },
        },
      ]
    },

    panels() {
      return [
        {
          /**
           * 「她的一天」——主人打开控制台第一眼要看的那页（2026-11-05 设计交接 story-5）。
           *
           * 它回答三个问题：**她现在在干什么、今天干过什么、这一页之外我还该知道什么**。
           * 数据全从既有的作息账与因果账来，不新建存储，也不在这里做控制：
           * 拉滑块、戳醒、改睡眠时段都在「鱼缸」，改节奏在「配置」——
           * 同一件事有两个入口就是两个真相。因此这一页是**只读**的，
           * 我们不为了满足"每页都得有个写按钮"而挂一个假的写。
           */
          id: 'day',
          title: '她的一天',
          description: '她现在在干什么、今天做过什么、下一拍什么时候。要动手去「鱼缸」，改节奏去「配置」',
          methods: {
            get: {
              name: 'get',
              verb: 'GET',
              summary: '读取她当前状态三态、今天做过的件数、下一拍时间，以及今天的因果账流水',
              writable: false,
              invoke() {
                const now = Date.now()
                const state = loadState(opts.fieldsFile)
                const life = loadLifeFile(opts.lifeFile)
                const rest = restState(life, state.fields, now, opts.timezone)
                const nextCheckAt = Number(life.nextCheckAt ?? 0)
                // 因果账按本地日切今天：不能用 toISOString()，那是 UTC，
                // 东八区凌晨 0–8 点会算到昨天上去（本仓测试踩过同一条）。
                const today = dayKey(now)
                // 行动账才是"今天做过什么"的凭据；life.json 里那只是汇总（可能还没等到下一拍对账）。
                const ledger = readActionLedger(actionsFile, now)
                const chain = Array.isArray(state.chain) ? [...state.chain] : []
                const ofToday = chain
                  .filter((c: any) => {
                    const ms = Number(c.atMs ?? Date.parse(String(c.timestamp ?? '')))
                    return Number.isFinite(ms) && dayKey(ms) === today
                  })
                  .reverse()
                return {
                  ok: true,
                  rest,
                  asleep: rest === 'asleep',
                  resting: rest === 'resting',
                  mode: life.mode ?? 'auto',
                  modeExpiresAt: Number(life.modeExpiresAt ?? 0) || null,
                  sleepWindow: life.sleepWindow === undefined ? DEFAULT_SLEEP_WINDOW : life.sleepWindow,
                  mood: readMood(state),
                  fields: state.fields,
                  described: describeState(state),
                  /**
                   * 当日成本与通道状态（P2 成本可见，只读宿主的计费账，不写任何东西）。
                   *
                   * 挂在这一页是有意的：主人看的就是「她的一天」，而这一页原先只有
                   * "今天做了 226 件小事"和"她很安静"两种读法——**累、设计如此、没钱了**
                   * 三件完全不同的事，在观察面上一模一样。读数口径（UTC/本地日界）
                   * 跟数一起出去，免得又出现"我 814 次你 841 次"那种两个数都对、
                   * 问的不是同一件事。
                   */
                  cost: (() => {
                    try {
                      const c = readCostToday({ dataDir: path.dirname(path.dirname(opts.lifeFile)) })
                      return { ...c, line: costSummary(c) }
                    } catch (e: any) {
                      return { verdict: 'quiet', calls: 0, paid: 0, failed: 0, line: `成本读数取不到：${String(e?.message ?? e).slice(0, 80)}` }
                    }
                  })(),
                  today: {
                    day: today,
                    // 汇总与流水取大的那个：life.json 要等下一拍才对齐，日记里不该显示成 0。
                    actionsToday: Math.max(life.day === today ? Number(life.actionsToday ?? 0) : 0, ledger.count),
                    lastActionAt: Math.max(Number(life.lastActionAt ?? 0), ledger.lastAt),
                    lastKind: life.lastKind ?? null,
                    lastCheckAt: Number(life.lastCheckAt ?? 0),
                    nextCheckAt,
                    // 下一拍还有几分钟：负数/0 表示"账上写的时刻已经过了"，前端要说人话
                    nextInMin: nextCheckAt > 0 ? Math.round((nextCheckAt - now) / 60_000) : null,
                  },
                  // 今天的行动回执（新→旧）：她真做过什么，一条条摆着
                  recentActions: ledger.today.slice(0, 8),
                  actionLedgerTotal: ledger.total,
                  events: ofToday.slice(0, 40),
                  eventCountToday: ofToday.length,
                  eventCountAll: chain.length,
                }
              },
            },
            wakeNow: {
              name: 'wakeNow',
              verb: 'POST',
              summary: '立即戳醒她马上跑一轮，并回一份"这一拍做了什么/还没看到什么"的回执',
              writable: true,
              invoke(params: { hint?: string }) {
                // 与鱼缸那一颗是同一个实现；这一页有个写入口也是宿主合同的要求
                //（能力包合同校验会拒掉纯只读面板）。
                return wakeNowImpl(params)
              },
            },
          },
        },
        {
          id: 'tank',
          title: '鱼缸与作息遥控台',
          description: '查看与直接滑块调节 6 条场值、心情、一键戳醒立即跑一轮、切换作息模式',
          methods: {
            getSnapshot: {
              name: 'getSnapshot',
              verb: 'GET',
              summary: '读取当前场值、心情、作息阶段与近期状态变迁链',
              writable: false,
              invoke() {
                const state = loadState(opts.fieldsFile)
                const life = loadLifeFile(opts.lifeFile)
                const mood = readMood(state)
                const rest = restState(life, state.fields, Date.now(), opts.timezone)
                return {
                  ok: true,
                  fields: state.fields,
                  mood,
                  // 三态而不是一个布尔：歇着（累了）与睡着（夜间）是两件事
                  rest,
                  asleep: rest === 'asleep',
                  resting: rest === 'resting',
                  sleepWindow: life.sleepWindow === undefined ? DEFAULT_SLEEP_WINDOW : life.sleepWindow,
                  mode: life.mode ?? 'auto',
                  modeExpiresAt: Number(life.modeExpiresAt ?? 0) || null,
                  life,
                  recentChain: [...state.chain].reverse().slice(0, 20),
                  described: describeState(state),
                  lastAppliedAt: state.lastAppliedAt,
                }
              },
            },
            setFields: {
              name: 'setFields',
              verb: 'POST',
              summary: '主人直接拉滑块修改场值并落盘',
              writable: true,
              invoke(params: { patch: Partial<AtomicFields>; note?: string }) {
                if (!params?.patch || typeof params.patch !== 'object') {
                  return { ok: false, error: '缺少 patch 字段对象' }
                }
                const current = loadState(opts.fieldsFile)
                const next = setFieldsDirect(
                  current,
                  params.patch,
                  params.note?.trim() || '主人在面板手动调节场值',
                )
                saveState(opts.fieldsFile, next)
                return {
                  ok: true,
                  fields: next.fields,
                  mood: readMood(next),
                  lastAppliedAt: next.lastAppliedAt,
                }
              },
            },
            wakeNow: {
              name: 'wakeNow',
              verb: 'POST',
              summary: '立即戳醒她马上跑一轮（可附带主人叮嘱）',
              writable: true,
              invoke(params: { hint?: string }) {
                // 「她的一天」也有这一颗按钮：两处入口，**一份实现**（下面 wakeNowImpl）。
                return wakeNowImpl(params)
              },
            },
            setMode: {
              name: 'setMode',
              verb: 'POST',
              summary: '切换作息模式（auto / force_sleep / force_awake）；force_* 可带 expiresInMinutes，到点自动回 auto',
              writable: true,
              invoke(params: { mode: RhythmMode; expiresInMinutes?: number }) {
                const mode = params?.mode
                if (mode !== 'auto' && mode !== 'force_sleep' && mode !== 'force_awake') {
                  return { ok: false, error: 'mode 必须是 auto / force_sleep / force_awake' }
                }
                // 到期时间：只在强制模式上给，auto 一律清掉（auto 本身就是"没有到期"）
                const mins = Number(params?.expiresInMinutes ?? 0)
                let modeExpiresAt: number | undefined
                if (mode !== 'auto' && Number.isFinite(mins) && mins > 0) {
                  modeExpiresAt = Date.now() + Math.round(mins * 60_000)
                }
                const life = loadLifeFile(opts.lifeFile)
                const nextLife: LifeMemoryView = { ...life, mode, modeExpiresAt }
                saveLifeFile(opts.lifeFile, nextLife)
                const state = loadState(opts.fieldsFile)
                const rest = restState(nextLife, state.fields, Date.now(), opts.timezone)
                return {
                  ok: true,
                  mode,
                  modeExpiresAt: modeExpiresAt ?? null,
                  rest,
                  asleep: rest === 'asleep',
                }
              },
            },
            setSleepWindow: {
              name: 'setSleepWindow',
              verb: 'POST',
              summary: '改她的夜间睡眠时段（默认 01:00–07:00；传 off 关掉时段判据，只按"闲了多久"）',
              writable: true,
              invoke(params: { start?: string; end?: string; off?: boolean }) {
                const life = loadLifeFile(opts.lifeFile)
                let win: SleepWindow
                if (params?.off === true) win = null
                else {
                  const start = String(params?.start ?? '').trim()
                  const end = String(params?.end ?? '').trim()
                  if (!/^\d{1,2}:\d{2}$/.test(start) || !/^\d{1,2}:\d{2}$/.test(end)) {
                    return { ok: false, error: 'start/end 要形如 01:00 / 07:00，或者传 off:true 关掉' }
                  }
                  const h = (s: string) => Number(s.split(':')[0])
                  const m = (s: string) => Number(s.split(':')[1])
                  if (h(start) > 23 || h(end) > 23 || m(start) > 59 || m(end) > 59) return { ok: false, error: '时刻超出 24 小时制' }
                  if (start === end) return { ok: false, error: '时段起止相同等于整天空窗，要关就传 off:true' }
                  win = { start, end }
                }
                const nextLife: LifeMemoryView = { ...life, sleepWindow: win }
                saveLifeFile(opts.lifeFile, nextLife)
                const state = loadState(opts.fieldsFile)
                const rest = restState(nextLife, state.fields, Date.now(), opts.timezone)
                return {
                  ok: true,
                  sleepWindow: win,
                  rest,
                  note: win
                    ? `夜间 ${win.start}–${win.end} 算睡着（记忆结算与遗忘叙事只在这时跑）；白天体力低于 ${REST_BELOW_ENERGY} 算"歇着"，慢慢回血但不做梦`
                    : '已关掉时段判据：只按"距上次行动 ≥6 小时"算睡着',
                }
              },
            },
          },
        },
      ]
    },

    /**
     * 只把"下一拍什么时候"写进作息账，不做对账、不做决定、不推进任何计数。
     *
     * 为什么要单独一条：心跳的排程活在内存里。进程一重启，`life.json` 的 `nextCheckAt`
     * 还是上一个进程写的——账上挂着一个已经过去的时间，而下一拍要等这进程排好的几分钟之后才落，
     * `cortico-health` 的「下次状态评估」就在这段窗口里报假警（2026-11-05 07:15 重启后实测到一次，
     * 直到 07:20 那一拍才自愈）。**账要一直对得起事实**，所以启动那一刻就把真排程落下来。
     */
    markNextCheck(nextCheckAtMs: number): void {
      const now = Date.now()
      const at = Number(nextCheckAtMs)
      if (!Number.isFinite(at) || at <= now) return
      saveLifeFile(opts.lifeFile, { ...loadLifeFile(opts.lifeFile), nextCheckAt: at })
    },

    /**
     * 作息对账一拍（**2026-11-04 补上的最后一块**）。
     *
     * 旧架构里"她的一天"是有人每 5 分钟推一次的：对账 → 决定动不动 → 落 life.json。
     * 重写之后 `reconcileLife` / `decideStage` / `applyActionRecord` 三个函数都还在、
     * 也都还导出，但**没有任何调用者**——于是 `life.json` 的 lastCheckAt 与 nextCheckAt
     * 停在启动那一刻，actionsToday 永远 0，`cortico-health` 的「下次状态评估」一直过期。
     * 心跳接上之后她"醒得对"了，可那一拍只是发一句话，作息账还是没人记。
     *
     * 所以这个方法把四步串起来，并且**把决定的理由带回去**——
     * "这一拍她不动"必须是能解释的（gap / cap / tired / content），不能是沉默。
     */
    lifeTick(nextCheckAtMs?: number): {
      now: number
      neverActed: boolean
      asleep: boolean
      resting: boolean
      shouldAct: boolean
      reason: string
      kind: string | null
      urge: number
      actionsToday: number
      lastActionAt: number
      nextCheckAt: number
    } {
      const now = Date.now()
      let state = loadState(opts.fieldsFile)
      const life = loadLifeFile(opts.lifeFile)

      /**
       * ③ 衰减/恢复：睡着（或累到歇着）时回一点体力。
       *
       * `restRecovery` 以前也没有生产调用者——行动不花体力、休息不回体力，
       * 场值只能靠零散事件漂移。这里按距上次结算的真实小时数补上，
       * 单拍最多补 8 小时（再长的停机由 applyEffects 的离线补算负责，不在这儿重复算）。
       */
      const restBefore = restState(life, state.fields, now, opts.timezone)
      const elapsedH = Math.max(0, (now - Date.parse(state.lastAppliedAt)) / 3_600_000)
      const recovery = restRecovery(
        state.fields,
        Math.min(elapsedH, 8),
        restBefore === 'asleep',
        restBefore === 'resting',
      )
      if (recovery > 0) {
        state = applyEffects(
          state,
          [{ field: 'energy', delta: recovery, source: 'rest', priority: 2 }],
          restBefore === 'asleep' ? '睡着回了一点体力' : '歇着回了一点体力',
          { now, source: 'rest' },
        )
        saveState(opts.fieldsFile, state)
      }

      // 第三个来源：只追加的行动账。**必须按天过滤**（readActionLedger 只数今天），
      // 不能把 life.actionsToday 当账本传——昨天记了 7 件，跨日也会被这 7 顶回来。
      const ledger = readActionLedger(actionsFile, now)
      const reconciled = reconcileLife(
        life,
        life,
        { count: ledger.count, lastAt: ledger.lastAt },
        dayKey(now),
      )
      const { decision } = decideStage({
        fields: state.fields,
        relation: (state.npcState?.current ?? 'normal') as never,
        now,
        mem: reconciled as never,
        rng: Math.random,
        tz: opts.timezone,
      })
      const delay = nextCheckDelay(Math.random)
      const nextLife: LifeMemoryView = {
        ...reconciled,
        lastCheckAt: now,
        // nextCheckAt 要写**下一拍真正会落的时间**（空拍退避已删，现在是固定基线）。
        // 调用方（转接头）把心跳排好的真时间传进来；没传时退回 3–7 分钟。
        // 以前这里按随机值写、心跳却按退避排，账与事实对不上，健康检查据此报假警。
        nextCheckAt: Number(nextCheckAtMs) > now ? Number(nextCheckAtMs) : now + delay,
      }
      saveLifeFile(opts.lifeFile, nextLife)
      // 三态：睡着（夜间/闲够 6 小时）／歇着（累了）／醒着。
      // 以前这里只有一个布尔，且 `lastActionAt<=0` 被当成"睡了很久"——
      // 线上因此说出过自相矛盾的话（14:47：既说"她在睡着时段"又说"她想动"）。
      const rest = restState(nextLife, state.fields, now, opts.timezone)
      return {
        now,
        neverActed: Number(nextLife.lastActionAt ?? 0) <= 0,
        rest,
        asleep: rest === 'asleep',
        resting: rest === 'resting',
        shouldAct: decision.act === true,
        reason: String(decision.reason ?? ''),
        kind: decision.act ? String(decision.kind ?? '') : null,
        // 具体做的是哪一类活动（歇会儿 / 找点新鲜的 / 想想事…）与它的说法。
        // 以前只有三个 kind，她日账里的理由读起来像机器人。
        activityLabel: decision.act ? String((decision as any).activity?.label ?? '') : null,
        activityType: decision.act ? String((decision as any).activity?.type ?? '') : null,
        activityDesc: decision.act ? String((decision as any).activity?.description ?? '') : null,
        urge: Number(decision.urge ?? 0),
        actionsToday: Number(nextLife.actionsToday ?? 0),
        lastActionAt: Number(nextLife.lastActionAt ?? 0),
        nextCheckAt: Number(nextLife.nextCheckAt ?? 0),
      }
    },

    /**
     * 做梦系统要的判据：**必须走三态里的"睡着"**。
     * 转接头以前直接从能力包对象上取 `isAsleep`（那是模块级导出，对象上没有），
     * 结果每晚抛异常被 catch 吞掉，她一次梦都没做过。现在由本包给出绑好的函数，
     * 时段与模式都从她自己的账里读。
     */
    lifeAsleep(now: number = Date.now()): boolean {
      const life = loadLifeFile(opts.lifeFile)
      const state = loadState(opts.fieldsFile)
      return restState(life, state.fields, now, opts.timezone) === 'asleep'
    },
  }
}
