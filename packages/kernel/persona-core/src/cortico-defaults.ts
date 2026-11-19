/**
 * Cortico Core 配置默认值的本地副本（自 src/core/config.ts:108 抄入，值以 2026-11-04 上游为准）。
 *
 * 为什么抄：转接头需要一份完整的 CoreConfig 默认值打底（缺 logging.areas 等字段宿主直接起不来，
 * 实测踩过）。抄成常量后转接头对 `cortico/*` 的依赖归零——升级宿主时若默认值变更，此处随
 * 「独立审计」更新，属已知维护点。
 */
import { SYSTEM_TIMEZONE } from './tz.ts';

export const CORE_DEFAULTS = {
  /** 用于 WebUI 标题和控制台消息的发送方名称。 */
  displayName: 'Cortico Bot',
  timezone: SYSTEM_TIMEZONE,
  providers: {} as Record<string, unknown>,
  activeProvider: '',
  web: { port: 7777, theme: 'mint' },
  paths: { memory: 'memory', data: 'data' },
  batching: { quietGapMs: 2500, minBatchAgeMs: 0, maxBatchAgeMs: 15000, maxBatchSize: 100 },
  context: { keepPastThinking: true },
  logging: { file: 'debug' as const, stdout: 'info' as const, areas: '' },
} as const;
