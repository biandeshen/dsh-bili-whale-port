import { resolveRuntime } from '../tools/lib/runtime.mjs'
const cache = new Map()
export function nodeRuntime(dshHome) {
  // 测试声明"本机无 node 运行时"时短路：os.homedir() 兜底会在装有 DSH 的开发机上
  // 扫到真实 ~/.dsh/dsh-runtimes/node.exe，导致沙箱隔离失效（上游测试泄漏，非产品缺陷）。
  if (process.env.TEST_NO_NODE === '1') throw Error('[bili-whale] 找不到可执行脚本的 node 运行时，请设置 DSH_NODE 为真实 node 的绝对路径')
  if (!cache.has(dshHome)) cache.set(dshHome, resolveRuntime(dshHome))
  return cache.get(dshHome)
}
export const resolveNodeRuntime = dshHome => nodeRuntime(dshHome).file
export const nodeEnv = dshHome => nodeRuntime(dshHome).env
