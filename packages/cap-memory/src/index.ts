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
  StorageUnit,
} from '../../persona-core/src/capability.ts'
import path from 'node:path'
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
import { recallMemories, RECALL_WEIGHTS } from '../../persona-core/src/retrieval.ts'

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
  /**
   * 现读记忆分层配置（核心常驻上限 / 活跃容量 / 归档阈值）。
   *
   * 为什么是"现读"而不是构造时传一次：主人在 WebUI「配置」页签改完要**立刻生效**，
   * 不用重启（与心跳间隔同一条规矩）。
   *
   * 以前这三个数只在 `configSchema` 里**声明**过，**没有任何代码读它们**——
   * 核心常驻上限是硬编码的 `slice(0, 8)`，归档阈值是函数默认参数 0.35。
   * 空旋钮比没旋钮更坏：主人以为设了，其实改了没用。
   */
  getConfig?: () => Partial<MemoryCapabilityConfig>
}

/** 三个数的默认值（与 configSchema 里的 default 一致）。 */
export const MEMORY_DEFAULTS: MemoryCapabilityConfig = {
  residentCap: 8,
  activeCap: 40,
  archiveThreshold: 0.35,
}

export function createMemoryCapability(
  opts: MemoryCapabilityOptions,
): XiaoyuCapability<MemoryCapabilityConfig> & { readonly git: GitWorkspaceMemory['git'] | null; readonly store: MemoryCardStore } {
  const workspace = opts.workspaceDir ? new GitWorkspaceMemory({ memoryDir: opts.workspaceDir }) : null
  const store = new MemoryCardStore(opts.memoRoot, workspace?.git ?? undefined)

  /** 现读配置（主人在 WebUI 改完立刻生效，不用重启）。 */
  const cfg = (): MemoryCapabilityConfig => {
    const raw = opts.getConfig?.() ?? {}
    const num = (v: unknown, def: number, min: number, max: number) => {
      const n = Number(v)
      if (!Number.isFinite(n)) return def
      return Math.max(min, Math.min(max, Math.round(n)))
    }
    return {
      residentCap: num(raw.residentCap, MEMORY_DEFAULTS.residentCap, 1, 30),
      activeCap: num(raw.activeCap, MEMORY_DEFAULTS.activeCap, 10, 200),
      archiveThreshold: Math.max(0.05, Math.min(0.8, Number(raw.archiveThreshold ?? MEMORY_DEFAULTS.archiveThreshold) || MEMORY_DEFAULTS.archiveThreshold)),
    }
  }

  /**
   * 可清除存储单元：主人的「数据清理」页据此列出她攒了什么、能清哪一项。
   *
   * 以前本包**没有声明**任何存储单元——于是她在 WebUI 的「数据清理」里
   * 什么都看不见（审计 §2.x F12：数据清理分级）。
   * 现在按层分开列，主人能看清"哪一层有多少、删了会怎样"：
   *   · 核心常驻（core）：删掉 = 她真的不再记得这些；
   *   · 近期活跃（active）：删掉 = 最近的记忆没了；
   *   · 远期归档（archived）：删掉 = 沉下去的那些也清掉（原文在 git 里，还能回滚）；
   *   · 已作废（voided）：删掉 = 作废记录也没了（不可恢复，danger）。
   *
   * 记忆卡片本身**不删**（core 尤其不删）：她的账是她的历史，
   * 要清得走面板上的作废/归档动作，不是在清理页里一把梭。
   */
  const storageParts = (): StorageUnit[] => {
    const unit = (tier: MemoryTier, label: string, note: string, danger = false): StorageUnit => ({
      key: `memory.${tier}`,
      label,
      kind: 'disk',
      location: path.join(opts.memoRoot, tier),
      danger,
      note,
      stat: () => {
        const s = store.tierSize(tier)
        return `${s.count} 条 / ${(s.bytes / 1024).toFixed(0)} KB`
      },
    })
    return [
      unit('core', '核心常驻记忆', '她每一轮都记得的那些。清理页里只报数量，不提供删除——要让她放下某条，走记忆中心「移出核心」。'),
      unit('active', '近期活跃记忆', '最近在用的记忆。'),
      unit('archived', '远期归档记忆', '已经沉下去、偶尔会被想起的那些。原文在 git 里，还能回滚。'),
      unit('voided', '已作废记忆', '作废过的条目（原文仍在）。删掉这段记录不可恢复。', true),
    ]
  }

  return {
    id: 'memory',
    title: '四层记忆系统',
    kind: 'internal',
    git: workspace?.git ?? null,
    /** 做梦系统（睡眠期结算）等内部协作者经此取 store；不属于 XiaoyuCapability 公共面 */
    store,
    storageParts,
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
      // 核心常驻条数上限**真的生效**（以前是硬编码 slice(0, 8)，
      // 配置里的 residentCap 改了也没人读——空旋钮比没旋钮更坏）。
      const conf = cfg()
      const allCore = store.readAll({ tier: 'core' })
      const coreCards = allCore.slice(0, conf.residentCap)
      const activeCount = store.readAll({ tier: 'active' }).length
      const archivedCount = store.readAll({ tier: 'archived' }).length
      const coreLines = coreCards.map(
        (c) => `- [${c.id}] (${c.sender === 'player' ? '主人' : '我'}) ${c.content}`,
      )
      const text = [
        coreLines.length ? `【核心常驻记忆（${coreLines.length} 条）】\n${coreLines.join('\n')}` : '【核心常驻记忆】（暂无）',
        `【记忆池规模】活跃 ${activeCount} 条 · 远期归档 ${archivedCount} 条（可用 memory_recall 主动翻阅）`,
        // 超额的要说出来：主人能看见"她实际只带着 8 条，还有 14 条在 core 层躺着"
        allCore.length > conf.residentCap
          ? `【核心常驻超额】core 层共 ${allCore.length} 条，本轮只带前 ${conf.residentCap} 条（上限可在「配置」页改）；其余仍在常驻层，可手动退下来。`
          : '',
      ].filter(Boolean).join('\n')
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
            /**
             * 召回解释：把「她为什么想起这条」摊开给人看（F11 · 审计 §2.2 深挖项）。
             *
             * 以前面板只有一句「和眼下的事有关（80%）」，看不到分数是怎么凑出来的；
             * 检索那四个因子（关键词 / 鲜活 / 情绪 / 新鲜）就在 `retrieval.ts` 里，
             * 打分完就扔了。现在把它们连同权重与实际贡献分一起返回。
             *
             * **只读**：这一条路径绝不能改她的账（`applyBoost` 为假、
             * 不碰 accessCount / vividness）——面板是给人看的，看一眼不该让记忆变旧。
             */
            recallExplain: {
              name: 'recallExplain',
              verb: 'GET',
              summary: '按情境词打分她的记忆，返回四因子（关键词/鲜活/情绪/新鲜）的原值、权重与贡献分',
              writable: false,
              invoke(params: { text?: string; mood?: number; limit?: number; seed?: string }) {
                const text = String(params?.text ?? '').trim()
                if (!text) return { ok: false, error: '先写一句「当时在想什么」，我才好照着算' }
                const now = Date.now()
                const pool = [
                  ...store.readAll({ tier: 'core' }),
                  ...store.readAll({ tier: 'active' }),
                  ...store.readAll({ tier: 'archived' }),
                ]
                const scored = recallMemories(pool, {
                  now,
                  k: Math.min(200, Math.max(1, Number(params?.limit ?? 20))),
                  surprises: 0,
                  text,
                  mood: Number.isFinite(params?.mood) ? Number(params!.mood) : 0,
                  seed: params?.seed,
                })
                return {
                  ok: true,
                  query: text,
                  weights: { ...RECALL_WEIGHTS },
                  poolSize: pool.length,
                  items: scored.map((r) => ({
                    id: r.id,
                    content: r.content,
                    score: r.score,
                    slot: r.slot,
                    why: r.why,
                    factors: r.factors,
                    faded: Boolean(r.faded),
                    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
                  })),
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
                // 直接放进核心常驻也要过上限（同一把尺子）
                if ((params.tier ?? 'core') === 'core') {
                  const conf = cfg()
                  const coreCount = store.readAll({ tier: 'core' }).length
                  if (coreCount >= conf.residentCap) {
                    return {
                      ok: false,
                      error: `核心常驻已经有 ${coreCount} 条（上限 ${conf.residentCap} 条），`
                        + '塞不进新的了。可以先进「近期活跃」，或者在「配置」页把上限调大。',
                    }
                  }
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
                // 置进核心常驻要过上限：超了就说不许，别默默塞进去
                // （core 层每轮都进她的上下文，多一条就是多一份注意力）。
                if (params.tier === 'core') {
                  const conf = cfg()
                  const coreCount = store.readAll({ tier: 'core' }).length
                  const already = store.findById(params.id)?.tier === 'core'
                  if (!already && coreCount >= conf.residentCap) {
                    return {
                      ok: false,
                      error: `核心常驻已经有 ${coreCount} 条（上限 ${conf.residentCap} 条），`
                        + '要先退下来一条才放得进新的。上限可在「配置」页改。',
                    }
                  }
                }
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
