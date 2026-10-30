/**
 * V1 视频切片：一张立绘 + 几行字 + TTS + CC0 BGM → 竖屏 mp4 + 双比例封面（本地 smoke，不投稿）。
 *
 *   node tools/video-build.mjs --image <png> --text <txt|字符串> [--duration 20] [--size 1080x1920]
 *     [--tts auto|mimo|edge|none] [--voice <音色|auto>] [--style <风格指令>]
 *     [--bgm auto|<assets/bgm 里的名字>|<路径>|none] [--bgm-volume 0.14] [--plan]
 *
 * TTS：MiMo（默认，key 读 ~/.local/share/mimocode/auth.json 或 MIMO_API_KEY）→ 失败回退 edge-tts。
 * 产出：<WHALE_HOME>/bili-whale/media/_smoke/<slug>.mp4 + <slug>-cover.png + <slug>-cover-169.png
 * 依赖：vendor/dsh-video-studio（MIT）+ 本机 ffmpeg/ffprobe + tools/venv/edge-tts（回退用）。
 */
import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DSH_HOME } from './lib/paths.mjs'
import { render } from '../vendor/dsh-video-studio/render.js'
import { makeCover } from '../vendor/dsh-video-studio/cover.js'
import { resolveBinaries } from '../vendor/dsh-video-studio/ffmpeg.js'
// M1b：key 只在 credentials provider 里出（顺序不变：env → auth.json → credentials/mimo.json）
import { loadMimoKey } from './lib/credentials/mimo.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')

const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d }
const image = arg('image')
const textArg = arg('text', '今晚听雨。')
let duration = Math.max(3, Math.min(60, Number(arg('duration', 20)) || 20))
const [width, height] = String(arg('size', '1080x1920')).split('x').map(Number)
const tts = String(arg('tts', 'auto')).toLowerCase()
const voiceArg = String(arg('voice', 'auto'))
const style = String(arg('style', '请用温柔、轻一点、像夜里说话的语气朗读下面内容。'))
const mimoModel = String(arg('model', 'mimo-v2.5-tts'))
const bgmArg = String(arg('bgm', 'auto'))
const bgmVolume = Math.max(0, Math.min(0.6, Number(arg('bgm-volume', 0.14)) || 0.14))
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

// ---- BGM：assets/bgm 里挑 CC0 曲目 ----
function resolveBgm(value) {
  if (!value || value === 'none') return null
  const dir = path.join(REPO, 'assets', 'bgm')
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.mp3$/i.test(f)).sort() : []
  if (value === 'auto') return files.length ? path.join(dir, files[0]) : null
  if (fs.existsSync(value)) return value
  const hit = files.find((f) => f.toLowerCase().includes(value.toLowerCase()))
  return hit ? path.join(dir, hit) : false
}

let bgmFile = null
if (bgmArg && bgmArg !== 'none') {
  const r = resolveBgm(bgmArg)
  if (r === false) { console.error(`找不到 BGM：${bgmArg}（可用：${fs.readdirSync(path.join(REPO, 'assets', 'bgm')).filter((f) => /\.mp3$/i.test(f)).join(', ')}）`); process.exit(2) }
  bgmFile = r
  if (!bgmFile) console.warn('[bgm] assets/bgm 里没有 mp3，本次只用人声/静音')
}

// ---- TTS：MiMo 优先，失败回退 edge-tts（key 来源见 credentials/mimo.mjs，M1b）----
async function mimoTts(text, voice) {
  const key = loadMimoKey().key
  if (!key) throw new Error('未找到 MiMo API key（~/.local/share/mimocode/auth.json 或 MIMO_API_KEY）')
  const payload = JSON.stringify({
    model: mimoModel,
    messages: [
      { role: 'user', content: style },
      { role: 'assistant', content: text },
    ],
    audio: { format: 'mp3', voice },
  })
  const r = await httpsPost('https://api.xiaomimimo.com/v1/chat/completions', payload, {
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  }, 180_000)
  if (r.status >= 400) {
    throw new Error(`MiMo TTS ${r.status}: ${r.buffer.toString('utf8').slice(0, 300)}`)
  }
  const ct = String(r.headers['content-type'] || '')
  let buf
  if (ct.includes('application/json')) {
    const j = JSON.parse(r.buffer.toString('utf8'))
    const data = j?.choices?.[0]?.message?.audio?.data
    if (!data) throw new Error('MiMo 响应缺少 message.audio.data')
    buf = Buffer.from(data, 'base64')
  } else {
    buf = r.buffer
  }
  if (!buf.length) throw new Error('MiMo 返回空音频')
  fs.writeFileSync(voiceFile, buf)
}

/** 只用于 MiMo TTS（不是 B 站后端，不走 traffic 闸）。 */
function httpsPost(url, payload, headers, timeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    const req = https.request(new URL(url), { method: 'POST', headers }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, buffer: Buffer.concat(chunks) }))
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error('MiMo 请求超时')))
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

async function edgeTts(text, voice) {
  const bin = fs.existsSync(path.join(localTools, 'edge-tts.exe'))
    ? path.join(localTools, 'edge-tts.exe')
    : fs.existsSync(path.join(localTools, 'edge-tts'))
      ? path.join(localTools, 'edge-tts')
      : 'edge-tts'
  const r = await runBin(bin, ['--voice', voice, '--rate', '-4%', '--text', text, '--write-media', voiceFile], 180_000)
  if (r.code !== 0 || !fs.existsSync(voiceFile)) throw new Error((r.stderr || 'edge-tts 无输出').slice(-300))
}

let ttsProvider = null
let voiceUsed = null
let ttsDuration = 0
if (tts !== 'none') {
  const order = tts === 'auto' ? ['mimo', 'edge'] : [tts]
  let lastErr = null
  for (const p of order) {
    const v = voiceArg === 'auto' ? (p === 'mimo' ? '茉莉' : 'zh-CN-XiaoyiNeural') : voiceArg
    try {
      if (p === 'mimo') await mimoTts(lines.join('\n'), v)
      else await edgeTts(lines.join('\n'), v)
      ttsProvider = p
      voiceUsed = v
      break
    } catch (e) {
      lastErr = e
      console.warn(`[tts] ${p} 失败：${String(e?.message ?? e).slice(0, 200)}`)
    }
  }
  if (!ttsProvider) { console.error('TTS 全部失败（--tts none 可跳过配音）：' + String(lastErr?.message ?? lastErr)); process.exit(1) }
  ttsDuration = await probeDuration(voiceFile)
  // 旁白最多占成片 90%，至少留 2s 收尾；不够就拉长成片，最多 60s
  const need = Math.ceil(ttsDuration + 2)
  if (need > duration) {
    duration = Math.min(60, need)
    if (ttsDuration + 2 > 60) console.warn(`[video] 旁白 ${ttsDuration.toFixed(1)}s，60s 装不下完整收尾，按 60s 截断`)
  }
}

// ---- 1) 立绘 + 音轨 → 基础片段（无字幕，供成片与封面复用）----
{
  const scale = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
  const args = ['-hide_banner', '-loglevel', 'error', '-loop', '1', '-i', image]
  const filters = [`[0:v]${scale},setsar=1[v]`]
  const audio = []
  let idx = 1
  if (ttsProvider) {
    args.push('-i', voiceFile)
    filters.push(`[${idx}:a]adelay=1500:all=1,apad[vo]`)
    audio.push('vo')
    idx += 1
  }
  if (bgmFile) {
    args.push('-stream_loop', '-1', '-i', bgmFile)
    filters.push(`[${idx}:a]volume=${bgmVolume},apad[bg]`)
    audio.push('bg')
    idx += 1
  }
  if (audio.length === 0) {
    // vendor 的音频链默认每段都有 [i:a]，所以基础片段必须带一条音轨
    args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo')
    filters.push(`[${idx}:a]anull[aout]`)
  } else if (audio.length === 1) {
    filters.push(`[${audio[0]}]anull[aout]`)
  } else {
    filters.push('[vo][bg]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[aout]')
  }
  args.push('-filter_complex', filters.join(';'), '-map', '[v]', '-map', '[aout]',
    '-t', String(duration), '-r', '30', '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264', '-preset', planOnly ? 'ultrafast' : 'veryfast', '-crf', planOnly ? '30' : '23',
    '-c:a', 'aac', '-b:a', '128k', '-y', base)
  const r = await runBin(ffmpeg, args, 300_000)
  if (r.code !== 0) { console.error('基础片段生成失败：\n' + r.stderr.slice(-800)); process.exit(1) }
}

// ---- 2) 渲染（字幕/转场/淡出）；planOnly 只校验 spec ----
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

// ---- 3) 封面：竖版 9:16 + 横版 16:9；planOnly 没有成片，跳过 ----
// 取 base 而不是成片：成片里已经烧了字幕，再从成片取帧会叠出「大字 + 行字幕」两层字
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
  ttsProvider,
  voice: voiceUsed,
  voiceSeconds: ttsDuration ? Number(ttsDuration.toFixed(2)) : null,
  bgm: bgmFile ? path.basename(bgmFile) : null,
  bgmVolume: bgmFile ? bgmVolume : null,
  coverBytes: coverRes?.bytes ?? null,
  cover169Bytes: cover169Res?.bytes ?? null,
  warnings: res.warnings,
}, null, 2))
