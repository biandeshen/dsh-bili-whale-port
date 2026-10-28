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

export function makeDraft({ date, image, text, diaryHash }) {
  const textHash = crypto.createHash('sha1').update(String(text)).digest('hex')
  const id = 'dyn-' + String(date).replace(/-/g, '') + '-' + crypto.createHash('sha1').update(String(text) + String(image)).digest('hex').slice(0, 6)
  return { id, date, image, text, textHash, diaryHash: diaryHash ?? null, status: 'pending', createdAt: new Date().toISOString() }
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
  const img = pickDailyImage(IMAGES, { mark: false })
  if (!img.ok) { console.log(JSON.stringify({ ok: false, error: img.error }, null, 2)); process.exit(1) }
  const text = buildText(diaryText, { date })
  const existing = fs.readdirSync(DRAFTS).filter((f) => f.endsWith('.json')).map((f) => {
    try { return JSON.parse(fs.readFileSync(path.join(DRAFTS, f), 'utf8')) } catch { return null }
  }).filter(Boolean)
  const dup = findDuplicateText(existing, { date, text })
  if (dup && !FORCE) {
    console.log(JSON.stringify({ ok: false, error: '这条文案和 ' + dup.date + ' 的草稿一字不差——别拿旧日记复用，重写今天的「想说」再出稿', duplicateOf: dup.id }, null, 2))
    process.exit(0)
  }
  const draft = makeDraft({ date, image: img.file, text, diaryHash })
  try { draft.ackId = enqueue(WHALE_HOME, { draftId: draft.id, date }).id } catch {}
  fs.writeFileSync(outJson, JSON.stringify(draft, null, 2) + '\n', 'utf8')
  fs.writeFileSync(path.join(DRAFTS, date + '.md'), `# 小鱼动态草稿 ${date}\n\n- id: ${draft.id}\n- 图片: ${draft.image}\n- 状态: pending\n- diaryHash: ${draft.diaryHash}\n- textHash: ${draft.textHash}\n\n---\n\n${draft.text}\n`, 'utf8')
  console.log(JSON.stringify({ ok: true, ...draft }, null, 2))
}
