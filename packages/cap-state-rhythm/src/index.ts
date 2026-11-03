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
  restRecovery,
  decideStage,
  applyActionRecord,
  gapLeft,
  SLEEP_AFTER_MS,
  type RhythmMode,
  type LifeMemoryView,
} from './life-stages.ts'

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
  restRecovery,
  decideStage,
  applyActionRecord,
  gapLeft,
  SLEEP_AFTER_MS,
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
}

function loadLifeFile(file: string): LifeMemoryView {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    return {
      day: String(raw.day ?? dayKey(Date.now())),
      actionsToday: Number(raw.actionsToday ?? 0),
      lastActionAt: Number(raw.lastActionAt ?? 0),
      lastCheckAt: Number(raw.lastCheckAt ?? 0),
      lastKind: raw.lastKind ?? null,
      mode: (raw.mode === 'force_sleep' || raw.mode === 'force_awake') ? raw.mode : 'auto',
      nextCheckAt: Number(raw.nextCheckAt ?? 0),
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
                const asleep = isAsleep(life.lastActionAt, Date.now(), life.mode ?? 'auto')
                return {
                  ok: true,
                  fields: state.fields,
                  mood,
                  asleep,
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
                return {
                  ok: true,
                  mode,
                  asleep: isAsleep(nextLife.lastActionAt, Date.now(), mode),
                }
              },
            },
          },
        },
      ]
    },
  }
}
