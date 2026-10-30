/**
 * 封面图生成：从视频里取一帧，压上落款文字，输出图片。
 *
 * 实现方式（每一步都落成文件并校验，便于定位失败点）：
 *   1. 透明画布 + drawtext 画出文字层 PNG
 *   2. 视频取帧 → 叠文字层 → 合成 PNG
 *   3. 需要 JPG 时再转码
 *
 * 为什么用 drawtext 而不是 ASS/subtitles：
 *   实测 libass 不会在**完全透明**的画布上渲染（color=black@0.0、colorchannelmixer=aa=0
 *   与 -pix_fmt rgba 都试过，输出全是空白）。封面需要"文字层叠到画面上"，drawtext 正常。
 *
 * 为什么分步而不是一条 filter_complex 到底：
 *   多输入叠加在某些 ffmpeg 构建/调用环境下会 exit=0 但不产出文件（stderr 也为空），
 *   排查成本极高。分步后每步都有明确的产物可校验。
 *
 * 中文必须走 textfile：中文直接写进 filter 字符串会碰到转义与编码问题。
 */

import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync, copyFileSync, statSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveBinaries, run } from './ffmpeg.js'
import { probe } from './media.js'
import { resolveFontFile } from './fonts.js'

const WINDOWS_FONTS = {
  bold: 'C:\\Windows\\Fonts\\msyhbd.ttc',
  regular: 'C:\\Windows\\Fonts\\msyh.ttc',
  hei: 'C:\\Windows\\Fonts\\simhei.ttf',
}

function pickFont(name) {
  if (name && existsSync(name)) return name
  if (WINDOWS_FONTS[name]) return WINDOWS_FONTS[name]
  // 字体预设 key（yahei/hei/yuan/kai/song...）或家族名
  return resolveFontFile(name ?? 'yahei')
}

/** filter 参数里的路径：反斜杠转正斜杠，冒号转义。 */
function esc(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

export async function makeCover(spec = {}, config = {}, { signal } = {}) {
  const { ffmpeg } = resolveBinaries(config)
  if (!ffmpeg) throw new Error('找不到 ffmpeg，请设置 DSH_FFMPEG_PATH')
  if (!spec.video || !existsSync(spec.video)) throw new Error(`源视频不存在：${spec.video}`)
  if (!spec.output) throw new Error('缺少 output')
  const lines = (spec.lines ?? []).filter((l) => l && String(l).trim())
  if (lines.length === 0) throw new Error('lines 至少要有一行文字')
  if (lines.length > 4) throw new Error(`lines 最多 4 行（当前 ${lines.length}）`)

  const info = await probe(spec.video, config)
  const width = Number(spec.width) || info.width || 1280
  const height = Number(spec.height) || info.height || 720
  const at = Number.isFinite(Number(spec.at)) ? Number(spec.at) : Math.max(0, info.duration * 0.85)
  const fontPath = pickFont(spec.font ?? config.font ?? spec.fontName ?? config.fontName)
  const lineStep = Number(spec.lineStep) || Math.round(height * 0.108)
  const firstBaseline = Number(spec.firstBaseline) || Math.round(height * 0.206)

  const tag = `${process.pid}-${Date.now()}`
  const temp = []
  // 中间产物放在输出文件同目录，而不是系统临时目录：沙箱环境下 ffmpeg 子进程写系统
  // TEMP 可能被静默拒绝（exit=0、stderr 为空、文件不生成），写输出目录旁最稳。
  const outDir = dirname(spec.output)
  mkdirSync(outDir, { recursive: true })
  const workDir = join(outDir, '.vstudio-tmp')
  try { mkdirSync(workDir, { recursive: true }) } catch {}
  // 自增序号是必需的：只用 pid+时间戳做 tag 时，同一 tick 内的多次调用会得到相同的
  // 文件名，导致 text.png / line0.txt / frame.png 互相覆盖（曾因此排查很久）。
  let seq = 0
  const tmp = (suffix) => {
    seq += 1
    const p = join(workDir, `${tag}-${seq}-${suffix}`)
    temp.push(p)
    return p
  }
  const expect = (label, code, path, stderr) => {
    if (code !== 0 || !existsSync(path) || statSync(path).size === 0) {
      throw new Error(`${label}失败（exit ${code}）：${String(stderr).trim().slice(-300) || '无 stderr'}`)
    }
  }

  try {
    // ---- 1. 文字层（透明画布 + drawtext，每行一个 textfile）------------------
    const textPng = tmp('text.png')
    const drawFilters = lines.map((text, index) => {
      const tf = tmp(`line${index}.txt`)
      writeFileSync(tf, String(text), 'utf8')   // 不加 BOM：drawtext 会把 BOM 当可见字符
      const y = Math.round(height - (firstBaseline + (lines.length - 1 - index) * lineStep))
      const size = index === 0 ? Math.round(height * 0.089) : Math.round(height * 0.075)
      const color = index === 0 ? '0xFFD24A' : 'white'
      return `drawtext=fontfile='${esc(fontPath)}':textfile='${esc(tf)}':`
        + `fontsize=${size}:fontcolor=${color}:borderw=4:bordercolor=black@0.85:`
        + `shadowx=2:shadowy=2:shadowcolor=black@0.5:x=(w-text_w)/2:y=${y}`
    })

    const textStage = await run([
      ffmpeg, '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:d=1,format=rgba,colorchannelmixer=aa=0`,
      '-vf', drawFilters.join(','),
      '-frames:v', '1', '-update', '1', '-pix_fmt', 'rgba',
      '-y', textPng,
    ], { timeoutMs: 120_000, signal })
    expect('文字层渲染', textStage.code, textPng, textStage.stderr)

    // ---- 2. 取帧并叠加（分两步：先出帧，再叠文字）---------------------------
    const framePng = tmp('frame.png')
    const frameStage = await run([
      ffmpeg, '-hide_banner', '-loglevel', 'error',
      '-ss', String(at), '-i', spec.video,
      '-frames:v', '1', '-update', '1',
      '-y', framePng,
    ], { timeoutMs: 120_000, signal })
    expect('取帧', frameStage.code, framePng, frameStage.stderr)

    const composed = tmp('composed.png')
    const overlayStage = await run([
      ffmpeg, '-hide_banner', '-loglevel', 'error',
      '-i', framePng, '-i', textPng,
      '-filter_complex', '[0:v][1:v]overlay=0:0:format=auto[o]',
      '-map', '[o]', '-frames:v', '1', '-update', '1',
      '-y', composed,
    ], { timeoutMs: 120_000, signal })
    expect('叠加文字', overlayStage.code, composed, overlayStage.stderr)

    // ---- 3. 输出 -------------------------------------------------------------
    mkdirSync(dirname(spec.output), { recursive: true })
    if (/\.jpe?g$/i.test(spec.output)) {
      const jpgStage = await run([
        ffmpeg, '-hide_banner', '-loglevel', 'error',
        '-i', composed,
        // mjpeg 编码器要求全范围 YUV，否则报
        // "Non full-range YUV is non-standard, set strict_std_compliance to at most unofficial"
        '-pix_fmt', 'yuvj420p', '-q:v', '2',
        '-frames:v', '1', '-update', '1',
        '-y', spec.output,
      ], { timeoutMs: 60_000, signal })
      expect('转 JPG', jpgStage.code, spec.output, jpgStage.stderr)
    } else {
      copyFileSync(composed, spec.output)
    }

    return {
      output: spec.output,
      at,
      width,
      height,
      lines,
      bytes: readFileSync(spec.output).length,
    }
  } finally {
    for (const f of temp) {
      try { rmSync(f, { force: true }) } catch {}
    }
  }
}

/**
 * 把封面图**嵌进 MP4**（iTunes 风格的 attached_pic 附加流）。
 *
 * 为什么这么做：微信/QQ 在聊天里显示的缩略图取的是**视频第一帧**，但不少播放器和
 * 文件管理器（以及部分版本的微信"查看视频"）会读 MP4 里的 attached_pic 当封面。
 * 用户明确选了"不动片头画面、只嵌封面图"这条路，所以这里只能做到元数据层面。
 *
 * 实测要点：
 *   - 用 `-c copy` 复制原流（不重编码，秒级完成），只对附加图片流用 mjpeg；
 *   - mp4 的 attached_pic 必须是 mjpeg（png 很多播放器不认）；
 *   - `-disposition:v:1 attached_pic` 是关键，加上才会被识别为封面而不是第二路视频；
 *   - 必须再走一次 `-movflags +faststart`（copy 时 moov 默认会跑到文件尾）；
 *   - **不能原地写**（边读边写同一个文件），所以先写临时文件再 rename 覆盖。
 *
 * 在 DSH 沙箱下注意：临时文件必须放在输出同目录。写系统 TEMP 有被静默拒绝的先例。
 *
 * @returns {Promise<{video:string,image:string,duration:number,streams:number,bytes:number}>}
 */
export async function attachCover({ video, image }, config = {}, { signal } = {}) {
  const { ffmpeg, ffprobe } = resolveBinaries(config)
  if (!ffmpeg) throw new Error('找不到 ffmpeg，请设置 DSH_FFMPEG_PATH')
  if (!video || !existsSync(video)) throw new Error(`视频不存在：${video}`)
  if (!image || !existsSync(image)) throw new Error(`封面图不存在：${image}`)

  const dir = dirname(video)
  const tmpOut = join(dir, `.vstudio-cover-${process.pid}-${Date.now()}.mp4`)
  try {
    const res = await run([
      ffmpeg, '-hide_banner', '-loglevel', 'error',
      '-i', video,
      '-i', image,
      '-map', '0', '-map', '1:v',
      '-c', 'copy',
      '-c:v:1', 'mjpeg', '-pix_fmt:v:1', 'yuvj420p', '-q:v', '2',
      '-disposition:v:1', 'attached_pic',
      '-movflags', '+faststart',
      '-y', tmpOut,
    ], { timeoutMs: 300_000, signal })
    if (res.code !== 0 || !existsSync(tmpOut) || statSync(tmpOut).size === 0) {
      throw new Error(`封面嵌入失败（exit ${res.code}）：${String(res.stderr).trim().slice(-300) || '无 stderr'}`)
    }

    // 校验：必须有两路视频流，且第二路是 attached_pic；时长不能被改坏。
    let streams = 0
    if (ffprobe) {
      const info = JSON.parse((await run([ffprobe, '-v', 'error', '-show_streams', '-show_format', '-of', 'json', tmpOut], { timeoutMs: 120_000 })).stdout || '{}')
      streams = (info.streams ?? []).length
      const pic = (info.streams ?? []).find((st) => st.disposition?.attached_pic === 1)
      if (!pic) throw new Error('嵌入后没有检测到 attached_pic 流，已放弃覆盖原文件')
    }

    renameSync(tmpOut, video)
    const info = await probe(video, config)
    return { video, image, duration: info.duration, streams, bytes: statSync(video).size }
  } finally {
    try { rmSync(tmpOut, { force: true }) } catch {}
  }
}
