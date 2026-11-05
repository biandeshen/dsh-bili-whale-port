/**
 * 变化分管道（V-Now ①）——把一段视频压成「只有画面真的变了的那几帧」拼成的几张图。
 *
 * 为什么不是自己写：这套判据（HSV 逐格差 → 切点/积分/兜底三路留帧 → 档位 → DP 装箱 →
 * 拼 sheet → PNG）是 dsh-see-now（Apache-2.0，SAOS-3624）线上跑出来的东西，
 * 阈值全部带实测标定表（见 vendor/see-now/pipeline.js 的注释与 VENDORED.md）。
 * 我们原先的方案是 ffmpeg `scene` 滤镜空跑一遍 + 逐段 `-ss` 重开 ffmpeg 抽帧：
 * 两趟解码、均匀取 N 个与"哪里变了"无关，25 分钟的片子直接 ETIMEDOUT。
 *
 * 这里只补它没有的那一段：**离线读文件**。它的 capture.js 面向实时屏幕/摄像头
 * （ddagrab/gdigrab/avfoundation），文件输入这一路得自己起 ffmpeg。
 * 单管道、一趟解码、边读边判（背压在 onFrame 里，帧不在内存里堆）。
 *
 * 离线和实时默认值的三处差别（其余全部沿用上游 DEFAULTS）：
 *   ① queueDepth 0：实时是"宁可丢老画面也不给模型看 15 秒前的事"，离线丢帧等于丢素材；
 *   ② fps 2：实时 12fps 是跟手，离线只需要"别错过镜头"，一趟解码才是成本大头；
 *   ③ maxWaitSec 120 / maxFrames 12：一张图覆盖的是一段视频的 2 分钟，不是现实的 15 秒。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createPipeline, DEFAULTS, REF_SCORE } from './vendor/see-now/pipeline.js'
import { createScorer } from './vendor/see-now/cuts.js'

export { DEFAULTS, REF_SCORE, createPipeline, createScorer }

/** 上游是 JS 原样 vendor，这里不做类型重声明；契约只到本文件导出的形状为止。 */

export interface OfflineOptions {
  /** 拼图画布尺寸（也是喂给判帧管道的单帧尺寸）；默认 800x450，模型侧约 216 token/张 */
  width?: number
  height?: number
  /** 解码采样率（帧/秒）。默认 2。降到 1 更省，但 cutAbs 是逐帧分，越低越容易过线。 */
  fps?: number
  /** 一张图最多几帧 */
  maxFrames?: number
  /** 一张图最多覆盖多少秒视频 */
  maxWaitSec?: number
  /** 本次最多出几张图（超出即停管道，标 truncated） */
  maxSheets?: number
  /**
   * 视频总时长（秒）。调用方通常已经知道（B 站 view 接口就给）。
   * 给了就按它自动定"每隔多久留一帧"，让有限的几张图铺满整条片子，
   * 而不是全挤在前 7 分钟——离线看片的目的是覆盖，不是跟手。
   */
  durationSec?: number
  /** 希望整条片子留多少帧（默认 48）；只在给了 durationSec 时生效 */
  targetFrames?: number
  /** 关掉上面的自动配平，只用显式传进来的值 */
  autoTune?: boolean
  /**
   * 与上一张留下的帧差小于这个分就不留（0–255 刻度，上游默认 8）。
   *
   * 离线默认给到 **12**：小鱼看的素材里有一大类是"雨声/自然循环片"。实测一条
   * 44 分钟的叶子雨声片，按上游 8 的地板留了 49 帧 6 张图，打开 1546→2001 秒
   * 那一张，9 帧几乎一模一样——水面反光每帧都在微动，8 分挡不住，
   * 而积分一直在进账（scoreAvg 4.03 ≈ REF_SCORE 4，正好卡在"中等强度"上）。
   * 这类素材该少给画面（内容在声音和字幕里），12 分是把循环片压下来的最低有效值。
   */
  dupMin?: number
  /** 从第几秒开始读（-ss 放在 -i 前，走关键帧快定位） */
  startSec?: number
  /** 读到第几秒为止（相对视频起点） */
  endSec?: number
  /** 整趟管道墙钟上限，超时 SIGKILL ffmpeg 并返回已出的图 + truncated=true */
  timeoutMs?: number
  /** 攒够多少"中等强度秒"留一帧（上游默认 3，是给实时标定的） */
  integralSeconds?: number
  /** 画面完全静止时每隔多久兜一张（上游默认 20 秒） */
  silentFloorSec?: number
  /** ffmpeg 可执行文件；缺省由调用方传 requireFfmpeg() 的结果 */
  ffmpegPath?: string
  /**
   * 每张图落盘目录；给了才写文件，否则只在内存里返回 png。
   *
   * 曾经 here 有过一个 cutsOnly（"只留硬切帧"）开关，实测砍掉了：
   * 两条真实 B 站素材（44 分钟 / 1 分钟）跑下来 cuts 恒为 0——切点判据要
   * 同时过 cutAbs=12 与 2.5× 前后帧的尖峰比，已剪好的视频里"整幅换画面"
   * 那帧的分会被相邻帧摊薄（长片 scoreMax 只有 12.1，短片 55.1 但同样不满足尖峰）。
   * 结果 cutsOnly=true 时 44 分钟只留 1 帧（start）。留着就是个骗人的开关。
   */
  outDir?: string
  /** 落盘文件名前缀 */
  nameHint?: string
  /** 进度回调（离线长跑给用户看的） */
  onProgress?: (p: { frames: number; sheets: number; sec: number; ms: number }) => void
}

export interface FrameMark {
  /** 视频内秒 */
  t: number
  tier: number
  level: number
  /** 为什么留下这一帧：start/cut/mark/floor */
  via: string
}

export interface SheetOut {
  index: number
  fromSec: number
  toSec: number
  /** 为什么出这张：cap/time/full/crumb/floor/finish */
  why: string
  frames: FrameMark[]
  w: number
  h: number
  png: Uint8Array
  /** outDir 给了才有 */
  file?: string
}

export interface PipelineStats {
  frames: number
  kept: number
  cuts: number
  marks: number
  floors: number
  dupSkipped: number
  sheets: number
  msDecode: number
  msPipeline: number
  scoreMax: number
  scoreAvg: number
  motionPerSec: number
  overflow: number
}

export interface AnalyzeResult {
  ok: boolean
  source: { file: string; durationSec: number | null }  /** 生效的管道参数（回执里带出来，方便对账"为什么只出了 3 张"） */
  tuning: {
    width: number
    height: number
    fps: number
    maxFrames: number
    maxWaitSec: number
    integralSeconds: number
    silentFloorSec: number
    dupMin: number
    durationSec: number | null
  }
  stats: PipelineStats
  sheets: SheetOut[]
  /**
   * SUBS 字幕条版（同一批帧，只留底部字幕带竖着拼的一条）。
   * 出不来时是 undefined——它是锦上添花，不该让整趟分析失败。
   */
  subtitleStrip?: { file?: string; times: number[]; w: number; h: number; bytes: number }
  dropped: number
  truncated: boolean
  /** 截断原因：timeout / maxSheets / ffmpeg-exit / 解码错误 */
  truncatedBy?: string
  error?: string
}

const clampNum = (v: unknown, d: number, lo: number, hi: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
}

/**
 * 离线配平：把上游那套**实时**默认值换算成"整条片子摊开"的节奏。
 *
 * 上游 DEFAULTS 是按 15 秒窗口标定的（integralSeconds 3 秒、silentFloorSec 20 秒、
 * maxWaitSec 15 秒）。直接搬到 25 分钟片子上实测会挤成 8 张图只覆盖到 454 秒——
 * 离线看片要的是**覆盖**，不是跟手，所以按片长把节奏摊开：
 *
 *   cadence = 片长 / 目标留帧数   ← 平均每 cadence 秒留一帧
 *
 * 三个参数各管一段：integralSeconds 管"画面在动时多久留一帧"，
 * silentFloorSec 管"画面不动时最晚补一帧"，maxWaitSec 管"一张图最多攒多久"。
 * 显式传了任何一个，就单独关掉那一项的自动配平。
 *
 * **自动配平只往稀的方向调，不往密的方向调**：上游那几个数（3 秒 / 20 秒）是
 * 实时侧标定出来的最密可用值，短片按片长算出来的 cadence 比它还小，
 * 再照搬只会把 1 分钟的片子摊成 9 张图（实测 64 秒片 → 96 帧 9 张 ≈ 1900 token，
 * 比人一眼看完还贵）。所以 cadence 一律取 max(上游默认, cadence)。
 */
export function tuneForDuration(
  durationSec: number | null | undefined,
  targetFrames = 48,
): { integralSeconds?: number; silentFloorSec?: number; maxWaitSec?: number } {
  const d = Number(durationSec)
  if (!Number.isFinite(d) || d <= 0) return {}
  const tf = Math.min(240, Math.max(8, Math.round(targetFrames)))
  const cadence = d / tf
  return {
    integralSeconds: +Math.max(DEFAULTS.integralSeconds, cadence).toFixed(2),
    // 静止段不能比活跃段还密：兜底间隔至少等于平均节奏，再放宽 1.5 倍
    silentFloorSec: +Math.max(DEFAULTS.silentFloorSec, cadence * 1.5).toFixed(2),
    // 一张图覆盖的时长 = 节奏 × 每图帧数，夹在 30 秒～15 分钟之间
    maxWaitSec: +Math.min(900, Math.max(30, cadence * 8)).toFixed(2),
  }
}

/**
 * 离线跑一趟：ffmpeg 单管道解码 → 逐帧 push → finish 收尾 → 出 sheet。
 *
 * 只做一件事：把帧按 width*height*3 的 rgb24 喂进 createPipeline。
 * 判帧/留帧/装箱全在管道里同步跑完（上游刻意设计成背压），不另开队列。
 */
export async function analyzeVideo(
  file: string,
  opts: OfflineOptions = {},
): Promise<AnalyzeResult> {
  const width = Math.round(clampNum(opts.width, 800, 120, 1920))
  const height = Math.round(clampNum(opts.height, 450, 68, 1080))
  const fps = clampNum(opts.fps, 2, 0.2, 30)
  const maxFrames = Math.round(clampNum(opts.maxFrames, 12, 1, 40))
  const maxSheets = Math.round(clampNum(opts.maxSheets, 12, 1, 200))
  const timeoutMs = Math.round(clampNum(opts.timeoutMs, 240000, 1000, 3600000))
  const need = width * height * 3

  const auto = opts.autoTune === false ? {} : tuneForDuration(opts.durationSec, opts.targetFrames ?? 48)
  const integralSeconds = clampNum(opts.integralSeconds ?? auto.integralSeconds, DEFAULTS.integralSeconds, 0.2, 3600)
  const silentFloorSec = clampNum(opts.silentFloorSec ?? auto.silentFloorSec, DEFAULTS.silentFloorSec, 1, 7200)
  const maxWaitSec = clampNum(opts.maxWaitSec ?? auto.maxWaitSec, 120, 5, 36000)
  const dupMin = clampNum(opts.dupMin, 12, 0, 255)

  const tuning = {
    width, height, fps, maxFrames, maxWaitSec, integralSeconds, silentFloorSec, dupMin,
    durationSec: Number.isFinite(Number(opts.durationSec)) ? Number(opts.durationSec) : null,
  }
  const stub = (error: string, truncated = false, truncatedBy = ''): AnalyzeResult => ({
    ok: false,
    source: { file, durationSec: null },
    tuning,
    stats: emptyStats(),
    sheets: [],
    dropped: 0,
    truncated,
    ...(truncatedBy ? { truncatedBy } : {}),
    error,
  })

  if (!opts.ffmpegPath) return stub('没给 ffmpegPath（cap-vision 不自己找，避免把 ffmpeg 查找顺序散成两处）')
  if (!fs.existsSync(file)) return stub(`视频文件不存在：${file}`)

  const pipeline = createPipeline({
    width,
    height,
    fps,
    maxFrames,
    maxWaitSec,
    integralSeconds,
    silentFloorSec,
    dupMin,
    /** 离线绝不丢帧：实时那套 queueDepth=1 在这里等于把素材扔了 */
    queueDepth: 0,
  })

  const args: string[] = ['-hide_banner', '-v', 'error', '-nostdin']
  if (opts.startSec && opts.startSec > 0) args.push('-ss', String(opts.startSec))
  if (opts.endSec && opts.endSec > 0) args.push('-t', String(Math.max(1, opts.endSec - (opts.startSec ?? 0))))
  args.push('-i', file)
  args.push('-an', '-sn')
  // 先 fps 再 scale：降帧在前，缩放次数直接少一个数量级
  args.push('-vf', `fps=${fps},scale=${width}:${height}:flags=area`)
  args.push('-f', 'rawvideo', '-pix_fmt', 'rgb24', '-')

  const t0 = Date.now()
  let pending: Buffer | null = null
  let n = 0
  let errTail = ''
  let truncated = false
  let truncatedBy = ''
  let killed = false
  let sheetsSeen = 0
  let stopped = false

  const child = spawn(opts.ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })

  const done = new Promise<{ code: number | null; sig: string | null }>((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      if (stopped) return
      pending = pending?.length ? Buffer.concat([pending, chunk]) : chunk
      while (pending.length >= need) {
        const buf = pending.subarray(0, need)
        pending = pending.subarray(need)
        const sec = (opts.startSec ?? 0) + n / fps
        n += 1
        try {
          pipeline.push({ t: sec, buf })
        } catch (e) {
          stopped = true
          kill()
          reject(new Error(`判帧管道在第 ${n} 帧抛错：${e instanceof Error ? e.message : String(e)}`))
          return
        }
        const got = (pipeline.stats as { sheets?: number }).sheets ?? 0
        if (got > sheetsSeen) sheetsSeen = got
        if (sheetsSeen >= maxSheets) {
          // 已经够读了：提前收工，别把整条 25 分钟片子解码完
          truncated = true
          truncatedBy = 'maxSheets'
          stopped = true
          kill()
          return
        }
        if (n % 200 === 0) opts.onProgress?.({ frames: n, sheets: sheetsSeen, sec, ms: Date.now() - t0 })
      }
      if (pending.length === 0) pending = null
    })
    child.stderr.on('data', (d: Buffer) => { errTail = `${errTail}${d}`.slice(-3000) })
    child.on('error', reject)
    child.on('close', (code, sig) => resolve({ code, sig }))
  })

  const killTimer = setTimeout(() => {
    if (!stopped) {
      truncated = true
      truncatedBy = 'timeout'
      stopped = true
      kill()
    }
  }, timeoutMs)
  function kill() { killed = true; try { child.kill('SIGKILL') } catch { /* 已经没了 */ } }

  let close: { code: number | null; sig: string | null }
  try {
    close = await done
  } catch (e) {
    clearTimeout(killTimer)
    return stub(`ffmpeg 起不来：${e instanceof Error ? e.message : String(e)}`, truncated, truncatedBy)
  }
  clearTimeout(killTimer)

  // 自己 SIGKILL 的（超时/够数）是正常收尾，不是失败——上游同款判断。
  // Windows 上 kill() 走 TerminateProcess，close 给的是非零 code 而 sig 为 null，
  // 所以这里认 killed 这个标志位，不认信号。
  if (close.code !== 0 && !killed) {
    return stub(`ffmpeg 退出码 ${close.code}：${errTail.slice(-300).replace(/\s+/g, ' ')}`, truncated, truncatedBy)
  }

  let raw: Array<any> = []
  let finished: { stats?: Record<string, number> } = {}
  try {
    finished = pipeline.finish() as any
    raw = finished.sheets ?? []
  } catch (e) {
    return stub(`收尾出图抛错：${e instanceof Error ? e.message : String(e)}`, true, truncatedBy || 'finish')
  }

  if (opts.outDir) fs.mkdirSync(opts.outDir, { recursive: true })
  const hint = (opts.nameHint || path.basename(file, path.extname(file))).replace(/[^\w.-]+/g, '-')
  const sheets: SheetOut[] = raw.map((s, i) => {
    const out: SheetOut = {
      index: i + 1,
      fromSec: Number(s.from.toFixed(2)),
      toSec: Number(s.to.toFixed(2)),
      why: String(s.why),
      frames: (s.frames ?? []).map((f: any) => ({ t: Number(f.t), tier: f.tier, level: f.level, via: String(f.via) })),
      w: s.w,
      h: s.h,
      png: s.png,
    }
    if (opts.outDir) {
      const at = new Date().toISOString().replace(/[:.]/g, '-')
      out.file = path.join(opts.outDir, `${hint}-${String(i + 1).padStart(2, '0')}-${at}.png`)
      fs.writeFileSync(out.file, s.png)
    }
    return out
  })

  const rs = (finished.stats ?? {}) as Record<string, number>
  const scoreN = Math.max(1, rs.scoreN ?? 0)
  const stats: PipelineStats = {
    frames: n,
    kept: rs.kept ?? 0,
    cuts: rs.cuts ?? 0,
    marks: rs.marks ?? 0,
    floors: rs.floors ?? 0,
    dupSkipped: rs.dupSkipped ?? 0,
    sheets: sheets.length,
    msDecode: Date.now() - t0,
    msPipeline: rs.msPipeline ?? 0,
    scoreMax: +(rs.scoreMax ?? 0).toFixed(1),
    scoreAvg: +((rs.scoreSum ?? 0) / scoreN).toFixed(2),
    // 平均每秒画面变化分：与 REF_SCORE（中等强度=4/帧）对照着看这段素材有多动
    motionPerSec: +(((rs.scoreSum ?? 0) / scoreN) * fps).toFixed(2),
    overflow: rs.overflow ?? 0,
  }

  return {
    ok: true,
    source: { file, durationSec: tuning.durationSec },
    tuning,
    stats,
    sheets,
    dropped: (pipeline.dropped ?? 0) as number,
    truncated,
    ...(truncatedBy ? { truncatedBy } : {}),
  }
}

function emptyStats(): PipelineStats {
  return {
    frames: 0, kept: 0, cuts: 0, marks: 0, floors: 0, dupSkipped: 0, sheets: 0,
    msDecode: 0, msPipeline: 0, scoreMax: 0, scoreAvg: 0, motionPerSec: 0, overflow: 0,
  }
}

/**
 * 纯内存版：自己造帧（测试用，不碰 ffmpeg）。
 * 帧由 `(i) => Buffer` 给出，长度必须 width*height*3。
 */
export function analyzeFrames(
  frameCount: number,
  makeFrame: (i: number) => Buffer,
  opts: { width?: number; height?: number; fps?: number; maxFrames?: number; maxWaitSec?: number; dupMin?: number; integralSeconds?: number } = {},
): { sheets: SheetOut[]; stats: Record<string, number> } {
  const width = Math.round(clampNum(opts.width, 160, 8, 4096))
  const height = Math.round(clampNum(opts.height, 90, 8, 4096))
  const fps = clampNum(opts.fps, 2, 0.2, 30)
  const pipeline = createPipeline({
    width, height, fps, queueDepth: 0,
    maxFrames: Math.round(clampNum(opts.maxFrames, 12, 1, 40)),
    maxWaitSec: clampNum(opts.maxWaitSec, 120, 1, 3600),
    dupMin: clampNum(opts.dupMin, 12, 0, 255),
    integralSeconds: clampNum(opts.integralSeconds, DEFAULTS.integralSeconds, 0.2, 3600),
  })
  for (let i = 0; i < frameCount; i++) {
    const buf = makeFrame(i)
    if (buf.length !== width * height * 3) throw new Error(`帧 ${i} 长度 ${buf.length}，应为 ${width * height * 3}`)
    pipeline.push({ t: i / fps, buf })
  }
  const r = pipeline.finish() as any
  return {
    stats: r.stats,
    sheets: (r.sheets ?? []).map((s: any, i: number) => ({
      index: i + 1,
      fromSec: Number(s.from.toFixed(2)),
      toSec: Number(s.to.toFixed(2)),
      why: String(s.why),
      frames: (s.frames ?? []).map((f: any) => ({ t: Number(f.t), tier: f.tier, level: f.level, via: String(f.via) })),
      w: s.w, h: s.h, png: s.png,
    })),
  }
}
