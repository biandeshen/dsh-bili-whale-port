/**
 * 控制台图片 World（kind: "world", api: 6, id: "console-image"）。
 *
 * 为什么做成 World 而不是 bot 的 persona 工具（2026-11-20 实测的硬约束）：
 * 看图要三样东西——`store`（列出控制台上还有哪些图）、`blob`（取字节）、
 * `modelFacts`（这个模型收不收图）。宿主的 `WorldHost` 三样都有，
 * 而交给 Persona 的 `CoreApi` 只有 `blob`，连 `store` 都没有。
 * 所以 persona 侧最多只能"按句柄看一张"，做不出"还有哪些图"与"看不看得了"；
 * 而 World 侧完整。这是宿主契约的形状，不是我们的选择。
 *
 * 业务逻辑全在 `cap-console-image`（宿主无关、纯注入）；这里只负责把
 * 宿主的三个口子接进去。换底座时只需重写这层。
 */
import {
  toCorticoToolDef,
  toCorticoPanelDecl,
  invokePanelMethod,
  emitHostLog,
  type CorticoToolDef,
  type CorticoPanelDecl,
  type HostLogLike,
} from '../../cortico-adapter/src/index.ts'
import {
  createConsoleImageCapability,
  type ConsoleImage,
  type ConsoleImageOptions,
} from '../../../capabilities/cap-console-image/src/index.ts'

/**
 * 宿主的 WorldHost 里本 World 用得到的那几样（见 Cortico src/core/types.ts:684-730）。
 * 只声明用到的字段，不 import 宿主类型——本包自身保持宿主无关。
 */
export interface CorticoWorldHost {
  pushEvent(e: {
    type: string
    source: string
    senderKey?: string
    text?: string
    meta?: Record<string, unknown>
    atMs?: number
  }, opts?: Record<string, unknown>): void
  log?: HostLogLike
  /** 事件库读取口。 */
  store: {
    range(q: {
      fromCursor?: number
      toCursor?: number
      fromTs?: string
      toTs?: string
      senderKey?: string
      source?: string
      origin?: 'internal' | 'external'
      limit?: number
    }): Array<{
      cursor: number
      type?: string
      ts?: string
      senderKey?: string
      meta?: Record<string, unknown>
      blobs?: Array<{ handle: string; mime: string; fallbackText?: string }>
    }>
  }
  /** 解析 log:/mem: 句柄。 */
  blob(handle: string): { bytes: Uint8Array; mime: string } | null
  /** 当前模型的事实：收不收图。 */
  modelFacts: {
    model(): string
    accepts(mime: string): boolean
  }
}

export interface ConsoleImageWorldOptions {
  id?: string
  label?: string
  /**
   * 从哪个来源读图。宿主内置 console 写的 source 就是 `console`。
   * 给成别的值就只认那个来源——换底座/换渠道时改这里，不动业务。
   */
  source?: string
  /** 清单最多摆几张。 */
  inventoryMax?: number
}

/** 事件里的图片按新→旧摊平，同句柄只留第一次（最新的那次）。 */
function inventoryFrom(host: CorticoWorldHost, source: string, limit: number): ConsoleImage[] {
  const events = host.store.range({ source, limit: 200 })
  const seen = new Set<string>()
  const out: ConsoleImage[] = []
  for (const e of [...events].reverse()) {
    for (const b of e.blobs ?? []) {
      if (!b.mime.startsWith('image/') || seen.has(b.handle)) continue
      seen.add(b.handle)
      out.push({
        handle: b.handle,
        from: String(e.meta?.from ?? e.senderKey ?? '?'),
        at: String(e.ts ?? ''),
        fallbackText: String(b.fallbackText ?? ''),
        mime: b.mime,
      })
      if (out.length >= limit) return out
    }
  }
  return out
}

export function createConsoleImageWorld(opts: ConsoleImageWorldOptions = {}) {
  const id = opts.id ?? 'console-image'
  const label = opts.label ?? '小鱼 · 看控制台的图'
  const source = opts.source ?? 'console'
  const inventoryMax = opts.inventoryMax ?? 12

  /** 宿主句柄；`start()` 时交来。没启动时三个注入函数都返回"没有"，而不是抛。 */
  let host: CorticoWorldHost | null = null

  const capOpts: ConsoleImageOptions = {
    listImages: () => (host ? inventoryFrom(host, source, inventoryMax) : []),
    readImage: (handle) => (host ? host.blob(handle) : null),
    acceptsImage: () => {
      if (!host) return { model: '未知模型', accepts: false }
      try {
        return { model: host.modelFacts.model(), accepts: host.modelFacts.accepts('image/png') }
      } catch {
        return { model: '未知模型', accepts: false }
      }
    },
  }
  const cap = createConsoleImageCapability(capOpts)

  const world = {
    id,
    label,

    tools(): CorticoToolDef[] {
      return cap.tools().map((t) => toCorticoToolDef(t as never))
    },

    webUi(language?: string) {
      const panels = cap.panels().map((p) => toCorticoPanelDecl(p as never))
      return {
        label,
        panels,
        invoke: (panel: string, method: string, args: unknown[]) =>
          invokePanelMethod(cap.panels() as never, panel, method, args),
      }
    },

    /** 挂载：把宿主句柄收下来。没有它工具会说"还没起来"，不会假装能看。 */
    async start(h: CorticoWorldHost): Promise<void> {
      host = h
      emitHostLog(h.log, 'info', `${label} 就绪（图片来源：${source}）`)
    },

    async stop(): Promise<void> {
      host = null
    },
  }

  return { definition: { id, label, defaults: () => ({ enabled: true, ...cap.defaultConfig }) }, world, capability: cap }
}

// ── Cortico 装载入口（默认导出）──────────────────────────────────────────────

const TOOL_SUMMARIES: Record<string, string> = {
  console_see_image: '看控制台上发来的图片（回执带上图片内容，下一轮请求就能看到）',
}

const definition = {
  id: 'console-image',
  label: '小鱼 · 看控制台的图',
  defaults: () => ({ enabled: true }),
  create(ctx: { botDir?: string; dataDir?: string; cfg?: Record<string, any> } = {}) {
    const cfg = (ctx.cfg?.consoleImage ?? {}) as { source?: string; inventoryMax?: number }
    const w = createConsoleImageWorld({
      ...(cfg.source ? { source: String(cfg.source) } : {}),
      ...(Number(cfg.inventoryMax) > 0 ? { inventoryMax: Number(cfg.inventoryMax) } : {}),
    })
    return w.world
  },
  describe: {
    tools: Object.entries(TOOL_SUMMARIES).map(([name, summary]) => ({
      name,
      summary,
      description: summary,
      parameters: { type: 'object', properties: {} },
      tags: [],
    })),
    events: [],
  },
}

export default definition
