/**
 * 渲染适配层（M1c）：vendor/dsh-video-studio 是当前实现，换渲染器（如 bili-workbench）
 * 只改这个文件的内部，video-build 的调用面不动。
 * 职责：ffmpeg/ffprobe 定位、基础片段装配（图+人声+BGM→无字幕 mp4）、16:9 封面底图、
 * 成片渲染与封面（透传 vendor render/makeCover）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { render } from '../../../vendor/dsh-video-studio/render.js'
import { makeCover } from '../../../vendor/dsh-video-studio/cover.js'
import { resolveBinaries } from '../../../vendor/dsh-video-studio/ffmpeg.js'
import { runBin } from '../../lib/proc.mjs'

/** 先看 whale home 自带 bin，再走 vendor 的 PATH/常见目录探测。 */
export function studioConfig({ localBinDir }) {
  const exe = (n) => path.join(localBinDir, process.platform === 'win32' ? n + '.exe' : n)
  return {
    ffmpegPath: fs.existsSync(exe('ffmpeg')) ? exe('ffmpeg') : undefined,
    ffprobePath: fs.existsSync(exe('ffprobe')) ? exe('ffprobe') : undefined,
  }
}

/** @returns {{ ffmpeg: string|null, ffprobe: string|null }} */
export function resolveTools(config) {
  const { ffmpeg, ffprobe } = resolveBinaries(config)
  return { ffmpeg: ffmpeg ?? null, ffprobe: ffprobe ?? null }
}

export async function probeDuration(ffprobe, file) {
  const r = await runBin(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], 30_000)
  const d = Number(String(r.stdout).trim())
  return Number.isFinite(d) ? d : 0
}

/**
 * 图 + 人声(可选) + BGM(可选) → 无字幕基础片段（成片与封面共用）。
 * 音轨规则：都没有 → anullsrc 静音轨（vendor 音频链假设每段有 [i:a]）；只有一条 → anull 透传；两条 → amix。
 */
export async function assembleBaseClip({ ffmpeg, image, voiceFile, bgmFile, bgmVolume, width, height, duration, out, fast = false }) {
  const scale = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
  const args = ['-hide_banner', '-loglevel', 'error', '-loop', '1', '-i', image]
  const filters = [`[0:v]${scale},setsar=1[v]`]
  const audio = []
  let idx = 1
  if (voiceFile) {
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
    args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo')
    filters.push(`[${idx}:a]anull[aout]`)
  } else if (audio.length === 1) {
    filters.push(`[${audio[0]}]anull[aout]`)
  } else {
    filters.push('[vo][bg]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0[aout]')
  }
  args.push('-filter_complex', filters.join(';'), '-map', '[v]', '-map', '[aout]',
    '-t', String(duration), '-r', '30', '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264', '-preset', fast ? 'ultrafast' : 'veryfast', '-crf', fast ? '30' : '23',
    '-c:a', 'aac', '-b:a', '128k', '-y', out)
  const r = await runBin(ffmpeg, args, 300_000)
  if (r.code !== 0) throw new Error('基础片段生成失败：\n' + r.stderr.slice(-800))
}

/** 16:9 封面底图：模糊底 + 完整立绘居中（竖图直接中心裁会切到眼睛）。 */
export async function make169Base({ ffmpeg, base, at, out }) {
  const filter = '[0:v]scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,gblur=sigma=30[bg];'
    + '[0:v]scale=1280:720:force_original_aspect_ratio=decrease[fg];'
    + '[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1'
  const r = await runBin(ffmpeg, ['-hide_banner', '-loglevel', 'error',
    '-ss', String(at), '-i', base, '-t', '1',
    '-filter_complex', filter,
    '-r', '30', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20',
    '-an', '-y', out], 120_000)
  if (r.code !== 0) throw new Error('16:9 封面底图生成失败：\n' + r.stderr.slice(-500))
}

export { render, makeCover }
