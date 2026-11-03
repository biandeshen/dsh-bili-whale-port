/**
 * cortico-world-media —— 音视频创作能力薄转接头（kind: "world", api: 6, id: "media-studio"）。
 */
import {
  validateCapabilityContract,
} from '../../persona-core/src/capability.ts'
import {
  createMediaStudioCapability,
  type MediaStudioCapabilityOptions,
} from '../../cap-media-studio/src/index.ts'

export function createMediaWorldAdapter(opts: MediaStudioCapabilityOptions) {
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

export default createMediaWorldAdapter
