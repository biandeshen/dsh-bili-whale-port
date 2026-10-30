/**
 * feed 反馈回流（B4，2026-10-30 她的 OPS：「偏好词表没有回流通道」）。
 *
 * 纯函数、带测试；feed.mjs 只负责取数（三路信号）并把结果交进来：
 *   ① likedEvents —— 被赞（feedback.json，kind=like）
 *   ② favItems    —— 真收下的收藏（favorites.json）
 *   ③ sentDrafts  —— 主人放行且已发送的动态草稿（drafts/*.json status=sent）**新补的第三路**
 * 抽词规则沿用原 feed.mjs 实现（拉丁词 ≥2 字 + 中文 3-4 字 n-gram − 停用词）：
 * 主题词方案比标题相似度稳（"几乎改一个字"的标题 Jaccard 只有 0.036）。
 *
 * 注意：只学「已发出的」；pending/dry-run/rejected 不算她的品味。
 */
const STOP_WORDS = new Set(['我为', '添加', '开屏', '广告', '这个', '那个', '什么', '自己', '可以', '就是', '一个'])

export function learnTokens(text, { ownerName = '' } = {}) {
  const out = new Set()
  // ⚠️ ownerName 为空时 new RegExp('') 会在每个字之间插空格 → 必须先判断 ✗（原实现实测踩过）
  const base = ownerName ? String(text).replace(new RegExp(ownerName, 'g'), ' ') : String(text)
  const t = base.replace(/@\S+/g, ' ')
  for (const m of t.matchAll(/[A-Za-z][A-Za-z0-9]{1,}/g)) if (m[0].length >= 2) out.add(m[0].toLowerCase())
  for (const m of t.matchAll(/[一-龥]{2,}/g)) {
    const run = m[0]
    for (const n of [3, 4]) for (let i = 0; i + n <= run.length; i += 1) {
      const g = run.slice(i, i + n)
      if (!STOP_WORDS.has(g)) out.add(g)
    }
  }
  return [...out]
}

/** 三路信号 → 去重主题词。sentDrafts 只认 status==='sent'（pending/dry-run/rejected 不算品味）。 */
export function collectLearnedTokens({ likedEvents = [], favItems = [], sentDrafts = [], ownerName = '' } = {}) {
  const texts = [
    ...likedEvents.map((e) => `${e.videoTitle ?? ''} ${e.comment ?? ''}`),
    ...favItems.map((x) => `${x.title ?? ''} ${x.reason ?? ''}`),
    ...sentDrafts.filter((d) => d?.status === 'sent').map((d) => String(d.text ?? '')),
  ]
  return [...new Set(texts.filter((s) => s.trim()).flatMap((s) => learnTokens(s, { ownerName })))]
}
