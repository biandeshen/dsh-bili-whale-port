// M1c：BGM 选择器——catalog 顺序为准、auto 取第一首、名字/路径/none/找不到各分支
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listBgm, resolveBgm } from '../tools/media/bgm.mjs'

function bgmDir({ catalog = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bgm-'))
  for (const f of ['zzz-first-alphabetically.mp3', 'mm-track.mp3', 'readme.txt']) {
    fs.writeFileSync(path.join(dir, f), 'x')
  }
  if (catalog) {
    fs.writeFileSync(path.join(dir, 'catalog.json'), JSON.stringify({
      tracks: [{ file: 'mm-track.mp3' }, { file: 'zzz-first-alphabetically.mp3' }],
    }))
  }
  return dir
}

test('catalog 顺序压过文件名排序；缺 catalog 回退文件名排序', () => {
  assert.deepEqual(listBgm(bgmDir()), ['mm-track.mp3', 'zzz-first-alphabetically.mp3'])
  assert.deepEqual(listBgm(bgmDir({ catalog: false })), ['mm-track.mp3', 'zzz-first-alphabetically.mp3'].sort())
})

test('auto = 第一首；none/空 = 关掉；给路径直接用', () => {
  const dir = bgmDir()
  assert.equal(resolveBgm('auto', { dir }).file, path.join(dir, 'mm-track.mp3'))
  assert.deepEqual(resolveBgm('none', { dir }), { file: null, error: null })
  assert.deepEqual(resolveBgm('', { dir }), { file: null, error: null })
  const abs = path.join(dir, 'zzz-first-alphabetically.mp3')
  assert.equal(resolveBgm(abs, { dir }).file, abs)
})

test('名字给片段即可（大小写不敏感）；找不到报错并列可用清单；空目录 auto 不报错', () => {
  const dir = bgmDir()
  assert.equal(resolveBgm('MM-TRACK', { dir }).file, path.join(dir, 'mm-track.mp3'))
  const miss = resolveBgm('rain', { dir })
  assert.equal(miss.file, null)
  assert.match(miss.error, /找不到 BGM：rain/)
  assert.match(miss.error, /mm-track\.mp3/)
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'bgm-empty-'))
  assert.deepEqual(resolveBgm('auto', { dir: empty }), { file: null, error: null })
})
