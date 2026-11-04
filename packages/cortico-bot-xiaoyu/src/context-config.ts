/**
 * 她的上下文预算配置组（宿主 WebUI 的标准「配置」页签）。
 *
 * 为什么有这一组（2026-11-04，主人："上下文长度设不了"）：
 * 迁移时把能力包（干活的功能）搬过来了，但配置组（能改能看能清的旋钮）整块漏了——
 * 宿主从 bot 的 `webUi.configGroups` 收拢配置页签（src/bot.ts:940），
 * 小鱼一个都没声明，于是她的页面上**连「配置」页签都不生成**。
 * 数字还在 `config.json` 里，但只能手改 JSON + 重启。
 *
 * 形状照抄宿主 `bots/cormini/persona/config.ts`，**不 import 宿主模块**：
 * A3 的解耦约定是转接头不依赖 `cortico/*`，只做「类型形状对齐 + 默认值本地持有」。
 *
 * 注意区分两个数：
 *   · `context.maxTokens` = 我们**请求**多少（阶段预算）
 *   · provider 的 `contextWindow` = 模型**允许**多少（物理上限）
 * 调大前者不会突破后者，所以描述里写清楚了。
 */

export interface ContextStagePolicy {
  /** 上下文阶段预算（token）：超过它 × 软阈值就预警，再超就交接。 */
  maxTokens: number
  /** 软阈值比例：预警线 = 阶段预算 × 此值。 */
  softRatio: number
  /** 交接保留比例：交接笔记的预算 = 阶段预算 × 此值。 */
  keepRatio: number
  /** 是否把部署 prompts/ 里的首轮对话作为合成开头送进每次请求。 */
  firstTurn: boolean
}

/** 与宿主 cormini 的默认值对齐（bots/cormini/persona/persona.ts:198）。 */
export const XIAOYU_CONTEXT_DEFAULTS: ContextStagePolicy = {
  maxTokens: 64000,
  softRatio: 0.85,
  keepRatio: 1 / 3,
  firstTurn: false,
}

/** 宿主 ConfigGroup 的最小形状（不 import 宿主：src/core/config-schema.ts:58）。 */
export interface XiaoyuConfigGroup {
  id: string
  owner: 'core' | 'persona' | `world:${string}` | `provider:${string}`
  schema: {
    type: 'object'
    title: string
    description?: string
    properties: Record<string, unknown>
  }
}

export function contextStageConfigGroup(id: string): XiaoyuConfigGroup {
  return {
    id,
    owner: 'persona',
    schema: {
      type: 'object',
      title: '上下文与交接',
      description:
        '模型窗口与单次输出上限在「语言模型」页配置。上下文达到模型硬限制时由 Core 强制交接。',
      properties: {
        'context.maxTokens': {
          type: 'integer',
          title: '上下文阶段预算',
          minimum: 8000,
          maximum: 2_000_000,
          multipleOf: 1000,
          'x-suffix': 'tok',
          'x-hot': true,
          description:
            '上下文超过阶段预算 × 软阈值比例时先提示；下一批结束时仍超出则交接。'
            + '这是我们请求多少，不是模型允许多少——模型窗口在「语言模型」页。',
        },
        'context.keepRatio': {
          type: 'number',
          title: '交接保留比例',
          minimum: 0.05,
          maximum: 0.9,
          multipleOf: 0.01,
          'x-suffix': '×',
          'x-hot': true,
          description:
            '交接笔记的 token 预算 = 阶段预算 × 此比例。笔记保留最近内容，更早的部分只留计数。',
        },
        'context.softRatio': {
          type: 'number',
          title: '软阈值比例',
          minimum: 0.1,
          maximum: 1,
          multipleOf: 0.01,
          'x-suffix': '×',
          'x-hot': true,
          description: '上下文预警阈值 = 阶段预算 × 此比例。',
        },
        'context.firstTurn': {
          type: 'boolean',
          title: '合成首轮对话',
          'x-hot': true,
          description:
            '把部署 prompts/ 里的首轮对话(FIRST_TURN_USER / THINKING / REPLY)作为合成开头送进每次请求,不写入 session;内容为空时不送。',
        },
      },
    },
  }
}
