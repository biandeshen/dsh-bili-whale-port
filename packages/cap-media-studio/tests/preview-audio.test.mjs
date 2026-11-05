/**
 * 试听配音要真的能在页面里播（B13d · B7c 同款问题的收尾）。
 *
 * 以前有两处毛病：
 *   1. **一次点击合成两次**——actionButton 已经 invoke 过一次，after 里又 invoke 一次
 *      （白烧一次 TTS，还可能给主人两段不一样的音频）；
 *   2. `<audio src="/api/files?path=...">` —— 宿主**没有**这条路由
 *      （它只有 `/api/blob?handle=`），所以那个播放器永远裂着，2026-11-04 实测就是 404。
 *
 * 现在：后端把音频出成 data URL，页面直接拿它播；点击只合成一次。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mountPanel, settle } from '../../../tests/helpers/panel-harness.mjs'
import { mediaStudioPanel } from '../src/webui/client.ts'
import { createMediaStudioCapability } from '../src/index.ts'

// ── 后端：给的是 data URL，不是路径 ──

test('试听：后端给 data URL（宿主没有 /api/files 这条路）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-media-tts-'))
  const outputDir = path.join(dir, 'out')
  let calls = 0
  const cap = createMediaStudioCapability({
    assetsDir: path.join(dir, 'assets'),
    bgmDir: path.join(dir, 'bgm'),
    outputDir,
    ttsPreview: async ({ text, outFile }) => {
      calls += 1
      fs.mkdirSync(path.dirname(outFile), { recursive: true })
      fs.writeFileSync(outFile, `FAKE-MP3:${text}`)
      return { ok: true, outFile, provider: 'fake' }
    },
  })
  const panel = cap.panels().find((p) => p.id === 'media-studio')
  const res = await panel.methods.previewTts.invoke({ text: '今晚听雨' })
  assert.equal(res.ok, true)
  assert.equal(calls, 1, '一次调用只合成一次')
  assert.ok(String(res.dataUrl).startsWith('data:audio/mpeg;base64,'), '要给 data URL')
  assert.ok(res.bytes > 0)
})

test('试听：音频出不来就照实说，不给一个播不动的空地址', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-media-tts2-'))
  const cap = createMediaStudioCapability({
    assetsDir: path.join(dir, 'assets'),
    bgmDir: path.join(dir, 'bgm'),
    outputDir: path.join(dir, 'out'),
    ttsPreview: async ({ outFile }) => ({ ok: true, outFile }),
  })
  const panel = cap.panels().find((p) => p.id === 'media-studio')
  const res = await panel.methods.previewTts.invoke({ text: 'x' })
  assert.equal(res.ok, false)
  assert.match(res.error, /试听音频/)
  assert.equal(res.dataUrl, undefined)
})

// ── 面板：一次点击只合成一次，且播放器用 data URL ──

test('面板：点一次「试听配音」只发一次请求，播放器用 data URL', async () => {
  let calls = 0
  const h = mountPanel({
    listAssets: () => ({ ok: true, images: ['a.png'], bgmTracks: [], toolchain: { ffmpegReady: true, tts: {} } }),
    previewTts: (p = {}) => {
      calls += 1
      return { ok: true, outFile: '/tmp/x.mp3', dataUrl: 'data:audio/mpeg;base64,QUJD' }
    },
  }, { pageId: 'world:media-studio', panelId: 'media-studio' })
  mediaStudioPanel.mount(h.ctx)
  await settle()
  await h.click(h.findButton('🔊 试听配音'))
  assert.equal(calls, 1, `一次点击只该合成一次，实得 ${calls}`)
  const audios = h.root.querySelectorAll ? h.root.querySelectorAll('audio') : []
  const srcs = []
  const walk = (el) => { if (el.tagName === 'AUDIO') srcs.push(el.src); for (const c of el.children) walk(c) }
  walk(h.root)
  assert.equal(srcs.length, 1, '要有一个播放器')
  assert.ok(String(srcs[0]).startsWith('data:audio/mpeg;base64,'), `播放器要用 data URL，实得 ${srcs[0]}`)
  assert.ok(!String(srcs[0]).includes('/api/files'), '不能指向宿主不存在的 /api/files')
})
