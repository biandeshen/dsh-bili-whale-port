/** 纯门禁函数：可单测，不依赖 Cortico。 */

/** 这一轮 feed 过就必须先 debrief；没有「等 2 小时自动放行」的后门。 */
export function canDraft(feedAt: number, debriefed: boolean): boolean {
  if (!feedAt) return true
  return debriefed === true
}

export function draftRefusal(): string {
  return '[refused] 这一轮还没 debrief 任何视频。请先调用 bili_debrief（从 feed 结果里选一个 BV），成功后再重试 bili_draft_dynamic。'
}

export function canApplyWatched(debriefed: boolean): boolean {
  return debriefed === true
}

export function watchedRefusal(): string {
  return '[refused] 这一轮没有成功 debrief，不能记 watchedVideo。'
}

/** 公开日记超过 24h 没更新 → 今天还没写日记，不许出稿。 */
export const DIARY_STALE_MS = 24 * 3600_000

export function diaryFresh(mtimeMs: number, now = Date.now(), maxAgeMs = DIARY_STALE_MS): boolean {
  return Number.isFinite(mtimeMs) && mtimeMs > 0 && now - mtimeMs <= maxAgeMs
}

export function diaryRefusal(): string {
  return '[refused] 今天还没写日记（whale-diary.md 超过 24 小时没更新）。先 bili_diary_read 看一眼，再用 bili_diary_append 写今天的「看过 / 想说」，然后再出稿。'
}

/** 从因果记录里找最近的纪律违规（默认看最近 24h），生成 kick 前置点名。 */
export function violationNotice(entries: Array<{ kind?: string; at?: string; reason?: string }>, now = Date.now(), windowMs = 24 * 3600_000): string {
  const hit = entries
    .filter((e) => e.kind === 'discipline-violation' && Number.isFinite(Date.parse(String(e.at ?? ''))) && now - Date.parse(String(e.at)) <= windowMs)
    .sort((a, b) => Date.parse(String(b.at)) - Date.parse(String(a.at)))[0]
  if (!hit) return ''
  return '上一轮你跳过了 debrief（' + (hit.reason ?? 'no-debrief') + '），这次必须先深读一条再出稿。'
}
