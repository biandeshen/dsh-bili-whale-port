/**
 * 时间感知纯函数（昼夜相位 / 季节 / 时间元信息 / 自然语言时间句；零 IO）。
 */

export type CircadianPhaseName =
  | 'dawn'
  | 'morning'
  | 'noon'
  | 'afternoon'
  | 'evening'
  | 'night'
  | 'late_night';

export type SeasonName = 'spring' | 'summer' | 'autumn' | 'winter';

export interface CircadianPhase {
  readonly name: CircadianPhaseName;
  readonly label: string;
  readonly from: number;
  readonly to: number;
}

export interface TemporalMeta {
  readonly hour: number;
  readonly dayOfWeek: number;
  readonly circadianPhase: CircadianPhaseName;
  readonly phaseLabel: string;
  readonly season: SeasonName;
  readonly seasonLabel: string;
  readonly weekdayLabel: string;
  readonly isNight: boolean;
}

const PHASES: readonly CircadianPhase[] = [
  { name: 'dawn', label: '清晨', from: 5, to: 7 },
  { name: 'morning', label: '上午', from: 7, to: 12 },
  { name: 'noon', label: '中午', from: 12, to: 14 },
  { name: 'afternoon', label: '下午', from: 14, to: 18 },
  { name: 'evening', label: '傍晚', from: 18, to: 21 },
  { name: 'night', label: '晚上', from: 21, to: 23 },
  { name: 'late_night', label: '深夜', from: 23, to: 29 }, // 跨午夜：23–(24+5)
];

const SEASON_LABEL: Readonly<Record<SeasonName, string>> = {
  spring: '初春',
  summer: '初夏',
  autumn: '初秋',
  winter: '初冬',
};

const WEEKDAY = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'] as const;

export function circadianPhase(hour: number): CircadianPhase {
  const h = hour < 5 ? hour + 24 : hour;
  return PHASES.find((p) => h >= p.from && h < p.to) ?? PHASES[6];
}

export function season(month: number): SeasonName {
  if (month >= 3 && month < 6) return 'spring';
  if (month >= 6 && month < 9) return 'summer';
  if (month >= 9 && month < 12) return 'autumn';
  return 'winter';
}

export function buildTemporalMeta(now: Date = new Date()): TemporalMeta {
  const hour = now.getHours();
  const phase = circadianPhase(hour);
  const s = season(now.getMonth() + 1);
  return {
    hour,
    dayOfWeek: now.getDay(),
    circadianPhase: phase.name,
    phaseLabel: phase.label,
    season: s,
    seasonLabel: SEASON_LABEL[s],
    weekdayLabel: WEEKDAY[now.getDay()],
    isNight: hour >= 23 || hour < 5,
  };
}

export function nowSentence(now: Date = new Date()): string {
  const m = buildTemporalMeta(now);
  return `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${m.weekdayLabel} ${m.phaseLabel}（${m.seasonLabel}）`;
}
