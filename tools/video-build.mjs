/**
 * V1 视频切片：一张立绘 + 几行字 + TTS → 竖屏 mp4 + 封面（本地 smoke，不投稿）。
 *
 *   node tools/video-build.mjs --image <png> --text <txt|字符串> [--duration 12] [--size 1080x1920] [--voice <edge-tts 音色|none>] [--plan]
 *
 * 产出：<WHALE_HOME>/bili-whale/media/_smoke/<slug>.mp4 + <slug>-cover.png
 * 依赖：vendor/dsh-video-studio（MIT）+ 本机 ffmpeg/ffprobe + tools/venv 里的 edge-tts。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { DSH_HOME } from './lib/paths.mjs'
import { render } from '../vendor/dsh-video-studio/render.js'
import { makeCover } from '../vendor/dsh-video-studio/cover.js'
import { resolveBinaries } from '../vendor/dsh-video-studio/ffmpeg.js'

const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d }
const image = arg('image')
const textArg = arg('text', '今晚听雨。')
let duration = Math.max(3, Math.min(60, Number(arg('duration', 12)) || 12))
const [width, height] = String(arg('size', '1080x1920')).split('x').map(Number)
const voice = String(arg('voice', 'zh-CN-XiaoyiNeural'))
const rate = String(arg('rate', '-4%'))
const planOnly = argv.includes('--plan')
const outDir = path.join(DSH_HOME, 'bili-whale', 'media', '_smoke')
fs.mkdirSync(outDir, { recursive: true })

if (!image || !fs.existsSync(image)) { console.error('需要 --image <存在的图片>'); process.exit(2) }
if (!Number.isFinite(width) || !Number.isFinite(height)) { console.error('--size 形如 1080x1920'); process.exit(2) }

const text = fs.existsSync(textArg) ? fs.readFileSync(textArg, 'utf8') : String(textArg)
const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 5)
if (!lines.length) { console.error('--text 是空的'); process.exit(2) }

const slug = 'smoke-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const out = path.join(outDir, slug + '.mp4')
const cover = path.join(outDir, slug + '-cover.png')
const cover169 = path.join(outDir, slug + '-cover-169.png')
const base = path.join(outDir, '.' + slug + '.base.mp4')
const base169 = path.join(outDir, '.' + slug + '.base169.mp4')
const voiceFile = path.join(outDir, '.' + slug + '.voice.mp3')
// 失败也要清中间件：render/cover 抛错时不会走到末尾的清理
const cleanup = () => {
  for (const f of [base, base169, voiceFile]) { try { fs.rmSync(f, { force: true }) } catch {} }
}
process.on('exit', cleanup)

// 先看本仓自带的 bin（~/.dsh/bili-whale/bin），再走 vendor 的 PATH/常见目录探测
const localBin = path.join(DSH_HOME, 'bili-whale', 'bin')
const localTools = path.join(DSH_HOME, 'bili-whale', 'tools', 'venv', 'Scripts')
const exe = (n) => path.join(localBin, process.platform === 'win32' ? n + '.exe' : n)
const config = {
  ffmpegPath: fs.existsSync(exe('ffmpeg')) ? exe('ffmpeg') : undefined,
  ffprobePath: fs.existsSync(exe('ffprobe')) ? exe('ffprobe') : undefined,
}
const { ffmpeg, ffprobe } = resolveBinaries(config)
if (!ffmpeg) { console.error('找不到 ffmpeg'); process.exit(2) }
if (!ffprobe) { console.error('找不到 ffprobe'); process.exit(2) }

function runBin(bin, args, timeoutMs = 120_000) {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { windowsHide: true })
    let err = ''
    let stdout = ''
    const t = setTimeout(() => { try { p.kill() } catch {} }, timeoutMs)
    p.stdout?.on('data', (d) => { stdout += String(d) })
    p.stderr.on('data', (d) => { err += String(d) })
    p.on('close', (code) => { clearTimeout(t); resolve({ code, stdout, stderr: err }) })
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, stdout, stderr: String(e) }) })
  })
}

async function probeDuration(file) {
  const r = await runBin(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], 30_000)
  const d = Number(String(r.stdout).trim())
  return Number.isFinite(d) ? d : 0
}

// 0) 配音（edge-tts）；--voice none 则静音成片
let ttsDuration = 0
let voiceUsed = null
if (voice && voice !== 'none') {
  const bin = fs.existsSync(path.join(localTools, 'edge-tts.exe'))
    ? path.join(localTools, 'edge-tts.exe')
    : fs.existsSync(path.join(localTools, 'edge-tts'))
      ? path.join(localTools, 'edge-tts')
      : 'edge-tts'
  const r = await runBin(bin, ['--voice', voice, '--rate', rate, '--text', lines.join('\n'), '--write-media', voiceFile], 180_000)
  if (r.code !== 0 || !fs.existsSync(voiceFile)) {
    console.error('TTS 失败（--voice none 可跳过配音）：\n' + (r.stderr || '').slice(-600))
    process.exit(1)
  }
  ttsDuration = await probeDuration(voiceFile)
  voiceUsed = voice
  // 旁白最多占成片 90%，至少留 1.2s 收尾；不够就拉长成片，最多 60s
  const need = Math.ceil(ttsDuration + 2)
  if (need > duration) {
    duration = Math.min(60, need)
    if (ttsDuration + 2 > 60) console.warn(`[video] 旁白 ${ttsDuration.toFixed(1)}s，60s 装不下完整收尾，按 60s 截断`)
  }
}

// 1) 立绘 → 基础片段（缩放裁切到目标画幅）。planOnly 也建片段，否则正文时间窗算不准
{
  const scale = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
  const args = ['-hide_banner', '-loglevel', 'error', '-loop', '1', '-i', image]
  if (voiceUsed) {
    args.push('-i', voiceFile, '-af', 'adelay=1500:all=1,apad')
  } else {
    // vendor 的音频链默认每段都有 [i:a]，所以基础片段必须带一条音轨
    args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo')
  }
  args.push('-t', String(duration), '-vf', scale, '-r', '30', '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264', '-preset', planOnly ? 'ultrafast' : 'veryfast', '-crf', planOnly ? '30' : '23',
    '-c:a', 'aac', '-b:a', '128k', '-y', base)
  const r = await runBin(ffmpeg, args, 300_000)
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

const res = await render(spec, config, {
  onProgress: (m) => console.log('[video] ' + m),
})

// 3) 封面：竖版 9:16 + 横版 16:9；planOnly 没有成片，跳过
//    取 base 而不是成片：成片里已经烧了字幕，再从成片取帧会叠出「大字 + 行字幕」两层字
let coverRes = null
let cover169Res = null
if (!planOnly) {
  const at = Math.max(0, duration * 0.85)
  coverRes = await makeCover({
    video: base, output: cover, lines: [lines[0]], width, height,
    at, font: 'yahei',
  }, config)

  // 16:9：竖图不能直接中心裁（会切到眼睛）。用模糊底 + 完整立绘居中，再压字（B 站封面比例）
  const filter = '[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,gblur=sigma=30[bg];'
    + '[0:v]scale=1280:720:force_original_aspect_ratio=decrease[fg];'
    + '[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1'
  const r = await runBin(ffmpeg, ['-hide_banner', '-loglevel', 'error',
    '-ss', String(at), '-i', base, '-t', '1',
    '-filter_complex', filter,
    '-r', '30', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20',
    '-an', '-y', base169], 120_000)
  if (r.code !== 0) { console.error('16:9 封面底图生成失败：\n' + r.stderr.slice(-500)); process.exit(1) }
  cover169Res = await makeCover({
    video: base169, output: cover169, lines: [lines[0]], width: 1280, height: 720,
    at: 0.5, font: 'yahei',
  }, config)
}

console.log(JSON.stringify({
  ok: true,
  planOnly,
  out: planOnly ? null : out,
  cover: planOnly ? null : cover,
  cover169: planOnly ? null : cover169,
  duration: res.duration,
  sizeMB: res.sizeMB,
  voice: voiceUsed,
  voiceSeconds: ttsDuration ? Number(ttsDuration.toFixed(2)) : null,
  coverBytes: coverRes?.bytes ?? null,
  cover169Bytes: cover169Res?.bytes ?? null,
  warnings: res.warnings,
}, null, 2))
