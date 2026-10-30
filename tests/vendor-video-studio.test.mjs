// vendor 完整性：文件哈希必须与 SHA256SUMS 一致（升级时整目录替换并更新清单）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'vendor', 'dsh-video-studio')
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')

test('vendor/dsh-video-studio 与 SHA256SUMS 一致', () => {
  const lines = fs.readFileSync(path.join(DIR, 'SHA256SUMS'), 'utf8').trim().split('\n').filter(Boolean)
  const files = lines.map((l) => l.trim().split(/\s+\*?/)).filter(([, f]) => f && f !== 'dsh-video-studio-0.4.3.tgz')
  assert.ok(files.length >= 7, '清单条目过少')
  for (const [want, f] of files) {
    const abs = path.join(DIR, f)
    assert.ok(fs.existsSync(abs), '缺文件 ' + f)
    assert.equal(sha256(abs), want, '哈希不一致 ' + f)
  }
})

test('vendor 核心不依赖 DSH 宿主', () => {
  for (const f of ['render.js', 'media.js', 'cover.js', 'ffmpeg.js', 'fonts.js', 'subtitles.js']) {
    const src = fs.readFileSync(path.join(DIR, f), 'utf8')
    assert.doesNotMatch(src, /from ['"](?:@?dsh|cordis|electron)/, f + ' 引入了宿主依赖')
  }
})
