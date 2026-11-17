/**
 * 音视频创作工作室的 Cortico World 实现（kind: "world", api: 6, id: "media-studio"）。
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
import { createMediaStudioCapability, type MediaStudioCapabilityOptions } from '../../cap-media-studio/src/index.ts'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 环境提示词模板（同 bili world 的理由：契约要求"使用时机"写进提示词）。 */
const ENV_PROMPT_FILE = fileURLToPath(new URL('./ENV_PROMPT.md', import.meta.url))

/** 本机 ffmpeg 的默认位置（与 tools/video-build.mjs 用的是同一处）。 */
export function defaultMediaBinDir(): string {
  return path.join(homedir(), '.dsh', 'bili-whale', 'bin')
}

/**
 * MiMo 的 usage → 宿主的 LLMUsage（`promptTokens/completionTokens/cacheHitTokens/cacheMissTokens`）。
 * 兼容 OpenAI 风格下划线键；**四个必需字段缺一个就返回 null**，让调用方跳过记账而不是填 0 冒充。
 * 为什么宁可不记：`promptTokens: 0` 在成本报表里是"这次调用免费"，比"未知"更误导。
 */
function toHostUsage(raw: Record<string, unknown>): {
  promptTokens: number
  completionTokens: number
  cacheHitTokens: number
  cacheMissTokens: number
  reasoningTokens?: number
} | null {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)
  const input = num(raw.promptTokens ?? raw.prompt_tokens)
  const output = num(raw.completionTokens ?? raw.completion_tokens)
  if (input === null || output === null) return null
  const hit = num(raw.cacheHitTokens ?? raw.cache_hit_tokens ?? raw.prompt_cache_hit_tokens) ?? 0
  const missRaw = num(raw.cacheMissTokens ?? raw.cache_miss_tokens ?? raw.prompt_cache_miss_tokens)
  // 没给 cache 拆分时按"缓存命中 0、全部未命中"记，这是成本口径的上界（宁可高估不高估不漏）
  const miss = missRaw ?? Math.max(0, input - hit)
  const reasoning = num(raw.reasoningTokens ?? raw.reasoning_tokens)
  return {
    promptTokens: input,
    completionTokens: output,
    cacheHitTokens: hit,
    cacheMissTokens: miss,
    ...(reasoning === null ? {} : { reasoningTokens: reasoning }),
  }
}

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
  /**
   * 宿主给 World 用的自报用量口（Cortico: `WorldCtx.reportUsage`）。
   * 可选：最小宿主（stub）不实现也必须能跑——所以本包只在有它时才上报。
   * 这里用本地结构类型声明，不 import 宿主类型（本包仍宿主无关）。
   */
  reportUsage?: (
    usage: { promptTokens: number; completionTokens: number; cacheHitTokens: number; cacheMissTokens: number; reasoningTokens?: number },
    opts?: { model?: string; label?: string },
  ) => void
}

export interface MediaWorldOptions extends MediaStudioCapabilityOptions {
  id?: string
  label?: string
}

export function createMediaWorld(opts: MediaWorldOptions) {
  const id = opts.id ?? 'media-studio'
  const label = opts.label ?? '小鱼 · 音视频工作室'
  // host 要到 start() 才拿到，而 cap 在工厂期就建好了：用一个可填的口把两边接起来。
  // 宿主没接 reportUsage（最小 stub）时这里是 undefined，cap 侧只跳过记账，不做别的。
  let hostUsage: CorticoWorldHost['reportUsage'] | undefined
  let hostLog: HostLogLike = undefined
  const cap = createMediaStudioCapability({
    ...opts,
    binDir: opts.binDir ?? defaultMediaBinDir(),
    onUsage: (u) => {
      if (!hostUsage) return
      const mapped = toHostUsage(u.usage)
      if (!mapped) {
        emitHostLog(hostLog, 'warn', `[media] MiMo 用量字段不完整，本次不记账：${JSON.stringify(Object.keys(u.usage ?? {}))}`)
        return
      }
      try {
        hostUsage(mapped, { model: u.model, label: 'media-studio · 配音' })
      } catch (e) {
        emitHostLog(hostLog, 'warn', `[media] 上报配音用量失败：${String((e as Error)?.message ?? e)}`)
      }
    },
  })
  const world = {
    id,
    label,

    tools(): CorticoToolDef[] {
      return cap.tools().map((t) => toCorticoToolDef(t as never))
    },

    webUi() {
      const panels = cap.panels().map((p) => toCorticoPanelDecl(p as never))
      return {
        label,
        panels,
        promptDocs: [
          {
            key: 'worlds.media-studio.envPrompt',
            title: '音视频工作室环境提示词',
            description: '告诉她这间工作室能做什么、什么时候值得出片、出片慢不要反复调。',
            path: ENV_PROMPT_FILE,
            role: 'envPrompt',
            vars: [
              { name: 'media.assets', description: '可用底图与 CC0 曲目数量' },
              { name: 'media.toolchain', description: 'ffmpeg 是否可用' },
            ],
          },
        ],
        invoke: (panel: string, method: string, args: unknown[]) =>
          invokePanelMethod(cap.panels() as never, panel, method, args),
      }
    },

    /** 环境提示词变量：曲库与工具链状态（她要不要提议出片，先看有没有素材与工具）。 */
    envPromptVars(): Record<string, string> | null {
      try {
        const assets = cap.panels()[0]?.methods.listAssets?.invoke({}) as any
        const ffmpegReady = Boolean(assets?.toolchain?.ffmpegReady)
        const tracks = Array.isArray(assets?.bgmTracks) ? assets.bgmTracks.length : 0
        const images = Array.isArray(assets?.images) ? assets.images.length : 0
        return {
          'media.assets': `可用底图 ${images} 张，CC0 曲目 ${tracks} 首`,
          'media.toolchain': ffmpegReady ? 'ffmpeg 可用，可以出片' : 'ffmpeg 不可用，出不了片',
        }
      } catch {
        return null
      }
    },

    async start(host: CorticoWorldHost): Promise<void> {
      hostUsage = host.reportUsage?.bind(host)
      hostLog = host.log
      cap.start?.({
        homeDir: opts.outputDir,
        dataDir: opts.outputDir,
        workspaceDir: opts.outputDir,
        pushEvent: (ev) => {
          host.pushEvent({
            type: ev.type,
            source: ev.source,
            senderKey: ev.source,
            text: ev.text,
            meta: ev.meta,
            atMs: ev.atMs,
          })
        },
        log: (level, msg, meta) => emitHostLog(host.log, level, `${msg}${meta ? ' ' + JSON.stringify(meta) : ''}`),
      })
    },

    async stop(): Promise<void> {
      await cap.stop?.()
    },
  }

  return { definition: { id, label, defaults: () => ({ enabled: true, ...cap.defaultConfig }) }, world, capability: cap }
}
