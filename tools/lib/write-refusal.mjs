/**
 * 写操作失败的统一收口（2026-11-02）。
 *
 * 起因是她 11-01 的三次点赞在会话记录里长这样：
 *
 *   file:///E:/.../tools/lib/traffic.mjs:120
 *   if (a.lastWrite && timestamp - a.lastWrite < gap …) throw new TrafficError('写操作冷却中，请稍后再发送')
 *
 * —— 一条裸的 Node 堆栈。原因是 like/fav/comment/danmaku 四条写链路只给 `GET` 包了 try，
 * POST 那一步没包：`traffic.mjs` 抛的 TrafficError 直接把进程崩掉。崩掉有两个后果：
 *   ① 她读到的是堆栈不是结论，学不到"这是冷却，等一会儿再来"；
 *   ② 因果账本一条不写（World 只在 `status===0` 时记），于是"她从没点过赞"和
 *      "她点了四次全失败"在账上长得一模一样。实测就是后者：`causal.jsonl` 里 `like` 0 条。
 *
 * 这里做两件事：把失败翻译成一行能读的拒绝，并**无论成败都留一条账**。
 */
import { appendCausal } from './causal.mjs'
import { whaleHome } from './paths.mjs'

/** traffic 闸的拒绝（冷却/暂停）——这类是可重试的，不是平台否决。 */
export function isGateRefusal(err) {
  return err?.name === 'TrafficError' || err?.code === 'BILI_TRAFFIC_PAUSED'
}

/** 一行能读的拒绝原因：冷却说清"等一会儿"，其余如实带 message。 */
export function refusalReason(err) {
  if (isGateRefusal(err)) return `${err.message}（${err.code ?? 'BILI_TRAFFIC_PAUSED'}）—— 等冷却过了再试，别改内容重发`
  return String(err?.message ?? err ?? '未知错误')
}

/**
 * 记一条失败账。`kind` 传动作名（like/fav/comment/danmaku），落盘是 `<kind>-failed`，
 * 与成功账（World 写的 `kind`）成对；actor 由 `appendCausal` 统一标成 cli。
 */
export function noteWriteFailure({ kind, bv = '', reason = '', home = whaleHome } = {}) {
  return appendCausal(home, {
    kind: `${kind}-failed`,
    bv: String(bv).slice(0, 20),
    reason: String(reason).slice(0, 200),
    atMs: Date.now(),
  })
}

/**
 * 包住一次写请求：抛出来的错一律翻成一行 `✗ …`、记一条失败账，然后按"闸门拒"退 4。
 * 退出码 4 与 quota-gate 的既有语义一致（World 与面板都按这个数判断"没发出去但不是崩溃"）。
 * 成功账不在这里写——World 与 go-gate 放行各自已经记了，重复记会让 K4 的分母翻倍。
 */
export async function attemptWrite(label, fn, { kind, bv = '', home = whaleHome } = {}) {
  try {
    return await fn()
  } catch (e) {
    const reason = refusalReason(e)
    console.error(`✗ ${label}没发出去：${reason}`)
    noteWriteFailure({ kind, bv, reason, home })
    process.exit(4)
  }
}
