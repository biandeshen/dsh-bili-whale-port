/**
 * cortico-bot-xiaoyu 的浏览器端面板合集（Persona 页 + Memory 页）。
 *
 * 一个扩展包只能声明一个 cortico.webUiClient，所以三个对内能力包的面板在这里合并成一个 bundle。
 * 面板实现分别在各自的包里（cap-state-rhythm / cap-memory / cap-journal），这里只做组装。
 */
import { tankPanel } from '../../../cap-state-rhythm/src/webui/client.ts'
import { memoryCenterPanel } from '../../../cap-memory/src/webui/client.ts'
import { journalBoardPanel } from '../../../cap-journal/src/webui/client.ts'

export default {
  panels: {
    tank: tankPanel,
    'memory-center': memoryCenterPanel,
    'journal-board': journalBoardPanel,
  },
}
