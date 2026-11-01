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
    seen: Boolean(x?._seen),
    rank,
  }
}

/**
 * 宽容数字解析（B3，2026-10-30 她的 OPS：关注源 play 曾落成 NaN、快照显示 null）：
 *   '1.2万'→12000、'10亿'→1000000000、'344'/'3445'→344、344→344；
 *   null/''/'-'/非数字串 → 0（0 会被质量下限当“未验证”，fail-closed 而不是 NaN 放行）。
 */
export function numOf(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const s = String(v ?? '').replace(/[,\s]/g, '')
  if (!s) return 0
  const m = /^(\d+(?:\.\d+)?)(万|亿|[wW])?$/.exec(s)
  if (!m) return 0
  const n = Number(m[1])
  if (!Number.isFinite(n)) return 0
  const unit = m[2]
  if (!unit) return n
  if (unit === '亿') return n * 1e8
  if (unit === '万' || unit === 'w' || unit === 'W') return n * 1e4
  return n
}

/**
 * 否定词命中（dislike）：任一 dislike 词——按与偏好同样的切分（去连接符、≥2 字）——
 * 出现在标题里即拦下，返回命中的那个词（null = 放行）。
 * 2026-10-31 修：dislike 之前只在 feed.mjs 读进变量、从未参与筛选（她报「词表未生效」的字面根因）。
 */
export function dislikeHit(title, words) {
  const t = String(title ?? '').toLowerCase()
  for (const w of words ?? []) {
    for (const tok of String(w).split(/[\s·,，、/]+|与|和|及|向|的|类/).map((s) => s.trim()).filter((s) => s.length >= 2)) {
      if (t.includes(tok.toLowerCase())) return tok
    }
  }
  return null
}
