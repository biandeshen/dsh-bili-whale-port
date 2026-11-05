/**
 * SUBS 字幕条版（B7b-2）。
 *
 * 缺口长什么样：旧 CLI（`tools/commands/bili-watch.mjs`）一直有一张"SUBS 字幕条版"——
 * 同一批帧，只留画面底部 17%（字幕带），放大到 1280 宽，竖着拼成一条。
 * 依据是 2026-10-14 的实测：讲解型视频的信息全在字幕里，
 * 全画幅九宫格会把字幕压到看不清；只留字幕带，9 条字幕能全部读清。
 * 搬进能力包时这条**没搬**，于是新管道只剩画面版。
 *
 * 这一条钉住：
 *   1. 用的是**同一批帧**的时间点（不重抽帧——重抽要多解一遍码，那是最贵的一步）；
 *   2. 裁字幕带 + 放大 + 竖拼（用 image2 序列喂一个输入，tile 只吃一条流）；
 *   3. **失败不抛**：出不来时画面版还在，不该因为一张可选的图把整趟分析带崩。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { buildSubtitleStrip } from '../src/subtitle-strip.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cap-subs-'))

/** 本机有没有 ffmpeg（没有就只测"失败不抛"那一半）。 */
function ffmpegPath() {
  const home = path.join(os.homedir(), '.dsh', 'bili-whale', 'bin')
  for (const n of ['ffmpeg.exe', 'ffmpeg']) {
    const p = path.join(home, n)
    if (fs.existsSync(p)) return p
  }
  return ''
}

/** 造一段带字幕带的测试视频（ffmpeg 造一段带 drawtext 的画面太重，这里用纯色 + 底部白条）。 */
function makeVideo(dir) {
  const ff = ffmpegPath()
  if (!ff) return null
  const out = path.join(dir, 'v.mp4')
  try {
    execFileSync(ff, [
      '-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'color=c=navy:s=320x180:d=6',
      '-f', 'lavfi', '-i', 'color=c=white:s=320x40:d=6',
      '-filter_complex', '[0:v][1:v]overlay=0:140',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out,
    ], { stdio: 'ignore' })
    return out
  } catch {
    return null
  }
}

test('字幕条：没有时间点/没有 ffmpeg/文件不在，都要说清原因而不是抛', async () => {
  const r1 = await buildSubtitleStrip({ file: 'x.mp4', times: [], ffmpegPath: 'ffmpeg' })
  assert.equal(r1.ok, false)
  assert.match(r1.error ?? '', /时间点/)

  const r2 = await buildSubtitleStrip({ file: 'x.mp4', times: [1], ffmpegPath: '' })
  assert.equal(r2.ok, false)
  assert.match(r2.error ?? '', /ffmpeg/)

  const r3 = await buildSubtitleStrip({ file: path.join(tmp(), 'nope.mp4'), times: [1], ffmpegPath: 'ffmpeg' })
  assert.equal(r3.ok, false)
  assert.match(r3.error ?? '', /不在了/)
})

test('字幕条：真跑一遍——裁字幕带、放大、竖拼成一条', async (t) => {
  const ff = ffmpegPath()
  if (!ff) return t.skip('本机没有 ffmpeg')
  const dir = tmp()
  const video = makeVideo(dir)
  if (!video) return t.skip('造不出测试视频')

  const out = await buildSubtitleStrip({
    file: video,
    times: [0.5, 1.5, 2.5],
    ffmpegPath: ff,
    outDir: dir,
  })
  assert.equal(out.ok, true, out.error)
  assert.ok(out.png && out.png.length > 0, '要出 png')
  assert.equal(out.times.length, 3)
  assert.ok(out.file && fs.existsSync(out.file), '给了 outDir 就要落盘')
})

test('字幕条：出不来时只是失败，不许把整趟分析带崩', async () => {
  // 给一个坏掉的 ffmpeg 路径（存在但不是可执行程序）
  const dir = tmp()
  const fake = path.join(dir, 'not-ffmpeg.exe')
  fs.writeFileSync(fake, 'not an exe')
  const video = path.join(dir, 'v.mp4')
  fs.writeFileSync(video, 'x')
  const out = await buildSubtitleStrip({ file: video, times: [1], ffmpegPath: fake })
  assert.equal(out.ok, false)
  assert.ok(out.error, '要有失败原因')
})
