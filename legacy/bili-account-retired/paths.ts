/**
 * bili-account World 落在磁盘上的那些位置，以及它们的读写小工具。
 *
 * 只放"文件在哪、怎么整份读、怎么原子写"。业务含义留在各自的模块里：
 * 因果账在 `causal-io.ts`，提示词在 `prompts.ts`。
 */
import fs from 'node:fs'
import path from 'node:path'

/**
 * whale home 优先级与 dsh `tools/lib/paths.mjs:resolveWhaleHome` 一致（WHALE_HOME → DSH_HOME → ~/.dsh）；
 * 少一档就会和 dsh 子进程读不到同一片数据。
 */
export const WHALE = process.env.WHALE_HOME || process.env.DSH_HOME || path.join(process.env.USERPROFILE || '', '.dsh')

export const FIELDS_FILE = path.join(WHALE, 'bili-whale', 'fields.json')
export const ROUND_FILE = path.join(WHALE, 'bili-whale', 'control', 'round.json')
export const LIFE_FILE = path.join(WHALE, 'bili-whale', 'control', 'life.json')
export const LEGACY_RHYTHM_FILE = path.join(WHALE, 'bili-whale', 'control', 'rhythm.json')
export const LIFE_STATUS_FILE = path.join(WHALE, 'bili-whale', 'control', 'life-status.json')
export const QUEUE_FILE = path.join(WHALE, 'bili-whale', 'control', 'queue.json')
export const DM_APPLIED_FILE = path.join(WHALE, 'bili-whale', 'control', 'dm-applied.json')
export const DRAFT_RESULT_FILE = path.join(WHALE, 'bili-whale', 'control', 'draft-result.json')
export const CAUSAL_FILE = path.join(WHALE, 'bili-whale', 'causal.jsonl')
export const PUBLIC_DIARY = path.join(WHALE, 'whale-diary.md')
export const PRIVATE_DIARY = path.join(WHALE, 'whale-diary-private.md')
export const killPath = path.join(WHALE, 'bili-whale', 'control', 'kill')

/**
 * 草稿目录：与 dsh `tools/lib/paths.mjs:draftsDir()` 同一优先级（env → 旧路径-if-exists → home）。
 * 这条链曾在两处各写一份、第二份漏了旧路径，于是 badge 读不存在的空目录报「待放行=0」，
 * 而同页面板能列出真实草稿 —— 对外读数与事实相反的根因。只此一处实现。
 */
export function resolveDraftsDir(): string {
  for (const env of ['WHALE_DRAFTS', 'BILI_DRAFTS']) {
    const v = process.env[env]
    if (v) return v
  }
  const legacy = 'D:/AI/养鱼/drafts'
  try { if (fs.existsSync(legacy)) return legacy } catch {}
  return path.join(WHALE, 'bili-whale', 'drafts')
}
export const DRAFTS_DIR = resolveDraftsDir()

export const ROUND_STALE_MS = 12 * 3600_000

export function readJsonSafe(file: string): any {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

/** 同目录临时文件 + rename：写到一半被打断也不会留下半份 JSON。 */
function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.' + process.pid + '.' + Math.random().toString(36).slice(2, 8) + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
  fs.renameSync(tmp, file)
}

export function readLifeFile(): any {
  try { return JSON.parse(fs.readFileSync(LIFE_FILE, 'utf8')) } catch {}
  // 旧文件迁移：只取新字段，别把 wakesToday/lastWakeAt 再写回去
  try {
    const old = JSON.parse(fs.readFileSync(LEGACY_RHYTHM_FILE, 'utf8'))
    return { ...old, actionsToday: old.actionsToday ?? old.wakesToday ?? 0, lastActionAt: old.lastActionAt ?? old.lastWakeAt, wakesToday: undefined, lastWakeAt: undefined }
  } catch { return {} }
}

export function writeLifeFile(o: any): void {
  try { writeJsonAtomic(LIFE_FILE, o) } catch {}
}

export function readRound(): { feedAt?: number; debriefed?: boolean; bvid?: string; debriefedAt?: number } {
  try { return JSON.parse(fs.readFileSync(ROUND_FILE, 'utf8')) } catch { return {} }
}

export function writeRound(o: any): void {
  try { writeJsonAtomic(ROUND_FILE, o) } catch {}
}

export function readAppliedDmKeys(): string[] {
  try {
    const raw = JSON.parse(fs.readFileSync(DM_APPLIED_FILE, 'utf8'))
    return Array.isArray(raw?.keys) ? raw.keys.map(String) : []
  } catch { return [] }
}

export function writeAppliedDmKeys(keys: string[]): void {
  try { writeJsonAtomic(DM_APPLIED_FILE, { keys: keys.slice(-200) }) } catch {}
}

/** 审批结果回写游标：记到哪一条已经吃掉了，避免重复结算。 */
export function readDraftResultCursor(): number {
  try { return Number(JSON.parse(fs.readFileSync(DRAFT_RESULT_FILE, 'utf8')).consumedAt) || 0 } catch { return 0 }
}

export function writeDraftResultCursor(at: number): void {
  try { writeJsonAtomic(DRAFT_RESULT_FILE, { consumedAt: at }) } catch {}
}
