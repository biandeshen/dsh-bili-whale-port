/**
 * cortico-world-bilibili 的浏览器端面板（B 站世界页的五个操作台）。
 *
 * 实现都在 cap-bilibili 里，这里只做组装与注册；加一块面板要同时改两处
 * （能力包 `panels()` 声明数据面 + 这里挂上浏览器端），少一处就是"有接口没页面"或"有页面没接口"。
 */
import {
  inboxPanel,
  draftsQueuePanel,
  preferencesPanel,
  gatePolicyPanel,
  connectionPanel,
} from '../../../cap-bilibili/src/webui/client.ts'

export default {
  panels: {
    inbox: inboxPanel,
    'drafts-queue': draftsQueuePanel,
    preferences: preferencesPanel,
    'gate-policy': gatePolicyPanel,
    connection: connectionPanel,
  },
}
