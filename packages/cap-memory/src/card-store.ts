/**
 * 四层 Markdown 记忆卡片存储（core / active / archived / voided）。
 *
 * 目录布局（相对于 memoRoot，即 <workspace>/memo）：
 *   memo/core/<id>.md       核心常驻（flashbulb / 主人置顶）
 *   memo/active/<id>.md     近端活跃
 *   memo/archived/<id>.md   远期归档（vividness < archiveThreshold，仅参与 surprise 意外槽召回）
 *   memo/voided/<id>.md     已作废（保留原文与作废理由，永不进召回，可一键恢复）
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Memory, MemorySource } from '../../persona-core/src/types.ts'
import { clamp } from '../../persona-core/src/types.ts'
import {
  decayMemory,
  calculateEncodingStrength,
  recallMemory,
} from '../../persona-core/src/memory.ts'
import { recallMemories, type RecalledMemory } from '../../persona-core/src/retrieval.ts'
import { WorkspaceGit, AUTHOR_SELF, AUTHOR_OPERATOR, type GitAuthor } from './workspace-git.ts'

export { WorkspaceGit, AUTHOR_SELF, AUTHOR_OPERATOR }
export type { GitAuthor }

export type MemoryTier = 'core' | 'active' | 'archived' | 'voided'
export const MEMORY_TIERS: readonly MemoryTier[] = ['core', 'active', 'archived', 'voided']

export interface MemoryCard extends Memory {
  tier: MemoryTier
}

export function serializeMemoryCard(card: MemoryCard): string {
  const meta = {
    id: card.id,
    npcId: card.npcId ?? 'xiaoyu',
    sender: card.sender ?? 'npc',
    tags: Array.isArray(card.tags) ? card.tags : [],
    createdAt: card.createdAt instanceof Date ? card.createdAt.toISOString() : String(card.createdAt),
    vividness: Number(card.vividness ?? 0.9),
    accessCount: Number(card.accessCount ?? 0),
    encodingStrength: Number(card.encodingStrength ?? 0.6),
    flashbulb: Boolean(card.flashbulb),
    pinned: Boolean(card.pinned),
    source: card.source ?? 'npc_self',
    emotionValence: Number(card.emotion?.valence ?? 0),
    emotionIntensity: Number(card.emotion?.intensity ?? 0.5),
    voided: Boolean(card.voided),
    ...(card.voidedAt ? { voidedAt: card.voidedAt } : {}),
    ...(card.voidReason ? { voidReason: card.voidReason } : {}),
  }
  const lines = ['---']
  for (const [k, v] of Object.entries(meta)) {
    lines.push(`${k}: ${JSON.stringify(v)}`)
  }
  lines.push('---', String(card.content ?? '').trim(), '')
  return lines.join('\n')
}

export function parseMemoryCard(raw: string, tier: MemoryTier, fallbackId = 'mem-unknown'): MemoryCard | null {
  const text = String(raw ?? '')
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text)
  if (!m) return null
  const headerLines = m[1].split(/\r?\n/)
  const content = m[2].trim()
  const meta: Record<string, any> = {}
  for (const line of headerLines) {
    const idx = line.indexOf(':')
    if (idx < 0) continue
    const k = line.slice(0, idx).trim()
    const valStr = line.slice(idx + 1).trim()
    try {
      meta[k] = JSON.parse(valStr)
    } catch {
      meta[k] = valStr
    }
  }
  const tags = Array.isArray(meta.tags) ? meta.tags.map(String) : []
  const createdAt = meta.createdAt ? new Date(meta.createdAt) : new Date()
  return {
    id: String(meta.id ?? fallbackId),
    npcId: String(meta.npcId ?? 'xiaoyu'),
    sender: meta.sender === 'player' ? 'player' : 'npc',
    content,
    emotion: {
      valence: Number.isFinite(Number(meta.emotionValence)) ? Number(meta.emotionValence) : 0,
      intensity: Number.isFinite(Number(meta.emotionIntensity)) ? Number(meta.emotionIntensity) : 0.5,
      tags,
    },
    tags,
    vividness: clamp(Number.isFinite(Number(meta.vividness)) ? Number(meta.vividness) : 0.9, 0, 1),
    accessCount: Math.max(0, Math.floor(Number(meta.accessCount) || 0)),
    createdAt: Number.isNaN(createdAt.getTime()) ? new Date() : createdAt,
    pinned: Boolean(meta.pinned),
    encodingStrength: clamp(Number.isFinite(Number(meta.encodingStrength)) ? Number(meta.encodingStrength) : 0.6, 0, 1),
    flashbulb: Boolean(meta.flashbulb),
    source: (meta.source as MemorySource) ?? 'npc_self',
    voided: tier === 'voided' || Boolean(meta.voided),
    ...(meta.voidedAt ? { voidedAt: String(meta.voidedAt) } : {}),
    ...(meta.voidReason ? { voidReason: String(meta.voidReason) } : {}),
    tier,
  }
}

export class MemoryCardStore {
  readonly memoRoot: string
  /** 传了 git 就在每次改动后自动提交（同一工作区仓库，日记与记忆共享历史） */
  private readonly git?: WorkspaceGit

  constructor(memoRoot: string, git?: WorkspaceGit) {
    this.memoRoot = memoRoot
    this.git = git
  }

  /** 改动落盘后提交一次；没接 git 或提交失败时静默降级（文件已写成功，历史暂缺）。 */
  private commit(message: string, author: GitAuthor = AUTHOR_SELF): void {
    if (!this.git) return
    try {
      this.git.commitAll(message, author)
    } catch { /* 文件已保存；提交失败由 WorkspaceGit 记进 status().commitError */ }
  }

  private tierDir(tier: MemoryTier): string {
    return path.join(this.memoRoot, tier)
  }

  private cardPath(tier: MemoryTier, id: string): string {
    const safeId = String(id).replace(/[^a-zA-Z0-9_-]/g, '_')
    return path.join(this.tierDir(tier), `${safeId}.md`)
  }

  private writeCardAtomic(card: MemoryCard): void {
    const dir = this.tierDir(card.tier)
    fs.mkdirSync(dir, { recursive: true })
    const file = this.cardPath(card.tier, card.id)
    const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 7)}.tmp`
    fs.writeFileSync(tmp, serializeMemoryCard(card), 'utf8')
    fs.renameSync(tmp, file)
  }

  readAll(opts: { tier?: MemoryTier | 'all'; query?: string; tag?: string } = {}): MemoryCard[] {
    const targetTiers: readonly MemoryTier[] =
      opts.tier && opts.tier !== 'all' ? [opts.tier] : MEMORY_TIERS
    const out: MemoryCard[] = []
    for (const tier of targetTiers) {
      const dir = this.tierDir(tier)
      let files: string[] = []
      try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
      } catch {
        continue
      }
      for (const f of files) {
        try {
          const raw = fs.readFileSync(path.join(dir, f), 'utf8')
          const card = parseMemoryCard(raw, tier, f.replace(/\.md$/, ''))
          if (card) out.push(card)
        } catch {}
      }
    }
    const q = opts.query?.trim().toLowerCase() ?? ''
    const tagFilter = opts.tag?.trim().toLowerCase() ?? ''
    return out
      .filter((c) => {
        if (q && !c.content.toLowerCase().includes(q) && !c.id.toLowerCase().includes(q) && !c.tags.some((t) => t.toLowerCase().includes(q))) {
          return false
        }
        if (tagFilter && !c.tags.some((t) => t.toLowerCase() === tagFilter)) {
          return false
        }
        return true
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }

  findById(id: string): MemoryCard | null {
    for (const tier of MEMORY_TIERS) {
      const p = this.cardPath(tier, id)
      if (fs.existsSync(p)) {
        try {
          return parseMemoryCard(fs.readFileSync(p, 'utf8'), tier, id)
        } catch {}
      }
    }
    return null
  }

  create(input: {
    id?: string
    content: string
    sender?: 'player' | 'npc'
    tags?: string[]
    tier?: 'core' | 'active'
    vividness?: number
    intensity?: number
    mood?: number
    source?: MemorySource
    milestone?: boolean
    createdAt?: Date | string
  }): MemoryCard {
    const id = input.id?.trim() || `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const tags = Array.isArray(input.tags) ? input.tags.map((t) => String(t).trim()).filter(Boolean) : []
    const intensity = clamp(Number(input.intensity ?? 0.5), 0, 1)
    const milestone = Boolean(input.milestone) || input.tier === 'core' || tags.includes('milestone')
    const tier: MemoryTier = input.tier ?? (milestone ? 'core' : 'active')
    const createdAt = input.createdAt ? new Date(input.createdAt) : new Date()
    const card: MemoryCard = {
      id,
      npcId: 'xiaoyu',
      sender: input.sender ?? 'npc',
      content: String(input.content ?? '').trim(),
      emotion: { valence: Number(input.mood ?? 0), intensity, tags },
      tags,
      vividness: clamp(Number(input.vividness ?? 0.9), 0, 1),
      accessCount: 0,
      createdAt,
      pinned: tier === 'core',
      encodingStrength: calculateEncodingStrength(intensity),
      flashbulb: milestone,
      source: input.source ?? 'npc_self',
      voided: false,
      tier,
    }
    this.writeCardAtomic(card)
    this.commit(`memory: 记下「${card.content.slice(0, 24)}」(${tier})`, input.sender === 'player' ? AUTHOR_OPERATOR : AUTHOR_SELF)
    return card
  }

  rememberFirst(content: string, tag: string, opts: { sender?: 'player' | 'npc'; mood?: number; source?: MemorySource; tags?: string[] } = {}): MemoryCard {
    const existing = this.readAll({ tier: 'all' }).some((c) => !c.voided && c.tags.includes(tag))
    const allTags = [...new Set([...(opts.tags ?? []), tag])]
    return this.create({
      content,
      sender: opts.sender ?? 'npc',
      tags: allTags,
      tier: existing ? 'active' : 'core',
      milestone: !existing,
      mood: opts.mood ?? 0,
      source: opts.source ?? 'npc_self',
    })
  }

  update(input: {
    id: string
    content?: string
    tags?: string[]
    vividness?: number
    tier?: 'core' | 'active' | 'archived'
  }): { ok: true; card: MemoryCard } | { ok: false; error: string } {
    const existing = this.findById(input.id)
    if (!existing) return { ok: false, error: `找不到记忆卡片: ${input.id}` }
    const oldPath = this.cardPath(existing.tier, existing.id)
    const nextTier: MemoryTier = input.tier ?? existing.tier
    const updated: MemoryCard = {
      ...existing,
      content: input.content !== undefined ? String(input.content).trim() : existing.content,
      tags: input.tags !== undefined ? input.tags.map((t) => String(t).trim()).filter(Boolean) : existing.tags,
      vividness: input.vividness !== undefined ? clamp(Number(input.vividness), 0, 1) : existing.vividness,
      tier: nextTier,
      pinned: nextTier === 'core',
      flashbulb: nextTier === 'core' ? true : existing.flashbulb,
      voided: nextTier === 'voided',
    }
    this.writeCardAtomic(updated)
    if (nextTier !== existing.tier && fs.existsSync(oldPath)) {
      try { fs.unlinkSync(oldPath) } catch {}
    }
    this.commit(`memory: ${nextTier === existing.tier ? '修改' : `移入 ${nextTier}`}「${updated.content.slice(0, 24)}」`, AUTHOR_OPERATOR)
    return { ok: true, card: updated }
  }

  voidCard(
    sel: { id?: string; match?: string },
    reason: string,
    now = Date.now(),
  ): { ok: true; card: MemoryCard } | { ok: false; error: string; candidates?: string[] } {
    const cleanReason = String(reason ?? '').trim()
    if (cleanReason.length < 6) {
      return { ok: false, error: '作废理由至少 6 个字（需留痕以便日后复盘）' }
    }
    const pool = this.readAll({ tier: 'all' }).filter((c) => c.tier !== 'voided' && !c.voided)
    const hits = sel.id
      ? pool.filter((c) => c.id === sel.id)
      : pool.filter((c) => sel.match && c.content.toLowerCase().includes(sel.match.trim().toLowerCase()))
    if (hits.length === 0) return { ok: false, error: '没有找到匹配的未作废记忆' }
    if (hits.length > 1) {
      return {
        ok: false,
        error: `匹配到 ${hits.length} 条记忆，请指定唯一 id`,
        candidates: hits.map((h) => `${h.id}: ${h.content.slice(0, 30)}`),
      }
    }
    const target = hits[0]
    const oldPath = this.cardPath(target.tier, target.id)
    const voidedCard: MemoryCard = {
      ...target,
      tier: 'voided',
      voided: true,
      voidedAt: new Date(now).toISOString(),
      voidReason: cleanReason,
    }
    this.writeCardAtomic(voidedCard)
    if (fs.existsSync(oldPath)) {
      try { fs.unlinkSync(oldPath) } catch {}
    }
    this.commit(`memory: 作废「${target.content.slice(0, 24)}」（${cleanReason.slice(0, 30)}）`)
    return { ok: true, card: voidedCard }
  }

  restoreCard(id: string, targetTier: 'active' | 'core' = 'active'): { ok: true; card: MemoryCard } | { ok: false; error: string } {
    const existing = this.findById(id)
    if (!existing) return { ok: false, error: `找不到记忆卡片: ${id}` }
    const oldPath = this.cardPath(existing.tier, existing.id)
    const restored: MemoryCard = {
      ...existing,
      tier: targetTier,
      voided: false,
      voidedAt: undefined,
      voidReason: undefined,
      pinned: targetTier === 'core',
    }
    this.writeCardAtomic(restored)
    if (existing.tier !== targetTier && fs.existsSync(oldPath)) {
      try { fs.unlinkSync(oldPath) } catch {}
    }
    this.commit(`memory: 恢复「${restored.content.slice(0, 24)}」→ ${targetTier}`, AUTHOR_OPERATOR)
    return { ok: true, card: restored }
  }

  recall(opts: {
    text?: string
    terms?: string[]
    mood?: number
    k?: number
    surprises?: number
    seed?: string
    now?: number
    applyBoost?: boolean
  } = {}): RecalledMemory[] {
    const now = opts.now ?? Date.now()
    const coreAndActive = [...this.readAll({ tier: 'core' }), ...this.readAll({ tier: 'active' })]
    const archived = this.readAll({ tier: 'archived' })
    const mainPicked = recallMemories(coreAndActive, {
      now,
      k: opts.k ?? 3,
      surprises: 0,
      text: opts.text,
      terms: opts.terms,
      mood: opts.mood ?? 0,
      seed: opts.seed,
    })
    const surprisePool = [...coreAndActive, ...archived]
    const withSurprise = recallMemories(surprisePool, {
      now,
      k: 0,
      surprises: opts.surprises ?? 1,
      text: opts.text,
      mood: opts.mood ?? 0,
      seed: opts.seed,
      excludeIds: mainPicked.map((m) => m.id),
    })
    const combined = [...mainPicked, ...withSurprise]
    if (opts.applyBoost) {
      for (const hit of combined) {
        const card = this.findById(hit.id)
        if (card && card.tier !== 'voided') {
          const boosted = recallMemory(card)
          this.writeCardAtomic({ ...card, vividness: boosted.vividness, accessCount: boosted.accessCount })
        }
      }
    }
    return combined
  }

  /**
   * 每日结算：对 active 层做自然衰减，低于 archiveThreshold（默认 0.35）的自动移入 archived/。
   * 记忆观「遗忘叙事化」：返回本轮归档条目的摘要，调用方（做梦/日记）把它写成她看得见的一行。
   */
  settle(days = 1, archiveThreshold = 0.35): { decayed: number; archivedIds: string[]; archived: Array<{ id: string; content: string }> } {
    const activeCards = this.readAll({ tier: 'active' })
    const archivedIds: string[] = []
    const archived: Array<{ id: string; content: string }> = []
    for (const card of activeCards) {
      const next = decayMemory(card, days)
      if (!card.flashbulb && !card.pinned && next.vividness < archiveThreshold) {
        const oldPath = this.cardPath('active', card.id)
        this.writeCardAtomic({ ...card, vividness: next.vividness, tier: 'archived' })
        if (fs.existsSync(oldPath)) {
          try { fs.unlinkSync(oldPath) } catch {}
        }
        archivedIds.push(card.id)
        archived.push({ id: card.id, content: card.content })
      } else {
        this.writeCardAtomic({ ...card, vividness: next.vividness })
      }
    }
    this.commit(`memory: 每日结算（${activeCards.length} 条在册，${archivedIds.length} 条沉入归档）`)
    return { decayed: activeCards.length, archivedIds, archived }
  }

  /**
   * 做梦 · 记忆结算文本：把本轮结算翻译成她第一人称的一小段（供睡眠期写进日记/前缀）。
   * 没有归档时返回 null——不是每晚都有旧事沉底，别硬凑。
   */
  dreamDigest(settleResult: ReturnType<MemoryCardStore['settle']>): string | null {
    if (!settleResult.archived.length) return null
    const items = settleResult.archived
      .slice(0, 3)
      .map((a) => `「${a.content.slice(0, 30)}」`)
      .join('、')
    const more = settleResult.archived.length > 3 ? `等 ${settleResult.archived.length} 件` : ''
    return `夜里结算记忆：${items}${more} 想不太清了，只剩个轮廓。原文都还在（git 兜底），哪天被提起还会回来。`
  }
}
