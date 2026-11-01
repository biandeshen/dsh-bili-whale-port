/** 两本日记的写入与分页读取：按日期块、按小节"有则替换、无则追加"，纯函数。 */
import { ownerName } from '../../../persona-core/src/naming.ts'

export type DiaryBook = 'public' | 'private'

export interface DiarySectionInput {
  book: DiaryBook
  heading: string
  body: string
  date: string
}

/** 日记本的空文件抬头。公开本的收件人是主人，称呼跟着配置走（`persona-core/src/naming.ts`）。 */
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

  // 同一日期段里可能有历史遗留的重复小节（10-30 实测两个「想说」）：
  // 全部收集，删掉旧块，只在第一个位置写一份新内容；中间其它小节（看过等）保留。
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
 * 小节存在性统计（2026-10-30 她的 OPS B2：回执必须说清「替换」还是「追加」）。
 * 与 upsertDiarySection 复用同一套日期块/标题匹配——绝不出现“回执说追加、实际替换”。
 */
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

/**
 * 日记分页读取（#56，2026-11-01）：以前 `bili_diary_read` 把两本日记整本拼起来
 * 再 `.slice(0, 12000)` —— 她从截断的回执里以为"日记就读完了"，据此下"这一周只判了
 * 两条"的结论。分页不是为了省 token，是为了让"没给的部分"变成她看得见的事实。
 *
 * 纯函数：按日期块（新→旧）成页，回执头写明 总块数/总字数/本页给了哪几天/还剩多少、
 * 以及怎么继续翻。单块超预算时不悄悄砍，而是在回执里写"本日超长已截断 X/Y 字"。
 */
export interface DiaryPageInput {
  page?: number
  days?: number
  budget?: number
  date?: string
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

  let window = newestFirst
  let page = Math.max(0, Math.floor(Number(input.page) || 0))
  if (input.date) {
    const at = newestFirst.findIndex((b) => b.date === input.date)
    window = at < 0 ? [] : [newestFirst[at]]
    page = 0
  } else {
    window = newestFirst.slice(page * per)
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
  const hasMore = input.date ? (window.length > picked.length) : (page * per + consumed < newestFirst.length)
  const restDays = Math.max(0, newestFirst.length - (input.date ? (window.length ? dates.length : 0) : page * per + consumed))
  const restChars = Math.max(0, totalChars - used)

  const head = [
    `【这一本共 ${newestFirst.length} 个日期块 / ${totalChars} 字】`,
    picked.length
      ? `本页给了 ${dates.join('、')}（${picked.length} 块 · ${used} 字）${truncatedDay ? `；⚠️ ${truncatedDay} 本日超长，已截断（只给了前 ${budget} 字）` : ''}`
      : (input.date
        ? `本里没有 ${input.date} 这一天。`
        : (newestFirst.length
          ? `第 ${page + 1} 页取不到内容：整本 ${newestFirst.length} 块，往前最多到第 ${Math.ceil(newestFirst.length / per)} 页。该翻完的已经翻完了。`
          : '这一本没有日记块（可能还是空的）。')),
    hasMore
      ? `还剩 ${restDays} 块（约 ${restChars} 字）**没在这页里** —— 别把本页当成全部。往前翻 {"page":${page + 1}}；只要某天 {"date":"YYYY-MM-DD"}；想看更长一页 {"budget":8000}。`
      : `翻完了：这一本到此就是全部，没有截断。`,
  ].join('\n')

  const body = [page === 0 && !input.date && preamble ? preamble : '', ...picked].filter(Boolean).join('\n\n')
  return { totalDays: newestFirst.length, totalChars, page, dates, body, returnedChars: used, hasMore, receipt: `${head}\n\n${body}` }
}

