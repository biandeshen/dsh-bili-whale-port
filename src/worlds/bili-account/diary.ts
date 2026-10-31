/** 两本日记的写入：按日期块、按小节"有则替换、无则追加"，纯函数。 */
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
