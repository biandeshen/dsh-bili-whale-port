/**
 * cortico-world-bilibili —— B 站整域能力薄转接头（kind: "world", api: 6, id: "bili-account"）。
 *
 * 职责：
 * - 将宿主无关的 `@xiaoyu/cap-bilibili` 包装为 Cortico WorldDefinition（api: 6）；
 * - World ID 沿用 `bili-account`（避开上游内建直播 World `bilibili`，且保持现有配置键零迁移）。
 */
import path from 'node:path'
import {
  validateCapabilityContract,
  type CapabilityHost,
  type TurnContext,
} from '../../persona-core/src/capability.ts'
import {
  createBilibiliCapability,
  type BilibiliCapabilityOptions,
} from '../../cap-bilibili/src/index.ts'

export interface BiliWorldAdapterOptions extends Omit<BilibiliCapabilityOptions, 'dataDir'> {
  homeDir: string
}

export function createBiliWorldAdapter(opts: BiliWorldAdapterOptions) {
  const dataDir = path.join(opts.homeDir, 'data', 'bilibili')
  const cap = createBilibiliCapability({
    ...opts,
    dataDir,
  })
  const check = validateCapabilityContract(cap)
  if (!check.ok) {
    throw new Error(`cap-bilibili contract validation failed: ${check.errors.join('; ')}`)
  }

  return {
    id: 'bili-account' as const,
    label: '小鱼 · B站账号',
    kind: 'world' as const,
    api: 6 as const,
    capability: cap,
    defaults: () => ({ enabled: true, ...cap.defaultConfig }),
    configSchema: cap.configSchema,
    start: (host: CapabilityHost) => cap.start?.(host),
    stop: () => cap.stop?.(),
    envPrompt: async (ctx: TurnContext) => {
      const segs = (await cap.contextSegments?.(ctx)) ?? []
      return segs.map((s) => s.text).join('\n\n')
    },
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

export default createBiliWorldAdapter
