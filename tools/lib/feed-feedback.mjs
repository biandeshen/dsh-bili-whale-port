/**
 * feed 反馈回流（B4，2026-10-30 她的 OPS：「偏好词表没有回流通道」）。
 *
 * 纯函数、带测试；feed.mjs 只负责取数（三路信号）并把结果交进来：
 *   ① likedEvents —— 被赞（feedback.json，kind=like）
 *   ② favItems    —— 真收下的收藏（favorites.json）
 *   ③ sentDrafts  —— 主人放行且已发送的动态草稿（只取《书名号》片段）
 *
 * 2026-10-31 六席复核后重做抽词规则：原先把正文按 3/4-gram 滑窗切碎，两句稿子产出 230 个
 * `今天最/最想说/想说的` 这类散文碎片（实测 28 个真实片名里 25% 无差别撞上 → 加分=噪声，
 * 她报的「词表未生效」在效果上属实）。现在：
 *   · 只从**结构化来源**学（标题、收藏理由、稿子里的书名号片段），不从散文整句学；
 *   · 中文按标点切**词组**（2–6 字），不再滑窗；虚词句与停用词丢弃。
 * 注意：只学「已发出的」；pending/dry-run/rejected 不算她的品味。
 */
const STOP_WORDS = new Set([
  '这个', '那个', '什么', '自己', '可以', '就是', '一个', '一天', '今天', '昨天', '现在', '其实',
  '不是', '没有', '一下', '一点', '这么', '那么', '还是', '因为', '所以', '但是', '如果', '这样', '那样',
])
const TAIL_RE = /[的吗呢吧啊呀嘛了哦哈]$/

const LATIN_RE = /[A-Za-z][A-Za-z0-9]{1,}/g
const ZH_RUN_RE = /[一-龥]{2,6}/g
const BOOK_RE = /《([^》]{2,24})》/g

/** 从一段文本抽主题词。titlesOnly=true 时只认《…》里的片段（稿子正文用这个）。 */
export function learnTokens(text, { ownerName = '', titlesOnly = false } = {}) {
  const out = new Set()
  // ⚠️ ownerName 为空时 new RegExp('') 会在每个字之间插空格 → 必须先判断 ✗（原实现实测踩过）
  const base = ownerName ? String(text).replace(new RegExp(ownerName, 'g'), ' ') : String(text)
  const body = base.replace(/@\S+/g, ' ')
  const src = titlesOnly ? [...body.matchAll(BOOK_RE)].map((m) => m[1]).join(' ') : body
  for (const m of src.matchAll(LATIN_RE)) if (m[0].length >= 2) out.add(m[0].toLowerCase())
  for (const m of src.matchAll(ZH_RUN_RE)) {
    const w = m[0]
    if (STOP_WORDS.has(w) || TAIL_RE.test(w)) continue
    out.add(w)
  }
  return [...out]
}

/** 三路信号 → 去重主题词。sentDrafts 只认 status==='sent'，且只取《书名号》片段。 */
export function collectLearnedTokens({ likedEvents = [], favItems = [], sentDrafts = [], ownerName = '' } = {}) {
  const texts = [
    ...likedEvents.map((e) => `${e.videoTitle ?? ''} ${e.comment ?? ''}`),
    ...favItems.map((x) => `${x.title ?? ''} ${x.reason ?? ''}`),
    ...sentDrafts.filter((d) => d?.status === 'sent').map((d) => String(d.text ?? '')),
  ]
  const draftCount = sentDrafts.filter((d) => d?.status === 'sent').length
  const start = texts.length - draftCount
  return [...new Set(texts.map((s, i) => (i >= start ? learnTokens(s, { ownerName, titlesOnly: true }) : learnTokens(s, { ownerName })))
    .filter((arr) => arr.length).flat())]
}
