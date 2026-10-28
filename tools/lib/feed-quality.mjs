/**
 * feed 候选的准入判断（纯函数，可单测）。
 *
 * 2026-10-22 主人问「feed 是不是筛得太严」后加的质量下限：播放<300 且 弹幕<3 视为
 * 「几乎没人验过」。当时额外留了一个「命中 ≥2 个偏好词就免检」的口子，本意是
 * 小众多标签片，实测被绕过：播放 1、弹幕 0 的当日新片命中「白噪音」+「助眠」就进来了
 * （D-31，她 2026-10-28 日记：「播放是1」「我看的不是视频，是标题」）。
 *
 * 现在口子收回：下限对搜索/热门/排行一视同仁。**没有新增任何数值**——
 * 300/3 是 10-22 已有的规则；这不是播放量加权（播放量不参与排序）。
 * 关注流例外：她订阅的人发的新片播放再低也是"她认识的人"，不属于平台碎屑。
 */
export const JUNK_PLAY = 300
export const JUNK_DM = 3

export function looksLikeJunk(x) {
  return Number(x?.play ?? 0) < JUNK_PLAY && Number(x?.dm ?? 0) < JUNK_DM
}

/**
 * @returns {{ keep: boolean, why: 'following'|'ok'|'unverified' }}
 */
export function keepCandidate(x) {
  if (String(x?.kw ?? '') === '关注') return { keep: true, why: 'following' }
  if (!looksLikeJunk(x)) return { keep: true, why: 'ok' }
  return { keep: false, why: 'unverified' }
}

/** 给审计用的候选快照行：只留判断需要的字段，不写 cookie/凭据。 */
export function snapshotRow(x, decision, rank = null) {
  return {
    bv: String(x?.bv ?? ''),
    title: String(x?.t ?? '').slice(0, 80),
    up: String(x?.up ?? '').slice(0, 40),
    kw: String(x?.kw ?? ''),
    play: Number(x?.play ?? 0),
    dm: Number(x?.dm ?? 0),
    seconds: Number(x?.d ?? 0),
    hits: Array.isArray(x?._hits) ? x._hits.slice(0, 4) : [],
    score: Number(x?._score ?? 0),
    keep: Boolean(decision?.keep),
    why: String(decision?.why ?? ''),
    rank,
  }
}
