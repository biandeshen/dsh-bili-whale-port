/**
 * 音视频创作工作室的 Cortico World 实现（kind: "world", api: 6, id: "media-studio"）。
 */
import {
  toCorticoToolDef,
  toCorticoPanelDecl,
  invokePanelMethod,
  type CorticoToolDef,
  type CorticoPanelDecl,
} from '../../cortico-adapter/src/index.ts'
import { createMediaStudioCapability, type MediaStudioCapabilityOptions } from '../../cap-media-studio/src/index.ts'
import { homedir } from 'node:os'
import path from 'node:path'

/** 本机 ffmpeg 的默认位置（与 tools/video-build.mjs 用的是同一处）。 */
export function defaultMediaBinDir(): string {
  return path.join(homedir(), '.dsh', 'bili-whale', 'bin')
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
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void
}

export interface MediaWorldOptions extends MediaStudioCapabilityOptions {
  id?: string
  label?: string
}

export function createMediaWorld(opts: MediaWorldOptions) {
  const id = opts.id ?? 'media-studio'
  const label = opts.label ?? '小鱼 · 音视频工作室'
  const cap = createMediaStudioCapability({
    ...opts,
    binDir: opts.binDir ?? defaultMediaBinDir(),
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
        log: (level, msg, meta) => host.log?.(level, `${msg}${meta ? ' ' + JSON.stringify(meta) : ''}`),
      })
    },

    async stop(): Promise<void> {
      await cap.stop?.()
    },
  }

  return { definition: { id, label, defaults: () => ({ enabled: true, ...cap.defaultConfig }) }, world, capability: cap }
}
