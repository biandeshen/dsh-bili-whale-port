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
  /**
   * 只要正文里含这个小节标题（`### 标题`）的段落。日期块里一个小节一段，
   * 给了它就把每块裁成命中的小节——她要找"上个月写过的所有《判断》"，不必按天翻。
   * 与 date 同时给 = 那天里的这一节。
   */
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

/**
 * 把一个日期块按 `## 标题` 切成小节。日记里日期与小节同级（都是二级标题），
 * 所以块内的第一个 `## ` 就是第一小节的标题。
 */
function splitSections(blockText: string): Array<{ heading: string; text: string }> {
  const lines = blockText.split(/\r?\n/)
  const cuts: number[] = []
  for (let i = 1; i < lines.length; i++) if (/^##\s+/.test(lines[i])) cuts.push(i)
  if (!cuts.length) return [{ heading: '', text: blockText }]
  const out: Array<{ heading: string; text: string }> = []
  for (let i = 0; i < cuts.length; i++) {
    const start = cuts[i]
    const end = i + 1 < cuts.length ? cuts[i + 1] : lines.length
    out.push({ heading: lines[start].replace(/^##\s*/, '').trim(), text: lines.slice(start, end).join('\n').trimEnd() })
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

  // 小节过滤：先把每块裁成命中的小节，再按天成页。这样"上个月所有《看过》"是一页一页
  // 往前翻，而不是把整本按天读一遍再自己挑。
  const wanted = typeof input.heading === 'string' ? input.heading.trim() : ''
  const shaped: Block[] = wanted
    ? newestFirst
      .map((b) => {
        const hit = splitSections(b.text).filter((s) => s.heading.includes(wanted))
        // 日期标题本身也跟着给一行，否则读者不知道这一段是哪天的。
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
          ? `第 ${page + 1} 页取不到内容：整本 ${shaped.length} 块${wanted ? `（「${wanted}」在其中）` : ''}，往前最多到第 ${Math.ceil(shaped.length / per)} 页。该翻完的已经翻完了。`
          : (wanted
            ? `这一本里没有哪个日期块含「${wanted}」这一节。换个词，或去掉小节过滤按天翻。`
            : '这一本没有日记块（可能还是空的）。'))),
    hasMore
      ? `还剩 ${restDays} 块（约 ${restChars} 字）**没在这页里** —— 别把本页当成全部。往前翻 {"page":${page + 1}}${wanted ? '' : '；只要某天 {"date":"YYYY-MM-DD"}'}${wanted ? '' : '；只想看某一节 {"heading":"看过"}'}；想看更长一页 {"budget":8000}。`
      : `翻完了：这一本${scope}到此就是全部，没有截断。`,
  ].join('\n')

  // 小节过滤时 preamble（书名、运行目录）只是噪音：她要的是那几节的正文。
  const body = [page === 0 && !input.date && !wanted && preamble ? preamble : '', ...picked].filter(Boolean).join('\n\n')
  return { totalDays: newestFirst.length, totalChars, page, dates, body, returnedChars: used, hasMore, receipt: `${head}\n\n${body}` }
}

/** 日记里出现过哪些小节标题（新→旧，去重）：让她先知道有哪些节可选，再按名字取。 */
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


/**
 * 阶段性汇总（意见箱 f-f976ed）：她要回答"这一周判了多少条、收了几条、尺子改了几次"，
 * 过去只能把日记一页页读回来手工数。
 *
 * 只数**她写下来的东西**，不做推断：日期块数、看过里出现几个 BV、想说写了几次、
 * 判断小节里"收/不收"各多少、以及"今日指标"里分享与评论的合计。
 * 数不出来就报 null，不拿 0 冒充"没有"。
 */
export interface DiaryRangeSummary {
  from: string | null;
  to: string | null;
  days: number;
  /** 「看过」里出现过的不同 BV 数。 */
  watched: number;
  /** 判定结论的粗略计数（正文里含「收」/「不收」小节的条数）；判不了的写 null。 */
  verdicts: { keep: number; drop: number } | null;
  /** 「想说」小节写了多少次。 */
  notes: number;
  /** 提到尺子/规则的次数（粗略：含「尺子」「judgment」「判断」的段）。 */
  yardstickMentions: number;
  chars: number;
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

  // "收/不收"只在判断小节里数，避免把正文里所有"收"字都算进去。
  let keep = 0
  let drop = 0
  let sawVerdict = false
  for (const s of judgeSections) {
    // 先数「不收」，再数单独的「收」，否则「不收」会被算成一次「收」。
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
