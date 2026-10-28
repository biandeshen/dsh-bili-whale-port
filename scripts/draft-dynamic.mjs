/**
 * 生成每日动态草稿（不发送）。
 *   node scripts/draft-dynamic.mjs [--date YYYY-MM-DD] [--force]
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pickDailyImage } from '../tools/lib/pick-image.mjs'
import { DSH_HOME as WHALE_HOME } from '../tools/lib/paths.mjs'
import { enqueue } from './ack.mjs'
import { logicalDay } from './day-snapshot.mjs'

const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d }
const FORCE = argv.includes('--force')
// 与快照共用 04:00 日界：凌晨写的日记/出的稿算前一天，否则 day-report 找不到当天草稿
const date = arg('date', logicalDay())
const DIARY = path.join(WHALE_HOME, 'whale-diary.md')
const DRAFTS = arg('drafts', process.env.WHALE_DRAFTS || 'D:/AI/养鱼/drafts')
const IMAGES = arg('images', process.env.WHALE_IMAGES || 'D:/AI/养鱼/assets/daily')

function clip(s, max) {
  if (s.length <= max) return s
  const head = s.slice(0, max)
  const marks = '。！？…'
  let cut = -1
  for (let i = head.length - 1; i >= 0; i -= 1) if (marks.includes(head[i])) { cut = i; break }
  if (cut >= 0) return head.slice(0, cut + 1)
  let out = head.trimEnd()
  while (out && '，、；：'.includes(out[out.length - 1])) out = out.slice(0, -1)
  return out + '…'
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

export function buildText(diaryText, { max = 100, date } = {}) {
  const blocks = dayBlocks(diaryText)
  // 有日期头 → 只认当天/最后一天；没有日期头（旧格式）→ 整篇当一段
  const today = date && blocks.length
    ? blocks.filter((b) => b.date === date).pop()
    : (blocks.length ? blocks[blocks.length - 1] : { lines: String(diaryText || '').split(/\r?\n/) })
  const sections = (today ? today.lines.join('\n') : '').split(/^## /m)
  const find = (name) => sections.find((s) => s.startsWith(name)) || ''
  const rows = find('看过').split('\n').map((l) => l.trim()).filter(Boolean)
  // 真实日记首列是 BV（不是日期），旧格式首列是日期；一律按单元格找 BV 列，下一格就是标题。
  // 不按长度卡：测试与旧数据里可能存在 BVnew 这类短 ID。
  let title = ''
  for (const row of rows) {
    if (!row.startsWith('|')) continue
    const cells = row.split('|').map((c) => c.trim())
    const i = cells.findIndex((c) => /^BV[0-9A-Za-z]+$/.test(c))
    if (i >= 0) { title = cells[i + 1] || ''; break }
  }
  if (title.length > 24) title = title.slice(0, 24).trimEnd() + '…'

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
  const line = [title ? `今晚看的是《${title}》。` : '', said].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
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

/**
 * 把 voiceBrief 落成正文。缺 voice 直接拒稿；不再静默退化成"没有情绪"的模板。
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

  let text = buildText(diaryText, { date, max })

  if (LOW_TONE.has(voice.mood.label)) {
    // 低落时只留第一句，且不出现感叹号
    text = (text.match(/^[^。！？!?]*[。！？!?]?/) || [text])[0].replace(/[！!]/g, '。').trim()
  } else if (voice.memories.length && voice.memories[0].score > 0.5 && voice.relation !== 'cold_war') {
    const m = voice.memories[0]
    const snippet = String(m.text).replace(/^看过《/, '').split('》')[0].slice(0, 16)
    if (snippet && !text.includes(snippet)) text = `${text} 前两天记下的《${snippet}》还在。`
  }

  for (const w of voice.banned) if (w) text = text.split(w).join('他')

  const tail = MOOD_TAIL[voice.mood.label] ?? ''
  if (tail && !text.includes(tail)) text = `${text} ${tail}`

  return { ok: true, text, voiceHash: crypto.createHash('sha1').update(JSON.stringify(voice)).digest('hex') }
}

/** 和别的日期已有草稿一字不差 → 说明拿旧日记复用了，拒稿。返回撞上的那条。 */
export function findDuplicateText(drafts, { date, text }) {
  return (drafts || []).find((d) => d && d.date !== date && d.text === text) || null
}

if (process.argv[1] && process.argv[1].endsWith('draft-dynamic.mjs')) {
  fs.mkdirSync(DRAFTS, { recursive: true })
  const outJson = path.join(DRAFTS, date + '.json')
  if (fs.existsSync(outJson) && !FORCE) {
    const cur = JSON.parse(fs.readFileSync(outJson, 'utf8'))
    console.log(JSON.stringify({ ok: false, error: '当天草稿已存在', status: cur.status, file: outJson }, null, 2))
    process.exit(0)
  }
  let diaryText
  try {
    diaryText = fs.readFileSync(DIARY, 'utf8')
  } catch (e) {
    // 读不到日记必须显式失败：以前 catch{} 会退化成兜底句且 ok:true，等于假数据
    console.log(JSON.stringify({ ok: false, error: 'diary-missing', file: DIARY, detail: String(e?.code ?? e?.message ?? e) }, null, 2))
    process.exit(1)
  }
  if (!String(diaryText).trim()) {
    console.log(JSON.stringify({ ok: false, error: 'diary-empty', file: DIARY }, null, 2))
    process.exit(1)
  }
  const diaryHash = crypto.createHash('sha1').update(diaryText).digest('hex')
  const voicePath = arg('voice', '')
  const noVoice = argv.includes('--no-voice')
  if (!voicePath && !noVoice) {
    // 缺 voice 就拒稿：否则人格状态对产物没有影响，所有"活过来"的验收都是假的
    console.log(JSON.stringify({ ok: false, error: 'missing-voice', hint: '传 --voice <file>；仅在手工调试时用 --no-voice 显式降级' }, null, 2))
    process.exit(2)
  }
  let voice = null
  if (voicePath) {
    try { voice = JSON.parse(fs.readFileSync(voicePath, 'utf8')) } catch (e) {
      console.log(JSON.stringify({ ok: false, error: 'voice-file-missing', file: voicePath, detail: String(e?.code ?? e?.message ?? e) }, null, 2))
      process.exit(2)
    }
  }
  const composed = noVoice
    ? { ok: true, text: buildText(diaryText, { date }), voiceHash: null }
    : composeDraft(diaryText, { date, voice })
  if (!composed.ok) {
    const skip = composed.error === 'stance-skip'
    console.log(JSON.stringify(composed, null, 2))
    process.exit(skip ? 0 : 2)
  }
  const text = composed.text

  const img = pickDailyImage(IMAGES, { mark: false })
  if (!img.ok) { console.log(JSON.stringify({ ok: false, error: img.error }, null, 2)); process.exit(1) }
  const existing = fs.readdirSync(DRAFTS).filter((f) => f.endsWith('.json')).map((f) => {
    try { return JSON.parse(fs.readFileSync(path.join(DRAFTS, f), 'utf8')) } catch { return null }
  }).filter(Boolean)
  const dup = findDuplicateText(existing, { date, text })
  if (dup && !FORCE) {
    console.log(JSON.stringify({ ok: false, error: '这条文案和 ' + dup.date + ' 的草稿一字不差——别拿旧日记复用，重写今天的「想说」再出稿', duplicateOf: dup.id }, null, 2))
    process.exit(0)
  }
  const draft = makeDraft({ date, image: img.file, text, diaryHash, voice, voiceHash: composed.voiceHash, degraded: noVoice })
  try { draft.ackId = enqueue(WHALE_HOME, { draftId: draft.id, date }).id } catch {}
  fs.writeFileSync(outJson, JSON.stringify(draft, null, 2) + '\n', 'utf8')
  fs.writeFileSync(path.join(DRAFTS, date + '.md'), `# 小鱼动态草稿 ${date}\n\n- id: ${draft.id}\n- 图片: ${draft.image}\n- 状态: pending\n- diaryHash: ${draft.diaryHash}\n- textHash: ${draft.textHash}\n- voiceHash: ${draft.voiceHash}\n- degraded: ${draft.degraded}\n\n---\n\n${draft.text}\n`, 'utf8')
  console.log(JSON.stringify({ ok: true, ...draft }, null, 2))
}
