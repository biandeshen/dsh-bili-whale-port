/**
 * cortico-world-media —— 音视频创作工作室薄转接头（kind: "world", api: 6, World id: "media-studio"）。
 */
import path from 'node:path'
import { homedir } from 'node:os'
import { validateCapabilityContract } from '../../persona-core/src/capability.ts'
import {
  createMediaStudioCapability,
  type MediaStudioCapabilityOptions,
} from '../../cap-media-studio/src/index.ts'
import { createMediaWorld, defaultMediaBinDir, type MediaWorldOptions, type CorticoWorldHost } from './cortico-world.ts'

export { createMediaWorld, defaultMediaBinDir }
export type { MediaWorldOptions, CorticoWorldHost }

export interface MediaWorldAdapterOptions extends MediaStudioCapabilityOptions {
  homeDir: string
}

export function createMediaWorldAdapter(opts: MediaWorldAdapterOptions) {
  const cap = createMediaStudioCapability(opts)
  const check = validateCapabilityContract(cap)
  if (!check.ok) {
    throw new Error(`cap-media-studio contract validation failed: ${check.errors.join('; ')}`)
  }
  return {
    id: 'media-studio' as const,
    label: '小鱼 · 音视频工作室',
    kind: 'world' as const,
    api: 6 as const,
    capability: cap,
    defaults: () => ({ enabled: true, ...cap.defaultConfig }),
    configSchema: cap.configSchema,
    tools: () => cap.tools(),
    panels: () => cap.panels(),
    invokePanel: async (panelId: string, method: string, params: Record<string, unknown> = {}) => {
      const p = cap.panels().find((x) => x.id === panelId)
      if (!p) throw new Error(`Unknown panel "${panelId}"`)
      const m = p.methods[method]
      if (!m) throw new Error(`Unknown method "${panelId}.${method}"`)
      return await m.invoke(params)
    },
  }
}

// ── Cortico 装载入口（默认导出）──────────────────────────────────────────────

function defaultHomeDir(): string {
  return path.join(homedir(), '.xiaoyu-home')
}

const definition = {
  id: 'media-studio',
  label: '小鱼 · 音视频工作室',
  defaults: () => ({ enabled: true }),
  create(ctx: { botDir?: string; dataDir?: string }) {
    const botDir = ctx.botDir ?? defaultHomeDir()
    const w = createMediaWorld({
      homeDir: botDir,
      assetsDir: path.join(botDir, 'data', 'media', 'assets'),
      bgmDir: path.join(botDir, 'data', 'media', 'bgm'),
      outputDir: path.join(botDir, 'data', 'media', 'out'),
      binDir: defaultMediaBinDir(),
    } as never)
    return w.world
  },
  describe: {
    tools: [
      {
        name: 'media_tts_preview',
        summary: '合成一段台词的 TTS 语音试听（默认茉莉音色）',
        description: '合成一段台词的 TTS 语音试听（默认茉莉音色）',
        parameters: { type: 'object', properties: {} },
        tags: [],
      },
      {
        name: 'media_video_build',
        summary: '选底图、台词与 CC0 BGM 合成竖屏短视频及 9:16 / 16:9 双封面',
        description: '选底图、台词与 CC0 BGM 合成竖屏短视频及 9:16 / 16:9 双封面',
        parameters: { type: 'object', properties: {} },
        tags: [],
      },
    ],
    events: [],
  },
}

export default definition
