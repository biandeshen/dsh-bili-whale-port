/**
 * 发送策略（2026-10-31 主人拍板）——单一事实源 = `bili-whale.config.json` 的
 * `publish` / `permissions` 两节。dsh 工具与 Cortico World 都读同一份，不各存各的。
 *
 * publish.draftMode     'review'（默认，人工放行）| 'auto'（她出稿后自动发）
 * publish.autoDailyCap  0 = 不限（主人要的默认）；>0 = 每日 auto 条数上限
 * publish.autoWindow    'HH:MM-HH:MM'（支持跨午夜），'' = 不限时段
 * permissions.like/fav      'self'（默认自发）| 'review'（收回：--go 进待审队列）
 * permissions.dmReply       'direct'（默认直发主人）| 'queue'（回信改回草稿队列）
 * permissions.comment       'review'（默认：评论一律进待审队列等主人放行）| 'self'（收回成自发）
 * permissions.danmaku       'review'（默认：弹幕一律进待审队列等主人放行）| 'self'（收回成自发）
 *
 * 2026-11-03：评论与弹幕原先没有档位，行为写死在各命令里（评论无条件进队列、弹幕无条件进队列），
 * 主人想调都调不了。现在补成同一节配置，和 like/fav/dmReply 一个口径；默认保持原行为不变。
 *
 * 红线不在这里：kill 压过一切配置（traffic 写通道）、防双发在 dynamic-approve 的
 * sending 状态机、auto 发布必写因果留痕。
 */
export const POLICY_DEFAULTS = {
  draftMode: 'review',
  autoDailyCap: 0,
  autoWindow: '',
  like: 'self',
  fav: 'self',
  dmReply: 'direct',
  comment: 'review',
  danmaku: 'review',
}

export function readPolicy(cfg) {
  const p = cfg?.publish ?? {}
  const t = cfg?.permissions ?? {}
  return {
    draftMode: p.draftMode === 'auto' ? 'auto' : 'review',
    autoDailyCap: Math.max(0, Number(p.autoDailyCap ?? 0) || 0),
    autoWindow: typeof p.autoWindow === 'string' ? p.autoWindow.trim() : '',
    like: t.like === 'review' ? 'review' : 'self',
    fav: t.fav === 'review' ? 'review' : 'self',
    dmReply: t.dmReply === 'queue' ? 'queue' : 'direct',
    comment: t.comment === 'self' ? 'self' : 'review',
    danmaku: t.danmaku === 'self' ? 'self' : 'review',
  }
}

const HM = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null }

/** 'HH:MM-HH:MM'；空/非法 = 不限；支持跨午夜（23:00-07:00）。now 传 Date。 */
export function inWindow(now, spec) {
  const m = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(String(spec ?? '').trim())
  if (!spec || !m) return true
  const a = HM(m[1]); const b = HM(m[2])
  if (a === null || b === null) return true
  const cur = now.getHours() * 60 + now.getMinutes()
  return a <= b ? (cur >= a && cur < b) : (cur >= a || cur < b)
}

/** 每日 auto 上限：cap<=0 不限；sentToday 由调用方从因果链数出来。 */
export function capReached(sentToday, cap) {
  return Number(cap) > 0 && Number(sentToday) >= Number(cap)
}

/** 档位收回应走待审队列（like/fav 的 --go 分支用）。 */
export function tierQueues(mode) { return mode === 'review' }
