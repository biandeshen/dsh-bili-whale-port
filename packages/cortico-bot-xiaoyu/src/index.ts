/**
 * cortico-bot-xiaoyu —— 对内能力「一拖三」薄转接头（kind: "bot", api: 7）。
 *
 * 职责：
 * - 将 4 个宿主无关的对内能力包（cap-state-rhythm / cap-memory / cap-journal / cap-vision）组装为一个统一的人格中枢；
 * - 汇总 4 个能力包的**全部**工具与 4 个可写主人操作台（tank / memory-center / journal-board / vision）——
 *   工具数以 `hub.tools().length` 实测为准，不在注释里写死（写过 10，加一个包就过期了）；
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
import { GitWorkspaceMemory } from '../../cap-memory/src/workspace.ts'
import { createJournalCapability } from '../../cap-journal/src/index.ts'
import { createVisionCapability, type OfflineOptions } from '../../cap-vision/src/index.ts'

export interface XiaoyuBotHubOptions {
  homeDir: string
  onWakeTriggered?: (info: { reason: string; hint?: string; atMs: number }) => void
  onRuleConverted?: (rule: { kind: 'dislike' | 'keyword' | 'exemptUp'; value: string }) => void
  /** 看画面：注入管道替身（测试）或指定 ffmpeg（宿主已有那份） */
  vision?: { analyze?: (file: string, opts: OfflineOptions) => Promise<unknown>; ffmpegPath?: string }
}

export interface XiaoyuBotHub {
  readonly id: 'cortico-bot-xiaoyu'
  readonly api: 7
  readonly declares: readonly string[]
  readonly capabilities: readonly XiaoyuCapability<any>[]
  /** mem: 附件后端（工作区 blobs/） */
  readonly blobs: {
    put(nameHint: string, bytes: Uint8Array, mime: string): string
    get(handle: string): { bytes: Uint8Array; mime: string } | null
    list(prefix?: string): Array<{ handle: string; mime: string; size: number }>
  }
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

  const workspace = new GitWorkspaceMemory({ memoryDir: workspaceDir })

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
  // 看画面（V-Now）：判帧/装箱/出图用 vendor 的 dsh-see-now 管道，缺 ffmpeg 只降级不报错。
  // dataDir 直接给到 <home>/data/vision（包内不再加一层，2026-11-04 浏览器实测踩过双重嵌套）。
  // 拼图留在 data 下不进工作区：她的记忆 git 不该收二进制。
  const visionCap = createVisionCapability({
    dataDir: path.join(opts.homeDir, 'data', 'vision'),
    ...(opts.vision?.analyze ? { analyze: opts.vision.analyze } : {}),
    ...(opts.vision?.ffmpegPath ? { ffmpegPath: opts.vision.ffmpegPath } : {}),
  })

  const capabilities: readonly XiaoyuCapability<any>[] = [
    stateRhythmCap,
    memoryCap,
    journalCap,
    visionCap,
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
    blobs: workspace.blobs,

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
