/**
 * cortico-bot-xiaoyu 的 Cortico 装载入口（BotDefinition，kind: "bot", api: 7）。
 *
 * 它是"她"这个人格在 Cortico 里的唯一入口：
 *   - 挂载三个对内能力包（状态作息 / 四层记忆 / 日记判断）为一个 Persona；
 *   - 声明她用到的渠道（控制台 + B站 + 音视频工作室）；
 *   - 把全局唯一的生活 tick 挂在 BotParts.onStart 上（框架原生的昼夜心跳位置）。
 */
import path from 'node:path'
import { homedir } from 'node:os'
import { XiaoYuPersona } from './cortico-persona.ts'

export const XIAOYU_MEMORY_NAME = 'MEMORY.md'

const TOOL_SUMMARIES: Record<string, string> = {
  mood_read: '读她当前的场值、情绪与成因',
  mood_apply: '记下事件引起的场值与心情变化（看完一条可给 keep/drop/unclear）',
  memory_remember: '记下一条新的记忆卡片',
  memory_recall: '按话题检索她的记忆库',
  memory_void: '作废一条记错的记忆（原文留痕，退出召回）',
  diary_read: '分页或按天/按小节读她的两本日记',
  diary_write: '向公开本或私人本写入一个小节',
  judgment_read: '读她的审美判断卡独立视图',
  judgment_write: '新增一张结构化判断卡',
  feedback_submit: '向主人的意见箱提交一条反馈',
}

function defaultHomeDir(): string {
  return path.join(homedir(), '.xiaoyu-home')
}

export function createXiaoyuBotDefinition(homeDir: string) {
  return {
    id: 'xiaoyu',
    memoryName: XIAOYU_MEMORY_NAME,
    declares: ['console', 'bili-account', 'media-studio'] as const,
    defaults: () => ({
      displayName: '小鱼',
      web: { port: 7798 },
      paths: { memory: 'workspace', data: 'data' },
      rounds: { soft: 6, hard: 12 },
    }),
    build(loaded: { config: Record<string, unknown>; memoryDir: string }) {
      const persona = new XiaoYuPersona({
        homeDir: homeDir || String(loaded.config?.homeDir ?? defaultHomeDir()),
        rounds: { soft: 6, hard: 12 },
      })
      return {
        persona,
        onStart: () => persona.start(),
        onStop: () => persona.stop(),
      }
    },
    describe: {
      tools: Object.entries(TOOL_SUMMARIES).map(([name, summary]) => ({
        name,
        summary,
        description: summary,
        parameters: { type: 'object', properties: {} },
        tags: [],
      })),
      memory: {
        form: {
          zh: '四层 Markdown 记忆卡片（核心常驻 / 近期活跃 / 远期归档 / 已作废）+ 两本日记 + 审美判断卡，全部在 workspace 里，由 Git 记账可回退。',
          en: 'Four tiers of Markdown memory cards plus two diaries and a judgment-card file, all under workspace/ with Git history.',
        },
      },
    },
  }
}

export default createXiaoyuBotDefinition(defaultHomeDir())
