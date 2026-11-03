/**
 * cortico-world-bilibili 的浏览器端面板（B 站世界页的四个操作台）。
 */
import {
  inboxPanel,
  draftsQueuePanel,
  preferencesPanel,
  gatePolicyPanel,
} from '../../../cap-bilibili/src/webui/client.ts'

export default {
  panels: {
    inbox: inboxPanel,
    'drafts-queue': draftsQueuePanel,
    preferences: preferencesPanel,
    'gate-policy': gatePolicyPanel,
  },
}
