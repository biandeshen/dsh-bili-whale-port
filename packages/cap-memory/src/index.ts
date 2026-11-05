/**
 * @xiaoyu/cap-memory —— 四层记忆系统扩展包（100% 宿主无关）。
 *
 * 包含：
 * - 四层 Markdown 卡片存储（core / active / archived / voided）
 * - 系统前缀常驻注入 + 消息送达时按情境与 mood 自动召回（带 surprise 旧事槽）
 * - 模型工具：memory_remember、memory_recall、memory_void
 * - 主人操作台 `memory-center`（记忆管理中心）：list / create / update / void / restore
 */
import type {
  XiaoyuCapability,
  TurnContext,
  DeliveryContext,
  PrefixBlock,
} from '../../persona-core/src/capability.ts'
import { dayKey } from '../../persona-core/src/rhythm.ts'
import {
  MemoryCardStore,
  serializeMemoryCard,
  parseMemoryCard,
  MEMORY_TIERS,
  type MemoryTier,
  type MemoryCard,
} from './card-store.ts'
import { GitWorkspaceMemory } from './workspace.ts'

export {
  MemoryCardStore,
  serializeMemoryCard,
  parseMemoryCard,
  MEMORY_TIERS,
  GitWorkspaceMemory,
}
export type { MemoryTier, MemoryCard }

export interface MemoryCapabilityConfig {
  residentCap: number
  activeCap: number
  archiveThreshold: number
}

export interface MemoryCapabilityOptions {
  memoRoot: string
  getCurrentMood?: () => number
  /** 工作区根（memo 的上级，含 diary/）。给了就在这个根上建 git 仓：记忆与日记共享版本历史 */
  workspaceDir?: string
}

export function createMemoryCapability(
  opts: MemoryCapabilityOptions,
): XiaoyuCapability<MemoryCapabilityConfig> & { readonly git: GitWorkspaceMemory['git'] | null; readonly store: MemoryCardStore } {
  const workspace = opts.workspaceDir ? new GitWorkspaceMemory({ memoryDir: opts.workspaceDir }) : null
  const store = new MemoryCardStore(opts.memoRoot, workspace?.git ?? undefined)

  return {
    id: 'memory',
    title: '四层记忆系统',
    kind: 'internal',
    git: workspace?.git ?? null,
    /** 做梦系统（睡眠期结算）等内部协作者经此取 store；不属于 XiaoyuCapability 公共面 */
    store,
    configSchema: {
      type: 'object',
      title: '记忆分层与衰减阈值',
      properties: {
        residentCap: {
          type: 'integer',
          title: '核心常驻记忆条数上限（core）',
          default: 8,
          minimum: 1,
          maximum: 30,
          'x-hot': true,
        },
        activeCap: {
          type: 'integer',
          title: '近期活跃记忆容量（active）',
          default: 40,
          minimum: 10,
          maximum: 200,
          'x-hot': true,
        },
        archiveThreshold: {
          type: 'number',
          title: '归档鲜活度阈值（低于该值移入 archived）',
          default: 0.35,
          minimum: 0.05,
          maximum: 0.8,
          'x-hot': true,
        },
      },
    },
    defaultConfig: {
      residentCap: 8,
      activeCap: 40,
      archiveThreshold: 0.35,
    },

    async contextSegments(ctx: TurnContext): Promise<readonly PrefixBlock[]> {
      const coreCards = store.readAll({ tier: 'core' }).slice(0, 8)
      const activeCount = store.readAll({ tier: 'active' }).length
      const archivedCount = store.readAll({ tier: 'archived' }).length
      const coreLines = coreCards.map(
        (c) => `- [${c.id}] (${c.sender === 'player' ? '主人' : '我'}) ${c.content}`,
      )
      const text = [
        coreLines.length ? `【核心常驻记忆（${coreLines.length} 条）】\n${coreLines.join('\n')}` : '【核心常驻记忆】（暂无）',
        `【记忆池规模】活跃 ${activeCount} 条 · 远期归档 ${archivedCount} 条（可用 memory_recall 主动翻阅）`,
      ].join('\n')
      return [
        {
          title: '记忆摘要',
          text,
          sourceKey: 'persona.memory',
        },
      ]
    },

    async onMessageDelivery(ctx: DeliveryContext): Promise<readonly string[]> {
      const queryText = ctx.events.map((e) => e.text).join(' ')
      const mood = opts.getCurrentMood ? opts.getCurrentMood() : 0
      const recalled = store.recall({
        text: queryText,
        mood,
        k: 3,
        surprises: 1,
        seed: dayKey(ctx.now.getTime()),
        now: ctx.now.getTime(),
        applyBoost: true,
      })
      if (!recalled.length) return []
      const lines = recalled.map((r) => {
        const who = r.sender === 'player' ? '主人' : '我'
        const prefix = r.slot === 'surprise' ? '忽然想起' : '想起'
        return `- ${prefix}｜${who}（${r.why.join('·')}）：${r.content}`
      })
      return [`【本轮关联记忆】\n${lines.join('\n')}`]
    },

    tools() {
      return [
        {
          name: 'memory_remember',
          summary: '记下一条新的记忆卡片',
          description: '将值得记住的事件、主人的话或自己的里程碑感受存入记忆库。',
          parameters: {
            type: 'object',
            properties: {
              content: { type: 'string', description: '要记住的内容正文' },
              tags: { type: 'array', description: '标签列表', items: { type: 'string' } },
              milestone: { type: 'boolean', description: '是否是第一次/刻在心里的里程碑事件' },
              firstTag: { type: 'string', description: '可选：按该标签判"同类第一次才点亮里程碑"' },
            },
            required: ['content'],
          },
          mutatesState: true,
          execute(args: { content: string; tags?: string[]; milestone?: boolean; firstTag?: string }) {
            const mood = opts.getCurrentMood ? opts.getCurrentMood() : 0
            if (args.firstTag) {
              const card = store.rememberFirst(args.content, args.firstTag, {
                sender: 'npc',
                mood,
                tags: args.tags,
              })
              return { ok: true, id: card.id, tier: card.tier, flashbulb: card.flashbulb }
            }
            const card = store.create({
              content: args.content,
              sender: 'npc',
              tags: args.tags,
              milestone: args.milestone,
              mood,
              source: 'npc_self',
            })
            return { ok: true, id: card.id, tier: card.tier, flashbulb: card.flashbulb }
          },
        },
        {
          name: 'memory_recall',
          summary: '按话题或关键词检索记忆库',
          description: '在核心、活跃与远期归档记忆中检索相关往事。',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '要回忆的话题或关键词' },
              k: { type: 'integer', description: '返回条数（默认 5）' },
            },
            required: ['query'],
          },
          execute(args: { query: string; k?: number }) {
            const mood = opts.getCurrentMood ? opts.getCurrentMood() : 0
            const hits = store.recall({
              text: args.query,
              mood,
              k: args.k ?? 5,
              surprises: 1,
              applyBoost: true,
            })
            return { ok: true, count: hits.length, items: hits }
          },
        },
        {
          name: 'memory_void',
          summary: '作废一条记错的记忆（保留原文留痕，退出召回）',
          description: '点名 id 或唯一匹配正文片段，附上 ≥6 字的理由将该条记忆盖章移入 voided/。',
          parameters: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '记忆卡片 id' },
              match: { type: 'string', description: '或唯一匹配的正文子串' },
              reason: { type: 'string', description: '作废理由（至少 6 个字）' },
            },
            required: ['reason'],
          },
          mutatesState: true,
          execute(args: { id?: string; match?: string; reason: string }) {
            return store.voidCard({ id: args.id, match: args.match }, args.reason)
          },
        },
      ]
    },

    panels() {
      return [
        {
          id: 'memory-center',
          title: '记忆管理中心',
          description: '四层记忆卡片全量检索、直接塞一条记忆给她、在线编辑正文/标签/鲜活度、置顶进核心、一键作废与恢复',
          methods: {
            list: {
              name: 'list',
              verb: 'GET',
              summary: '按层级（all/core/active/archived/voided）、关键词或标签检索记忆卡片',
              writable: false,
              invoke(params: { tier?: MemoryTier | 'all'; query?: string; tag?: string }) {
                const items = store.readAll({
                  tier: params?.tier ?? 'all',
                  query: params?.query,
                  tag: params?.tag,
                })
                const all = store.readAll({ tier: 'all' })
                return {
                  ok: true,
                  counts: {
                    total: all.length,
                    core: all.filter((c) => c.tier === 'core').length,
                    active: all.filter((c) => c.tier === 'active').length,
                    archived: all.filter((c) => c.tier === 'archived').length,
                    voided: all.filter((c) => c.tier === 'voided').length,
                  },
                  items,
                }
              },
            },
            create: {
              name: 'create',
              verb: 'POST',
              summary: '主人直接新建一条记忆塞给她（可选直接置入 core 核心常驻）',
              writable: true,
              invoke(params: {
                content: string
                tags?: string[]
                tier?: 'core' | 'active'
                vividness?: number
                sender?: 'player' | 'npc'
              }) {
                if (!params?.content || !String(params.content).trim()) {
                  return { ok: false, error: '记忆正文不能为空' }
                }
                const card = store.create({
                  content: String(params.content).trim(),
                  tags: params.tags ?? [],
                  tier: params.tier ?? 'core',
                  vividness: params.vividness ?? 1.0,
                  sender: params.sender ?? 'player',
                  source: 'user_said',
                  milestone: (params.tier ?? 'core') === 'core',
                })
                return { ok: true, card }
              },
            },
            update: {
              name: 'update',
              verb: 'POST',
              summary: '在线修改记忆正文、标签、鲜活度权重，或调整层级（置顶 core / 移入 active / 归档 archived）',
              writable: true,
              invoke(params: {
                id: string
                content?: string
                tags?: string[]
                vividness?: number
                tier?: 'core' | 'active' | 'archived'
              }) {
                if (!params?.id) return { ok: false, error: '缺少记忆 id' }
                return store.update(params)
              },
            },
            void: {
              name: 'void',
              verb: 'POST',
              summary: '一键作废指定记忆并移入 voided/',
              writable: true,
              invoke(params: { id: string; reason: string }) {
                if (!params?.id) return { ok: false, error: '缺少记忆 id' }
                return store.voidCard({ id: params.id }, params.reason || '主人在记忆管理面板手动点作废')
              },
            },
            restore: {
              name: 'restore',
              verb: 'POST',
              summary: '将已作废或已归档的记忆恢复回 active 或 core',
              writable: true,
              invoke(params: { id: string; targetTier?: 'active' | 'core' }) {
                if (!params?.id) return { ok: false, error: '缺少记忆 id' }
                return store.restoreCard(params.id, params.targetTier ?? 'active')
              },
            },
            history: {
              name: 'history',
              verb: 'GET',
              summary: '查看工作区（记忆+日记）的版本历史、当前状态与可用 checkpoint',
              writable: false,
              invoke(params: { path?: string; limit?: number; diffOf?: string; fileAt?: { hash: string; path: string } }) {
                if (!workspace) {
                  return { ok: false, error: '未接 workspace（没有 git 版本历史）' }
                }
                const g = workspace.git
                if (params?.diffOf) {
                  try {
                    return { ok: true, diff: g.diff(params.diffOf, params.path ? { path: params.path } : undefined) }
                  } catch (e: any) {
                    return { ok: false, error: String(e?.message ?? e) }
                  }
                }
                if (params?.fileAt) {
                  try {
                    return { ok: true, content: g.fileAt(params.fileAt.hash, params.fileAt.path) }
                  } catch (e: any) {
                    return { ok: false, error: String(e?.message ?? e) }
                  }
                }
                return {
                  ok: true,
                  status: g.status(),
                  log: g.log({ path: params?.path, limit: params?.limit ?? 20 }),
                  logStat: g.logStat({ path: params?.path, limit: 10 }),
                }
              },
            },
            checkpoint: {
              name: 'checkpoint',
              verb: 'POST',
              summary: '打一个可回滚的存档点（annotated tag）',
              writable: true,
              invoke(params: { name: string; message?: string }) {
                if (!workspace) return { ok: false, error: '未接 workspace（没有 git 版本历史）' }
                try {
                  workspace.git.tag(String(params?.name ?? ''), String(params?.message ?? ''))
                  return { ok: true, checkpoints: workspace.git.listTags() }
                } catch (e: any) {
                  return { ok: false, error: String(e?.message ?? e) }
                }
              },
            },
            rollback: {
              name: 'rollback',
              verb: 'POST',
              summary: '回滚整个工作区到某个 checkpoint（reset --hard：之后的改动丢弃，慎用）',
              writable: true,
              invoke(params: { name: string; confirm: boolean }) {
                if (!workspace) return { ok: false, error: '未接 workspace（没有 git 版本历史）' }
                if (params?.confirm !== true) {
                  return { ok: false, error: '回滚会丢弃该 checkpoint 之后的所有记忆与日记改动，需显式传 confirm: true' }
                }
                // 名字为空要当场说清，不能让它走到 checkoutTag 报「没有这个 checkpoint:」（看不出是没选到）
                const name = String(params?.name ?? '').trim()
                if (!name) return { ok: false, error: '没选到存档点：请在「存档点与回滚」那一行点回滚' }
                try {
                  workspace.git.checkoutTag(name)
                  return { ok: true, rolledBackTo: name, checkpoints: workspace.git.listTags() }
                } catch (e: any) {
                  return { ok: false, error: String(e?.message ?? e) }
                }
              },
            },
          },
        },
      ]
    },
  }
}
