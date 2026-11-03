/**
 * cortico-world-bilibili —— B 站整域能力薄转接头（kind: "world", api: 6, World id: "bili-account"）。
 *
 * 默认导出是 Cortico 的 WorldDefinition（装载入口）；工厂函数 createBiliWorldAdapter
 * 是宿主无关版本（给别的底座或测试用）。
 */
import path from 'node:path'
import { homedir } from 'node:os'
import {
  validateCapabilityContract,
} from '../../persona-core/src/capability.ts'
import {
  createBilibiliCapability,
  type BilibiliCapabilityOptions,
} from '../../cap-bilibili/src/index.ts'
import { createBiliWorld, type BiliWorldOptions, type CorticoWorldHost } from './cortico-world.ts'

export { createBiliWorld }
export type { BiliWorldOptions, CorticoWorldHost }

export interface BiliWorldAdapterOptions extends Omit<BilibiliCapabilityOptions, 'dataDir'> {
  homeDir: string
}

export function createBiliWorldAdapter(opts: BiliWorldAdapterOptions) {
  const dataDir = path.join(opts.homeDir, 'data', 'bilibili')
  const w = createBiliWorld({
    ...opts,
    dataDir,
  })
  const cap = w.capability
  const check = validateCapabilityContract(cap)
  if (!check.ok) {
    throw new Error(`cap-bilibili contract validation failed: ${check.errors.join('; ')}`)
  }

  return {
    id: 'bili-account' as const,
    label: '小鱼 · B站账号',
    kind: 'world' as const,
    api: 6 as const,
    capability: cap,
    defaults: () => ({ enabled: true, ...cap.defaultConfig }),
    configSchema: cap.configSchema,
    tools: () => w.world.tools(),
    panels: () => cap.panels(),
    world: w.world,
    start: (host: CorticoWorldHost) => w.world.start(host),
    stop: () => w.world.stop(),
    invokePanel: async (panelId: string, method: string, params: Record<string, unknown> = {}) => {
      const p = cap.panels().find((x) => x.id === panelId)
      if (!p) throw new Error(`Unknown panel "${panelId}"`)
      const m = p.methods[method]
      if (!m) throw new Error(`Unknown method "${panelId}.${method}"`)
      return await m.invoke(params)
    },
  }
}

// ── Cortico 装载入口（默认导出）──────────────────────────────────────────────

const TOOL_SUMMARIES: Record<string, string> = {
  bili_inbox_read: '读取 B 站四路收件箱（私信 / 评论回复 / @提及 / 收到的赞）',
  bili_inbox_ack: '把处理完的收件箱条目标为已读',
  bili_feed: '刷 B 站首页推荐流（自动套用看片偏好与时长标注）',
  bili_debrief: '深读一条视频：标题、简介、弹幕采样与高赞评论',
  bili_subtitles: '读取视频的 CC 或 AI 字幕全文',
  bili_search: '按关键词搜索 B 站视频',
  bili_comments: '查看视频评论区与楼中楼',
  bili_whois: '查询 B 站用户与 UP 主信息',
  bili_dynamic_recent: '核对账号最近已发布的动态',
  bili_dynamic_draft: '发起一条图文或纯文字动态（经把关链）',
  bili_dynamic_edit: '修改一条已发布或待审的动态',
  bili_comment: '在视频下发表评论或回复别人的评论',
  bili_danmaku: '向视频发送一条弹幕',
  bili_dm_reply: '回复 B 站私信（受档位与回信时效窗管控）',
  bili_like: '为真正喜欢的视频点赞（30 天内不重复）',
  bili_fav: '收藏值得回看的视频（每天 3 条上限，理由至少 6 个字）',
}

const EVENT_DESCRIPTIONS = [
  { type: 'bili-account.inbox', description: 'B 站有新私信 / 评论回复 / @提及 / 收到的赞', trigger: 'wake', tags: ['social'] },
  { type: 'bili-account.inbox_assigned', description: '主人指派她回复某条消息', trigger: 'wake', tags: ['social'] },
  { type: 'bili-account.draft_rejected', description: '主人驳回了她的草稿（可带理由要求重写）', trigger: 'wake', tags: ['speak'] },
  { type: 'bili-account.owner_order_draft', description: '主人点单让她写一条动态或评论', trigger: 'wake', tags: ['speak'] },
]

function defaultHomeDir(): string {
  return path.join(homedir(), '.xiaoyu-home')
}

const definition = {
  id: 'bili-account',
  label: '小鱼 · B站账号',
  defaults: () => ({ enabled: true }),
  create(ctx: { config: Record<string, unknown> }) {
    const homeDir = String(ctx.config?.homeDir ?? defaultHomeDir())
    const w = createBiliWorld({
      homeDir,
      dataDir: path.join(homeDir, 'data', 'bilibili'),
      credentialsFile: path.join(homeDir, '.env'),
      assetsDir: path.join(homeDir, 'data', 'media', 'assets'),
      bgmDir: path.join(homeDir, 'data', 'media', 'bgm'),
    } as never)
    return w.world
  },
  describe: {
    tools: Object.entries(TOOL_SUMMARIES).map(([name, summary]) => ({
      name,
      summary,
      description: summary,
      parameters: { type: 'object', properties: {} },
      tags: [],
    })),
    events: EVENT_DESCRIPTIONS,
  },
}

export default definition
