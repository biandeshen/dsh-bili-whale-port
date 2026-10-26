/**
 * 每日配图选图器：从目录里按"未用过优先、文件名升序"选一张 daily-*.png。
 * 用法：node tools/lib/pick-image.mjs [--dir D:/AI/养鱼/assets/daily]
 * 输出 JSON：{ ok, file, remaining }；用过的记在同目录 used-images.json。
 * 只认 daily-*.png，contact-sheet 等其它图忽略。
 */
import fs from 'node:fs'
import path from 'node:path'

export function pickDailyImage(dir, { mark = true } = {}) {
  let files = []
  try { files = fs.readdirSync(dir).filter((f) => /^daily-.*\.png$/i.test(f)).sort() } catch { return { ok: false, error: '目录不存在：' + dir } }
  if (!files.length) return { ok: false, error: '没有 daily-*.png' }
  const usedFile = path.join(dir, 'used-images.json')
  let used = []
  try { used = JSON.parse(fs.readFileSync(usedFile, 'utf8')).used ?? [] } catch {}
  const file = files.find((f) => !used.includes(f))
  if (!file) return { ok: false, error: '图片用完了，请补充 daily-*.png', used: used.length, total: files.length }
  if (mark) {
    used.push(file)
    fs.writeFileSync(usedFile, JSON.stringify({ used, updatedAt: new Date().toISOString() }, null, 2) + '\n')
  }
  return { ok: true, file: path.join(dir, file), name: file, remaining: files.length - used.length }
}

if (process.argv[1] && process.argv[1].endsWith('pick-image.mjs')) {
  const i = process.argv.indexOf('--dir')
  const dir = i >= 0 ? process.argv[i + 1] : (process.env.WHALE_IMAGE_DIR || 'D:/AI/养鱼/assets/daily')
  console.log(JSON.stringify(pickDailyImage(dir), null, 2))
}
