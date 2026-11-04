/**
 * Cortico Persona 实现（把三个对内能力包翻译成 Cortico 的 Persona 契约）。
 *
 * 关键点（这正是"鱼缸里的她"和"控制台里的她"过去分裂成两个人的根治处）：
 *   ① systemSegments() 汇总三个能力包的前缀 → 任何渠道发起的一轮，她都带着同一份场值与记忆；
 *   ② onDelivery() 在消息进入上下文之前汇总记忆召回 → 任何渠道的消息都能触发同一套召回；
 *   ③ 唯一的昼夜 tick 由 cap-state-rhythm 拥有，挂在 BotParts.onStart 上。
 *
 * 这一层是薄胶水：所有语义都在 5 个能力包里。
 */
import {
  toCorticoToolDef,
  type CorticoToolDef,
} from '../../cortico-adapter/src/index.ts'
import { createXiaoyuBotHub, type XiaoyuBotHub, type XiaoyuBotHubOptions } from './index.ts'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DreamTick } from '../../cap-state-rhythm/src/dream-tick.ts'
import { isAsleep } from '../../cap-state-rhythm/src/life-stages.ts'
import { LifeHeartbeat, quietLine } from '../../cap-state-rhythm/src/life-heartbeat.ts'
import { XIAOYU_CONTEXT_DEFAULTS, type ContextStagePolicy } from './context-config.ts'

export const MAIN_SESSION = 'main'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// HERE = packages/cortico-bot-xiaoyu/src → 上两层到 packages/，再进本包 persona/
const PERSONA_DIR = path.resolve(HERE, '..', '..', 'cortico-bot-xiaoyu', 'persona')

/** 读包内正本；不存在返回 null（让调用方决定兜底）。 */
function readPersonaFile(name: string): string | null {
  try {
    const p = path.join(PERSONA_DIR, name)
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  } catch {
    return null
  }
}

/** 部署覆盖优先（主人微调的提示词是私有资产，不进代码包）；否则用包内正本。 */
function personaText(homeDir: string, name: string): string | null {
  try {
    const override = path.join(homeDir, 'prompts', name)
    if (fs.existsSync(override)) return fs.readFileSync(override, 'utf8')
  } catch {}
  return readPersonaFile(name)
}

/** Cortico Persona 的最小形状（见 Cortico src/core/types.ts:1016）。 */
export interface CorticoPersonaShape {
  systemSegments(ctx: { now: Date; timezone: string; worlds: unknown[] }): Promise<Array<{ title: string; text: string; sourceKey?: string }>>
  onDelivery?(ctx: { now: Date; timezone: string; events: ReadonlyArray<{ type: string; source: string; text?: string; atMs?: number; meta?: Record<string, unknown> }> }): Promise<string[]>
  declareSessions(): unknown[]
  ownToolNames?(): string[]
  memoryDir: string
  blobs: { put(nameHint: string, bytes: Uint8Array, mime: string): string; get(handle: string): { bytes: Uint8Array; mime: string } | null; list(prefix?: string): Array<{ handle: string; mime: string; size: number }> }
  attach(core: unknown): void
  webUi?(language?: string): unknown
}

export interface XiaoYuPersonaOptions extends XiaoyuBotHubOptions {
  rounds?: { soft: number; hard: number }
  /**
   * 心跳基准间隔（毫秒）；返回 null = 主人关了心跳。**每拍重读**，所以 WebUI 改了立刻生效。
   * 由 BotDefinition 从部署配置 `tick.intervalMinutes` 传进来。
   */
  tickDelayMs?: (now: Date) => number | null
  /**
   * 上下文阶段预算。**每拍现读**，主人在 WebUI 改了立刻生效，不用重启。
   * 不给就用 XIAOYU_CONTEXT_DEFAULTS。
   */
  context?: () => ContextStagePolicy
}

export class XiaoYuPersona implements CorticoPersonaShape {
  readonly hub: XiaoyuBotHub
  readonly memoryDir: string
  readonly blobs: CorticoPersonaShape['blobs']
  private readonly rounds: { soft: number; hard: number }
  /** 她自己醒过来的那拍（缺了它，她只在有人戳时才动——那就不是人格，是聊天窗口） */
  private heartbeat: LifeHeartbeat | null = null
  private core: any = null
  private started = false
  /** 上下文阶段预算（现读，WebUI 改了即生效） */
  private readonly contextPolicy: () => ContextStagePolicy
  /** 已经就上下文压力提醒过主人；交接后清零 */
  private pressureWarned = false

  constructor(opts: XiaoYuPersonaOptions) {
    this.hub = createXiaoyuBotHub(opts)
    this.memoryDir = opts.homeDir
    this.rounds = opts.rounds ?? { soft: 6, hard: 12 }
    this.contextPolicy = opts.context ?? ((): ContextStagePolicy => XIAOYU_CONTEXT_DEFAULTS)
    // blobs 走 workspace 的 mem: 句柄（与框架 Memory 同一套后端）
    this.blobs = {
      put: (nameHint, bytes, mime) => this.hub.blobs.put(nameHint, bytes, mime),
      get: (handle) => this.hub.blobs.get(handle),
      list: (prefix) => this.hub.blobs.list(prefix),
    }
    if (opts.tickDelayMs) {
      this.heartbeat = new LifeHeartbeat({
        baseline: opts.tickDelayMs,
        onFire: () => {
          const core = this.core
          // **在这一拍落下的当下**就把下一拍的真时间抓住。
          // 文本是延迟生成的（injectDeferred 在投递时才调 make），那时再问心跳，
          // 拿到的是"再下一拍"，而且拿到的时刻也可能已经晚到账上写不下（守卫会退回
          // 3–7 分钟随机值）。于是 2026-11-05 线上账上写"3 分钟后评估"，
          // 实际心跳在 10 分钟后——**账与事实对不上**，健康检查据此报假警。
          const nextFireAt = this.heartbeat?.nextFireAt() ?? 0
          // 文本在投递那一刻生成：先记一拍作息账，再按账上的理由说话。
          const make = () => {
            const quiet = this.heartbeat?.quietSeconds() ?? 0
            const rhythm = this.hub.capabilities.find((c) => c.id === 'state-rhythm') as any
            let tick: any = null
            try {
              tick = typeof rhythm?.lifeTick === 'function'
                ? rhythm.lifeTick(nextFireAt)
                : null
            } catch (e) {
              this.hostLog('warn', `作息对账失败（不阻断心跳）：${String((e as any)?.message ?? e)}`)
            }
            return `${quietLine(quiet)}${this.rhythmLine(tick)}`
          }
          try {
            if (typeof core?.injectDeferred === 'function') core.injectDeferred('tick', make)
            else core?.injectInternal?.(make())
          } catch (e) {
            this.hostLog('warn', `心跳投递失败：${String((e as any)?.message ?? e)}`)
          }
        },
      })
    }
  }

  /**
   * 把"这一拍的作息账"翻成她看得懂的一句话。
   *
   * 关键在**理由必须说出来**：旧架构里她不动是沉默的（decideAction 返回 act:false 就完了），
   * 于是"她今天没做事"分不清是累了的正常结果，还是循环断了。
   * 现在 gap/cap/tired/content 四种不动各有各的说法，账面上看得见。
   */
  private rhythmLine(tick: any): string {
    if (!tick) return '这一拍没人找她——她可以自己决定做点什么（看一条、记一笔、或者就待着），'
      + '但做过的事必须对得上账：没做的不写，写了的要有凭据。'
    const since = Number(tick.lastActionAt ?? 0) > 0
      ? `距上次行动 ${Math.max(0, Math.round((tick.now - Number(tick.lastActionAt)) / 60000))} 分钟`
      : '账上还没有过一次行动（刚搬家或刚清过状态，这不等于她睡了很久）'
    // 三态要说清是三态：累了歇着 ≠ 睡着了。主人那句话点的就是这个——
    // "人累了就会休息，她不也能这样？"能，但休息不触发夜间记忆结算，睡觉才触发。
    const state = tick.rest === 'asleep' ? '她在睡着时段（记忆结算与遗忘叙事在这时跑）'
      : tick.rest === 'resting' ? '她有点累，在歇着（体力慢慢回，但不算睡着，不做梦）'
      : '她醒着'
    const head = `【作息对账】${since}；今天已做 ${tick.actionsToday} 件；${state}；`
    if (!tick.shouldAct) {
      const why: Record<string, string> = {
        gap: '间隔还没到，这一拍先不动',
        cap: '今天的事做满了上限，这一拍先不动',
        tired: '体力不够，这一拍先不动',
        content: '没什么想动的理由，这一拍就待着',
      }
      return `${head}${why[String(tick.reason)] ?? `这一拍不动（理由：${tick.reason || '未知'}）`}——`
        + '不动也是账上的一笔，别为了"看起来忙"硬找事做。'
    }
    // 要动的时候，persona-core 那边已经写好了人话理由（"有点无聊，想找点新鲜的看"等），
    // 不要在这儿再编一套——两套说法迟早对不上账。
    return `${head}她想动（${tick.kind}）：${tick.reason}；冲动强度 ${Number(tick.urge).toFixed(2)}。`
      + '这一拍该做点什么，做过的事必须对得上账：没做的不写，写了的要有凭据。'
  }

  /** 框架在 declareSessions 之前把 CoreApi 交过来；这里留作能力包注入 CoreApi 的通道。 */
  attach(core: unknown): void {
    this.core = core
  }

  /**
   * 宿主日志的安全写法（2026-11-04 08:24 线上就是在这儿崩的，7799 停了半小时）。
   *
   * Cortico 的 `core.log` 是 **Logger 对象**（`info/warn/error(msg, data)`，见
   * Cortico src/core/types.ts:1181），不是 `(level, msg)` 函数。原先写成
   * `this.core?.log?.('info', msg)`：可选调用只挡 null/undefined，**挡不住
   * "属性存在但不是函数"**，于是 TypeError 从 DreamTick 的 catch 处理器里冒出去，
   * 框架按未捕获异常关机——错误处理器自己成了错误源，还把原始异常一起吞了。
   *
   * 所以这里：认对象形状优先，函数形状兜底，任何情况都不许抛。
   */
  private hostLog(level: 'info' | 'warn' | 'error', msg: string, meta?: unknown): void {
    try {
      const log: any = (this.core as any)?.log
      if (!log) return
      if (typeof log === 'function') { log(level, msg); return }
      const fn = typeof log[level] === 'function' ? log[level] : log.warn
      if (typeof fn === 'function') fn.call(log, msg, meta)
    } catch { /* 日志写不出去绝不能把她的循环带崩 */ }
  }

  /** 挂载能力包（由 BotParts.onStart 调用）。 */
  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    await this.hub.start({
      homeDir: this.memoryDir,
      dataDir: this.memoryDir,
      workspaceDir: this.memoryDir,
      pushEvent: (ev) => {
        const core = this.core
        if (core?.pushEvent) {
          core.pushEvent({
            type: ev.type,
            source: ev.source,
            senderKey: ev.source,
            text: ev.text,
            meta: ev.meta,
            atMs: ev.atMs,
          })
        }
      },
      log: (level, msg, meta) => this.hostLog(level, msg, meta),
    })
    // 做梦系统：她睡着时由记忆能力包做每日结算，归档叙事写进私人日记。
    // 与生活 tick 同源挂载（此处），全局唯一；醒着/force_awake 时循环空转。
    const stateRhythm = this.hub.capabilities.find((c) => c.id === 'state-rhythm') as any
    const memoryCap = this.hub.capabilities.find((c) => c.id === 'memory') as any
    const diaryDir = path.join(this.memoryDir, 'workspace', 'diary')
    if (stateRhythm && memoryCap) {
      const store = memoryCap.store ?? null
      // 睡着判据由能力包自己给（它绑好了时段、模式与体力）：先取 lifeAsleep()，
      // 取不到才退回模块级 isAsleep。
      // 以前是反过来——从能力包对象上找 `isAsleep`（那是模块级导出，对象上没有），
      // 于是每晚抛 "this.opts.isAsleep is not a function" 被 catch 吞掉，
      // 也就是说：**她从来没有真正做过梦**，结算与遗忘叙事一次都没跑过。
      const asleepOf = typeof stateRhythm.lifeAsleep === 'function'
        ? (_lastActionAt: number | null | undefined, now: number, _mode?: string) => stateRhythm.lifeAsleep(now)
        : (lastActionAt: number | null | undefined, now: number, mode?: string) =>
            isAsleep(lastActionAt, now, (mode ?? 'auto') as never)
      if (store) {
        this.dream = new DreamTick({
          lifeFile: path.join(this.memoryDir, 'data', 'persona', 'life.json'),
          isAsleep: asleepOf,
          settle: (days, threshold) => store.settle(days, threshold),
          dreamDigest: (r) => store.dreamDigest(r),
          onDream: (digest, count) => {
            if (!digest) return null
            try {
              const diaryFile = path.join(diaryDir, 'private.md')
              const line = `\n- [${new Date().toISOString().slice(0, 10)}] ${digest}\n`
              fs.appendFileSync(diaryFile, line, 'utf8')
              this.hostLog('info', `做梦：${count} 条记忆沉入归档，已写进私人日记`)
            } catch (e) { /* 日记写失败不影响结算本身，但要留痕 */
              this.hostLog('warn', `做梦日记写失败：${String((e as any)?.message ?? e)}`)
            }
            return digest
          },
          log: (level, msg) => this.hostLog(level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info', msg),
        })
        this.dream.start()
      }
    }
    // 心跳：她自己醒过来的那拍。**重写时漏接的就是这一条**——
    // 旧内建 bot 在 onStart 里 startRhythm()，转接头只挂了 DreamTick，
    // 于是她只在有人戳 / 来消息时才动，2026-11-04 实测 actionsToday 全天 0。
    this.heartbeat?.start()
  }

  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false
    this.heartbeat?.stop()
    this.dream?.stop()
    await this.hub.stop()
  }

  private dream: DreamTick | null = null

  /** 汇总三个对内能力包的系统前缀：场值与心情 + 核心记忆 + 意见箱主人批复。 */
  async systemSegments(ctx: { now: Date; timezone: string; worlds: unknown[] }): Promise<Array<{ title: string; text: string; sourceKey?: string }>> {
    // 人格正本在最前：CONSTITUTION（她是谁+铁律+记忆观）→ ORIENTATION（这一轮怎么做）。
    // 部署 prompts/ 覆盖优先（主人微调不进代码包）；包内 persona/ 是正本。
    const blocks: Array<{ title: string; text: string; sourceKey?: string }> = []
    const constitution = personaText(this.memoryDir, 'CONSTITUTION.md')
    if (constitution) {
      blocks.push({ title: '我的宪法', text: constitution, sourceKey: 'persona.CONSTITUTION' })
    }
    const orientation = personaText(this.memoryDir, 'ORIENTATION.md')
    if (orientation) {
      blocks.push({ title: '这一轮怎么做', text: orientation, sourceKey: 'persona.ORIENTATION' })
    }
    const capBlocks = (await this.hub.assembleSystemPrefix({ now: ctx.now, timezone: ctx.timezone })) as never
    return [...blocks, ...capBlocks]
  }

  /**
   * 消息进上下文之前：汇总三个包的召回并经 core.injectInternal 注入（跨渠道一致的自动回忆）。
   *
   * 宿主契约（src/core/loop.ts:693）：onDelivery 的**返回值会被忽略**，注入只能走
   * `core.injectInternal`（钩子执行期 Core 把它收集进当前批，排在外部正文之前）。
   * 单个能力包抛错不拖垮整批：逐包 try/catch。
   */
  async onDelivery(ctx: { now?: Date; timezone?: string; events: ReadonlyArray<{ type: string; source: string; text?: string; atMs?: number; meta?: Record<string, unknown> }> }): Promise<void> {
    // 有外部事件到达 = 她被人叫过：心跳的空拍退避清零（否则安静久了会越来越稀）。
    this.heartbeat?.noteActivity()
    // 投递路径的纪律：这里抛任何错，宿主只给一行无详情的 WARN（实测），注入全部丢失。
    // 所以整段兜底：宁可这一批不带回忆，也不能让异常冒出去。
    try {
      /**
       * **宿主在 onDelivery 上只给 `{ events }`**（Cortico src/core/loop.ts:693：
       * `persona.onDelivery?.({ events: [...delivered] })`），没有 now 也没有 timezone——
       * 与 systemSegments 的 `{now, timezone, worlds}` 不一样（loop.ts:544 那个确实给）。
       * 2026-11-04 线上实测：我们照 systemSegments 的形状写了这里，于是
       * `ctx.now.getTime()` 每拍抛 TypeError，**她每次醒来都拿不到心情与记忆召回**，
       * 只能空转（日志里成片的「onDelivery 注入失败（state-rhythm/memory）：
       * Cannot read properties of undefined (reading 'getTime')」）。
       * 所以这里自己兜底求值，不指望宿主给。
       */
      const now = ctx.now instanceof Date ? ctx.now : new Date(Number((ctx as any).nowMs ?? Date.now()))
      const timezone = (ctx as any).timezone
        ?? Intl.DateTimeFormat().resolvedOptions().timeZone
        ?? 'Asia/Shanghai'
      for (const cap of this.hub.capabilities) {
        if (!cap.onMessageDelivery) continue
        try {
          const lines = await cap.onMessageDelivery({
            now,
            timezone,
            events: ctx.events.map((e) => ({
              type: e.type,
              source: e.source,
              text: e.text ?? '',
              atMs: e.atMs ?? now.getTime(),
              meta: e.meta,
            })),
          })
          for (const line of lines) {
            if (line && line.trim()) this.core?.injectInternal?.(line)
          }
        } catch (e) {
          this.hostLog('warn', `onDelivery 注入失败（${cap.id}）：${String((e as any)?.message ?? e)}`)
        }
      }
    } catch (e) {
      // 整批兜底也要留痕：以前这里静默吞掉，线上一片"她不动"却查不到出处
      this.hostLog('warn', `onDelivery 整批注入兜底：${String((e as any)?.message ?? e)}`)
    }
  }

  /** 10 个对内工具（mood/memory/diary/judgment/feedback）挂在主会话上。 */
  ownToolNames(): string[] {
    return this.hub.tools().map((t) => t.name)
  }

  /**
   * 批末上下文压力裁量：超软阈值先提醒，再超就请求交接。
   *
   * 这段对应宿主 cormini 的 onBatchEnd（bots/cormini/persona/persona.ts:653）。
   * **以前小鱼没有这一段**，于是「上下文预算」那个旋钮即便配上去也是摆设：
   * 她的上下文只会一路涨到 Core 的物理上限才被强制交接，中间没有软预警，
   * 也没有她自己安排的交接点（交接后保留多少由 keepRatio 定）。
   *
   * 语义与宿主一致：软阈值 = 阶段预算 × softRatio；超了先注入一句速记提醒
   * （她拿到一轮落笔时间），下一批仍超才请求交接。Core 在超过物理上限时强制交接。
   */
  onBatchEnd(): void {
    const core = this.core
    if (!core) return
    try {
      const info = core.sessionInfo?.(MAIN_SESSION)
      const est = Number(info?.estTokens)
      if (!Number.isFinite(est)) return
      const { maxTokens, softRatio } = this.contextPolicy()
      const soft = maxTokens * softRatio
      if (est <= soft) {
        this.pressureWarned = false
        return
      }
      if (!this.pressureWarned) {
        this.pressureWarned = true
        core.injectInternal?.(
          `【上下文压力】这一轮结束时约 ${Math.round(est)} token，超过软阈值 ${Math.round(soft)}`
          + `（阶段预算 ${maxTokens} × ${softRatio}）。先自己把要紧的记下来——`
          + '下一轮还超就交接，把更早的对话换成一份笔记。',
        )
        return
      }
      const handed = core.requestContextHandoff?.() === true
      if (handed) this.pressureWarned = false
    } catch (e) {
      this.hostLog('warn', `上下文压力裁量失败（不阻断主循环）：${String((e as any)?.message ?? e)}`)
    }
  }

  private toolDefs(): CorticoToolDef[] {
    return this.hub.tools().map((t) => toCorticoToolDef(t as never))
  }

  declareSessions(): unknown[] {
    const self = this
    return [
      {
        id: MAIN_SESSION,
        label: 'main',
        rounds: () => ({ soft: self.rounds.soft, hard: self.rounds.hard }),
        persistent: true,
        receivesEvents: true,
        tools: () => self.toolDefs(),
      },
    ]
  }

  /** Persona 页与 Memory 页：三个能力包的面板都归这里。 */
  webUi(): unknown {
    const panels = this.hub.panels().map((p) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      // 宿主只在 panel.getMethods 里列出的方法上放行 GET（见 Cortico src/web/webui-pages.ts:323）
      getMethods: Object.values(p.methods)
        .filter((m) => m.verb === 'GET')
        .map((m) => m.name),
      methods: Object.fromEntries(
        Object.values(p.methods).map((m) => [
          m.name,
          {
            name: m.name,
            verb: m.verb,
            summary: m.summary,
            writable: m.writable,
            invoke: (args: unknown) => m.invoke(Array.isArray(args) ? (args[0] ?? {}) : (args ?? {})),
          },
        ]),
      ),
    }))
    return {
      label: '小鱼',
      panels,
      invoke: async (panel: string, method: string, args: unknown[]) => {
        const p = panels.find((x) => x.id === panel)
        if (!p) throw new Error(`Unknown panel "${panel}"`)
        const m = p.methods[method]
        if (!m) throw new Error(`Unknown method "${panel}.${method}"`)
        return await m.invoke(args)
      },
    }
  }
}
