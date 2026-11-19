/** 宿主时区取本机时区（与 Cortico src/core/util.ts:54 的 SYSTEM_TIMEZONE 同口径）。 */
export const SYSTEM_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
