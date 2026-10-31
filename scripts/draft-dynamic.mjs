/**
 * 生成每日动态草稿（不发送）。
 *   node scripts/draft-dynamic.mjs [--date YYYY-MM-DD] [--force] [--voice <file> | --no-voice]
 * M2：文案逻辑在 tools/drafts/compose.mjs、落盘在 tools/drafts/store.mjs；本文件只剩参数与流程。
 * 文案函数仍从这里 re-export——旧测试/调用方的 import 路径不变。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { pickDailyImage } from '../tools/lib/pick-image.mjs'
import { DSH_HOME as WHALE_HOME, draftsDir, imagesDir } from '../tools/lib/paths.mjs'
import { enqueue } from './ack.mjs'
import { logicalDay } from './day-snapshot.mjs'
import { readAllDrafts, writeNewDraft } from '../tools/drafts/store.mjs'

export { dayBlocks, clipTitle, buildText, makeDraft, VOICE_REQUIRED, assertVoice, snippetOf, composeDraft, findDuplicateText } from '../tools/drafts/compose.mjs'
import { buildText, makeDraft, composeDraft, findDuplicateText } from '../tools/drafts/compose.mjs'

const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d }
const FORCE = argv.includes('--force')
// 与快照共用日界：凌晨写的日记/出的稿算前一天，否则 day-report 找不到当天草稿
const date = arg('date', logicalDay())
const DIARY = path.join(WHALE_HOME, 'whale-diary.md')
// M1a 收口：目录解析只走 paths.draftsDir/imagesDir（env → 旧路径 → whale home），不再散写硬编码
const DRAFTS = arg('drafts', draftsDir())
const IMAGES = arg('images', imagesDir())

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
  const dup = findDuplicateText(readAllDrafts(DRAFTS), { date, text })
  if (dup && !FORCE) {
    console.log(JSON.stringify({ ok: false, error: '这条文案和 ' + dup.date + ' 的草稿一字不差——别拿旧日记复用，重写今天的「想说」再出稿', duplicateOf: dup.id }, null, 2))
    process.exit(0)
  }
  const draft = makeDraft({ date, image: img.file, text, diaryHash, voice, voiceHash: composed.voiceHash, degraded: noVoice })
  // M1e：令牌绑定 draftId + 正文哈希 —— 审完再改稿，approve 会拒
  try { draft.ackId = enqueue(WHALE_HOME, { draftId: draft.id, date, textHash: draft.textHash }).id } catch {}
  writeNewDraft(DRAFTS, draft)
  console.log(JSON.stringify({ ok: true, ...draft }, null, 2))
}
