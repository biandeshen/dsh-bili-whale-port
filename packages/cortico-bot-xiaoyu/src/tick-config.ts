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
 *   · 空拍退避**已经整条删掉**（2026-11-06）：shouldAct=false 的那一拍一个字都不投、
 *     不花模型调用，退避只是在把采样间隔偷偷拉长 8 倍。所以这里没有"退避倍率"这个旋钮。
 *   · 睡眠时段也不放这儿：它已经有一条真能用的路（鱼缸面板设完写进 `life.json`），
 *     再开一个 config 键就是两个真相。
 */

/** 心跳间隔的默认值：0.5 分钟 = 30 秒一评估（主人 2026-11-06 拍板不限次，评估贴着"她想动"走）。 */
export const XIAOYU_TICK_DEFAULTS = {
  intervalMinutes: 0.5,
  /**
   * 两次**真正叫醒**之间的最小间隔（分钟）—— 抄上游 `night.minGapMin` 的默认 10。
   *
   * 两个数不是一回事，别混：
   *   · `intervalMinutes = 0.5`  → 多久**评估**一次（评估不投递、不花钱）
   *   · `minWakeGapMinutes = 10` → 评估通过后，距上次真叫醒不足 10 分钟就先不动
   *
   * 上游原话（night-plan.mjs:73-86）：「改成【硬下限】——窗口挤不下就少醒几次，
   * 不自动压缩间隔（主人要的是"每次至少隔 10 分钟"，不是"尽量隔开"）」。
   * 实测依据：11-13 那个 run 4 笔行动之间最短只隔 5 分钟。
   */
  minWakeGapMinutes: 10,
  /**
   * 会话轮换天数 —— 抄上游 `sessionRotateDays`，默认 0（不轮换，与上游一致）。
   *
   * 上游语义（`lib/session-delivery.js:29`）：已用满 N 天 + 距上次投递 ≥8 分钟 + 不忙 → 换会话。
   * Cortico 没有 createSession，所以我们的等价物是**请求一次上下文交接**：
   * 效果一样（旧对话换成笔记，上下文不再无限堆），差别只是 session id 不变。
   */
  sessionRotateDays: 0,
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
        '这一拍决定她多久自己醒一次。醒着的每一拍只是对账，不动就不投递、不花模型调用；'
        + '只有真的想动的那一拍才会叫醒她。改完立刻生效，不用重启。',
      properties: {
        'tick.sessionRotateDays': {
          type: 'number',
          title: '会话轮换天数',
          minimum: 0,
          maximum: 365,
          'x-suffix': '天（0 = 不轮换）',
          'x-hot': true,
          description:
            '一份会话最多用多少天。到期后在**空闲时**（距上次投递 ≥8 分钟、且没有回合在跑）'
            + '请求一次上下文交接：更早的对话换成一份笔记，旧内容仍可回溯。'
            + '**这不是配额**：她该做的事一件不少，只是不让上下文无限堆。0 = 不轮换（默认，同上游）。',
        },
        'tick.minWakeGapMinutes': {
          type: 'number',
          title: '两次叫醒至少隔多久',
          minimum: 0,
          maximum: 240,
          'x-suffix': '分钟',
          'x-hot': true,
          description:
            '评估通过后，距上一次**真的叫醒她**不足这么久就先不动（默认 10 分钟，抄上游）。'
            + '**这不是每日配额**：她一天能醒几次仍由体力与场强自己收敛；'
            + '这里只防"5 分钟里被叫醒两次"那种机械重复。0 = 不限。',
        },
        'tick.intervalMinutes': {
          type: 'number',
          title: '醒来的间隔',
          minimum: 0,
          maximum: 180,
          'x-suffix': '分钟（可小数，0.5 = 30 秒）',
          'x-hot': true,
          description:
            '她每隔这么久自己评估一次"想不想动"。**不限活动次数**（主人 2026-11-06 拍板）：'
            + '该不该动由冲动强度与体力自己收敛，累了自然歇，唯一的节流阀是体力。'
            + '不动的那一拍不投递、不花模型调用。\n'
            + '0 = 关掉这一拍：她只在有人戳她或来消息时才醒——那她就退回成聊天窗口了。',
        },
      },
    },
  }
}
