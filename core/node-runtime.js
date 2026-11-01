import { resolveRuntime } from '../tools/lib/runtime.mjs'
const cache = new Map()
export function nodeRuntime(whaleHome) {
  // 测试声明"本机无 node 运行时"时短路：os.homedir() 兜底会在装有桌面运行时的开发机上
  // 扫到真实 ~/.dsh/dsh-runtimes/node.exe，导致沙箱隔离失效（上游测试泄漏，非产品缺陷）。
  if (process.env.TEST_NO_NODE === '1') throw Error('[bili-whale] 找不到可执行脚本的 node 运行时，请设置 WHALE_NODE 为真实 node 的绝对路径')
  if (!cache.has(whaleHome)) cache.set(whaleHome, resolveRuntime(whaleHome))
  return cache.get(whaleHome)
}
export const resolveNodeRuntime = whaleHome => nodeRuntime(whaleHome).file
export const nodeEnv = whaleHome => nodeRuntime(whaleHome).env
