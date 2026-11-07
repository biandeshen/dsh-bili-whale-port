/**
 * 心跳退避的**唯一一份**公式（2026-11-07 从投递处抽出来）。
 *
 * 为什么单开一个文件：演示脚本 `scripts/verify-stall-backoff.mjs` 要证明"排拍确实变长"，
 * 如果它自己再抄一遍 `min(30min, 60s×2^n)`，那就成了"演示说一套、线上跑另一套"——
 * 本项目这类漂移已经犯过好几次（回执与代码漂、门禁与盘上事实漂）。
 * 公式只在这里有一份，投递处和演示都从这里取。
 *
 * 界线也写在这儿，免得下次有人顺手把它当配额用：
 * **这里推迟的是"对着已知不通的上游再敲一次"，不是"她今天可以做几件事"。**
 * 上游一恢复（`cost-today` 的 verdict 不再判 stalled/throttled），调用方立刻清零回到原节奏。
 */

/** 连退避次数的上限（0..5）：第 5 次起封顶在 30 分钟，不再往上堆。 */
export const STALL_STEP_MAX = 5
/** 单次退避的封顶（分钟）。再长就失去"恢复后马上能说话"的意义。 */
export const STALL_MAX_MINUTES = 30

/** 第 `step` 次退避该多久（毫秒）：1 → 2 → 4 → 8 → 16 → 30（封顶）。 */
export function stallScheduleMs(step: number): number {
  const s = Math.max(0, Math.min(STALL_STEP_MAX, Number(step) || 0))
  return Math.min(STALL_MAX_MINUTES * 60_000, 60_000 * 2 ** s)
}

/** 给人看的那一句：退避多少分钟、为什么（措辞里必须点明这不是行动限制）。 */
export function stallNotice(step: number): string {
  return `上游不通，心跳退避 ${Math.round(stallScheduleMs(step) / 60_000)} 分钟——这拦的是空转，不是她想做事`
}
