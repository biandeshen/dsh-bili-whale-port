/**
 * cortico-world-media 的浏览器端面板（音视频工作室页 + 生图提示词预设页）。
 *
 * 一个扩展包只能声明一个 cortico.webUiClient，所以能力包的面板必须在这里合并成一个 bundle。
 * 面板实现分别在各自的包里，这里只做组装。
 *
 * 2026-11-21：漏了 `prompt-preset` 这一行，导致面板产物里根本没有它——
 * 浏览器打开就是「面板加载失败 / 产物中只有 media-studio」。
 * 能力包自己构建出的 dist/webui.js **宿主不会读**（只有 adapter 声明的那个路径会被加载），
 * 所以凡是新增能力包面板，都必须回到这个文件加一行。
 */
import { mediaStudioPanel } from '../../../../capabilities/cap-media-studio/src/webui/client.ts'
import { promptPresetPanel } from '../../../../capabilities/cap-media-studio/src/webui/prompt-preset.ts'

export default {
  panels: {
    'media-studio': mediaStudioPanel,
    'prompt-preset': promptPresetPanel,
  },
}
