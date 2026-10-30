/**
 * V1 视频切片：一张立绘 + 几行字 → 竖屏 mp4（本地 smoke，不投稿）。
 *
 *   node tools/video-build.mjs --image <png> --text <txt|字符串> [--duration 12] [--size 1080x1920] [--plan]
 *
 * 产出：<WHALE_HOME>/bili-whale/media/_smoke/<slug>.mp4
 * 依赖：vendor/dsh-video-studio（MIT）+ 本机 ffmpeg/ffprobe。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { DSH_HOME } from './lib/paths.mjs'
import { render } from '../vendor/dsh-video-studio/render.js'
import { resolveBinaries } from '../vendor/dsh-video-studio/ffmpeg.js'

const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d }
const image = arg('image')
const textArg = arg('text', '今晚听雨。')
const duration = Math.max(3, Math.min(60, Number(arg('duration', 12)) || 12))
const [width, height] = String(arg('size', '1080x1920')).split('x').map(Number)
const planOnly = argv.includes('--plan')
const outDir = path.join(DSH_HOME, 'bili-whale', 'media', '_smoke')
fs.mkdirSync(outDir, { recursive: true })

if (!image || !fs.existsSync(image)) { console.error('需要 --image <存在的图片>'); process.exit(2) }

const text = fs.existsSync(textArg) ? fs.readFileSync(textArg, 'utf8') : String(textArg)
const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 5)
if (!lines.length) { console.error('--text 是空的'); process.exit(2) }

const slug = 'smoke-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const out = path.join(outDir, slug + '.mp4')
const base = path.join(outDir, '.' + slug + '.base.mp4')

// 先看本仓自带的 bin（~/.dsh/bili-whale/bin），再走 vendor 的 PATH/常见目录探测
const localBin = path.join(DSH_HOME, 'bili-whale', 'bin')
const exe = (n) => path.join(localBin, process.platform === 'win32' ? n + '.exe' : n)
const { ffmpeg, ffprobe } = resolveBinaries({
  ffmpegPath: fs.existsSync(exe('ffmpeg')) ? exe('ffmpeg') : undefined,
  ffprobePath: fs.existsSync(exe('ffprobe')) ? exe('ffprobe') : undefined,
})
if (!ffmpeg) { console.error('找不到 ffmpeg'); process.exit(2) }
if (!ffprobe) { console.error('找不到 ffprobe'); process.exit(2) }

function runBin(bin, args) {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { windowsHide: true })
    let err = ''
    p.stderr.on('data', (d) => { err += String(d) })
    p.on('close', (code) => resolve({ code, stderr: err }))
  })
}

// 1) 立绘 → 基础片段（缩放裁切到目标画幅）。planOnly 也建片段，否则正文时间窗算不准
{
  const scale = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
  // vendor 的音频链默认每段都有 [i:a]，所以基础片段必须带一条静音轨
  const r = await runBin(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-loop', '1', '-i', image,
    '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo',
    '-t', String(duration), '-vf', scale, '-r', '30', '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264', '-preset', planOnly ? 'ultrafast' : 'veryfast', '-crf', planOnly ? '30' : '23',
    '-c:a', 'aac', '-b:a', '128k', '-shortest', '-y', base])
  if (r.code !== 0) { console.error('基础片段生成失败：\n' + r.stderr.slice(-800)); process.exit(1) }
}

// 2) 渲染（字幕/转场/淡出）；planOnly 只校验 spec
const spec = {
  segments: [{ input: base, start: 0, end: duration }],
  width, height, fps: 30,
  exactDuration: duration,
  textLines: lines,
  ending: 'fade',
  font: 'yahei',
  look: 'none',
  planOnly,
  output: out,
}

const res = await render(spec, { ffmpegPath: ffmpeg, ffprobePath: ffprobe }, {
  onProgress: (m) => console.log('[video] ' + m),
})
try { fs.rmSync(base, { force: true }) } catch {}
console.log(JSON.stringify({ ok: true, planOnly, out: planOnly ? null : out, duration: res.duration, sizeMB: res.sizeMB, warnings: res.warnings }, null, 2))
