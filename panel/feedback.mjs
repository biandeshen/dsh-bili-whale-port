/**
 * 她的意见箱读取/处理（M-UX 2026-10-31：“最好能有这样的机制，或者允许它能提出，然后让她解决”）。
 * 数据源 = tools/commands/feedback.mjs 的 append-only jsonl；面板只做展示 + 主人侧 resolve。
 */
export { listFeedback, resolveFeedback } from '../tools/commands/feedback.mjs'
