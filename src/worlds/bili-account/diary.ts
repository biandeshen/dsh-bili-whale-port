/** 两本日记的写入：按日期块、按小节"有则替换、无则追加"，纯函数。 */

export type DiaryBook = 'public' | 'private'

export interface DiarySectionInput {
  book: DiaryBook
  heading: string
  body: string
  date: string
}

export const DIARY_DEFAULT_HEADER: Record<DiaryBook, string> = {
  public: '# 鲸鱼日记 · 给鱼片\n\n',
  private: '# 私人日记 · 偏好校准\n\n',
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

  let s = -1
  for (let i = start + 1; i < end; i++) {
    if (lines[i].trim() === headingLine) { s = i; break }
  }

  const section = ['', headingLine, '', ...bodyLines, '']
  if (s >= 0) {
    let e = end
    for (let i = s + 1; i < end; i++) {
      if (isAnyHeading(lines[i])) { e = i; break }
    }
    return [...lines.slice(0, s), ...section, ...lines.slice(e)].join('\n')
  }

  return [...lines.slice(0, end), ...section, ...lines.slice(end)].join('\n')
}
