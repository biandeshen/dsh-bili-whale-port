/**
 * 时间感知纯函数（移植自 AMpath packages/shared/src/embodiment/temporal.ts，
 * 去 TS/zod 化；私用借用，AMpath 无 LICENSE，禁止随本仓库对外分发）。
 *
 * 用途：
 *   · panel 昼夜场景与 HUD（phase/isNight）
 *   · 唤醒提示词与日记条目的时间元信息（buildTemporalMeta 的中文标签）
 *   · inWindow 的语义参照（作息窗口仍是 night-plan 的唯一裁决，本文件不裁决）
 */

const PHASES = [
  { name: 'dawn', label: '清晨', from: 5, to: 7 },
  { name: 'morning', label: '上午', from: 7, to: 12 },
  { name: 'noon', label: '中午', from: 12, to: 14 },
  { name: 'afternoon', label: '下午', from: 14, to: 18 },
  { name: 'evening', label: '傍晚', from: 18, to: 21 },
  { name: 'night', label: '晚上', from: 21, to: 23 },
  { name: 'late_night', label: '深夜', from: 23, to: 29 }, // 跨午夜：23–(24+5)
]

export function circadianPhase(hour) {
  const h = hour < 5 ? hour + 24 : hour
  return PHASES.find(p => h >= p.from && h < p.to) ?? PHASES[6]
}

export function season(month) {
  if (month >= 3 && month < 6) return 'spring'
  if (month >= 6 && month < 9) return 'summer'
  if (month >= 9 && month < 12) return 'autumn'
  return 'winter'
}

const SEASON_LABEL = { spring: '初春', summer: '初夏', autumn: '初秋', winter: '初冬' }
const WEEKDAY = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

/** 事件时间元信息：写进 whale-log.jsonl / 日记条目，供 panel 时间线加权与展示。 */
export function buildTemporalMeta(now = new Date()) {
  const hour = now.getHours()
  return {
    hour,
    dayOfWeek: now.getDay(),
    circadianPhase: circadianPhase(hour).name,
    phaseLabel: circadianPhase(hour).label,
    season: season(now.getMonth() + 1),
    seasonLabel: SEASON_LABEL[season(now.getMonth() + 1)],
    weekdayLabel: WEEKDAY[now.getDay()],
    isNight: hour >= 23 || hour < 5,
  }
}

/** 给唤醒提示词/信件的一句"此刻"，替代原先各处零散的小时判断。 */
export function nowSentence(now = new Date()) {
  const m = buildTemporalMeta(now)
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${m.weekdayLabel} ${m.phaseLabel}（${m.seasonLabel}）`
}
