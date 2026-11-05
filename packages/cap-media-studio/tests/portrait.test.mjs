/**
 * 她的状态立绘（形态那一项里唯一有价值、又不引新引擎的活儿）。
 *
 * 那 8 张 `daily-*.png` 本来只是视频底图，但每张画的场景都很明确
 * （见 `assets/daily/prompts/NN-*.txt`）：深夜窗边 / 雨夜听雨 / 闭眼戴耳机 / 缩在被窝里。
 * **天生就是"她现在的样子"**——不生成新图，只按状态接上。
 *
 * 这一条钉住：
 *   1. 四种状态各挑到对的那张（睡着→被窝 / 歇着→深夜窗边 / 在听→耳机 / 精神好→看水母）；
 *   2. 同一个场景有 a/b 两个变体时能换（不总用同一张）；
 *   3. 面板方法给的是 **data URL**（宿主没有按路径取文件的路由，`/api/files?path=` 实测 404）；
 *   4. 文件不在时说清楚，不抛。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { choosePortrait, alternatePortrait, SCENE_LABEL } from '../src/portrait.ts'
import { createMediaStudioCapability } from '../src/index.ts'

test('状态 → 立绘：睡着是被窝，歇着是深夜窗边，在听是耳机，精神好是看水母', () => {
  const asleep = choosePortrait({ rest: 'asleep', energy: 0.2, stimulation: 0.1 })
  assert.equal(asleep.scene, 'goodnight')
  assert.match(asleep.caption, /睡/)

  const resting = choosePortrait({ rest: 'resting', energy: 0.3, stimulation: 0.2 })
  assert.equal(resting.scene, 'night')

  const listening = choosePortrait({ rest: 'awake', energy: 0.8, stimulation: 0.7 })
  assert.equal(listening.scene, 'headphone')

  const lively = choosePortrait({ rest: 'awake', energy: 0.8, stimulation: 0.3 })
  assert.equal(lively.scene, 'night')
  assert.match(lively.caption, /水母/)

  const low = choosePortrait({ rest: 'awake', energy: 0.3, stimulation: 0.1 })
  assert.equal(low.scene, 'rain')
})

test('每个场景都有 a/b 两个变体，且能换', () => {
  const c = choosePortrait({ rest: 'asleep' })
  const alt = alternatePortrait(c)
  assert.notEqual(alt.file, c.file, '换一张要给出不同的文件')
  assert.equal(alt.scene, c.scene, '场景不变')
  assert.equal(alt.caption, c.caption)
  assert.ok(SCENE_LABEL[c.scene])
})

test('面板方法：给 data URL（宿主没有 /api/files 那条路）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-portrait-'))
  const assetsDir = path.join(dir, 'assets')
  fs.mkdirSync(assetsDir, { recursive: true })
  // 造一张最小 PNG（1x1 像素，够 ffmpeg 缩放了）
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  fs.writeFileSync(path.join(assetsDir, 'daily-04-goodnight-a.png'), png)

  const cap = createMediaStudioCapability({
    assetsDir,
    bgmDir: path.join(dir, 'bgm'),
    outputDir: path.join(dir, 'out'),
  })
  const panel = cap.panels().find((p) => p.id === 'media-studio')
  const res = await panel.methods.portrait.invoke({ rest: 'asleep' })
  assert.equal(res.ok, true, res.error)
  assert.equal(res.file, 'daily-04-goodnight-a.png')
  assert.equal(res.scene, 'goodnight')
  assert.ok(res.caption)
  // 有 ffmpeg 就给 data URL（缩略）；没有也给 data URL（退回原图）——但不能是 undefined
  assert.ok(res.dataUrl, '要有 data URL')
  assert.match(String(res.dataUrl), /^data:image\/(png|jpeg);base64,/)
})

test('面板方法：文件不在时说清楚，不抛', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-portrait2-'))
  const cap = createMediaStudioCapability({
    assetsDir: path.join(dir, 'assets'),
    bgmDir: path.join(dir, 'bgm'),
    outputDir: path.join(dir, 'out'),
  })
  const panel = cap.panels().find((p) => p.id === 'media-studio')
  const res = await panel.methods.portrait.invoke({ rest: 'asleep' })
  assert.equal(res.ok, false)
  assert.match(res.error, /立绘不在了/)
})
