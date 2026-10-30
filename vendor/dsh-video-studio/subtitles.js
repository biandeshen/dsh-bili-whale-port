/**
 * 字幕/文字覆盖层：生成 ASS 文件供 ffmpeg 的 ass/subtitles 滤镜烧录。
 *
 * 两个必须记住的坑（本项目实测）：
 * 1. ASS 文件必须带 UTF-8 BOM。无 BOM 时 libass 按系统 legacy 代码页读，中文会变乱码。
 * 2. drawtext 不带 fontfile 时会去读 fontconfig 配置；gyan 的 Windows 构建没有该配置，
 *    结果是 ffmpeg 直接段错误崩溃（STATUS_ACCESS_VIOLATION），不是普通报错。
 *    所以文字统一走 ASS，需要 drawtext 时一律显式给 fontfile。
 *
 * 第三条经验（v0.2 新增）：字号不能写死。720p 的 54 号字搬到 1080x1920 竖屏上会小得
 * 看不见。所有字号按 min(width,height)/720 缩放，这样横竖屏观感一致。
 *
 * 第四条：文字进出动画只能用 ASS 内联标签，不能用 filter。
 *   - `\fad(in,out)` 任何对齐方式都能用，最安全；
 *   - `\t(...)` 做缩放弹出，也必须先给起始值（否则 libass 从"当前值"开始，等于没动画）；
 *   - `\move(x1,y1,x2,y2,...)` 会**屏蔽掉 style 的 MarginV**，所以必须自己按对齐方式
 *     算锚点 y（见 anchorY），否则文字会跑到画面外。
 */

import { writeFileSync } from 'node:fs'

/** ASS 颜色是 &HAABBGGRR（不是 RGB）。金色、白色、近黑。 */
const COLORS = {
  gold: '&H0026D6FF',
  goldBright: '&H004AD2FF',
  white: '&H00FFFFFF',
  lightGray: '&H00E8E8E8',
  dimGray: '&H00BFBFBF',
  black: '&H00000000',
  outlineDark: '&H00202020',
}

const STYLES = [
  // D = 正文：白色、黑描边、底部居中
  { name: 'D', fontsize: 54, primary: COLORS.white, outline: COLORS.outlineDark, back: '&H96000000', bold: -1, border: 1, outlineW: 4, shadow: 2, align: 2, marginV: 52 },
  // T = 标题/落款：金色、上方居中
  { name: 'T', fontsize: 76, primary: COLORS.gold, outline: COLORS.outlineDark, back: '&H96000000', bold: -1, border: 1, outlineW: 5, shadow: 3, align: 8, marginV: 70 },
  // S = 小字脚注
  { name: 'S', fontsize: 38, primary: COLORS.lightGray, outline: '&H00181818', back: '&H96000000', bold: 0, border: 1, outlineW: 3, shadow: 1, align: 2, marginV: 36 },
  // E = 片尾落款卡（居中，无描边，因为卡片本身是纯色底）
  { name: 'E', fontsize: 52, primary: COLORS.white, outline: COLORS.black, back: '&H00000000', bold: -1, border: 1, outlineW: 0, shadow: 0, align: 5, marginV: 0 },
  // CB / CT = 封面图/封面卡用：自带半透明底板（BorderStyle 3），保证在任何背景上都可读
  { name: 'CB', fontsize: 54, primary: COLORS.white, outline: '&H00141010', back: '&H6E000000', bold: -1, border: 3, outlineW: 10, shadow: 0, align: 5, marginV: 0 },
  { name: 'CT', fontsize: 64, primary: COLORS.goldBright, outline: '&H00141010', back: '&H6E000000', bold: -1, border: 3, outlineW: 12, shadow: 0, align: 5, marginV: 0 },
  // CC = 片头封面卡的文字（多行叠在一起，靠内联标签分大小）
  { name: 'CC', fontsize: 60, primary: COLORS.white, outline: '&H00101010', back: '&H78000000', bold: -1, border: 3, outlineW: 12, shadow: 0, align: 5, marginV: 0 },
  // K = 强调小标题（中上位置，用于"第 X 天"这类章节感文本）
  { name: 'K', fontsize: 46, primary: COLORS.goldBright, outline: COLORS.outlineDark, back: '&H96000000', bold: -1, border: 1, outlineW: 4, shadow: 2, align: 8, marginV: 140 },
]

const STYLE_BY_NAME = Object.fromEntries(STYLES.map((s) => [s.name, s]))

/** 秒 -> ASS 时间戳 H:MM:SS.cc */
function assTime(seconds) {
  const s = Math.max(0, Number(seconds) || 0)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  const cs = Math.floor((s - Math.floor(s)) * 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

/**
 * 对齐方式对应的锚点 y。`\move` / `\pos` 会屏蔽 MarginV，必须自己算。
 * ASS 的 an 编号：1-3 底部，4-6 中部，7-9 顶部（2/5/8 为水平居中，本文件只用这三种）。
 */
function anchorY(align, marginV, height) {
  if (align >= 7) return marginV
  if (align >= 4) return height / 2 + (marginV || 0)
  return height - marginV
}

const KNOWN_ANIMATIONS = ['none', 'fade', 'slideup', 'rise', 'pop']

/**
 * 文字进出动画的内联标签。
 * 动画名（供工具参数 `animate` 使用）：
 *   none    不加动画（硬出硬收）
 *   fade    淡入淡出（默认，最安全）
 *   slideup 从下方滑入 + 淡入
 *   rise    轻微上浮 + 淡入（比 slideup 收敛）
 *   pop     轻微放大弹出 + 淡入
 */
export function animationTag(animate, { width = 1280, height = 720, align = 2, marginV = 0 } = {}) {
  const cx = Math.round(width / 2)
  switch (String(animate ?? 'fade')) {
    case 'none':
      return ''
    case 'slideup': {
      const y = Math.round(anchorY(align, marginV, height))
      return `{\\fad(220,260)\\move(${cx},${y + 42},${cx},${y},0,380)}`
    }
    case 'rise': {
      const y = Math.round(anchorY(align, marginV, height))
      return `{\\fad(260,280)\\move(${cx},${y + 18},${cx},${y},0,420)}`
    }
    case 'pop':
      return '{\\fscx84\\fscy84\\fad(180,280)\\t(0,340,\\fscx100\\fscy100)}'
    case 'fade':
    default:
      return '{\\fad(280,280)}'
  }
}

/** ASS 文本里的 `\` `{` `}` 需要转义，否则会被当成标签。 */
function escapeAss(text) {
  return String(text ?? '').replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}')
}

/** 把数组文字拼成 ASS 多行（\N）。 */
function joinAssLines(lines) {
  return lines.map(escapeAss).join('\\N')
}

/**
 * 生成 ASS 内容。
 * @param {object} opts
 * @param {number} opts.width   PlayResX（必须与视频分辨率一致，否则字号/位置会缩放错）
 * @param {number} opts.height  PlayResY
 * @param {string} opts.fontName 字体家族名（默认微软雅黑）
 * @param {Array<{start:number,end:number,text:string,style?:string,marginV?:number,animate?:string}>} opts.cues
 */
export function buildAss({ width, height, fontName = 'Microsoft YaHei', cues = [] }) {
  const fontScale = Math.min(width, height) / 720
  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  ]
  for (const s of STYLES) {
    lines.push([
      `Style: ${s.name}`, fontName, Math.round(s.fontsize * fontScale), s.primary, '&H000000FF',
      s.outline, s.back,
      s.bold, 0, 0, 0, 100, 100, s.name === 'T' || s.name === 'CT' ? 2 : 1, 0,
      s.border, s.outlineW, s.shadow, s.align, 40, 40, s.marginV, 1,
    ].join(','))
  }
  lines.push('', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text')
  for (const cue of cues) {
    const style = cue.style ?? 'D'
    const styleDef = STYLE_BY_NAME[style] ?? STYLE_BY_NAME.D
    // MarginV 也要跟着缩放：它是 PlayRes 单位下的绝对距离，不缩放的话
    // 480x270 的小尺寸上 70 的边距会跑到画面中间去。
    const styleMargin = Math.round(styleDef.marginV * fontScale)
    const cueMargin = Number.isFinite(cue.marginV) ? Math.round(cue.marginV * fontScale) : 0
    // 文本里的换行在 ASS 里写作 \N
    const text = String(cue.text ?? '').replace(/\r?\n/g, '\\N')
    const anim = animationTag(cue.animate, {
      width, height, align: styleDef.align, marginV: cueMargin || styleMargin,
    })
    lines.push(`Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},${style},,0,0,${cueMargin},,${anim}${text}`)
  }
  return lines.join('\n') + '\n'
}

/** 写出 ASS 文件。**带 BOM**，否则中文乱码。 */
export function writeAss(path, options) {
  const content = buildAss(options)
  writeFileSync(path, '\uFEFF' + content, 'utf8')
  return path
}

/**
 * 把"文案行"铺成时间轴 cue。
 * 首行按标题样式（T），其余按正文（D），最后一行可选小字（S）。
 */
export function layoutCues({ lines = [], duration, start = 0.4, tailStyle, animate } = {}) {
  const usable = lines.filter((l) => l && String(l).trim())
  if (usable.length === 0) return []
  const span = Math.max(0.5, (duration - start - 0.2) / usable.length)
  return usable.map((text, index) => {
    const isFirst = index === 0
    const isLast = index === usable.length - 1
    const from = start + index * span
    const to = Math.min(duration - 0.1, from + span * 0.86)
    return {
      start: Number(from.toFixed(2)),
      end: Number(to.toFixed(2)),
      style: isFirst ? 'T' : (isLast && tailStyle ? tailStyle : 'D'),
      text,
      animate,
    }
  })
}

/**
 * 落款卡/封面卡的多行文字：首行大字金色，其余小字浅灰，行间用 \N。
 * 用内联标签分行设定字号（比拆成多个 cue 可靠：多个 align=5 的 cue 会叠在一起）。
 */
export function buildCardText({ lines = [], width = 1280, firstRatio = 0.052, restRatio = 0.026, firstColor = COLORS.goldBright, restColor = COLORS.lightGray } = {}) {
  const usable = lines.filter((l) => l && String(l).trim())
  if (usable.length === 0) return ''
  const firstSize = Math.round(width * firstRatio)
  const restSize = Math.round(width * restRatio)
  return usable.map((line, index) => (index === 0
    ? `{\\fs${firstSize}\\c${firstColor}\\b1}${escapeAss(line)}`
    : `{\\fs${restSize}\\c${restColor}\\b0}${escapeAss(line)}`)).join('\\N')
}

/** 封面图（叠加在实拍帧上）的多行文字，与 buildCardText 同构但更小、带底板。 */
export function buildOverlayText({ lines = [], width = 1280 } = {}) {
  return buildCardText({ lines, width, firstRatio: 0.050, restRatio: 0.028, firstColor: COLORS.goldBright, restColor: COLORS.white })
}

export { COLORS, STYLES, KNOWN_ANIMATIONS, escapeAss, joinAssLines }
