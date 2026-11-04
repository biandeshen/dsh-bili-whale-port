/**
 * @xiaoyu/cap-journal —— 日记、审美判断卡与意见箱能力扩展包（100% 宿主无关）。
 *
 * 包含：
 * - 公开本 / 私人本双日记读写、分页检索、阶段性汇总与在线整块 Markdown 编辑
 * - 审美判断卡（judgment.jsonl）独立表格查询与主人修改/采纳
 * - 意见箱（feedback.jsonl）提交、折叠统计、主人批复（自动注入下一轮前缀）与一键转规则
 * - 主人操作台 `journal-board`：getDiary / saveDiarySection / listJudgments / upsertJudgment / listFeedback / replyFeedback
 * - 主人操作台 `feedback-triage`：意见箱分诊台（状态/严重度/是否自对治筛选 + 分页 + 批复与结案分离），
 *   与 journal-board 共用同一套 listFeedback / replyFeedback 实现
 */
import fs from 'node:fs'
import path from 'node:path'
import type {
  XiaoyuCapability,
  TurnContext,
  PrefixBlock,
  PanelMethodDecl,
} from '../../persona-core/src/capability.ts'
import { dayKey } from '../../persona-core/src/rhythm.ts'
import { WorkspaceGit, AUTHOR_SELF, AUTHOR_OPERATOR } from '../../cap-memory/src/workspace-git.ts'
import {
  diaryDefaultHeader,
  upsertDiarySection,
  replaceDiaryDateBlock,
  sectionStats,
  paginateDiary,
  diaryHeadings,
  summarizeDiaryRange,
  type DiaryBook,
  type DiarySectionInput,
  type DiaryPageInput,
  type DiaryPageResult,
  type DiaryRangeSummary,
} from './diary.ts'
import {
  SCOPES,
  STANCES,
  normalizeTokens,
  listJudgments,
  appendJudgment,
  upsertJudgmentByOwner,
  listFeedback,
  appendFeedback,
  replyFeedbackByOwner,
  FEEDBACK_DEFAULT_PAGE_SIZE,
  FEEDBACK_MAX_PAGE_SIZE,
  type FeedbackStatusFilter,
  type FeedbackSeverityFilter,
  type ListFeedbackOptions,
  type JudgmentScope,
  type JudgmentStance,
  type JudgmentVerdict,
  type JudgmentItem,
  type FeedbackItem,
} from './judgments-feedback.ts'

export {
  diaryDefaultHeader,
  upsertDiarySection,
  replaceDiaryDateBlock,
  sectionStats,
  paginateDiary,
  diaryHeadings,
  summarizeDiaryRange,
  SCOPES,
  STANCES,
  normalizeTokens,
  listJudgments,
  appendJudgment,
  upsertJudgmentByOwner,
  listFeedback,
  appendFeedback,
  replyFeedbackByOwner,
  FEEDBACK_DEFAULT_PAGE_SIZE,
  FEEDBACK_MAX_PAGE_SIZE,
}
export type {
  DiaryBook,
  DiarySectionInput,
  DiaryPageInput,
  DiaryPageResult,
  DiaryRangeSummary,
  JudgmentScope,
  JudgmentStance,
  JudgmentVerdict,
  JudgmentItem,
  FeedbackItem,
  FeedbackStatusFilter,
  FeedbackSeverityFilter,
  ListFeedbackOptions,
}

export interface JournalCapabilityConfig {
  defaultPageBudgetChars: number
  defaultDaysPerPage: number
}

export interface JournalCapabilityOptions {
  publicDiaryFile: string
  privateDiaryFile: string
  judgmentFile: string
  feedbackFile: string
  onRuleConverted?: (rule: { kind: 'dislike' | 'keyword' | 'exemptUp'; value: string }) => void
  /** 与 cap-memory 共用同一个工作区仓：日记每次落盘后自动提交，历史可回退 */
  git?: WorkspaceGit
}

function readTextSafe(file: string, book: DiaryBook): string {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return diaryDefaultHeader(book)
  }
}

function writeTextAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 7)}.tmp`
  fs.writeFileSync(tmp, content, 'utf8')
  fs.renameSync(tmp, file)
}

/** convertRule.kind 的真值集合：只这三个后端会真的落到规则上，面板不许发明第四种去向。 */
const CONVERT_RULE_KINDS = ['dislike', 'keyword', 'exemptUp']

/**
 * 意见箱查询参数归一化（浏览器传来的任何东西都可能是字符串、越界值或干脆是脏的）。
 *
 * 口径：
 * - `status` 不给、或给的不是 resolved/all → 'open'（与拆分前一致，老调用方行为不变）；
 * - `severity` 非 high/low → 'all'；
 * - `page` 至少 1，`pageSize` 夹在 1..100；
 * - **只有显式给了 page/pageSize 才走分页**，否则沿用旧的 `limit` 一路（limit 缺省 50）。
 */
function feedbackQueryOptions(params: {
  status?: unknown
  severity?: unknown
  page?: unknown
  pageSize?: unknown
  selfHandled?: unknown
  limit?: unknown
}): ListFeedbackOptions {
  const status: FeedbackStatusFilter =
    params?.status === 'resolved' || params?.status === 'all' ? params.status : 'open'
  const severity: FeedbackSeverityFilter =
    params?.severity === 'high' || params?.severity === 'low' ? params.severity : 'all'
  const out: ListFeedbackOptions = { status, severity }
  if (params && typeof params.selfHandled === 'boolean') out.selfHandled = params.selfHandled
  const hasPaging = params?.page !== undefined || params?.pageSize !== undefined
  if (hasPaging) {
    const rawPage = Math.floor(Number(params?.page ?? 1))
    out.page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1
    const rawSize = Math.floor(Number(params?.pageSize ?? FEEDBACK_DEFAULT_PAGE_SIZE))
    out.pageSize = Math.min(FEEDBACK_MAX_PAGE_SIZE, Math.max(1, Number.isFinite(rawSize) ? rawSize : FEEDBACK_DEFAULT_PAGE_SIZE))
  } else if (params?.limit !== undefined) {
    out.limit = Number(params.limit)
  }
  return out
}

/**
 * 意见箱的两个数据面方法。`journal-board`（历史入口）与 `feedback-triage`（分诊台）
 * 共用同一份实现，避免两个 tab 的口径漂走。
 */
function createFeedbackPanelMethods(
  feedbackFile: string,
  onRuleConverted?: JournalCapabilityOptions['onRuleConverted'],
): Record<string, PanelMethodDecl<any, any>> {
  return {
    listFeedback: {
      name: 'listFeedback',
      verb: 'GET',
      summary: '按状态/严重度/是否已自对治分页列出意见箱（未解决置顶、high 在前、新的在前，并带回全量总览计数）',
      writable: false,
      invoke(params: {
        status?: FeedbackStatusFilter
        severity?: FeedbackSeverityFilter
        page?: number
        pageSize?: number
        selfHandled?: boolean
        limit?: number
      }) {
        return listFeedback(feedbackFile, feedbackQueryOptions(params ?? {}))
      },
    },
    replyFeedback: {
      name: 'replyFeedback',
      verb: 'POST',
      summary: '主人批复（resolve:false 只批复不结案 / resolve:true 批复并结案），或转成看片过滤规则（dislike / keyword / exemptUp）',
      writable: true,
      invoke(params: {
        id: string
        ownerReply?: string
        resolve?: boolean
        convertRule?: { kind: 'dislike' | 'keyword' | 'exemptUp'; value: string }
      }) {
        const rule = params?.convertRule
        if (rule) {
          const kind = String(rule.kind ?? '')
          const value = String(rule.value ?? '').trim()
          if (!CONVERT_RULE_KINDS.includes(kind)) {
            return { ok: false, error: `规则类型只能是 ${CONVERT_RULE_KINDS.join(' / ')}（后端只认这三种）` }
          }
          if (!value) return { ok: false, error: '转成规则要给内容（词或 UP 主名），空值不写入' }
        }
        return replyFeedbackByOwner(feedbackFile, params, onRuleConverted)
      },
    },
  }
}

export function createJournalCapability(
  opts: JournalCapabilityOptions,
): XiaoyuCapability<JournalCapabilityConfig> {
  const diaryPath = (book: DiaryBook) =>
    book === 'private' ? opts.privateDiaryFile : opts.publicDiaryFile
  const commitDiary = (message: string, byOwner: boolean): void => {
    if (!opts.git) return
    try {
      opts.git.commitAll(message, byOwner ? AUTHOR_OPERATOR : AUTHOR_SELF)
    } catch { /* 文件已保存；提交失败进 git.status().commitError */ }
  }

  return {
    id: 'journal',
    title: '日记、判断卡与意见箱',
    kind: 'internal',
    configSchema: {
      type: 'object',
      title: '日记与判断配置',
      properties: {
        defaultPageBudgetChars: {
          type: 'integer',
          title: '日记单页读取字符预算',
          default: 4000,
          minimum: 500,
          maximum: 9000,
          'x-hot': true,
        },
        defaultDaysPerPage: {
          type: 'integer',
          title: '日记单页默认天数',
          default: 3,
          minimum: 1,
          maximum: 30,
          'x-hot': true,
        },
      },
    },
    defaultConfig: {
      defaultPageBudgetChars: 4000,
      defaultDaysPerPage: 3,
    },

    async contextSegments(_ctx: TurnContext): Promise<readonly PrefixBlock[]> {
      // 给她的是"最近提过且主人批复了的"几句，口径按时间新→旧（order:'recent'）。
      // 分诊台的默认序是"未解决/high 置顶"，那一套是给主人处理用的；
      // 直接套到这里会悄悄换掉注入进她提示词的内容——排序要在调用点上写明。
      const fb = listFeedback(opts.feedbackFile, { status: 'all', limit: 20, order: 'recent' })
      const withReplies = fb.items.filter((x) => x.ownerReply)
      if (!withReplies.length) return []
      const lines = withReplies.slice(0, 5).map(
        (x) => `- [${x.id}] 你提过的「${x.issue}」 → 主人批复：「${x.ownerReply}」`,
      )
      return [
        {
          title: '意见箱主人批复',
          text: `【主人对你意见箱的批复】\n${lines.join('\n')}`,
          sourceKey: 'persona.journal',
        },
      ]
    },

    tools() {
      return [
        {
          name: 'diary_read',
          summary: '分页或按天/按小节读取公开日记或私人日记（含阶段汇总）',
          description: '支持按 book(public/private)、page、date、heading 读取日记，或传 summary:true 统计区间内看过/收与不收/想说次数。',
          parameters: {
            type: 'object',
            properties: {
              book: { type: 'string', enum: ['public', 'private'], description: '日记本：public（给主人看）或 private（私人偏好校准）' },
              page: { type: 'integer', description: '页码（从 0 开始，新→旧）' },
              days: { type: 'integer', description: '每页天数（默认 3）' },
              date: { type: 'string', description: '指定日期 YYYY-MM-DD' },
              heading: { type: 'string', description: '只看含该标题的小节（如 看过 / 想说 / 判断）' },
              summary: { type: 'boolean', description: '若为 true，返回日期区间统计汇总' },
              from: { type: 'string', description: '汇总起始日期 YYYY-MM-DD' },
              to: { type: 'string', description: '汇总截止日期 YYYY-MM-DD' },
            },
          },
          execute(args: {
            book?: DiaryBook
            page?: number
            days?: number
            date?: string
            heading?: string
            summary?: boolean
            from?: string
            to?: string
          }) {
            const book: DiaryBook = args?.book === 'private' ? 'private' : 'public'
            const raw = readTextSafe(diaryPath(book), book)
            if (args?.summary) {
              return { ok: true, book, summary: summarizeDiaryRange(raw, { from: args.from, to: args.to }), headings: diaryHeadings(raw) }
            }
            return { ok: true, book, ...paginateDiary(raw, args) }
          },
        },
        {
          name: 'diary_write',
          summary: '向公开日记或私人日记写入一个小节（同日同小节有则替换、无则追加）',
          description: '按当前逻辑日（或指定 date）写入指定小节，回执明确告知是追加还是替换。',
          parameters: {
            type: 'object',
            properties: {
              book: { type: 'string', enum: ['public', 'private'] },
              heading: { type: 'string', description: '小节标题（如 看过 / 想说 / 本轮留下的判断）' },
              body: { type: 'string', description: '小节正文内容' },
              date: { type: 'string', description: '可选日期 YYYY-MM-DD，默认当天' },
            },
            required: ['book', 'heading', 'body'],
          },
          mutatesState: true,
          execute(args: { book: DiaryBook; heading: string; body: string; date?: string }) {
            const book: DiaryBook = args.book === 'private' ? 'private' : 'public'
            const date = args.date?.trim() || dayKey(Date.now())
            const file = diaryPath(book)
            const raw = readTextSafe(file, book)
            const before = sectionStats(raw, date, args.heading, book)
            const next = upsertDiarySection(raw, { book, heading: args.heading, body: args.body, date })
            writeTextAtomic(file, next)
            commitDiary(`diary: ${book} 本 ${date}「${args.heading}」${before.existed ? '替换' : '追加'}（她写的）`, false)
            return {
              ok: true,
              book,
              date,
              heading: args.heading,
              mode: before.existed ? 'replaced' : 'appended',
              previousChars: before.chars,
              newChars: args.body.trim().length,
            }
          },
        },
        {
          name: 'judgment_read',
          summary: '读取审美判断卡独立视图（终于不用从日记正文里捞）',
          description: '按状态（all/proposed/adopted/rejected）或结论（keep/drop/unclear）查询结构化判断卡列表。',
          parameters: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['all', 'proposed', 'adopted', 'rejected'] },
              verdict: { type: 'string', enum: ['keep', 'drop', 'unclear'] },
              query: { type: 'string', description: '按关键词或 BV 号过滤' },
            },
          },
          execute(args: { status?: string; verdict?: JudgmentVerdict; query?: string }) {
            return listJudgments(opts.judgmentFile, args)
          },
        },
        {
          name: 'judgment_write',
          summary: '新增一张结构化审美/内容判断卡',
          description: '记录对某类内容或某个视频的偏好/回避判断（理由至少 6 个字）。',
          parameters: {
            type: 'object',
            properties: {
              scope: { type: 'string', enum: ['feed', 'draft', 'dm', 'any'] },
              stance: { type: 'string', enum: ['prefer', 'avoid', 'noise'] },
              verdict: { type: 'string', enum: ['keep', 'drop', 'unclear'] },
              tokens: { type: 'array', items: { type: 'string' }, description: '2–12 字的主题词数组' },
              reason: { type: 'string', description: '判断理由（6–200 字）' },
              bvid: { type: 'string', description: '关联的 BV 号（可选）' },
            },
            required: ['tokens', 'reason'],
          },
          mutatesState: true,
          execute(args: {
            scope?: string
            stance?: string
            verdict?: JudgmentVerdict
            tokens: string[]
            reason: string
            bvid?: string
          }) {
            return appendJudgment(args, opts.judgmentFile)
          },
        },
        {
          name: 'feedback_submit',
          summary: '向主人的意见箱提交一条问题或体验反馈',
          description: '遇到工具卡点、规则不合理或需要主人協助时提交一条反馈。',
          parameters: {
            type: 'object',
            properties: {
              issue: { type: 'string', description: '一句话现象描述' },
              severity: { type: 'string', enum: ['low', 'high'] },
              selfHandled: { type: 'boolean', description: '是否自己已临时绕过/对治' },
              note: { type: 'string', description: '补充说明或自己的对治办法' },
            },
            required: ['issue'],
          },
          mutatesState: true,
          execute(args: { issue: string; severity?: 'low' | 'high'; selfHandled?: boolean; note?: string }) {
            return appendFeedback(args, opts.feedbackFile)
          },
        },
      ]
    },

    panels() {
      return [
        {
          id: 'journal-board',
          title: '日记、判断卡与意见箱工作台',
          description: '公开/私人日记在线 Markdown 编辑、审美判断卡独立表格与修改、意见箱主人批复与一键转规则',
          methods: {
            getDiary: {
              name: 'getDiary',
              verb: 'GET',
              summary: '按本（public/private）、日期或关键词读取日记与目录树',
              writable: false,
              invoke(params: { book?: DiaryBook; date?: string; query?: string; page?: number }) {
                const book: DiaryBook = params?.book === 'private' ? 'private' : 'public'
                const raw = readTextSafe(diaryPath(book), book)
                const paged = paginateDiary(raw, {
                  date: params?.date,
                  heading: params?.query,
                  page: params?.page ?? 0,
                  days: 7,
                  budget: 8000,
                })
                return {
                  ok: true,
                  book,
                  headings: diaryHeadings(raw),
                  summary: summarizeDiaryRange(raw),
                  ...paged,
                }
              },
            },
            saveDiarySection: {
              name: 'saveDiarySection',
              verb: 'POST',
              summary: '主人在面板在线修改某天（或某小节）日记 Markdown 并原子落盘',
              writable: true,
              invoke(params: { book: DiaryBook; date: string; heading?: string; markdown: string }) {
                if (!params?.date || typeof params?.markdown !== 'string') {
                  return { ok: false, error: '需要提供 date 与 markdown 内容' }
                }
                const book: DiaryBook = params.book === 'private' ? 'private' : 'public'
                const file = diaryPath(book)
                const raw = readTextSafe(file, book)
                const next = params.heading?.trim()
                  ? upsertDiarySection(raw, {
                      book,
                      date: params.date.trim(),
                      heading: params.heading.trim(),
                      body: params.markdown,
                    })
                  : replaceDiaryDateBlock(raw, params.date.trim(), params.markdown)
                writeTextAtomic(file, next)
                commitDiary(`diary: 主人在线编辑 ${book} 本 ${params.date.trim()}`, true)
                return { ok: true, book, date: params.date.trim(), savedChars: params.markdown.length }
              },
            },
            listJudgments: {
              name: 'listJudgments',
              verb: 'GET',
              summary: '读取审美判断卡独立表格视图（支持按 keep/drop/unclear 与关键词过滤）',
              writable: false,
              invoke(params: { verdict?: JudgmentVerdict; status?: string; query?: string }) {
                return listJudgments(opts.judgmentFile, params)
              },
            },
            upsertJudgment: {
              name: 'upsertJudgment',
              verb: 'POST',
              summary: '主人直接修改或新增一条判断卡结论（keep/drop/unclear）与备注',
              writable: true,
              invoke(params: { id?: string; verdict: JudgmentVerdict; note: string; status?: 'adopted' | 'rejected' | 'proposed' }) {
                return upsertJudgmentByOwner(opts.judgmentFile, params)
              },
            },
            // 意见箱的两个方法走同一份实现（见 createFeedbackPanelMethods）：
            // journal-board 保留历史入口，feedback-triage 是分诊台。
            ...createFeedbackPanelMethods(opts.feedbackFile, opts.onRuleConverted),
          },
        },
        {
          id: 'feedback-triage',
          title: '意见箱分诊台',
          description: '她的意见独立成 tab：未解决置顶 + high 在前 + 分页 + 严重度/自对治筛选；批复与结案分离，可只批复不结案，或转成看片过滤规则（dislike / keyword / exemptUp）',
          methods: createFeedbackPanelMethods(opts.feedbackFile, opts.onRuleConverted),
        },
      ]
    },
  }
}
