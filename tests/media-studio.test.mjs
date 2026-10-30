// M1c：studio 适配层——本地 bin 优先定位；CLI 等价冒烟（--tts none --bgm none --plan）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { studioConfig, resolveTools } from '../tools/media/video/studio.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

test('studioConfig：whale bin 里有就用本地路径，没有就留给 vendor 探测', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bin-'))
  assert.deepEqual(studioConfig({ localBinDir: dir }), { ffmpegPath: undefined, ffprobePath: undefined })
  const exe = process.platform === 'win32' ? '.exe' : ''
  fs.writeFileSync(path.join(dir, 'ffmpeg' + exe), '')
  fs.writeFileSync(path.join(dir, 'ffprobe' + exe), '')
  const cfg = studioConfig({ localBinDir: dir })
  assert.equal(cfg.ffmpegPath, path.join(dir, 'ffmpeg' + exe))
  assert.equal(cfg.ffprobePath, path.join(dir, 'ffprobe' + exe))
})

// CLI 等价门：--tts none --bgm none --plan 走完整装配链（ffmpeg 本机才有；没有就跳过）
const { ffmpeg } = resolveTools(studioConfig({ localBinDir: path.join(process.env.USERPROFILE || '', '.dsh', 'bili-whale', 'bin') }))
test('CLI 冒烟：--plan 输出与旧版同构（ok/planOnly/null 产出路径）', { skip: !ffmpeg }, () => {
  const png = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vb-')), 'px.png')
  // 1×1 红色 PNG
  fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'video-build.mjs'), '--image', png, '--text', '冒烟。', '--tts', 'none', '--bgm', 'none', '--plan'], { encoding: 'utf8', timeout: 120_000 })
  assert.equal(r.status, 0, r.stderr)
  const j = JSON.parse(r.stdout)
  assert.equal(j.ok, true)
  assert.equal(j.planOnly, true)
  assert.equal(j.out, null)
  assert.equal(j.ttsProvider, null)
  assert.equal(j.bgm, null)
  assert.ok(Array.isArray(j.warnings))
})
