/**
 * 只读探针：在子进程里打印"这份代码实际解析出的 whale home"。
 * 用途：优先级链是在模块加载时定定的，父进程改 env 影响不到已加载的模块，
 * 所以必须另起一个进程、用给定 env 跑，才测到真实行为（不碰网络、不写盘）。
 */
import { whaleHome, DSH_HOME, configPath, resolveWhaleHome } from '../../tools/lib/paths.mjs'
import { killFile } from '../../tools/lib/kill.mjs'

console.log(JSON.stringify({
  whaleHome,
  dshHomeAlias: DSH_HOME,
  configPath,
  // 真实消费方（kill 闸门）跟着同一个 home 走，证明收口不只是探针自己在算
  killFile: killFile(),
  fromEnv: resolveWhaleHome(process.env),
}))
