// 选图器契约：未用优先、用过不重复、用完报错、忽略 contact-sheet
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pickDailyImage } from '../../tools/lib/pick-image.mjs'

test('pickDailyImage：按文件名顺序、不重复、用完报错', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pick-img-'))
  fs.writeFileSync(path.join(dir, 'daily-02-b.png'), 'x')
  fs.writeFileSync(path.join(dir, 'daily-01-a.png'), 'y')
  fs.writeFileSync(path.join(dir, 'contact-sheet.png'), 'z')
  const a = pickDailyImage(dir)
  assert.equal(a.ok, true); assert.equal(a.name, 'daily-01-a.png')
  const b = pickDailyImage(dir)
  assert.equal(b.name, 'daily-02-b.png'); assert.equal(b.remaining, 0)
  const c = pickDailyImage(dir)
  assert.equal(c.ok, false); assert.match(c.error, /用完/)
})
