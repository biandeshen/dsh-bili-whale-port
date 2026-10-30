/**
 * V1 视频切片 CLI（M1c 后为薄壳：解析参数 → 调 media/ 层）：
 *   node tools/video-build.mjs --image <png> --text <txt|字符串> [--duration 20] [--size 1080x1920]
 *     [--tts auto|mimo|edge|none] [--voice <音色|auto>] [--style <风格指令>]
 *     [--bgm auto|<名字>|<路径>|none] [--bgm-volume 0.14] [--plan]
 * 默认值来自 config.media（bili-whale.config.json 的 media 节），CLI 参数优先。
 * 产出：<WHALE_HOME>/bili-whale/media/_smoke/<slug>.mp4 + 双比例封面；--plan 只装配与校验，不出成片。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DSH_HOME } from './lib/paths.mjs'
import { mediaConfig } from './media/config.mjs'
import { resolveBgm } from './media/bgm.mjs'
import { ttsPlan, synthesize, describeTts } from './media/tts.mjs'
import { studioConfig, resolveTools, probeDuration, assembleBaseClip, make169Base, render, makeCover } from './media/video/studio.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const cfg = mediaConfig()

const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d }
const image = arg('image')
const textArg = arg('text', '今晚听雨。')
let duration = Math.max(cfg.video.minDuration, Math.min(cfg.video.maxDuration, Number(arg('duration', cfg.video.duration)) || cfg.video.duration))
const [width, height] = String(arg('size', cfg.video.size)).split('x').map(Number)
const tts = String(arg('tts', cfg.tts.provider)).toLowerCase()
const voiceArg = String(arg('voice', 'auto'))
const style = String(arg('style', cfg.tts.style))
const mimoModel = String(arg('model', cfg.tts.model))
const bgmArg = String(arg('bgm', cfg.bgm.default))
const bgmVolume = Math.max(0, Math.min(0.6, Number(arg('bgm-volume', cfg.bgm.volume)) || cfg.bgm.volume))
const planOnly = argv.includes('--plan')
const outDir = path.join(DSH_HOME, 'bili-whale', 'media', '_smoke')
fs.mkdirSync(outDir, { recursive: true })

if (!['auto', 'mimo', 'edge', 'none'].includes(tts)) { console.error('--tts 只支持 auto|mimo|edge|none'); process.exit(2) }
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
const cleanup = () => {
  for (const f of [base, base169, voiceFile]) { try { fs.rmSync(f, { force: true }) } catch {} }
}
process.on('exit', cleanup)

const localBin = path.join(DSH_HOME, 'bili-whale', 'bin')
const localTools = path.join(DSH_HOME, 'bili-whale', 'tools', 'venv', 'Scripts')
const scfg = studioConfig({ localBinDir: localBin })
const { ffmpeg, ffprobe } = resolveTools(scfg)
if (!ffmpeg) { console.error('找不到 ffmpeg'); process.exit(2) }
if (!ffprobe) { console.error('找不到 ffprobe'); process.exit(2) }

// ---- BGM ----
const bgmDir = path.join(REPO, 'assets', 'bgm')
let bgmFile = null
if (bgmArg && bgmArg !== 'none') {
  const r = resolveBgm(bgmArg, { dir: bgmDir })
  if (r.error) { console.error(r.error); process.exit(2) }
  bgmFile = r.file
  if (!bgmFile) console.warn('[bgm] assets/bgm 里没有 mp3，本次只用人声/静音')
}

// ---- TTS（回退序与 fail-closed 语义见 media/tts.mjs）----
let ttsProvider = null
let voiceUsed = null
let ttsDuration = 0
const plan = ttsPlan(tts)
if (plan.order.length) {
  try {
    const r = await synthesize({ plan, text: lines.join('\n'), voiceArg, outFile: voiceFile, style, model: mimoModel, binDir: localTools, onWarn: (m) => console.warn('[tts] ' + m) })
    ttsProvider = r.provider
    voiceUsed = r.voice
  } catch (e) {
    console.error(String(e?.message ?? e))
    process.exit(1)
  }
  ttsDuration = await probeDuration(ffprobe, voiceFile)
  // 旁白留 2s 收尾；装不下就拉长成片，最多 60s
  const need = Math.ceil(ttsDuration + 2)
  if (need > duration) {
    duration = Math.min(cfg.video.maxDuration, need)
    if (ttsDuration + 2 > cfg.video.maxDuration) console.warn(`[video] 旁白 ${ttsDuration.toFixed(1)}s，${cfg.video.maxDuration}s 装不下完整收尾，按 ${cfg.video.maxDuration}s 截断`)
  }
}

// ---- 1) 基础片段 ----
try {
  await assembleBaseClip({ ffmpeg, image, voiceFile: ttsProvider ? voiceFile : null, bgmFile, bgmVolume, width, height, duration, out: base, fast: planOnly })
} catch (e) { console.error(String(e.message)); process.exit(1) }

// ---- 2) 渲染；planOnly 只校验 spec ----
const res = await render({
  segments: [{ input: base, start: 0, end: duration }],
  width, height, fps: 30,
  exactDuration: duration,
  textLines: lines,
  ending: 'fade',
  font: 'yahei',
  look: 'none',
  planOnly,
  output: out,
}, scfg, { onProgress: (m) => console.log('[video] ' + m) })

// ---- 3) 封面：竖版 9:16 + 横版 16:9；取 base 不取成片（成片已烧字幕，会叠两层字）----
let coverRes = null
let cover169Res = null
if (!planOnly) {
  const at = Math.max(0, duration * 0.85)
  coverRes = await makeCover({ video: base, output: cover, lines: [lines[0]], width, height, at, font: 'yahei' }, scfg)
  try {
    await make169Base({ ffmpeg, base, at, out: base169 })
  } catch (e) { console.error(String(e.message)); process.exit(1) }
  cover169Res = await makeCover({ video: base169, output: cover169, lines: [lines[0]], width: 1280, height: 720, at: 0.5, font: 'yahei' }, scfg)
}

if (planOnly && process.env.BILI_MEDIA_DEBUG === '1') console.error('[plan] tts ' + JSON.stringify(describeTts()) + ' bgm=' + (bgmFile ? path.basename(bgmFile) : 'none'))
console.log(JSON.stringify({
  ok: true,
  planOnly,
  out: planOnly ? null : out,
  cover: planOnly ? null : cover,
  cover169: planOnly ? null : cover169,
  duration: res.duration,
  sizeMB: res.sizeMB,
  ttsProvider,
  voice: voiceUsed,
  voiceSeconds: ttsDuration ? Number(ttsDuration.toFixed(2)) : null,
  bgm: bgmFile ? path.basename(bgmFile) : null,
  bgmVolume: bgmFile ? bgmVolume : null,
  coverBytes: coverRes?.bytes ?? null,
  cover169Bytes: cover169Res?.bytes ?? null,
  warnings: res.warnings,
}, null, 2))
