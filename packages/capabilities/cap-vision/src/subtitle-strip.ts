/**
 * SUBS 字幕条版 —— 同一批帧，换一种拼法：只留画面底部的字幕带，竖着拼成一长条。
 *
 * 为什么要有这个（2026-10-14 实测得出的结论，旧 CLI 一直留着它没搬过来）：
 *   她看的素材里有一大类是**讲解型**视频——信息全在字幕里，画面只是配图。
 *   全画幅九宫格会把字幕压到看不清（每格 800 宽再切三列，字幕只有几十像素高）；
 *   同样预算下只留字幕带，9 条字幕能全部读清。
 *
 * 做法（照旧 CLI `tools/commands/bili-watch.mjs` 那份验过的 ffmpeg 形状）：
 *   crop=iw:ih*0.17:0:ih*0.83   ← 只取底部 17%（字幕带）
 *   scale=1280:-1                ← 放大到 1280 宽，字幕才读得清
 *   tile=1xN                     ← 竖着拼 N 条
 *
 * **帧是同一批**（用变化分管道留下的那些时间点），不是重新抽一遍——
 * 重新抽帧要多解一遍码，那是最贵的一步。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface SubtitleStripOptions {
  /** 视频路径 */
  file: string
  /** 要用的时间点（秒）；来自变化分管道留下的帧 */
  times: number[]
  /** ffmpeg 可执行文件 */
  ffmpegPath: string
  /** 落盘目录；不给就只在内存里返回 */
  outDir?: string
  /** 落盘文件名前缀 */
  nameHint?: string
  /** 字幕带占画面高度的比例（默认 0.17，旧 CLI 验过的值） */
  bandRatio?: number
  /** 放大到的宽度（默认 1280） */
  scaleWidth?: number
  /** 最多拼几条（默认 9，与旧 CLI 一致） */
  maxRows?: number
}

export interface SubtitleStripResult {
  ok: boolean
  /** 拼好的 png（没给 outDir 时只在内存里） */
  png?: Uint8Array
  /** 落盘路径（给了 outDir 才有） */
  file?: string
  /** 用了哪几个时间点 */
  times: number[]
  error?: string
}

/**
 * 拼一条字幕带。
 *
 * **失败不抛**：字幕条是"锦上添花"的一张图——出不来时画面版还在，
 * 不该因为它把整趟分析带崩（旧 CLI 也是这么处理的：「字幕条版生成失败，忽略」）。
 */
export async function buildSubtitleStrip(opts: SubtitleStripOptions): Promise<SubtitleStripResult> {
  const times = (opts.times ?? [])
    .filter((t) => Number.isFinite(t) && t >= 0)
    .slice(0, Math.max(1, opts.maxRows ?? 9))
  if (!times.length) return { ok: false, times: [], error: '没有可用的时间点' }
  if (!opts.ffmpegPath) return { ok: false, times, error: '找不到 ffmpeg' }
  if (!fs.existsSync(opts.file)) return { ok: false, times, error: `视频不在了：${opts.file}` }

  const band = Math.max(0.05, Math.min(0.6, opts.bandRatio ?? 0.17))
  const width = Math.max(320, Math.min(1920, opts.scaleWidth ?? 1280))
  const rows = times.length

  // 逐帧按时间点抽（`-ss` 放在 `-i` 前，走关键帧快定位），再统一裁字幕带 + 放大 + 竖拼。
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), '.subs-'))
  try {
    for (const [i, t] of times.entries()) {
      await runFfmpeg(opts.ffmpegPath, [
        '-y', '-loglevel', 'error',
        '-ss', t.toFixed(2),
        '-i', opts.file,
        '-frames:v', '1',
        path.join(tmp, `s${String(i).padStart(2, '0')}.png`),
      ])
    }
    const inputs: string[] = []
    for (const [i] of times.entries()) {
      inputs.push('-i', path.join(tmp, `s${String(i).padStart(2, '0')}.png`))
    }
    /**
     * 拼法：**image2 序列**（`-i s%02d.png`）把所有帧喂进**一个**输入，再 tile。
     *
     * 为什么不是 N 个 `-i` 再连起来：`tile` 滤镜只吃**一条**流
     * （实测报 "More input link labels specified for filter 'tile' than it has inputs: 3 > 1"）。
     * image2 序列正是旧 CLI `tools/commands/bili-watch.mjs` 用的形状（`-i f%02d.jpg`），
     * 那是验过的。
     */
    const out = path.join(tmp, 'strip.png')
    await runFfmpeg(opts.ffmpegPath, [
      '-y', '-loglevel', 'error',
      '-i', path.join(tmp, 's%02d.png'),
      '-vf', `crop=iw:ih*${band}:0:ih*${1 - band},scale=${width}:-1,tile=1x${rows}`,
      '-frames:v', '1',
      out,
    ])
    if (!fs.existsSync(out)) return { ok: false, times, error: '字幕带没生成' }
    const bytes = fs.readFileSync(out)
    let file: string | undefined
    if (opts.outDir) {
      fs.mkdirSync(opts.outDir, { recursive: true })
      const hint = (opts.nameHint || path.basename(opts.file, path.extname(opts.file))).replace(/[^\w.-]+/g, '-')
      file = path.join(opts.outDir, `${hint}-subs-${Date.now()}.png`)
      fs.writeFileSync(file, bytes)
    }
    return { ok: true, png: new Uint8Array(bytes), ...(file ? { file } : {}), times }
  } catch (e: any) {
    return { ok: false, times, error: `字幕条生成失败：${String(e?.message ?? e)}` }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* 临时目录清不掉就算了 */ }
  }
}

/** 跑一次 ffmpeg；失败抛（由调用方决定要不要吞）。 */
function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    c.stderr.on('data', (d) => { err += String(d) })
    c.on('error', reject)
    c.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-400) || `ffmpeg 退出码 ${code}`))))
  })
}
