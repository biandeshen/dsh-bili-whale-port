/**
 * 对话历史能力包：把 data/runs 下各 run 的转录文件变成她能查、主人能看的账。
 *
 * 为什么它在这里而不是在底座里：
 * 这段功能原本是宿主 core 目录里 transcript.ts 的 228 行 + 一个前端页面。
 * 那意味着"我们的功能住在别人的代码里"——升级底座要重新打一遍补丁。
 * 现在它只认一个 `dataDir`：任何底座告诉她数据在哪，这段就能跑。
 *
 * 四件套（三条铁律要求）：
 *   · store   —— transcript.jsonl（只读；本包永不写它）
 *   · tools   —— `history_page` / `history_search` 给她自己翻
 *   · panel   —— 主人往回翻的控制台页
 *   · 事件    —— 不推事件：历史是已经发生的事，不是需要被叫醒的事
 *
 * 为什么给她这两把工具：她说"上次那件事"时，靠的是上下文里那一小段；
 * 上下文之外的旧事她本来无从查起。**只读**——她可以看自己说过什么，
 * 但不能改历史。
 */
import { readdirSync } from 'node:fs'
import path from 'node:path'
import type {
  CapabilityPanelDecl,
  PanelMethodDecl,
  ToolRegistration,
  XiaoyuCapability,
} from '../../../kernel/persona-core/src/capability.ts'
import { readTranscriptHistory, searchTranscript, type TranscriptHit } from './history.ts'

export * from './history.ts'

export interface HistoryCapabilityOptions {
  /** 部署数据目录（历史在它下面的 `runs/`）。 */
  dataDir: string
}

export interface HistoryConfig {
  /** 主人页默认一次翻多少条。 */
  pageSize: number
}

const HISTORY_DEFAULTS: HistoryConfig = { pageSize: 60 }

/** 一条记录变成她读得懂的一行。工具回执可能很长，截断后交给她。 */
function lineOf(hit: TranscriptHit): string {
  const who = hit.role === 'assistant' ? '我' : hit.role === 'user' ? '主人' : hit.role === 'tool' ? `工具${hit.tool ? `(${hit.tool})` : ''}` : hit.role === 'reasoning' ? '思考' : '边界'
  const when = hit.ts ? hit.ts.replace('T', ' ').slice(0, 19) : ''
  return `- ${when}｜${who}：${hit.excerpt}`
}

export function createHistoryCapability(opts: HistoryCapabilityOptions): XiaoyuCapability<HistoryConfig> {
  const runsDir = path.join(opts.dataDir, 'runs')

  const tools: ToolRegistration[] = [
    {
      name: 'history_page',
      summary: '往回翻我们之前的对话（分页，越翻越早）',
      description:
        '读的是从不剪枝的全量记录。不带参数给最近一页；把回执里的 cursor 作为 before 传回来就是再往前翻。'
        + '当前这一轮对话本来就在你的上下文里，这里查的是**更早**的事。',
      parameters: {
        type: 'object',
        properties: {
          before: { type: 'string', description: '上一次回执里的 cursor；不传 = 从最近开始' },
          limit: { type: 'integer', description: '这一页最多几条（1-500，默认 120）' },
        },
      },
      execute(args: { before?: string; limit?: number }) {
        const page = readTranscriptHistory(opts.dataDir, {
          ...(args?.before ? { before: args.before } : {}),
          ...(args?.limit ? { limit: args.limit } : {}),
        })
        const lines = page.records.map((rec) => {
          const role = rec.kind === 'boundary' ? `边界(${rec.event})` : (rec.item?.role === 'assistant' ? '我' : rec.item?.type === 'function_call' ? `工具(${rec.item.name ?? ''})` : '主人')
          const body = rec.kind === 'boundary'
            ? JSON.stringify(rec.data ?? {}).slice(0, 200)
            : (typeof rec.item?.text === 'string'
              ? rec.item.text
              : Array.isArray(rec.item?.content)
                ? (rec.item.content as Array<{ text?: string }>).map((c) => c?.text ?? '').join(' ')
                : JSON.stringify(rec.item ?? {})).slice(0, 300)
          return `- ${String(rec.ts ?? '').replace('T', ' ').slice(0, 19)}｜${role}：${body}`
        })
        return {
          ok: true,
          count: page.records.length,
          records: lines,
          cursor: page.cursor,
          hasMore: page.hasMore,
          note: page.records.length ? '要更早的，把 cursor 作为 before 再调一次' : '这条时间线上没有更多记录了',
        }
      },
    },
    {
      name: 'history_search',
      summary: '按日期 / 关键词 / 角色在全部历史里找',
      description:
        '翻页回答"最近说过什么"，检索回答"某天/某句话在哪"。日期以 run 目录名为准（不用记录里的时刻，'
        + '交接类边界记录可能跨到第二天凌晨）。只读。',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD；只查这一天的 run' },
          query: { type: 'string', description: '不区分大小写的子串' },
          role: { type: 'string', enum: ['user', 'assistant', 'tool'], description: '只看某一类' },
          before: { type: 'string', description: '继续往上找：上一次回执里的 cursor' },
          limit: { type: 'integer', description: '最多几条（1-200，默认 40）' },
        },
      },
      execute(args: { date?: string; query?: string; role?: 'user' | 'assistant' | 'tool'; before?: string; limit?: number }) {
        const page = searchTranscript(opts.dataDir, {
          ...(args?.date ? { date: args.date } : {}),
          ...(args?.query ? { query: args.query } : {}),
          ...(args?.role ? { role: args.role } : {}),
          ...(args?.before ? { before: args.before } : {}),
          ...(args?.limit ? { limit: args.limit } : {}),
        })
        return {
          ok: true,
          count: page.hits.length,
          hits: page.hits.map(lineOf),
          cursor: page.cursor,
          hasMore: page.hasMore,
          scannedRuns: page.scannedRuns,
          matchingRuns: page.matchingRuns,
        }
      },
    },
  ]

  const panelMethods: Record<string, PanelMethodDecl<any, any>> = {
    page: {
      name: 'page', verb: 'GET', writable: false,
      summary: '往回翻一页历史（主人操作台用）',
      invoke: (params: { before?: string; limit?: number } = {}) => {
        const page = readTranscriptHistory(opts.dataDir, {
          ...(params?.before ? { before: params.before } : {}),
          ...(params?.limit ? { limit: params.limit } : {}),
        })
        return {
          ok: true,
          records: page.records.map((rec) => ({
            ts: rec.ts,
            kind: rec.kind,
            ...(rec.kind === 'boundary'
              ? { event: rec.event, data: rec.data }
              : {
                  role: rec.item?.role ?? rec.item?.type ?? 'other',
                  name: rec.item?.name ?? null,
                  text: typeof rec.item?.text === 'string'
                    ? rec.item.text
                    : Array.isArray(rec.item?.content)
                      ? (rec.item.content as Array<{ text?: string }>).map((c) => c?.text ?? '').join(' ')
                      : '',
                }),
          })),
          cursor: page.cursor,
          hasMore: page.hasMore,
          scannedRuns: page.scannedRuns,
        }
      },
    },
    search: {
      name: 'search', verb: 'GET', writable: false,
      summary: '按日期/关键词检索历史',
      invoke: (params: { date?: string; query?: string; role?: 'user' | 'assistant' | 'tool'; before?: string; limit?: number } = {}) => ({
        ok: true,
        ...searchTranscript(opts.dataDir, params),
      }),
    },
    setPageSize: {
      name: 'setPageSize', verb: 'POST', writable: true,
      summary: '改默认每页条数（写进本包配置）',
      invoke: (params: { pageSize?: number } = {}) => {
        const n = Number(params?.pageSize)
        if (!Number.isFinite(n) || n < 10 || n > 500) throw new Error('pageSize 只能是 10–500')
        return { ok: true, pageSize: Math.round(n) }
      },
    },
  }

  const panels: CapabilityPanelDecl[] = [
    {
      id: 'history',
      title: '对话历史',
      description: '往回翻之前的全部对话（从不剪枝的那份账），可按日期或关键词找。',
      methods: panelMethods,
    },
  ]

  return {
    id: 'history',
    title: '对话历史与检索',
    kind: 'internal',
    configSchema: {
      type: 'object',
      title: '历史页配置',
      properties: {
        pageSize: { type: 'integer', title: '每页条数', default: HISTORY_DEFAULTS.pageSize, minimum: 10, maximum: 500 },
      },
    },
    defaultConfig: { ...HISTORY_DEFAULTS },
    storageParts: () => [
      {
        key: 'history.runs', label: '对话转录', kind: 'disk', location: runsDir, danger: true,
        note: '各 run 的 transcript.jsonl（只追加、从不剪枝）。本包只读，不提供删除。',
        stat: () => {
          try {
            const n = readdirSync(runsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).length
            return `${n} 个 run`
          } catch {
            return '还没有'
          }
        },
      },
    ],
    tools: () => tools,
    panels: () => panels,
  }
}
