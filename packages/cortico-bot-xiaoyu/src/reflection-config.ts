/**
 * 睡前反思的配置组（主人 2026-11-05 拍板：反思花模型钱）。
 *
 * 这一组存在的意义是**让花不花钱由主人决定，而且看得见**：
 *   · 以前她的"做梦"是纯本地拼接（沉记忆 + 一句模板），零成本也零理解；
 *   · 现在多一条路：睡着的时候真的想一遍，用她自己的工具把值得留的写下来——
 *     **这要花模型钱**，所以默认**关**。
 *
 * 三条硬约束（不是建议，是判据）：
 *   · `reflection.enabled` —— 总开关，**默认 false**；
 *   · `reflection.maxPerDay` —— 每天最多想几次（默认 1）；
 *   · `reflection.maxRounds` —— 每晚最多几轮工具循环（默认 2，跑不完就收线）。
 *
 * 成本账走宿主标准用量（成本页看得见），写下的记忆进她的记忆卡与日记，走同一套 git 记账。
 */

/** 默认值：全关（要花的钱得主人显式点头）。 */
export const XIAOYU_REFLECTION_DEFAULTS = {
  enabled: false,
  maxPerDay: 1,
  maxRounds: 2,
  minSleepHours: 3,
}

/** 宿主 ConfigGroup 的最小形状（同 context-config.ts，不 import 宿主）。 */
export interface XiaoyuReflectionConfigGroup {
  id: string
  owner: 'core' | 'persona' | `world:${string}` | `provider:${string}`
  schema: {
    type: 'object'
    title: string
    description?: string
    properties: Record<string, unknown>
  }
}

export function reflectionConfigGroup(id: string): XiaoyuReflectionConfigGroup {
  return {
    id,
    owner: 'persona',
    schema: {
      type: 'object',
      title: '睡前的反思',
      description:
        '她睡着的时候要不要真的想一遍。想=起一次临时会话（用她自己的记忆/日记工具），'
        + '要花模型钱，成本在「用量与成本」页看得见。默认关。',
      properties: {
        'reflection.enabled': {
          type: 'boolean',
          title: '睡觉时想一遍',
          default: false,
          'x-hot': true,
          description:
            '开着的话，她夜里睡够之后会真的想一次这几天有什么值得留下的，'
            + '想出来的用她自己的工具写进记忆卡与日记（走同一套 git 记账，你在面板上看得见）。\n'
            + '**会花模型钱**（一次标准对话的量），花在「用量与成本」页里。\n'
            + '关着的时候她照样做梦（沉记忆 + 遗忘叙事），只是不会"想"。',
        },
        'reflection.maxPerDay': {
          type: 'integer',
          title: '每天最多想几次',
          minimum: 1,
          maximum: 3,
          'x-suffix': '次',
          'x-hot': true,
          description: '不是每晚都能想。一天最多想这么多次，其余时间她就是睡觉。',
        },
        'reflection.maxRounds': {
          type: 'integer',
          title: '每晚最多几轮',
          minimum: 1,
          maximum: 4,
          'x-suffix': '轮',
          'x-hot': true,
          description:
            '一轮 = 一次模型调用 + 她的工具动作。跑满就收线，不许她半夜自己聊下去。',
        },
        'reflection.minSleepHours': {
          type: 'number',
          title: '睡够几小时才值得想',
          minimum: 0,
          maximum: 12,
          multipleOf: 0.5,
          'x-suffix': '小时',
          'x-hot': true,
          description: '没睡够就别想——刚眯一会儿就想事，写出来的多半是噪声。',
        },
      },
    },
  }
}
