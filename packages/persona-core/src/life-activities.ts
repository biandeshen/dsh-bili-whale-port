/**
 * 7 类生活活动 —— 醒来时的日常微活动候选与轮换（connection 只由与主人接触提升）。
 *
 * 她不联网也能"过日子"：醒来时从候选中挑一个，做完把选择写回 life.json.lastKind。
 * 选择由场值打分 + 抖动决定候选，最终由模型挑——代码不替她决定。
 */
import type { AtomicFields } from './types.ts'

export type ActivityType = 'rest' | 'explore' | 'create' | 'social' | 'reflect' | 'exercise' | 'consume'

export interface LifeActivity {
  type: ActivityType
  label: string
  description: string
}

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  rest: '歇会儿',
  explore: '找点新鲜的',
  create: '做点东西',
  social: '想他 / 翻旧记录',
  reflect: '想想事',
  exercise: '动一动',
  consume: '看点轻松的',
}

/** 每类 5 条文案，按小时轮换（同一类活动说法不同，而不是永远一句）。 */
const TEMPLATES: Record<ActivityType, string[]> = {
  rest: [
    '窝在椅子上，听窗外的声音发一会儿呆',
    '闭眼靠了一会儿，世界安静下来',
    '给自己泡了杯热的，慢慢喝完',
    '趴在桌上小憩了几分钟',
    '放空了一会儿，什么都不想',
  ],
  explore: [
    '在推荐里翻到没见过的角落，想多看两眼',
    '点开一个从来没听过的话题',
    '听了一首新歌，旋律在脑子里转',
    '把收藏夹翻了一遍，挑出一个漏掉的',
    '顺着一个 BV 的评论区一路看下去',
  ],
  create: [
    '随手写了几句碎碎念，不算日记',
    '画了两笔，不好看但挺开心',
    '拼了一小段旋律，哼给自己听',
    '把桌面重新摆了一遍',
    '写了一首小诗，押韵押得乱七八糟',
  ],
  social: [
    '翻看以前和{{owner}}的聊天记录，忍不住笑了一下',
    '想给他发条消息，打了一半又删掉',
    '在别人的动态底下看了很久评论',
    '想起一个人，默默在心里问了句好',
    '把想说的话先写在私密日记里',
  ],
  reflect: [
    '想了想最近的日子，好像还行',
    '对着窗户发了会儿呆，思绪飘远了',
    '回忆起一件小事，嘴角动了一下',
    '盘算了一下明天想做的事',
    '安静坐了一会儿，和自己待着',
  ],
  exercise: [
    '做了几组伸展，身体舒展开了',
    '原地跑了一小会儿，心跳快起来',
    '跟着视频练了几分钟，累但充实',
    '跳了几下，活动活动筋骨',
    '在屋里走了很多圈，脚有点酸',
  ],
  consume: [
    '看了一个短视频，学到一个冷知识',
    '刷了会儿手机，看到好多有意思的事',
    '翻了几页书，一个段落读了三遍',
    '听了一期播客，嘉宾说的挺有道理',
    '看了一集短剧，虽然老套但挺好看',
  ],
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/** 场值 → 活动倾向分（0-1，只是候选排序，不是决定）。 */
function scoreActivity(type: ActivityType, f: AtomicFields): number {
  switch (type) {
    case 'rest': return clamp01((0.45 - f.energy) / 0.45)
    case 'exercise': return clamp01((f.energy - 0.5) * 1.5 + (f.stimulation - 0.4))
    case 'explore': return clamp01((f.curiosity - 0.3) + (0.45 - f.stimulation))
    case 'create': return clamp01((f.creativity - 0.25) * 1.5)
    case 'social': return clamp01((0.45 - f.connection) * 1.2)
    case 'consume': return clamp01((f.stimulation - 0.15) * 1.5)
    case 'reflect': return 0.2
  }
}

/** 按时钟轮换文案：同一类活动在不同时间说不同的话。 */
function describe(type: ActivityType, now: number): string {
  const list = TEMPLATES[type]
  const hours = Math.floor(now / 3600_000)
  return list[((hours % list.length) + list.length) % list.length]
}

export function pickActivities(
  fields: AtomicFields,
  opts: { now: number; rng: () => number; k?: number },
): LifeActivity[] {
  const k = Math.max(1, Math.min(7, opts.k ?? 3))
  const scored = (Object.keys(TEMPLATES) as ActivityType[]).map((type) => ({
    type,
    score: scoreActivity(type, fields) + opts.rng() * 0.25,
  }))
  scored.sort((a, b) => b.score - a.score || a.type.localeCompare(b.type))
  return scored.slice(0, k).map(({ type }) => ({
    type,
    label: ACTIVITY_LABELS[type],
    description: describe(type, opts.now),
  }))
}
