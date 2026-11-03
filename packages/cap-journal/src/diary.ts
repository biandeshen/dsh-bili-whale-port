/**
 * 两本日记（公开本 / 私人本）的写入、在线整块编辑、分页读取与阶段汇总（纯函数）。
 */
import { ownerName } from '../../persona-core/src/naming.ts'

export type DiaryBook = 'public' | 'private'

export interface DiarySectionInput {
  book: DiaryBook
  heading: string
  body: string
  date: string
}

export function diaryDefaultHeader(book: DiaryBook): string {
  return book === 'public' ? `# 鲸鱼日记 · 给${ownerName()}\n\n` : '# 私人日记 · 偏好校准\n\n'
}

const isDateHeading = (l: string) => /^##\s+\d{4}-\d{2}-\d{2}(?:\D|$)/.test(l)
const isAnyHeading = (l: string) => /^#{2,4}\s/.test(l)
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function upsertDiarySection(text: string, input: DiarySectionInput): string {
  const headingLine = `${input.book === 'public' ? '## ' : '### '}${input.heading}`.trim()
  const bodyLines = input.body.trim().split(/\r?\n/)
  const lines = String(text ?? '').split(/\r?\n/)
  const dateHeading = new RegExp('^##\\s+' + escapeRe(input.date) + '(?:\\D|$)')

  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (dateHeading.test(lines[i])) start = i
  }

  if (start < 0) {
    const head = String(text ?? '').trimEnd()
    return [...(head ? [head, ''] : []), `## ${input.date}`, '', headingLine, '', ...bodyLines, ''].join('\n')
  }

  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (isDateHeading(lines[i])) { end = i; break }
  }

  const hits: number[] = []
  for (let i = start + 1; i < end; i++) {
    if (lines[i].trim() === headingLine) hits.push(i)
  }

  const section = ['', headingLine, '', ...bodyLines, '']
  if (hits.length) {
    const ranges = hits.map((s) => {
      let e = end
      for (let i = s + 1; i < end; i++) {
        if (isAnyHeading(lines[i])) { e = i; break }
      }
      return [s, e] as const
    })
    const out = [...lines]
    for (const [s, e] of [...ranges].reverse()) out.splice(s, e - s)
    out.splice(hits[0], 0, ...section)
    return out.join('\n')
  }

  return [...lines.slice(0, end), ...section, ...lines.slice(end)].join('\n')
}

/**
 * 主人在面板在线编辑某天的整块日记（或当不传 heading 时直接替换该日期块全文，用于修正错位日期或格式）。
 */
export function replaceDiaryDateBlock(text: string, date: string, newBlockMarkdown: string): string {
  const cleanBlock = newBlockMarkdown.trim()
  const normalizedBlock = cleanBlock.startsWith(`## ${date}`)
    ? cleanBlock
    : `## ${date}\n\n${cleanBlock}`
  const lines = String(text ?? '').split(/\r?\n/)
  const dateHeading = new RegExp('^##\\s+' + escapeRe(date) + '(?:\\D|$)')
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (dateHeading.test(lines[i])) { start = i; break }
  }
  if (start < 0) {
    const head = String(text ?? '').trimEnd()
    return [...(head ? [head, ''] : []), normalizedBlock, ''].join('\n')
  }
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (isDateHeading(lines[i])) { end = i; break }
  }
  const out = [...lines.slice(0, start), ...normalizedBlock.split(/\r?\n/), '', ...lines.slice(end)]
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

export function sectionStats(
  text: string,
  date: string,
  heading: string,
  book: DiaryBook,
): { existed: boolean; chars: number } {
  const headingLine = `${book === 'public' ? '## ' : '### '}${heading}`.trim()
  const dateHeading = new RegExp('^##\\s+' + escapeRe(date) + '(?:\\D|$)')
  const lines = String(text ?? '').split(/\r?\n/)
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (dateHeading.test(lines[i])) start = i
  }
  if (start < 0) return { existed: false, chars: 0 }
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (isDateHeading(lines[i])) { end = i; break }
  }
  let s = -1
  for (let i = start + 1; i < end; i++) {
    if (lines[i].trim() === headingLine) { s = i; break }
  }
  if (s < 0) return { existed: false, chars: 0 }
  let e = end
  for (let i = s + 1; i < end; i++) {
    if (isAnyHeading(lines[i])) { e = i; break }
  }
  return { existed: true, chars: lines.slice(s + 1, e).join('\n').trim().length }
}

export interface DiaryPageInput {
  page?: number
  days?: number
  budget?: number
  date?: string
  heading?: string
}

export interface DiaryPageResult {
  totalDays: number
  totalChars: number
  page: number
  dates: string[]
  body: string
  returnedChars: number
  hasMore: boolean
  receipt: string
}

interface Block { date: string; text: string }

function splitSections(blockText: string): Array<{ heading: string; text: string }> {
  const lines = blockText.split(/\r?\n/)
  const cuts: number[] = []
  for (let i = 1; i < lines.length; i++) if (/^#{2,3}\s+/.test(lines[i])) cuts.push(i)
  if (!cuts.length) return [{ heading: '', text: blockText }]
  const out: Array<{ heading: string; text: string }> = []
  for (let i = 0; i < cuts.length; i++) {
    const start = cuts[i]
    const end = i + 1 < cuts.length ? cuts[i + 1] : lines.length
    out.push({ heading: lines[start].replace(/^#{2,3}\s*/, '').trim(), text: lines.slice(start, end).join('\n').trimEnd() })
  }
  return out
}

function splitBlocks(raw: string): { preamble: string; blocks: Block[] } {
  const lines = String(raw ?? '').split(/\r?\n/)
  const cuts: number[] = []
  for (let i = 0; i < lines.length; i++) if (isDateHeading(lines[i])) cuts.push(i)
  const preamble = cuts.length ? lines.slice(0, cuts[0]).join('\n').trim() : String(raw ?? '').trim()
  const blocks: Block[] = cuts.map((start, idx) => {
    const end = idx + 1 < cuts.length ? cuts[idx + 1] : lines.length
    const m = lines[start].match(/^##\s+(\d{4}-\d{2}-\d{2})/)
    return { date: m ? m[1] : lines[start].replace(/^##\s*/, '').trim(), text: lines.slice(start, end).join('\n').trimEnd() }
  })
  return { preamble, blocks }
}

export function paginateDiary(raw: string, input: DiaryPageInput = {}): DiaryPageResult {
  const { preamble, blocks } = splitBlocks(raw)
  const totalChars = String(raw ?? '').trim().length
  const newestFirst = [...blocks].reverse()
  const per = Math.max(1, Math.min(30, Math.round(Number(input.days ?? 3)) || 3))
  const budget = Math.max(200, Math.min(9000, Math.round(Number(input.budget ?? 4000)) || 4000))

  const wanted = typeof input.heading === 'string' ? input.heading.trim() : ''
  const shaped: Block[] = wanted
    ? newestFirst
      .map((b) => {
        const hit = splitSections(b.text).filter((s) => s.heading.includes(wanted))
        return hit.length ? { date: b.date, text: [`## ${b.date}`, ...hit.map((s) => s.text)].join('\n') } : null
      })
      .filter((b): b is Block => b !== null)
    : newestFirst
  const totalForHead = shaped.length

  let window = shaped
  let page = Math.max(0, Math.floor(Number(input.page) || 0))
  if (input.date) {
    const at = shaped.findIndex((b) => b.date === input.date)
    window = at < 0 ? [] : [shaped[at]]
    page = 0
  } else {
    window = shaped.slice(page * per)
  }

  const picked: string[] = []
  const dates: string[] = []
  let used = 0
  let truncatedDay = ''
  for (const b of window) {
    if (!input.date && picked.length >= per) break
    if (used + b.text.length + 2 > budget) {
      if (!picked.length) {
        picked.push(b.text.slice(0, budget) + '\n…（截断）')
        dates.push(b.date); used += budget; truncatedDay = b.date
      }
      break
    }
    picked.push(b.text); dates.push(b.date); used += b.text.length + 2
  }

  const consumed = input.date ? (window.length ? 1 : 0) : picked.length
  const hasMore = input.date ? (window.length > picked.length) : (page * per + consumed < shaped.length)
  const restDays = Math.max(0, shaped.length - (input.date ? (window.length ? dates.length : 0) : page * per + consumed))
  const restChars = Math.max(0, totalChars - used)

  const scope = wanted ? `小节含「${wanted}」的 ` : ''
  const head = [
    wanted
      ? `【这一本共 ${newestFirst.length} 个日期块 / ${totalChars} 字；其中 ${totalForHead} 天有「${wanted}」】`
      : `【这一本共 ${newestFirst.length} 个日期块 / ${totalChars} 字】`,
    picked.length
      ? `本页给了 ${dates.join('、')}（${picked.length} 块 · ${used} 字）${truncatedDay ? `；⚠️ ${truncatedDay} 本日超长，已截断（只给了前 ${budget} 字）` : ''}`
      : (input.date
        ? `本里没有 ${input.date} 这一天${wanted ? `（或这天没有「${wanted}」这一节）` : ''}。`
        : (shaped.length
          ? `第 ${page + 1} 页取不到内容：整本 ${shaped.length} 块，往前最多到第 ${Math.ceil(shaped.length / per)} 页。`
          : '这一本没有匹配的日记块。')),
    hasMore
      ? `还剩 ${restDays} 块（约 ${restChars} 字）没在这页里。往前翻 {"page":${page + 1}}。`
      : `翻完了：这一本${scope}到此就是全部，没有截断。`,
  ].join('\n')

  const body = [page === 0 && !input.date && !wanted && preamble ? preamble : '', ...picked].filter(Boolean).join('\n\n')
  return { totalDays: newestFirst.length, totalChars, page, dates, body, returnedChars: used, hasMore, receipt: `${head}\n\n${body}` }
}

export function diaryHeadings(raw: string): string[] {
  const { blocks } = splitBlocks(raw)
  const seen: string[] = []
  for (const b of [...blocks].reverse()) {
    for (const s of splitSections(b.text)) {
      if (s.heading && !seen.includes(s.heading)) seen.push(s.heading)
    }
  }
  return seen
}

export interface DiaryRangeSummary {
  from: string | null
  to: string | null
  days: number
  watched: number
  verdicts: { keep: number; drop: number } | null
  notes: number
  yardstickMentions: number
  chars: number
}

const DIARY_DATE_RE = /^##\s+(\d{4}-\d{2}-\d{2})/

export function summarizeDiaryRange(raw: string, opts: { from?: string; to?: string } = {}): DiaryRangeSummary {
  const { blocks } = splitBlocks(raw)
  const from = opts.from ?? null
  const to = opts.to ?? null
  const picked = blocks.filter((b) => {
    const d = (b.date.match(DIARY_DATE_RE)?.[1]) ?? b.date
    if (from && d < from) return false
    if (to && d > to) return false
    return true
  })
  const dates = picked.map((b) => (b.date.match(DIARY_DATE_RE)?.[1]) ?? b.date).sort()
  const texts = picked.map((b) => b.text).join('\n')
  const bvs = new Set(texts.match(/BV[0-9A-Za-z]{10}/g) ?? [])
  const sections = picked.flatMap((b) => splitSections(b.text))
  const noteSections = sections.filter((s) => /想说/.test(s.heading))
  const judgeSections = sections.filter((s) => /判断|尺子/.test(s.heading))

  let keep = 0
  let drop = 0
  let sawVerdict = false
  for (const s of judgeSections) {
    const drops = (s.text.match(/不收|放弃|没留|不分享/g) ?? []).length
    const keeps = (s.text.replace(/不收|放弃|没留|不分享/g, '').match(/(?:^|[^\u4e00-\u9fa5])(收|留下|分享)(?:[^\u4e00-\u9fa5]|$)/g) ?? []).length
    if (drops + keeps > 0) sawVerdict = true
    drop += drops
    keep += keeps
  }

  return {
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
    days: picked.length,
    watched: bvs.size,
    verdicts: sawVerdict ? { keep, drop } : null,
    notes: noteSections.length,
    yardstickMentions: judgeSections.length,
    chars: texts.length,
  }
}
