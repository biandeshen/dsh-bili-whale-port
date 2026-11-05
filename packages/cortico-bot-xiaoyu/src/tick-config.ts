/**
 * 心跳（她自己醒过来那拍）的配置组。
 *
 * 为什么这条要上页面（2026-11-05，设计交接 story-4「旋钮全上页面」）：
 * 间隔其实**早就从部署配置读了**，而且是每拍重读——`cortico-definition.ts` 里
 * `tickDelayMs` 现取 `config.tick.intervalMinutes`，改完不用重启就生效。
 * 缺的只有两样：**默认值**与**配置组的声明**（宿主只渲染 `webUi.configGroups`
 * 登记过的键）。于是这个数一直只能手改 `config.json`，页面上看不见也改不了。
 *
 * 只做代码里真存在的旋钮：
 *   · `tick.intervalMinutes` —— 有实现（`LifeHeartbeat` 的 baseline 每拍读它）。
 *   · 空拍退避倍率（封顶 8×）不做成旋钮：它是 `life-heartbeat.ts` 里的常量，
 *     没有配置读取路径，挂上去就是个改了没用的假旋钮。
 *   · 睡眠时段也不放这儿：它已经有一条真能用的路（鱼缸面板设完写进 `life.json`），
 *     再开一个 config 键就是两个真相。
 */

/** 心跳间隔的默认值：5 分钟一拍（与线上 config.json 当前值一致）。 */
export const XIAOYU_TICK_DEFAULTS = {
  intervalMinutes: 5,
}

/** 宿主 ConfigGroup 的最小形状（同 context-config.ts，不 import 宿主）。 */
export interface XiaoyuTickConfigGroup {
  id: string
  owner: 'core' | 'persona' | `world:${string}` | `provider:${string}`
  schema: {
    type: 'object'
    title: string
    description?: string
    properties: Record<string, unknown>
  }
}

export function tickConfigGroup(id: string): XiaoyuTickConfigGroup {
  return {
    id,
    owner: 'persona',
    schema: {
      type: 'object',
      title: '心跳与作息',
      description:
        '这一拍决定她多久自己醒一次。连续空拍会自动拉长间隔（最长 8 倍），有人来叫她立刻复位。改完立刻生效，不用重启。',
      properties: {
        'tick.intervalMinutes': {
          type: 'integer',
          title: '醒来的间隔',
          minimum: 0,
          maximum: 180,
          'x-suffix': '分钟',
          'x-hot': true,
          description:
            '她每隔这么久自己醒一次，看看有没有该做的事。\n'
            + '0 = 关掉这一拍：她只在有人戳她或来消息时才醒——那她就退回成聊天窗口了。',
        },
      },
    },
  }
}
