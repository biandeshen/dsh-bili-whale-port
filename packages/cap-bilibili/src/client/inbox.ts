/**
 * B 站四路收件箱合一（dm 私信 / reply 回复我的 / mention @我的 / like 收到的赞）
 * 以及主人指派动作（ask_her_reply / ignore / block_user）与看片偏好过滤规则。
 */
import fs from 'node:fs'
import path from 'node:path'

export type InboxKind = 'dm' | 'reply' | 'mention' | 'like'

export interface InboxItem {
  key: string
  kind: InboxKind
  uid: string
  who: string
  text: string
  atMs: number
  ref?: { bvid?: string; rpid?: string; dynId?: string }
  read: boolean
  assignedAction?: 'ask_her_reply' | 'ignore' | 'block_user'
  ownerHint?: string
}

export interface WatchPreferences {
  like: string[]
  dislike: string[]
  keywords: string[]
  exemptUps: string[]
  minDurationSec: number
}

export const DEFAULT_WATCH_PREFS: WatchPreferences = {
  like: ['传统艺术与手艺', '自然与动物', '历史与人文', '长纪录片', '声音采样'],
  dislike: ['引导冥想', '睡眠瑜伽', '跟练打卡', '吃播', '开箱'],
  keywords: ['雨声', '纪录片', '手艺'],
  exemptUps: [],
  minDurationSec: 600,
}

export class BiliInboxAndPrefsStore {
  readonly dataDir: string
  private readonly inboxFile: string
  private readonly blockedUidsFile: string
  private readonly prefsFile: string

  constructor(dataDir: string) {
    this.dataDir = dataDir
    this.inboxFile = path.join(dataDir, 'inbox-items.json')
    this.blockedUidsFile = path.join(dataDir, 'blocked-uids.json')
    this.prefsFile = path.join(dataDir, 'watch-prefs.json')
  }

  readBlockedUids(): string[] {
    try {
      const list = JSON.parse(fs.readFileSync(this.blockedUidsFile, 'utf8'))
      return Array.isArray(list) ? list.map(String) : []
    } catch {
      return []
    }
  }

  private saveBlockedUids(uids: string[]): void {
    fs.mkdirSync(this.dataDir, { recursive: true })
    fs.writeFileSync(this.blockedUidsFile, JSON.stringify([...new Set(uids)], null, 2), 'utf8')
  }

  readAllInbox(): InboxItem[] {
    try {
      const items: InboxItem[] = JSON.parse(fs.readFileSync(this.inboxFile, 'utf8'))
      const blocked = new Set(this.readBlockedUids())
      return items
        .map((it) => ({
          ...it,
          // B 站 10 位秒时间戳自动归一为 13 位毫秒（防 1970 年死循环 bug）
          atMs: it.atMs > 0 && it.atMs < 1e11 ? it.atMs * 1000 : Number(it.atMs || Date.now()),
        }))
        .filter((it) => !blocked.has(String(it.uid)))
        .sort((a, b) => b.atMs - a.atMs)
    } catch {
      return []
    }
  }

  saveAllInbox(items: InboxItem[]): void {
    fs.mkdirSync(this.dataDir, { recursive: true })
    const tmp = `${this.inboxFile}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(items, null, 2), 'utf8')
    fs.renameSync(tmp, this.inboxFile)
  }

  ingestItems(incoming: Array<Omit<InboxItem, 'read'>>): { added: InboxItem[] } {
    const existing = this.readAllInbox()
    const byKey = new Map(existing.map((x) => [x.key, x]))
    const blocked = new Set(this.readBlockedUids())
    const added: InboxItem[] = []
    for (const raw of incoming) {
      if (blocked.has(String(raw.uid))) continue
      const normalizedAtMs = raw.atMs > 0 && raw.atMs < 1e11 ? raw.atMs * 1000 : Number(raw.atMs || Date.now())
      if (!byKey.has(raw.key)) {
        const item: InboxItem = { ...raw, atMs: normalizedAtMs, read: false }
        byKey.set(raw.key, item)
        added.push(item)
      }
    }
    if (added.length > 0) {
      this.saveAllInbox([...byKey.values()])
    }
    return { added }
  }

  listInbox(opts: { kind?: InboxKind | 'all'; unreadOnly?: boolean } = {}): InboxItem[] {
    return this.readAllInbox().filter((x) => {
      if (opts.kind && opts.kind !== 'all' && x.kind !== opts.kind) return false
      if (opts.unreadOnly && x.read) return false
      return true
    })
  }

  ackItems(keys: string[]): { acked: number } {
    const keySet = new Set(keys)
    const all = this.readAllInbox()
    let acked = 0
    const next = all.map((x) => {
      if (keySet.has(x.key) && !x.read) {
        acked++
        return { ...x, read: true }
      }
      return x
    })
    this.saveAllInbox(next)
    return { acked }
  }

  assignAction(
    input: {
      itemKey: string
      action: 'ask_her_reply' | 'ignore' | 'block_user'
      ownerHint?: string
    },
    onWakeForReply?: (item: InboxItem, ownerHint?: string) => void,
  ): { ok: true; item: InboxItem } | { ok: false; error: string } {
    const all = this.readAllInbox()
    const idx = all.findIndex((x) => x.key === input.itemKey)
    if (idx < 0) return { ok: false, error: `找不到收件箱条目: ${input.itemKey}` }
    const target = all[idx]
    const updated: InboxItem = {
      ...target,
      read: input.action === 'ignore' || input.action === 'block_user' ? true : target.read,
      assignedAction: input.action,
      ...(input.ownerHint ? { ownerHint: input.ownerHint.trim() } : {}),
    }
    all[idx] = updated
    this.saveAllInbox(all)

    if (input.action === 'block_user' && target.uid) {
      this.saveBlockedUids([...this.readBlockedUids(), String(target.uid)])
    } else if (input.action === 'ask_her_reply') {
      onWakeForReply?.(updated, input.ownerHint?.trim())
    }
    return { ok: true, item: updated }
  }

  readPrefs(): WatchPreferences {
    try {
      const raw = JSON.parse(fs.readFileSync(this.prefsFile, 'utf8'))
      return {
        like: Array.isArray(raw.like) ? raw.like.map(String) : [...DEFAULT_WATCH_PREFS.like],
        dislike: Array.isArray(raw.dislike) ? raw.dislike.map(String) : [...DEFAULT_WATCH_PREFS.dislike],
        keywords: Array.isArray(raw.keywords) ? raw.keywords.map(String) : [...DEFAULT_WATCH_PREFS.keywords],
        exemptUps: Array.isArray(raw.exemptUps) ? raw.exemptUps.map(String) : [],
        minDurationSec: Number.isFinite(Number(raw.minDurationSec)) ? Math.max(0, Number(raw.minDurationSec)) : 600,
      }
    } catch {
      return { ...DEFAULT_WATCH_PREFS }
    }
  }

  savePrefs(patch: Partial<WatchPreferences>): WatchPreferences {
    const cur = this.readPrefs()
    const uniq = (arr?: string[]) => [...new Set((arr ?? []).map((s) => String(s).trim()).filter(Boolean))]
    const next: WatchPreferences = {
      like: patch.like !== undefined ? uniq(patch.like) : cur.like,
      dislike: patch.dislike !== undefined ? uniq(patch.dislike) : cur.dislike,
      keywords: patch.keywords !== undefined ? uniq(patch.keywords) : cur.keywords,
      exemptUps: patch.exemptUps !== undefined ? uniq(patch.exemptUps) : cur.exemptUps,
      minDurationSec: patch.minDurationSec !== undefined ? Math.max(0, Number(patch.minDurationSec)) : cur.minDurationSec,
    }
    fs.mkdirSync(this.dataDir, { recursive: true })
    fs.writeFileSync(this.prefsFile, JSON.stringify(next, null, 2), 'utf8')
    return next
  }
}
