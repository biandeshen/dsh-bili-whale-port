/**
 * cortico-bot-xiaoyu —— 对内能力「一拖三」薄转接头（kind: "bot", api: 7）。
 *
 * 职责：
 * - 将 3 个宿主无关的对内能力包（cap-state-rhythm / cap-memory / cap-journal）组装为一个统一的人格中枢；
 * - 汇总 3 个能力包的系统前缀（contextSegments）、入站消息动态注入（onMessageDelivery）、
 *   10 个对内工具（tools）以及 3 个可写主人操作台（tank / memory-center / journal-board）；
 * - 向下适配 Cortico BotDefinition（api: 7），同时暴露宿主无关的 `createXiaoyuBotHub` 供任意底座直接挂载。
 */
import path from 'node:path'
import {
  validateCapabilityContract,
  type XiaoyuCapability,
  type CapabilityHost,
  type TurnContext,
  type DeliveryContext,
  type PrefixBlock,
  type ToolRegistration,
  type CapabilityPanelDecl,
} from '../../persona-core/src/capability.ts'
import {
  createStateRhythmCapability,
  loadState,
} from '../../cap-state-rhythm/src/index.ts'
import { createMemoryCapability } from '../../cap-memory/src/index.ts'
import { createJournalCapability } from '../../cap-journal/src/index.ts'

export interface XiaoyuBotHubOptions {
  homeDir: string
  onWakeTriggered?: (info: { reason: string; hint?: string; atMs: number }) => void
  onRuleConverted?: (rule: { kind: 'dislike' | 'keyword' | 'exemptUp'; value: string }) => void
}

export interface XiaoyuBotHub {
  readonly id: 'cortico-bot-xiaoyu'
  readonly api: 7
  readonly declares: readonly string[]
  readonly capabilities: readonly XiaoyuCapability<any>[]
  start(host: CapabilityHost): Promise<void>
  stop(): Promise<void>
  assembleSystemPrefix(ctx: TurnContext): Promise<PrefixBlock[]>
  assembleDeliveryInjections(ctx: DeliveryContext): Promise<string[]>
  tools(): ToolRegistration<any, any>[]
  panels(): CapabilityPanelDecl[]
  invokePanel(panelId: string, method: string, params?: Record<string, unknown>): Promise<unknown>
}

export function createXiaoyuBotHub(opts: XiaoyuBotHubOptions): XiaoyuBotHub {
  const dataPersonaDir = path.join(opts.homeDir, 'data', 'persona')
  const workspaceDir = path.join(opts.homeDir, 'workspace')
  const fieldsFile = path.join(dataPersonaDir, 'fields.json')
  const lifeFile = path.join(dataPersonaDir, 'life.json')

  const stateRhythmCap = createStateRhythmCapability({
    fieldsFile,
    lifeFile,
    onWakeTriggered: opts.onWakeTriggered,
  })

  const memoryCap = createMemoryCapability({
    memoRoot: path.join(workspaceDir, 'memo'),
    workspaceDir,
    getCurrentMood: () => loadState(fieldsFile).fields.mood,
  })

  const journalCap = createJournalCapability({
    publicDiaryFile: path.join(workspaceDir, 'diary', 'public.md'),
    privateDiaryFile: path.join(workspaceDir, 'diary', 'private.md'),
    judgmentFile: path.join(dataPersonaDir, 'judgment.jsonl'),
    feedbackFile: path.join(dataPersonaDir, 'feedback.jsonl'),
    onRuleConverted: opts.onRuleConverted,
    git: memoryCap.git ?? undefined,
  })

  const capabilities: readonly XiaoyuCapability<any>[] = [
    stateRhythmCap,
    memoryCap,
    journalCap,
  ]

  for (const cap of capabilities) {
    const check = validateCapabilityContract(cap)
    if (!check.ok) {
      throw new Error(`Capability "${cap.id}" failed contract validation: ${check.errors.join('; ')}`)
    }
  }

  return {
    id: 'cortico-bot-xiaoyu',
    api: 7,
    declares: ['console', 'bili-account', 'media-studio'],
    capabilities,

    async start(host: CapabilityHost) {
      for (const cap of capabilities) {
        await cap.start?.(host)
      }
    },

    async stop() {
      for (const cap of capabilities) {
        await cap.stop?.()
      }
    },

    async assembleSystemPrefix(ctx: TurnContext): Promise<PrefixBlock[]> {
      const blocks: PrefixBlock[] = []
      for (const cap of capabilities) {
        if (cap.contextSegments) {
          const segs = await cap.contextSegments(ctx)
          blocks.push(...segs)
        }
      }
      return blocks
    },

    async assembleDeliveryInjections(ctx: DeliveryContext): Promise<string[]> {
      const lines: string[] = []
      for (const cap of capabilities) {
        if (cap.onMessageDelivery) {
          const items = await cap.onMessageDelivery(ctx)
          lines.push(...items)
        }
      }
      return lines
    },

    tools(): ToolRegistration<any, any>[] {
      return capabilities.flatMap((c) => [...c.tools()])
    },

    panels(): CapabilityPanelDecl[] {
      return capabilities.flatMap((c) => [...c.panels()])
    },

    async invokePanel(panelId: string, method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      const panel = this.panels().find((p) => p.id === panelId)
      if (!panel) throw new Error(`Unknown panel "${panelId}"`)
      const m = panel.methods[method]
      if (!m) throw new Error(`Unknown method "${panelId}.${method}"`)
      return await m.invoke(params)
    },
  }
}

export default createXiaoyuBotHub
