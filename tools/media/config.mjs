/**
 * config.media（M1c）：视频出片的配置节，默认值 = 原 CLI 硬编码默认，逐项可被
 * bili-whale.config.json 的 `media` 节覆盖；CLI 参数在 video-build 里再覆盖一层（CLI 优先）。
 */
import fs from 'node:fs'
import { dshPath } from '../lib/paths.mjs'

export const MEDIA_DEFAULTS = {
  tts: { provider: 'auto', model: 'mimo-v2.5-tts', style: '请用温柔、轻一点、像夜里说话的语气朗读下面内容。' },
  bgm: { default: 'auto', volume: 0.14 },
  video: { size: '1080x1920', duration: 20, minDuration: 3, maxDuration: 60 },
}

export function mediaConfig(file = dshPath('bili-whale.config.json')) {
  let user = {}
  try { user = JSON.parse(fs.readFileSync(file, 'utf8')).media ?? {} } catch {}
  return {
    tts: { ...MEDIA_DEFAULTS.tts, ...(user.tts ?? {}) },
    bgm: { ...MEDIA_DEFAULTS.bgm, ...(user.bgm ?? {}) },
    video: { ...MEDIA_DEFAULTS.video, ...(user.video ?? {}) },
  }
}
