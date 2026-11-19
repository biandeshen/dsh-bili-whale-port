/**
 * 她的状态立绘 —— 拿现成的 8 张图，按她此刻的状态挑一张。
 *
 * 这些图本来是**视频底图**（`daily-*.png`，1024×1536 竖版），
 * 但每张画的都是一个明确场景（见 `assets/daily/prompts/NN-*.txt` 的场景描述）：
 *
 *   · 01-night-a / 05-night-b　深夜窗边：安静、带一点困意 / 看发光水母、眼神温柔
 *   · 02-rain-a  / 06-rain-b　雨夜小房间：戴耳机听雨、放松 / 抱着膝盖听雨、摊着日记本
 *   · 03-headphone-a / 07-headphone-b　闭眼戴耳机、声波散开 / 侧脸闭眼微笑、音符光点
 *   · 04-goodnight-a / 08-goodnight-b　贝壳床里盖薄毯、快睡着 / 被窝里露出头和呆毛
 *
 * 所以它们天然能当"她现在的样子"用——**不引新引擎、不生成新图**，
 * 只是把她已有的素材按状态接上。
 *
 * 挑图规则（只有状态 → 一张图，不做"表情合成"，那要新图）：
 *   · 睡着 → goodnight（她在被窝里）
 *   · 歇着（累了）→ night（安静、带困意）
 *   · 醒着 + 想安静/需要休息 → rain（听雨）
 *   · 醒着 + 在听/在吸收 → headphone（闭眼戴耳机）
 *   · 醒着 + 有精神 → night 的 b 变体（看水母、眼神温柔）
 *
 * 同一场景有 a/b 两个变体时，按**当天的稳定选择**（不每刷新就换图——
 * 换图太跳，像是她在闪烁）。
 */

export type PortraitScene = 'night' | 'rain' | 'headphone' | 'goodnight'

export interface PortraitDescriptor {
  /** 她现在的状态（面板传进来的那几项） */
  rest?: 'asleep' | 'resting' | 'awake'
  /** 她有多精神（0~1）：体力 + 刺激 + 好奇的合成 */
  energy?: number
  /** 她在不在听/吸收（0~1）：刺激高说明她在接收外界 */
  stimulation?: number
  /** 今日的行动条数（动得多不多） */
  actionsToday?: number
}

export interface PortraitChoice {
  /** 底图文件名（在 assetsDir 下） */
  file: string
  /** 场景 */
  scene: PortraitScene
  /** 一句话：她现在这个样子的由来（面板显示在图下） */
  caption: string
}

/** 每个场景的两个变体（a/b）——挑的时候在 a/b 之间轮换，避免总用同一张。 */
const SCENE_FILES: Record<PortraitScene, [string, string]> = {
  night: ['daily-01-night-a.png', 'daily-05-night-b.png'],
  rain: ['daily-02-rain-a.png', 'daily-06-rain-b.png'],
  headphone: ['daily-03-headphone-a.png', 'daily-07-headphone-b.png'],
  goodnight: ['daily-04-goodnight-a.png', 'daily-08-goodnight-b.png'],
}

/** 场景的中文说法（面板显示；也是"她现在在干什么"的人话）。 */
export const SCENE_LABEL: Record<PortraitScene, string> = {
  night: '深夜的窗边',
  rain: '雨夜的小房间',
  headphone: '闭着眼听东西',
  goodnight: '缩在被窝里',
}

/**
 * 按状态挑一张立绘。
 *
 * @param pick 变体选择（0 = a，1 = b）；由调用方按"当天不变"的方式给
 */
export function choosePortrait(d: PortraitDescriptor, pick: 0 | 1 = 0): PortraitChoice {
  const energy = clamp01(Number(d.energy ?? 0.5))
  const stim = clamp01(Number(d.stimulation ?? 0.3))
  const rest = d.rest ?? 'awake'

  let scene: PortraitScene
  let caption: string
  if (rest === 'asleep') {
    scene = 'goodnight'
    caption = '她睡着了，被窝里只露出头和呆毛。'
  } else if (rest === 'resting') {
    scene = 'night'
    caption = '她有点累，坐在窗边安静一会儿。'
  } else if (stim >= 0.55) {
    // 在接收外界（戴着耳机在听）：闭眼的那张最贴
    scene = 'headphone'
    caption = '她在听东西，听得很专注。'
  } else if (energy <= 0.4) {
    scene = 'rain'
    caption = '她在听雨，让自己缓一缓。'
  } else if (energy >= 0.7) {
    scene = 'night'
    caption = '她今晚精神不错，靠在窗边看水母。'
  } else {
    scene = 'rain'
    caption = '她在听雨，等下一件事发生。'
  }
  const files = SCENE_FILES[scene]
  return { file: files[pick === 1 ? 1 : 0], scene, caption }
}

/** 这个场景还有哪一张（面板上给个"换一张"）。 */
export function alternatePortrait(choice: PortraitChoice): PortraitChoice {
  const files = SCENE_FILES[choice.scene]
  const other = choice.file === files[0] ? files[1] : files[0]
  return { ...choice, file: other }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}
