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
import { nextCheckDelay } from '../../persona-core/src/rhythm.ts'

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
  onWakeTriggered?: (info: { reason: string; hint?: string; atMs: number }) => void
  /** 她所在的时区；睡眠时段按它算（不传就用系统本地时区） */
  timezone?: string
}

function loadLifeFile(file: string): LifeMemoryView {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    // sleepWindow 要区分"没设过"（undefined → 用默认时段）与"主人明确关掉"（null → 不按时段判睡）：
    // 这个区别丢了，主人关掉时段判据这件事会在下一次读档时悄悄复原。
    const win = raw.sleepWindow === null
      ? null
      : (raw.sleepWindow && /^\d{1,2}:\d{2}$/.test(String(raw.sleepWindow.start)) && /^\d{1,2}:\d{2}$/.test(String(raw.sleepWindow.end))
        ? { start: String(raw.sleepWindow.start), end: String(raw.sleepWindow.end) }
        : undefined)
    return {
      day: String(raw.day ?? dayKey(Date.now())),
      actionsToday: Number(raw.actionsToday ?? 0),
      lastActionAt: Number(raw.lastActionAt ?? 0),
      lastCheckAt: Number(raw.lastCheckAt ?? 0),
      lastKind: raw.lastKind ?? null,
      mode: (raw.mode === 'force_sleep' || raw.mode === 'force_awake') ? raw.mode : 'auto',
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
      const { text, recalledIds } = describeStateWithTrace(state, 5, { seed: dayKey(ctx.now.getTime()) })
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
      const { text } = describeStateWithTrace(state, 3, {
        queryText,
        seed: dayKey(ctx.now.getTime()),
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
      ]
    },

    panels() {
      return [
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
                const nowMs = Date.now()
                const life = loadLifeFile(opts.lifeFile)
                const nextLife: LifeMemoryView = {
                  ...life,
                  lastCheckAt: nowMs,
                  nextCheckAt: nowMs,
                  mode: life.mode === 'force_sleep' ? 'auto' : (life.mode ?? 'auto'),
                }
                saveLifeFile(opts.lifeFile, nextLife)
                const hint = typeof params?.hint === 'string' ? params.hint.trim() : ''
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
                return { ok: true, triggeredAt: nowMs, hint, mode: nextLife.mode }
              },
            },
            setMode: {
              name: 'setMode',
              verb: 'POST',
              summary: '切换作息模式（auto / force_sleep / force_awake）',
              writable: true,
              invoke(params: { mode: RhythmMode }) {
                const mode = params?.mode
                if (mode !== 'auto' && mode !== 'force_sleep' && mode !== 'force_awake') {
                  return { ok: false, error: 'mode 必须是 auto / force_sleep / force_awake' }
                }
                const life = loadLifeFile(opts.lifeFile)
                const nextLife: LifeMemoryView = { ...life, mode }
                saveLifeFile(opts.lifeFile, nextLife)
                const state = loadState(opts.fieldsFile)
                const rest = restState(nextLife, state.fields, Date.now(), opts.timezone)
                return {
                  ok: true,
                  mode,
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
      const state = loadState(opts.fieldsFile)
      const life = loadLifeFile(opts.lifeFile)
      const reconciled = reconcileLife(
        life,
        life,
        // 第三个来源本来是因果账（用来在内存/磁盘漂移时取真值）。
        // **不能**把 life.actionsToday 当账本传进来：reconcileLife 取的是三者最大值，
        // 昨天记了 7 件的话，跨日也会被这 7 顶回来——测试「昨天的账不该带进今天」当场抓到。
        // 在因果账按天可查之前，这里就只给 0，宁可少算不可跨日串账。
        { count: 0, lastAt: 0 },
        dayKey(now),
      )
      const { decision } = decideStage({
        fields: state.fields,
        relation: (state.npcState?.current ?? 'normal') as never,
        now,
        mem: reconciled as never,
        rng: Math.random,
      })
      const delay = nextCheckDelay(Math.random)
      const nextLife: LifeMemoryView = {
        ...reconciled,
        lastCheckAt: now,
        // nextCheckAt 要写**下一拍真正会落的时间**。心跳在连续空拍时按 2^n 退避
        // （5 分钟基线 → 最长 40 分钟），若这里按 3–7 分钟写，账上就说"4 分钟后评估"，
        // 而实际是 40 分钟后——**账与事实对不上**，健康检查据此报假警（2026-11-05 线上实测）。
        // 调用方（转接头）把心跳排好的真时间传进来；没传时退回 3–7 分钟。
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
