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

export const MAIN_SESSION = 'main'

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
}

export class XiaoYuPersona implements CorticoPersonaShape {
  readonly hub: XiaoyuBotHub
  readonly memoryDir: string
  readonly blobs: CorticoPersonaShape['blobs']
  private readonly rounds: { soft: number; hard: number }
  private core: any = null
  private started = false

  constructor(opts: XiaoYuPersonaOptions) {
    this.hub = createXiaoyuBotHub(opts)
    this.memoryDir = opts.homeDir
    this.rounds = opts.rounds ?? { soft: 6, hard: 12 }
    // blobs 走 workspace 的 mem: 句柄（与框架 Memory 同一套后端）
    this.blobs = {
      put: (nameHint, bytes, mime) => this.hub.blobs.put(nameHint, bytes, mime),
      get: (handle) => this.hub.blobs.get(handle),
      list: (prefix) => this.hub.blobs.list(prefix),
    }
  }

  /** 框架在 declareSessions 之前把 CoreApi 交过来；这里留作能力包注入 CoreApi 的通道。 */
  attach(core: unknown): void {
    this.core = core
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
      log: (level, msg, meta) => {
        this.core?.log?.(level, `${msg}${meta ? ' ' + JSON.stringify(meta) : ''}`)
      },
    })
  }

  async stop(): Promise<void> {
    if (!this.started) return
    this.started = false
    await this.hub.stop()
  }

  /** 汇总三个对内能力包的系统前缀：场值与心情 + 核心记忆 + 意见箱主人批复。 */
  async systemSegments(ctx: { now: Date; timezone: string; worlds: unknown[] }): Promise<Array<{ title: string; text: string; sourceKey?: string }>> {
    return (await this.hub.assembleSystemPrefix({ now: ctx.now, timezone: ctx.timezone })) as never
  }

  /** 消息进上下文之前：汇总三个包的召回注入（跨渠道一致的自动回忆）。 */
  async onDelivery(ctx: { now: Date; timezone: string; events: ReadonlyArray<{ type: string; source: string; text?: string; atMs?: number; meta?: Record<string, unknown> }> }): Promise<string[]> {
    const lines = await this.hub.assembleDeliveryInjections({
      now: ctx.now,
      timezone: ctx.timezone,
      events: ctx.events.map((e) => ({
        type: e.type,
        source: e.source,
        text: e.text ?? '',
        atMs: e.atMs ?? ctx.now.getTime(),
        meta: e.meta,
      })),
    })
    // 只保留有内容的注入；空数组表示这一批没有额外上下文
    return lines.filter((l) => l && l.trim().length > 0)
  }

  /** 10 个对内工具（mood/memory/diary/judgment/feedback）挂在主会话上。 */
  ownToolNames(): string[] {
    return this.hub.tools().map((t) => t.name)
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
