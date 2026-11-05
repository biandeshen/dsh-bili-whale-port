/**
 * 记忆分层的配置组（核心常驻上限 / 活跃容量 / 归档阈值）。
 *
 * 为什么这组要上页面（2026-11-05，B13g）：
 * 这三个数**早就在 `cap-memory` 的 `configSchema` 里声明了**，但——
 *   · `residentCap` 从来没人读：核心常驻取的是硬编码 `slice(0, 8)`；
 *   · `activeCap` 从来没人读；
 *   · `archiveThreshold` 只是 `settle()` 的默认参数，值写死在 0.35。
 * 也就是说：**主人以为能调，页面上看不见、改了也没用**——空旋钮比没旋钮更坏。
 *
 * 现在它们都变成真判据（cap-memory `getConfig` 现读 + dream-tick 透传归档阈值），
 * 所以才配得上一个配置组：
 *   · `memory.residentCap` —— 核心常驻条数上限。她每一轮都记得这些，超额的不进上下文，
 *     并在上下文里明说"core 层共 N 条，本轮只带前 M 条"（主人看得见）。
 *   · `memory.activeCap` —— 近期活跃层容量（超出时新记忆不再无限进活跃层）。
 *   · `memory.archiveThreshold` —— 鲜活度低于它就沉入远期归档（夜里结算用）。
 *
 * 只做代码里真存在的旋钮：没有"每轮召回几条"这种没有实现路径的键。
 */

/** 三个数的默认值（与 cap-memory 的 MEMORY_DEFAULTS 一致）。 */
export const XIAOYU_MEMORY_DEFAULTS = {
  residentCap: 8,
  activeCap: 40,
  archiveThreshold: 0.35,
}

/** 宿主 ConfigGroup 的最小形状（同 context-config.ts，不 import 宿主）。 */
export interface XiaoyuMemoryConfigGroup {
  id: string
  owner: 'core' | 'persona' | `world:${string}` | `provider:${string}`
  schema: {
    type: 'object'
    title: string
    description?: string
    properties: Record<string, unknown>
  }
}

export function memoryConfigGroup(id: string): XiaoyuMemoryConfigGroup {
  return {
    id,
    owner: 'persona',
    schema: {
      type: 'object',
      title: '记忆分层与遗忘',
      description:
        '她的四层记忆（核心常驻 / 近期活跃 / 远期归档 / 已作废）各层放多少、什么时候算淡忘。'
        + '改完立刻生效，不用重启。',
      properties: {
        'memory.residentCap': {
          type: 'integer',
          title: '核心常驻条数上限',
          minimum: 1,
          maximum: 30,
          'x-suffix': '条',
          'x-hot': true,
          description:
            '核心常驻是她每一轮都记得的那几条，也是注意力最贵的地方。\n'
            + '超出上限的仍然留在常驻层，但不进上下文——她不会"忘了"，只是这一轮没被带进去；'
            + '上下文里会写明"core 层共几条、本轮只带几条"，你看得见。',
        },
        'memory.activeCap': {
          type: 'integer',
          title: '近期活跃层容量',
          minimum: 10,
          maximum: 200,
          'x-suffix': '条',
          'x-hot': true,
          description:
            '近期活跃层放她最近在用的记忆。层满了以后新记忆不再直接进这一层，'
            + '而是等夜里结算时按鲜活度自然沉入远期归档。',
        },
        'memory.archiveThreshold': {
          type: 'number',
          title: '归档鲜活度阈值',
          minimum: 0.05,
          maximum: 0.8,
          multipleOf: 0.01,
          'x-hot': true,
          description:
            '夜里结算时，鲜活度低于这条线的记忆沉入远期归档（原文还在 git 里，'
            + '哪天被提起还会回来）。调低 = 忘得更早，调高 = 忘得更晚。',
        },
      },
    },
  }
}
