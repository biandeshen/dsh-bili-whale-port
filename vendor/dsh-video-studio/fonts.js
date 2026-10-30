/**
 * 字体预设：一处定义"给用户选的字体风格" → 同时供 libass（家族名）和 drawtext（字体文件）使用。
 *
 * 背景：文字走两条路，两边的寻址方式不同——
 *   - ASS / libass 按**家族名**找字体（`Style: D,Microsoft YaHei,...`）；
 *   - drawtext 必须给**文件路径**，否则去读 fontconfig 配置并段错误崩溃。
 * 所以每个预设同时记录 family 和 file，避免只改一边导致封面与正文用上不同字体。
 *
 * 这些字体都确认存在于 C:\Windows\Fonts（本项目实测环境）。
 * family 名必须能被 libass 解析到，否则会静默回退到默认字体（中文可能变方块）。
 * `test/fonts.mjs` 用"不同预设渲染出的像素必须不同"来检测静默回退。
 */

export const FONT_PRESETS = {
  yahei: { family: 'Microsoft YaHei', file: 'C:\\Windows\\Fonts\\msyhbd.ttc', label: '微软雅黑', note: '现代、通用，最不容易出错（默认）' },
  hei: { family: 'SimHei', file: 'C:\\Windows\\Fonts\\simhei.ttf', label: '黑体', note: '笔画更硬朗，力量感，适合体育/竞技' },
  deng: { family: 'DengXian', file: 'C:\\Windows\\Fonts\\Dengb.ttf', label: '等线', note: '简洁、偏设计感，适合现代宣传片' },
  yuan: { family: 'YouYuan', file: 'C:\\Windows\\Fonts\\SIMYOU.TTF', label: '幼圆', note: '圆润亲和，最适合少儿题材' },
  kai: { family: 'KaiTi', file: 'C:\\Windows\\Fonts\\simkai.ttf', label: '楷体', note: '温情、人文气息，适合成长留念' },
  song: { family: 'STZhongsong', file: 'C:\\Windows\\Fonts\\STZHONGS.TTF', label: '华文中宋', note: '端正、机构感，适合官方发布' },
  fang: { family: 'FangSong', file: 'C:\\Windows\\Fonts\\simfang.ttf', label: '仿宋', note: '公文气质，偏正式' },
  li: { family: 'LiSu', file: 'C:\\Windows\\Fonts\\SIMLI.TTF', label: '隶书', note: '传统厚重，慎用（小字号糊）' },
  shu: { family: 'FZShuTi', file: 'C:\\Windows\\Fonts\\FZSTK.TTF', label: '方正舒体', note: '手写感，适合活泼标题' },
}

const DEFAULT_PRESET = 'yahei'

/** 预设 key 或直接的家族名 → libass 用的家族名。 */
export function resolveFontFamily(preset, fallback = FONT_PRESETS[DEFAULT_PRESET].family) {
  if (preset === undefined || preset === null || preset === '') return fallback
  const key = String(preset).trim()
  const hit = FONT_PRESETS[key.toLowerCase()]
  return hit ? hit.family : key
}

/** 预设 key 或家族名 → drawtext 用的字体文件路径。找不到就回退默认。 */
export function resolveFontFile(preset, fallback = FONT_PRESETS[DEFAULT_PRESET].file) {
  if (preset === undefined || preset === null || preset === '') return fallback
  const key = String(preset).trim()
  const hit = FONT_PRESETS[key.toLowerCase()]
  if (hit) return hit.file
  // 允许直接把家族名（或字体文件名）当参数传进来
  for (const p of Object.values(FONT_PRESETS)) {
    if (p.family.toLowerCase() === key.toLowerCase()) return p.file
  }
  return key.match(/[\\/]/) ? key : fallback
}

/** 给模型看的字体清单（写进工具描述/技能）。 */
export function fontCatalogText() {
  return Object.entries(FONT_PRESETS)
    .map(([key, p]) => `${key}（${p.label}）：${p.note}`)
    .join('；')
}
