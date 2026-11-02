/**
 * 草稿文案层（M2 抽自 scripts/draft-dynamic.mjs）：纯函数，无 IO。
 * 唯一事实源——scripts/draft-dynamic.mjs 从这里 re-export（旧测试的 import 路径不变）。
 */
import fs from 'node:fs'
import crypto from 'node:crypto'
import { plainOutbound } from '../lib/plain-outbound.mjs'

/**
 * 括号对：截断点落在未闭合的开括号里时，退回到它之前。
 * 半角 `<>` 也算——日记里有人写 <Untitled>，全角规则救不了它。
 */
const OPEN_PAIRS = [['《', '》'], ['〈', '〉'], ['『', '』'], ['「', '」'], ['『', '』'], ['（', '）'], ['<', '>']]

/** 书名号里再套书名号：只留外层标记，内层是排版噪声。`《A《B》C》`→`《ABC》`，并列的《A》《B》不动。 */
export function flattenBookMarks(raw) {
  const out = []
  let depth = 0
  for (const ch of String(raw ?? '')) {
    if (ch === '《') { if (depth === 0) out.push(ch); depth += 1; continue }
    if (ch === '》') { if (depth > 0) depth -= 1; if (depth === 0) out.push(ch); continue }
    out.push(ch)
  }
  return out.join('')
}

/** markdown 粗体不进正文：成对的只留内容，落单的删掉（截断可能把一对切开，所以不留半个）。 */
export function stripBold(s) {
  return String(s ?? '')
    .replace(/\*\*\*([^*]+)\*\*\*/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*\*/g, '')
}

/** 退回到最后一个未闭合的开括号之前；反复退，直到没有未闭合的开括号（`（（（` 不会只退掉一个）。 */
function retreatUnclosed(s) {
  let out = String(s)
  for (let guard = 0; guard < 8; guard += 1) {
    let earliest = -1
    for (const [open, close] of OPEN_PAIRS) {
      for (let i = out.indexOf(open); i >= 0; i = out.indexOf(open, i + open.length)) {
        if (!out.slice(i + open.length).includes(close)) {
          if (earliest < 0 || i < earliest) earliest = i
          break
        }
      }
    }
    if (earliest < 0) break
    out = out.slice(0, earliest).trimEnd()
  }
  return out
}

function clip(s, max) {
  if (s.length <= max) return s
  let head = s.slice(0, max)
  // 截断点落在未闭合的括号里：退回到开括号之前，别把《…高效补》截成半句
  head = retreatUnclosed(head)
  const marks = '。！？…'
  let cut = -1
  for (let i = head.length - 1; i >= 0; i -= 1) if (marks.includes(head[i])) { cut = i; break }
  if (cut >= 0) return stripBold(head.slice(0, cut + 1))
  let out = head.trimEnd()
  while (out && '，、；：'.includes(out[out.length - 1])) out = out.slice(0, -1)
  const tail = stripBold(out)
  return tail ? tail.slice(0, Math.max(1, max - 1)) + '…' : ''
}

/** 把日记按 `## YYYY-MM-DD` 切天；只取当天那段，避免旧文案被重复拿来出稿。 */
export function dayBlocks(diaryText) {
  const blocks = []
  let cur = null
  for (const line of String(diaryText || '').split(/\r?\n/)) {
    const m = /^##\s+(\d{4}-\d{2}-\d{2})/.exec(line)
    if (m) { cur = { date: m[1], lines: [line] }; blocks.push(cur); continue }
    if (cur) cur.lines.push(line)
  }
  return blocks
}

/**
 * 标题截断：先剥 markdown、折平嵌套书名号，再在集数分隔符（Ⅰ｜|）与句读处收短；
 * 只有实在收不下时才按长度退，且退到未闭合括号之前。绝不产出 `《…高效补》` 这种半截书名。
 */
export function clipTitle(title, max = 24) {
  const s = stripBold(flattenBookMarks(String(title ?? '').trim()))
  if (!s || s.length <= max) return s
  let cut = retreatUnclosed(s.slice(0, Math.max(1, max - 1)).trimEnd())
  cut = cut.replace(/[、，,：:；;（(【\[《<〈「『]+$/, '').trimEnd()
  return cut ? stripBold(cut) + '…' : ''
}

const SERIES_SPLIT = /[Ⅰ|｜]/
const PAUSE_SPLIT = /[，,。；;：:、]/

/** 标题本体清洗：剥 `**`、整对书名号脱掉、嵌套或零散的书名号折平成纯文字。 */
function cleanTitleInner(raw) {
  let s = stripBold(flattenBookMarks(String(raw ?? '').trim()))
  if (/^《[^《》]*》$/.test(s)) s = s.slice(1, -1)
  else s = s.replace(/[《》]/g, '')
  return s.replace(/^<([^<>]*)>$/, '$1').trim()
}

/**
 * 标题取位（正文与记忆回扣共用）：`splitAlways` 时无条件先在集数分隔符（Ⅰ｜|）、再在句读处收短
 * （旧 snippetOf 的口径）；否则只在超长时才收。实在收不下才按长度退，且不留未闭合括号。
 */
export function shortTitle(raw, max = 24, { splitAlways = false } = {}) {
  let s = cleanTitleInner(raw)
  if (!s) return ''
  if (splitAlways || s.length > max) {
    const series = s.split(SERIES_SPLIT)[0].trim()
    if (series) s = series
  }
  if (splitAlways || s.length > max) {
    const pause = s.split(PAUSE_SPLIT)[0].trim()
    if (pause) s = pause
  }
  if (s.length > max) s = clipTitle(s, max)
  return s.replace(/^[…]+/, '')
}

/**
 * 正文里引用的《作品名》：要么成对完整，要么整条不提。
 * 这是「看过」表格与记忆回扣共用的唯一取位口——以前 buildText 自己拼《${title}》，
 * 截断发生在加书名号之前，于是出现《…高效补》。
 */
export function titleMark(raw, max = 24) {
  const inner = shortTitle(raw, max)
  if (!inner) return ''
  if (/[《》〈〉「」『』<>]/.test(inner)) return ''
  return `《${inner}》`
}

export function buildText(diaryText, { max = 100, date } = {}) {
  const blocks = dayBlocks(diaryText)
  // 有日期头 → 只认当天/最后一天；没有日期头（旧格式）→ 整篇当一段
  const today = date && blocks.length
    ? blocks.filter((b) => b.date === date).pop()
    : (blocks.length ? blocks[blocks.length - 1] : { lines: String(diaryText || '').split(/\r?\n/) })
  const sections = (today ? today.lines.join('\n') : '').split(/^## /m)
  // 同一天可能因旧 bug 出现重复小节；取最后一个（最新写入），别拿 09:12 的旧段出稿
  const find = (name) => sections.filter((s) => s.startsWith(name)).pop() || ''
  const rows = find('看过').split('\n').map((l) => l.trim()).filter(Boolean)
  // 真实日记表格首列是日期（旧格式也兼容）；优先取 date 当天那一行，其次取最后一行。
  const table = rows.filter((r) => r.startsWith('|')).map((r) => r.split('|').map((c) => c.trim()))
  const dataRows = table.filter((cells) => cells.some((c) => /^BV[0-9A-Za-z]+$/.test(c)))
  const picked = dataRows.find((cells) => cells[0] === date) || dataRows[dataRows.length - 1] || []
  let title = ''
  const i = picked.findIndex((c) => /^BV[0-9A-Za-z]+$/.test(c))
  if (i >= 0) title = picked[i + 1] || ''
  const titleText = titleMark(title, 24)

  // 「想说」可能有多个 bullet，后几条往往是真正的判断；全部保留，不再在第二条截断
  const lines = find('想说').split('\n')
  const bullets = []
  let cur = null
  for (const raw of lines) {
    const l = raw.trim()
    if (!l) continue
    if (l === '想说') continue
    if (/^-\s+/.test(l)) { if (cur) bullets.push(cur); cur = l.replace(/^-\s+/, ''); continue }
    if (cur) cur += ' ' + l
    else if (!l.startsWith('#')) cur = l
  }
  if (cur) bullets.push(cur)
  const said = bullets.join(' ').replace(/\s+/g, ' ').trim()
  const line = [titleText ? `今晚看的是${titleText}。` : '', said].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
  const body = clip(line || '今晚只听了会儿雨声，没看到特别想说的。', max)
  return body
}

export function makeDraft({ date, image, text, diaryHash, voice = null, voiceHash = null, degraded = false }) {
  const textHash = crypto.createHash('sha1').update(String(text)).digest('hex')
  const id = 'dyn-' + String(date).replace(/-/g, '') + '-' + crypto.createHash('sha1').update(String(text) + String(image)).digest('hex').slice(0, 6)
  return { id, date, image, text, textHash, diaryHash: diaryHash ?? null, voice, voiceHash, degraded, status: 'pending', createdAt: new Date().toISOString() }
}

// 与 voice.schema.json 的 required 列表锁定（tests/contract/voice.test.mjs 会比对）
const VOICE_SCHEMA = JSON.parse(fs.readFileSync(new URL('./voice.schema.json', import.meta.url), 'utf8'))
export const VOICE_REQUIRED = VOICE_SCHEMA.required

/** 只做结构校验；语义（冷战略称等）由 composeDraft 执行。 */
export function assertVoice(v) {
  if (!v || typeof v !== 'object') return 'voice-missing'
  for (const k of VOICE_REQUIRED) if (!(k in v)) return 'voice-missing-' + k
  if (v.v !== 1) return 'voice-version'
  const m = v.mood
  if (!m || typeof m.label !== 'string' || !m.label || typeof m.intensity !== 'number' || m.intensity < 0 || m.intensity > 1) return 'voice-mood'
  if (!Array.isArray(v.memories) || !Array.isArray(v.banned)) return 'voice-arrays'
  if (!v.stance || typeof v.stance.share !== 'boolean') return 'voice-stance'
  return null
}

// 15 情绪标签（emotion-projection）：负向压一句，其余正常展开
const LOW_TONE = new Set(['悲伤', '焦虑', '孤独', '挫败', '忧郁'])
const HIGH_TONE = new Set(['快乐', '宁静', '兴奋', '温暖', '灵感', '苦乐参半', '怀旧', '躁动不安', '渴望', '纠结'])
// 同属"高语气"的标签也必须能区分，否则反事实会得到 0 差异（真实数据已实测到）
const MOOD_TAIL = {
  快乐: '今天挺好的。',
  宁静: '',
  兴奋: '有点坐不住，想做点什么。',
  温暖: '有人惦记的感觉，挺好的。',
  灵感: '脑子里冒出个小点子。',
  苦乐参半: '有些事说不上好，也说不上坏。',
  怀旧: '翻到以前的记录，看了一会儿。',
  躁动不安: '心里有点静不下来。',
  渴望: '要是现在有人说句话就好了。',
  纠结: '想了半天，也没想明白。',
}

/** 记忆里的可引用片段：看过的取片名（走与正文同一个 shortTitle 口径），主人说过的取原话开头。 */
export function snippetOf(text, from = 'npc') {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  const t = s.match(/《([^》]+)》/)
  if (from === 'npc' && t) return shortTitle(t[1], 30, { splitAlways: true })
  // 认不出成对书名号（半截《、原话引用）时走同一条清洗：星号与散落的《》都不许进正文
  return shortTitle(s, 16)
}

// ---- voiceBrief 新增的可选状态通道：缺字段 = 退回旧行为，绝不因此拒稿 ----

const PACES = new Set(['tired', 'calm', 'wired'])
const PACE_TAIL = { tired: '今天先这样。', wired: '还想接着说两句。' }
const TODAY_MAX = 40

/** 「今天做了什么」：voice.today 比日记更像事实，有就顶到开头当第一句。 */
function todayLead(voice) {
  if (!Array.isArray(voice.today)) return ''
  const first = voice.today.find((x) => typeof x === 'string' && x.trim())
  if (!first) return ''
  let s = first.replace(/\s+/g, ' ').trim().replace(/[。！？.!?]+$/, '')
  if (!s) return ''
  if (s.length > TODAY_MAX) {
    const head = s.slice(0, TODAY_MAX)
    const cut = head.lastIndexOf('，')
    s = (cut > 8 ? head.slice(0, cut) : head).replace(/[，、；：,;:]$/, '')
  }
  return `今天${s}`
}

/** 凌晨/深夜的时间感：钟点真的在两头才写，白天硬塞就假了。 */
function hourLead(voice) {
  if (typeof voice.hour !== 'number' || !Number.isInteger(voice.hour)) return ''
  const h = voice.hour
  if (h < 0 || h > 23) return ''
  if (h <= 4) return '这个点还醒着。'
  if (h === 23) return '快到零点了。'
  return ''
}

/** 场值只补一句、不叠加：写成她的口气，不写成状态播报。缺 state 或都不越线 → 空。 */
function stateFlavor(voice) {
  const st = voice.state
  if (!st || typeof st !== 'object') return ''
  const num = (k) => {
    const n = Number(st[k])
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null
  }
  const energy = num('energy')
  const social = num('social')
  const curiosity = num('curiosity')
  const creativity = num('creativity')
  const stimulation = num('stimulation')
  if (energy !== null && energy <= 0.25) return '话说得有点费力。'
  if (creativity !== null && creativity >= 0.7) return '脑子里有个还没试过的念头。'
  if (social !== null && social >= 0.7 && voice.relation !== 'cold_war') return '今天想多跟你说两句。'
  if (social !== null && social <= 0.25) return '想说，又不知道跟谁说。'
  if (curiosity !== null && curiosity >= 0.7) return '还想去翻点什么。'
  if (stimulation !== null && stimulation <= 0.2 && curiosity !== null && curiosity <= 0.2) return '没什么新东西，就想安静会儿。'
  return ''
}

const FIRST_SENTENCE = /^[^。！？!?]*[。！？!?]?/

/** 句群：按句末标点切开（保留标点），丢空段。 */
function sentences(text) {
  return String(text).split(/(?<=[。！？!?])/).map((s) => s.trim()).filter(Boolean)
}

/**
 * 把 voiceBrief 落成正文。缺 voice 直接拒稿；不再静默退化成"没有情绪"的模板。
 * 节律 pace / 今天 today / 钟点 hour / 场值 state / 记忆槽 slot 都进正文；任一缺字段该项退回旧行为。
 * 返回 { ok, text, voiceHash } 或 { ok:false, error }。
 */
export function composeDraft(diaryText, { date, voice, max = 100 } = {}) {
  const bad = assertVoice(voice)
  if (bad) return { ok: false, error: bad }
  if (!voice.stance.share) return { ok: false, error: 'stance-skip', because: voice.stance.because }
  // A1：情绪标签必须有明确措辞；新增标签忘了接线就报错，而不是悄悄当"宁静"处理
  if (!LOW_TONE.has(voice.mood.label) && !HIGH_TONE.has(voice.mood.label)) {
    return { ok: false, error: 'unmapped-mood', label: voice.mood.label }
  }
  const pace = PACES.has(voice.pace) ? voice.pace : null

  let text = buildText(diaryText, { date, max })
  const lead = [hourLead(voice), todayLead(voice)]
    .filter(Boolean)
    .map((s) => (/[。！？]$/.test(s) ? s : `${s}。`))
    .join('')
  if (lead) text = `${lead}${text}`

  if (LOW_TONE.has(voice.mood.label)) {
    // 低落时只留第一句，且不出现感叹号
    text = (text.match(FIRST_SENTENCE) || [text])[0].replace(/[！!]/g, '。').trim()
  } else {
    // M4 决策钩子：草稿回扣一条真正相关的记忆，并说清出处（谁说的、多少天前）
    const core = (voice.memories || []).find((x) => x && x.slot !== 'surprise' && x.score > 0.5)
    const coreSnippet = core ? snippetOf(core.text, core.from) : ''
    if (core && coreSnippet && voice.relation !== 'cold_war' && !text.includes(coreSnippet)) {
      const when = core.days === 0 ? '今天' : core.days === 1 ? '昨天' : `${core.days} 天前`
      const line = core.from === 'player'
        ? `你${when}说的「${coreSnippet}」我还记着。`
        : `我${when}记下的《${coreSnippet}》还在。`
      text = `${text} ${line}`
    } else {
      // 意外槽：没有可回扣的近期记忆时，"忽然想起"进正文。
      // 意外只带出语感、不复述原话——它的价值是"冒出来"这件事，不是把旧文本再抄一遍。
      const surprise = (voice.memories || []).find((x) => x && x.slot === 'surprise' && x.score > 0.5)
      if (surprise) {
        const snippet = snippetOf(surprise.text, surprise.from)
        const quotable = /《[^》]+》/.test(String(surprise.text ?? ''))
        text += snippet
          ? (quotable ? ` 忽然想起《${snippet}》，说不上为什么。` : ' 忽然想起有件旧事，说不上为什么。')
          : ' 忽然想起有件旧事，说不上为什么。'
      }
    }
    const flavor = stateFlavor(voice)
    if (flavor && !text.includes(flavor)) text = `${text} ${flavor}`
  }

  if (pace === 'tired' && !LOW_TONE.has(voice.mood.label)) {
    // 低落已经把正文压成一句了，再加收尾会变成两句
    text = `${(sentences(text)[0] || text).trim()} ${PACE_TAIL.tired}`
  } else if (pace === 'wired') {
    // 更跳、信息更密：句子之间的停顿收掉，末尾还想接一句
    text = `${sentences(text).map((s) => s.replace(/[。！？!?]$/, '')).join('，')}。 ${PACE_TAIL.wired}`
  }

  for (const w of voice.banned) if (w) text = text.split(w).join('他')

  const tail = MOOD_TAIL[voice.mood.label] ?? ''
  // 收尾句本身就是 tired 的语气，再叠一句情绪标签会读成两句套话
  if (tail && pace !== 'tired' && !text.includes(tail)) text = `${text} ${tail}`

  // 出站最后一道清洗（2026-11-02）：正文里渲染不出来的 Markdown 标记必须在这里掉干净。
  // 放在**成稿**这一步、而不是发布器里，是为了守住「审的就是发的」：草稿文件、一次性令牌的
  // textHash、真正 POST 出去的字符串三者必须是同一个串。
  const final = clip(plainOutbound(text).replace(/[ \t]+/g, ' ').trim(), max)
  return { ok: true, text: final, voiceHash: crypto.createHash('sha1').update(JSON.stringify(voice)).digest('hex') }
}

/** 和别的日期已有草稿一字不差 → 说明拿旧日记复用了，拒稿。返回撞上的那条。 */
export function findDuplicateText(drafts, { date, text }) {
  return (drafts || []).find((d) => d && d.date !== date && d.text === text) || null
}
