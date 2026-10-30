/**
 * 渲染器：按剪辑方案生成成片。
 *
 * 这个模块把本项目实测踩过的所有坑固化下来，改动前请先读注释：
 *
 * 1. xfade 要求两端时间基一致 —— 每段必须先各自 scale/fps 归一化再进 xfade，
 *    否则报 "First input link main timebase (1/600) do not match ... (1/30)"。
 * 2. xfade 会把输出补到较长输入的长度，而 acrossfade 不会 —— 两条链长度不一致时
 *    容器时长会由较短的音频决定，画面（含定格帧）会被静默截短。所以：
 *    视频链和音频链**分开搭**，音频最后统一 apad + 输出级 -t 精确截断。
 * 3. 减速段的音频会跟着变长（-t 10 解码 + 0.5 倍速 = 视频 20s、音频也 20s）。
 *    所以音频要 atrim 同样的源窗口后再 atempo，否则容器时长被拖长。
 * 4. fade 的计时从段首算。若在段内做 fade，会连定格帧一起吃掉。淡出统一放在
 *    整条链的末尾，按"成片总时长 - 淡出"倒推。
 * 5. 每段都补 tpad，最后用输出级 -t 精确截断。宁可多补再截，也不要少补导致末段没画面。
 * 6. 只有起始时间 + duration 的 trim 是**从 start 算起**的；早期版本给减速段写
 *    `trim=duration=X` 漏了 `start=`，等于从 0 秒开始截——已修，别再漏。
 *
 * v0.2 的结构变化（针对"每次都是慢动作收尾"的反馈）：
 *   - 时间轴改成一串 clip 链：片头封面卡（可选）→ 时间轴片段 → 落款卡（可选）。
 *     片间转场统一在链上做，音频链只覆盖真实片段，靠 adelay/apad 对齐。
 *   - 慢动作从中移除"末段默认减速"，改成**逐段** speed/freeze，用来在片中做强调。
 *   - 收尾方式变成 ending 选项，默认不再慢动作。
 */

import { mkdirSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveBinaries, run } from './ffmpeg.js'
import { probe } from './media.js'
import { writeAss, layoutCues, buildCardText, KNOWN_ANIMATIONS } from './subtitles.js'
import { resolveFontFamily, resolveFontFile } from './fonts.js'
import { attachCover } from './cover.js'

const DEFAULTS = {
  width: 1280,
  height: 720,
  fps: 30,
  crf: 20,
  preset: 'medium',
  transition: 0.6,
  exactDuration: undefined,

  // 收尾：card（深色落款卡）| freeze（末帧定格压字）| slowmo（末段慢动作）| fade | none
  ending: 'fade',
  endingCardSeconds: 2.6,
  endingCardFade: 0.5,
  endingCardLines: [],
  endingFreezeSeconds: 2.4,
  fadeBlackSeconds: 0.8,
  fadeOut: undefined,
  fadeInSeconds: 0,
  fadeColor: '0x0a100e',

  // 片头封面卡（可选；微信封面兜底方案）
  coverCard: undefined,

  musicGain: 0.4,
  musicStart: 30,
  musicFadeOut: 0.9,
  loudnessLufs: -14,

  // 文字
  font: 'yahei',
  animate: 'fade',
  textStart: 0.4,
  look: 'none',

  // 额外的 ASS 字幕文件，渲染时叠在正片自带的文字之上（可选）。
  // 用途：需要精确控制行距/字号/锚点的场合，例如落款卡的两行文字不想用
  // buildCardText 的 \N 行距（大字首行 + 小字次行会贴在一起）。
  // 由调用方自己生成 ASS（可用 subtitles.js 的 buildAss），本参数只负责叠加。
  extraAss: undefined,

  cover: undefined,
}

/**
 * 调色预设。素材偏灰偏暗时很有效，但不能滥用：足球场本身饱和度高，
 * vivid 再拉饱和会糊成一团，所以默认 none，由用户在方案里选。
 */
const LOOKS = {
  none: '',
  bright: 'eq=brightness=0.035:contrast=1.06:saturation=1.08',
  vivid: 'eq=brightness=0.02:contrast=1.10:saturation=1.22,unsharp=5:5:0.5:5:5:0',
  warm: 'eq=contrast=1.05:saturation=1.14,colorbalance=rs=0.05:gs=0.01:bs=-0.05',
  cool: 'eq=contrast=1.06:saturation=1.10,colorbalance=rs=-0.04:gs=0:bs=0.05',
  soft: 'eq=brightness=0.03:contrast=0.97:saturation=1.06,gblur=sigma=0.35',
}

const ENDINGS = ['card', 'freeze', 'slowmo', 'fade', 'none']

/**
 * 可用的 xfade 转场（从 ffmpeg 的 xfade 文档里挑出来、在本项目环境实测可用的）。
 * 没做全量列举：像 `hlslice`/`vuslice` 这类切片转场在 720p 上观感很碎，不如不给。
 */
const XFADE_TRANSITIONS = new Set([
  'fade', 'dissolve', 'fadeblack', 'fadewhite', 'fadegrays',
  'wipeleft', 'wiperight', 'wipeup', 'wipedown',
  'slideleft', 'slideright', 'slideup', 'slidedown',
  'smoothleft', 'smoothright', 'smoothup', 'smoothdown',
  'circleopen', 'circleclose', 'circlecrop', 'rectcrop',
  'radial', 'vertopen', 'vertclose', 'horzopen', 'horzclose',
  'pixelize', 'distance', 'squeezev', 'squeezeh', 'zoomin',
])

/** ffmpeg filter 里路径需转义：反斜杠转正斜杠、冒号转义。 */
function escapeFilterPath(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")
}

const round3 = (n) => Math.round(Number(n) * 1000) / 1000

function normalizeSegments(raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('segments 至少要有一段')
  if (raw.length > 8) throw new Error(`segments 最多 8 段（当前 ${raw.length}）`)
  return raw.map((s, i) => {
    const input = s.input ?? s.path ?? s.file
    if (!input) throw new Error(`第 ${i + 1} 段缺少 input`)
    if (!existsSync(input)) throw new Error(`第 ${i + 1} 段文件不存在：${input}`)
    const start = Number(s.start ?? 0)
    const end = Number(s.end)
    if (!Number.isFinite(end) || end <= start) {
      throw new Error(`第 ${i + 1} 段的 end 必须大于 start（start=${start}, end=${s.end}）`)
    }
    const speed = Number(s.speed)
    const freeze = Number(s.freeze)
    return {
      input,
      start,
      end,
      duration: round3(end - start),
      speed: Number.isFinite(speed) && speed > 0 ? speed : 1,
      freeze: Number.isFinite(freeze) && freeze > 0 ? freeze : 0,
      look: s.look,
      note: s.note,
    }
  })
}

/** 时间轴上每个 clip 的占位长度。 */
const clipLength = (seg) => round3(seg.duration / seg.speed + seg.freeze)

/**
 * 校验每段的起止点是否落在源视频长度之内。
 *
 * 为什么必须有这一步（不是可选的健壮性装饰）：
 * 早期版本的减速段写成 `trim=duration=X` 漏了 `start=`，等于永远从 0 秒开始截，
 * 于是一个"start 超出源视频长度"的错误方案**也能渲染成功**（只是内容不对）。
 * 修掉那个 bug 之后，这类方案会得到一段空画面，最终表现为含糊的"画面帧数不足"。
 * 所以这里在渲染前就点名报错，把"哪个文件、多长、你要的是哪一段"讲清楚。
 */
async function validateSegmentRanges(segments, config, warnings) {
  const cache = new Map()
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (!cache.has(seg.input)) {
      try { cache.set(seg.input, await probe(seg.input, config)) } catch { cache.set(seg.input, null) }
    }
    const info = cache.get(seg.input)
    if (!info || !Number.isFinite(info.duration) || info.duration <= 0) continue
    const name = basename(seg.input)
    if (seg.start >= info.duration - 0.05) {
      throw new Error(
        `第 ${i + 1} 段：${name} 只有 ${info.duration.toFixed(2)}s，但你要求从 ${seg.start}s 开始切——这一段会是空的。`
        + `请把 start 改到 0 ~ ${Math.max(0, info.duration - 1).toFixed(1)}s 之间（或换一个更长的素材）。`,
      )
    }
    if (seg.end > info.duration + 0.05) {
      warnings.push(`第 ${i + 1} 段：${name} 只有 ${info.duration.toFixed(2)}s，end=${seg.end}s 超出片尾，已按 ${info.duration.toFixed(2)}s 处理`)
      segments[i].end = round3(info.duration)
      segments[i].duration = round3(info.duration - seg.start)
    }
  }
}

/**
 * 渲染成片。
 *
 * planOnly=true 时**不渲染**，只把算好的时间轴/文案/落款窗口返回，
 * 供 agent 拿给用户确认（这是"先问再做"的落地手段：方案是精确的，不是口头描述）。
 *
 * @param {object} spec 见 README「剪辑方案」一节
 * @returns {Promise<object>}
 */
export async function render(spec = {}, config = {}, { signal, onProgress } = {}) {
  const s = { ...DEFAULTS, ...spec }
  const warnings = []
  const planOnly = Boolean(s.planOnly)

  const ending = String(s.ending ?? 'fade').toLowerCase()
  if (!ENDINGS.includes(ending)) {
    throw new Error(`ending 只能是 ${ENDINGS.join(' / ')} 之一（收到 "${s.ending}"）`)
  }
  const animate = String(s.animate ?? 'fade').toLowerCase()
  if (!KNOWN_ANIMATIONS.includes(animate)) {
    throw new Error(`animate 只能是 ${KNOWN_ANIMATIONS.join(' / ')} 之一（收到 "${s.animate}"）`)
  }

  const segments = normalizeSegments(s.segments)
  // 起止点必须先校验：start 超出源视频长度会得到空画面，而报出来的错会含糊得多
  await validateSegmentRanges(segments, config, warnings)
  const n = segments.length
  const transition = Math.max(0, Number(s.transition))
  const width = Number(s.width) || 1280
  const height = Number(s.height) || 720
  const fps = Number(s.fps) || 30

  // ---- 兼容旧的 finalSpeed / freezeSeconds：只作用在末段，并提示迁移 --------------
  if (spec.finalSpeed !== undefined && Number(spec.finalSpeed) !== 1) {
    segments[n - 1].speed = Number(spec.finalSpeed)
    warnings.push('finalSpeed 已废弃（它正是"每次都用慢动作收尾"的来源），本次仍按末段减速处理；请改用 segments[].speed 在片中做强调')
  }
  if (spec.freezeSeconds !== undefined && Number(spec.freezeSeconds) > 0) {
    segments[n - 1].freeze += Number(spec.freezeSeconds)
    warnings.push('freezeSeconds 已废弃，本次仍按末段定格处理；请改用 segments[].freeze')
  }
  if (ending === 'slowmo' && segments[n - 1].speed === 1) {
    const sp = Number(s.endingSlowmoSpeed) || 0.5
    segments[n - 1].speed = sp
  }
  if (ending === 'freeze') {
    segments[n - 1].freeze += Math.max(0, Number(s.endingFreezeSeconds) || 0)
  }

  const durations = segments.map(clipLength)
  const segChainLen = round3(durations.reduce((a, b) => a + b, 0) - (n - 1) * transition)

  // ---- 片头封面卡（可选）------------------------------------------------------
  let coverCard = null
  if (s.coverCard && (s.coverCard.from?.input || s.coverCard.input)) {
    const src = s.coverCard.from ?? s.coverCard
    const input = src.input
    if (!existsSync(input)) throw new Error(`封面卡取帧的源视频不存在：${input}`)
    const at = Number.isFinite(Number(src.at)) ? Number(src.at) : 0
    const seconds = Math.max(0.6, Number(s.coverCard.seconds) || 1.2)
    const fade = Math.min(Number(s.coverCard.fade ?? 0.45) || 0.45, seconds / 2)
    const lines = (s.coverCard.lines ?? []).filter((l) => l && String(l).trim())
    if (lines.length === 0) warnings.push('给了 coverCard 但没给 coverCard.lines，封面卡将只有画面没有文字')
    coverCard = { input, at, seconds, fade, lines }
  }

  // ---- 片尾落款 ---------------------------------------------------------------
  // 两种收尾都需要"落款文字"，但载体不同：
  //   card   → 印在深色卡上（无描边即可读）
  //   freeze → 印在**定格的那一帧实拍画面**上，必须有底板/描边，否则压在草地上读不出来
  // 所以两种各有自己的文字参数，freeze 允许直接复用 endingCardLines（省事）。
  const cardLines = (s.endingCardLines ?? []).filter((l) => l && String(l).trim())
  let freezeLines = (s.endingFreezeLines ?? []).filter((l) => l && String(l).trim())
  let effectiveEnding = ending
  if (ending === 'card' && cardLines.length === 0) {
    effectiveEnding = 'fade'
    warnings.push('ending=card 但没有给 endingCardLines（落款卡文字），已退化为 fade。落款卡至少要有机构名一行。')
  }
  if (ending !== 'card' && ending !== 'freeze' && cardLines.length > 0) {
    warnings.push(`给了 endingCardLines 但 ending=${ending}，这些文字不会显示。要落款卡请把 ending 设为 "card"。`)
  }
  if (ending === 'freeze' && freezeLines.length === 0) freezeLines = cardLines
  if (ending === 'freeze' && freezeLines.length === 0) {
    warnings.push('ending=freeze 但没有给 endingFreezeLines（也没给 endingCardLines），定格帧上不会有落款文字。')
  }
  const lastFreeze = round3(segments[n - 1].freeze)
  const cardSec = effectiveEnding === 'card' ? Math.max(1, Number(s.endingCardSeconds) || 2.6) : 0
  const cardFade = cardSec > 0 ? Math.min(Math.max(0.2, Number(s.endingCardFade) || 0.5), cardSec / 2) : 0

  // ---- 时间轴 ----------------------------------------------------------------
  const coverLead = coverCard ? round3(coverCard.seconds - coverCard.fade) : 0
  const bodyStart = coverLead
  const bodyEnd = round3(bodyStart + segChainLen)
  const contentLength = round3(bodyEnd + (cardSec > 0 ? cardSec - cardFade : 0))
  const exact = Number.isFinite(Number(s.exactDuration)) && Number(s.exactDuration) > 0
    ? Number(s.exactDuration)
    : round3(Math.max(3, contentLength))
  if (exact < contentLength - 0.05) {
    // 截断是合法操作（多给素材再截到目标时长），所以只警告不报错；但要说清楚
    // 尾部可能丢掉什么——实测最容易丢的正是"慢动作 + 定格 + 落款卡"这些收尾设计。
    const lost = round3(contentLength - exact)
    const atRisk = []
    if (segments.some((seg) => seg.speed !== 1)) atRisk.push('慢动作段')
    if (segments.some((seg) => seg.freeze > 0)) atRisk.push('定格')
    if (cardSec > 0) atRisk.push('落款卡')
    warnings.push(`exactDuration=${exact}s 短于内容长度 ${contentLength}s，尾部约 ${lost}s 会被截断`
      + (atRisk.length ? `，可能丢掉：${atRisk.join('、')}` : '')
      + '。有意只取前段可以忽略；否则请缩短片段或加大 exactDuration。')
  }
  // 落款卡之后如果还有一大段（exactDuration 给多了），画面会停在落款卡上不动，
  // 观感很拖。这是实测出来的：24s 目标 + 20.1s 内容 = 落款卡定格 6.2 秒。
  if (cardSec > 0 && exact > bodyEnd + cardSec + 0.4) {
    warnings.push(`exactDuration=${exact}s 比内容长，落款卡之后还会有约 ${round3(exact - bodyEnd - cardSec)}s 静止的落款卡画面，观感会拖。`
      + `建议把 exactDuration 设为 ${contentLength}s 左右，或加长片段。`)
  }

  const fontFamily = resolveFontFamily(s.font ?? s.fontName)

  // ---- 文字 cue ---------------------------------------------------------------
  const cues = []
  if (Array.isArray(s.cues) && s.cues.length > 0) {
    cues.push(...s.cues)
  } else if (Array.isArray(s.textLines) && s.textLines.length > 0) {
    // 正文不能铺到收尾区里去：落款卡会盖掉它，定格帧也要留给落款。
    const textWindowEnd = round3(bodyEnd - (cardFade > 0 ? cardFade : 0) - (effectiveEnding === 'freeze' ? lastFreeze : 0))
    const textWindowStart = round3(bodyStart + (Number(s.textStart) || 0))
    if (textWindowEnd - textWindowStart < 1.2) {
      warnings.push('正文可用的时间窗太短（不足 1.2s），已跳过正文文字')
    } else {
      cues.push(...layoutCues({
        lines: s.textLines,
        start: textWindowStart,
        duration: textWindowEnd,
        tailStyle: s.tailStyle,
        animate,
      }))
    }
  }
  if (coverCard && coverCard.lines.length > 0) {
    cues.push({
      start: 0.15,
      end: round3(Math.max(0.8, coverCard.seconds - coverCard.fade * 0.5)),
      style: 'CC',
      text: buildCardText({ lines: coverCard.lines, width }),
      animate: 'fade',
    })
  }
  if (cardSec > 0) {
    cues.push({
      start: round3(bodyEnd + 0.06),
      end: round3(Math.max(bodyEnd + 0.7, exact - 0.06)),
      style: 'E',
      text: buildCardText({ lines: cardLines, width, firstRatio: 0.055, restRatio: 0.028 }),
      animate: 'fade',
    })
  }
  // 定格帧上的落款：用带半透明底板的 CC 样式（底下是实拍画面，没有底板读不清）
  const freezeStart = round3(bodyEnd - lastFreeze)
  if (effectiveEnding === 'freeze' && lastFreeze > 0 && freezeLines.length > 0) {
    cues.push({
      start: round3(freezeStart + 0.15),
      end: round3(Math.max(freezeStart + 0.9, exact - 0.08)),
      style: 'CC',
      text: buildCardText({ lines: freezeLines, width }),
      animate: 'fade',
    })
  }

  // ---- 组装 clip 链 -----------------------------------------------------------
  // 每段之间可以用不同的转场：transitions 只给一个则全部复用，给了 N 个按边界取。
  const transitions = Array.isArray(s.transitions) && s.transitions.length > 0
    ? s.transitions
    : [s.transitions ?? 'fade']
  const boundaryKind = (i) => {
    const kind = transitions.length === 1 ? transitions[0] : transitions[Math.min(i, transitions.length - 1)]
    if (!XFADE_TRANSITIONS.has(kind)) {
      throw new Error(`不支持的转场 "${kind}"。可用：${[...XFADE_TRANSITIONS].join(' / ')}`)
    }
    return kind
  }
  const chain = []
  if (coverCard) chain.push({ kind: 'coverCard', label: 'vncc', dur: coverCard.seconds, fade: coverCard.fade, xfade: 'fade', index: -1 })
  for (let i = 0; i < n; i++) {
    chain.push({
      kind: 'segment', label: `vn${i}`, dur: durations[i],
      fade: i === 0 ? (coverCard ? coverCard.fade : 0) : transition,
      xfade: i === 0 ? 'fade' : boundaryKind(i - 1),
      index: i,
    })
  }
  if (cardSec > 0) chain.push({ kind: 'endCard', label: 'vnec', dur: cardSec, fade: cardFade, xfade: 'fade', index: -1 })
  const transitionKinds = chain.slice(1).map((c) => c.xfade)

  const plan = {
    width, height, fps,
    ending: effectiveEnding,
    endingRequested: ending,
    font: { preset: s.font, family: fontFamily, file: resolveFontFile(s.font) },
    animate,
    look: s.look,
    transition,
    transitionKinds,
    exactDuration: exact,
    contentLength,
    coverCard: coverCard
      ? { input: coverCard.input, at: coverCard.at, seconds: coverCard.seconds, fade: coverCard.fade, lines: coverCard.lines, window: [coverLead, coverCard.seconds] }
      : undefined,
    endCard: cardSec > 0 ? { seconds: cardSec, fade: cardFade, lines: cardLines, window: [round3(bodyEnd - cardFade), round3(bodyEnd - cardFade + cardSec)] } : undefined,
    freezeCard: (effectiveEnding === 'freeze' && lastFreeze > 0)
      ? { seconds: lastFreeze, lines: freezeLines, window: [freezeStart, bodyEnd] }
      : undefined,
    segments: segments.map((seg, i) => {
      const from = round3(bodyStart + durations.slice(0, i).reduce((a, b) => a + b, 0) - i * transition)
      return {
        index: i, input: seg.input, start: seg.start, end: seg.end,
        speed: seg.speed, freeze: seg.freeze, look: seg.look ?? s.look,
        timeline: [from, round3(from + durations[i])],
        clipLength: durations[i], note: seg.note,
      }
    }),
    // 给人看的方案要去掉 ASS 内联标签（{\fs67\c...}），否则落款那一行全是花括号
    cues: cues.map((c) => ({
      start: c.start,
      end: c.end,
      style: c.style ?? 'D',
      text: String(c.text).replace(/\{[^}]*\}/g, '').replace(/\\N/g, ' / '),
    })),
    estimatedFrames: Math.floor(exact * fps),
  }

  if (planOnly) {
    return { ...plan, planOnly: true, output: s.output ?? null, warnings }
  }

  // ============================ 真正渲染 =====================================
  const { ffmpeg, ffprobe } = resolveBinaries(config)
  if (!ffmpeg) throw new Error('找不到 ffmpeg。请安装（winget install Gyan.FFmpeg）或设置 DSH_FFMPEG_PATH')
  if (!ffprobe) throw new Error('找不到 ffprobe。请安装 ffmpeg 全套或设置 DSH_FFPROBE_PATH')
  if (!s.output) throw new Error('缺少 output（输出文件路径）')

  const assPath = join(tmpdir(), `dsh-video-studio-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.ass`)
  const cleanup = []
  if (cues.length > 0) {
    writeAss(assPath, { width, height, fontName: fontFamily, cues })
    cleanup.push(assPath)
  }
  // 额外的 ASS 叠层（调用方生成，例如自定义行距的落款卡）
  const extraAssPath = s.extraAss && existsSync(s.extraAss) ? s.extraAss : undefined
  if (s.extraAss && !extraAssPath) warnings.push(`extraAss 文件不存在，已忽略：${s.extraAss}`)

  // 封面卡要先抽一帧出来当静止输入
  let coverCardImage
  if (coverCard) {
    const img = join(tmpdir(), `dsh-video-studio-cover-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.png`)
    const grab = await run([
      ffmpeg, '-hide_banner', '-loglevel', 'error',
      '-ss', String(coverCard.at), '-i', coverCard.input,
      '-frames:v', '1', '-update', '1', '-y', img,
    ], { timeoutMs: 120_000, signal })
    if (grab.code !== 0 || !existsSync(img)) {
      throw new Error(`封面卡取帧失败（exit ${grab.code}）：${grab.stderr.trim().slice(-300)}`)
    }
    coverCardImage = img
    cleanup.push(img)
  }

  const parts = []

  // ---- 各段的视频/音频预处理 --------------------------------------------------
  for (let i = 0; i < n; i++) {
    const seg = segments[i]
    const look = LOOKS[seg.look ?? s.look]
    if (look === undefined) throw new Error(`未知的 look：${seg.look ?? s.look}（可选 ${Object.keys(LOOKS).join('/')}）`)
    // 坑 6：trim 的 duration 从 start 算起，start 不能漏
    parts.push(`[${i}:v]trim=start=${seg.start}:duration=${seg.duration},setpts=(PTS-STARTPTS)/${seg.speed}[lv${i}]`)
    if (seg.freeze > 0) parts.push(`[lv${i}]tpad=stop_mode=clone:stop_duration=${seg.freeze}[fv${i}]`)
    else parts.push(`[lv${i}]null[fv${i}]`)
    parts.push(`[fv${i}]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}${look ? `,${look}` : ''}[vn${i}]`)
    parts.push(`[${i}:a]atrim=start=${seg.start}:duration=${seg.duration},asetpts=PTS-STARTPTS,atempo=${seg.speed}[a${i}]`)
  }

  // ---- 追加输入：封面卡静帧 / 落款卡色块 / 配乐 ---------------------------------
  let nextIndex = n
  let coverCardIndex = -1
  let endCardIndex = -1
  let musicIndex = -1
  const extraInputs = []
  if (coverCard) {
    coverCardIndex = nextIndex++
    extraInputs.push(['-loop', '1', '-framerate', String(fps), '-t', String(coverCard.seconds), '-i', coverCardImage])
    parts.push(`[${coverCardIndex}:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=${fps},format=yuv420p[vncc]`)
  }
  if (cardSec > 0) {
    endCardIndex = nextIndex++
    extraInputs.push(['-f', 'lavfi', '-t', String(cardSec), '-i', `color=c=${s.fadeColor}:s=${width}x${height}:r=${fps}`])
    parts.push(`[${endCardIndex}:v]setsar=1,fps=${fps},format=yuv420p[vnec]`)
  }
  const music = s.music && existsSync(s.music) ? s.music : undefined
  if (s.music && !music) warnings.push(`配乐文件不存在，已忽略：${s.music}`)
  if (music) {
    musicIndex = nextIndex++
    extraInputs.push(['-ss', String(s.musicStart ?? 30), '-i', music])
  }

  // ---- 视频链：按 clip 顺序 xfade ---------------------------------------------
  let vout = chain[0].label
  let offset = 0
  for (let i = 1; i < chain.length; i++) {
    offset = round3(offset + chain[i - 1].dur - chain[i].fade)
    const nv = `vxc${i}`
    parts.push(`[${vout}][${chain[i].label}]xfade=transition=${chain[i].xfade}:duration=${chain[i].fade}:offset=${offset}[${nv}]`)
    vout = nv
  }

  // ---- 收尾：精确时长 + 淡入淡出 + 文字 ---------------------------------------
  const applyFadeOut = s.fadeOut === undefined
    ? (effectiveEnding === 'fade' && Number(s.fadeBlackSeconds) > 0)
    : Boolean(s.fadeOut)
  const fadeFilters = []
  if (Number(s.fadeInSeconds) > 0 && !coverCard) {
    fadeFilters.push(`fade=t=in:st=0:d=${Number(s.fadeInSeconds)}`)
  } else if (Number(s.fadeInSeconds) > 0 && coverCard) {
    warnings.push('用了片头封面卡，已忽略 fadeInSeconds（淡入会让首帧变黑，微信抓封面就抓到黑图）')
  }
  if (applyFadeOut) {
    fadeFilters.push(`fade=t=out:st=${round3(Math.max(0, exact - Number(s.fadeBlackSeconds)))}:d=${Number(s.fadeBlackSeconds)}:color=${s.fadeColor}`)
  }
  const padNeeded = round3(Math.max(0, exact - contentLength) + 4)
  parts.push(`[${vout}]trim=start=0:duration=${exact},setpts=PTS-STARTPTS${fadeFilters.length ? `,${fadeFilters.join(',')}` : ''},tpad=stop_mode=clone:stop_duration=${padNeeded},format=yuv420p[vfin]`)
  parts.push(cues.length > 0 ? `[vfin]ass='${escapeFilterPath(assPath)}'[vsub]` : '[vfin]null[vsub]')
  if (extraAssPath) {
    parts.push(`[vsub]ass='${escapeFilterPath(extraAssPath)}'[vsub2]`)
    parts.push('[vsub2]null[vsubx]')
  }

  // ---- 音频链（只覆盖真实片段；片头卡用 adelay 对齐，片尾卡靠 apad 补静音）-----
  let aout = 'a0'
  for (let i = 0; i < n - 1; i++) {
    const na = `ax${i + 1}`
    parts.push(`[${aout}][a${i + 1}]acrossfade=d=${transition}:c1=tri:c2=tri[${na}]`)
    aout = na
  }
  const lead = coverCard ? Math.round(coverLead * 1000) : 0
  const pad2 = `${lead > 0 ? `adelay=${lead}:all=1,` : ''}apad,atrim=start=0:duration=${exact},asetpts=PTS-STARTPTS`
  if (music) {
    parts.push(`[${aout}]${pad2},volume=1.0[oa]`)
    parts.push(`[${musicIndex}:a]volume=${Number(s.musicGain)},aformat=sample_rates=48000:channel_layouts=stereo[bg]`)
    parts.push('[oa][bg]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mx]')
    parts.push(`[mx]loudnorm=I=${Number(s.loudnessLufs)}:TP=-1.5:LRA=11[ln]`)
    parts.push(`[ln]afade=t=in:st=0:d=0.45,afade=t=out:st=${round3(Math.max(0, exact - Number(s.musicFadeOut)))}:d=${Number(s.musicFadeOut)},alimiter=limit=0.95[aoutf]`)
  } else {
    parts.push(`[${aout}]${pad2}[aoutf]`)
  }

  // ---- argv ------------------------------------------------------------------
  const argv = [ffmpeg, '-hide_banner', '-loglevel', 'error']
  for (const seg of segments) argv.push('-i', seg.input)
  for (const extra of extraInputs) argv.push(...extra)
  argv.push(
    '-filter_complex', parts.join(';'),
    '-map', extraAssPath ? '[vsubx]' : '[vsub]', '-map', '[aoutf]',
    '-c:v', 'libx264', '-preset', s.preset, '-crf', String(s.crf), '-pix_fmt', 'yuv420p',
    '-profile:v', 'high', '-level', '4.1',
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    '-t', String(exact),
    '-movflags', '+faststart',
    '-nostats',
    '-y', s.output,
  )

  mkdirSync(dirname(s.output), { recursive: true })
  onProgress?.(`渲染：${n} 段 / 内容 ${contentLength}s → 目标 ${exact}s / 转场 ${transition}s / 收尾 ${effectiveEnding}${music ? ' / 含配乐' : ''}`)

  try {
    const result = await run(argv, { timeoutMs: Number(config.timeoutMs ?? 30 * 60_000), signal })
    if (result.code !== 0) {
      throw new Error(`ffmpeg 渲染失败（exit ${result.code}）：${result.stderr.trim().slice(-600)}`)
    }
    if (!existsSync(s.output)) throw new Error('ffmpeg 报告成功但没有生成输出文件')

    // 自检 + 自动重试：ffmpeg 会 exit=0，但画面偶尔短于目标时长。用**帧数**判断而不是
    // stream duration（后者有时偏小）。一次重渲染即可修复，好过交付一条尾部没画面的成片。
    const expectedFrames = Math.floor(exact * fps)
    const tolerance = Math.ceil(fps * 0.4)
    for (let attempt = 1; attempt <= 2; attempt++) {
      const vs = await run([ffprobe, '-v', 'error', '-select_streams', 'v:0',
        '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', s.output], { timeoutMs: 180_000 })
      const frames = Number(String(vs.stdout).trim().split(',')[0])
      if (!Number.isFinite(frames) || frames === 0) break
      if (frames >= expectedFrames - tolerance) break
      if (attempt === 2) {
        throw new Error(
          `画面帧数不足：两次渲染后仍只有 ${frames} 帧（约 ${(frames / fps).toFixed(2)}s），目标 ${expectedFrames} 帧（${exact}s）。`
          + '请缩短 exactDuration 或延长片段（各段时长之和需 ≥ 目标时长）。',
        )
      }
      warnings.push(`首次渲染只得到 ${frames}/${expectedFrames} 帧，已自动重渲染`)
      onProgress?.(`画面偏短（${frames}/${expectedFrames} 帧），自动重渲染…`)
      const retry = await run(argv, { timeoutMs: Number(config.timeoutMs ?? 30 * 60_000), signal })
      if (retry.code !== 0) {
        throw new Error(`重渲染失败（exit ${retry.code}）：${retry.stderr.trim().slice(-400)}`)
      }
    }

    // ---- 嵌入封面图（微信封面兜底；片头画面不改）------------------------------
    let coverEmbedded
    if (s.cover) {
      if (!existsSync(s.cover)) {
        warnings.push(`封面图不存在，未嵌入：${s.cover}`)
      } else {
        try {
          coverEmbedded = await attachCover({ video: s.output, image: s.cover }, config, { signal })
          onProgress?.('封面图已嵌入 MP4（attached_pic）')
        } catch (error) {
          warnings.push(`封面图嵌入失败（视频本身没问题）：${error.message}`)
        }
      }
    }

    const info = await probe(s.output, config)
    return {
      ...plan,
      planOnly: false,
      output: s.output,
      duration: info.duration,
      realWidth: info.width,
      realHeight: info.height,
      sizeMB: info.sizeMB,
      segments: plan.segments,
      segmentCount: n,
      transitionKinds,
      hasMusic: Boolean(music),
      music,
      coverEmbedded,
      warnings,
    }
  } finally {
    for (const file of cleanup) {
      try { rmSync(file, { force: true }) } catch {}
    }
  }
}

export { LOOKS, ENDINGS }
