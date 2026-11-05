/**
 * 测试要端口时，去要一个**当下真空着**的，不要掷骰子。
 *
 * 为什么加它（2026-11-05 全量门禁"随机红"）：
 *   · `tests/contract/panel.test.mjs` 用 `18441 + random(900)` → 区间 18441–19340，
 *     正好盖住常驻 OFM 代理的固定端口 **18910**；
 *   · `tests/contract/launcher.test.mjs` 用 `18600 + random(300)` → 完全嵌在前面那段里，
 *     两个文件并发跑还能互相撞上。
 * 撞上了报的是「面板 API 未就绪（等 18s）」——跟本轮改动毫无关系，还白等 18 秒，
 * 表现就是同一份代码跑两遍一遍绿一遍红。门禁不可信，比门禁松更糟。
 *
 * 剩下的窄缝：探测到"空着"和子进程真去绑之间仍然有 TOCTOU。起点按 pid 打散，
 * 两个并发进程不会从同一个候选开始，残留概率比原来低几个数量级；
 * 真撞上时红的是这一条明确的错误，不是"等 18 秒后的一句超时"。
 */
import net from 'node:net'

const canBind = (port) => new Promise((resolve) => {
  const s = net.createServer()
  s.once('error', () => resolve(false))
  s.once('listening', () => s.close(() => resolve(true)))
  s.listen({ port, host: '127.0.0.1' })
})

/** 在 [base, base+span) 内找一个当前能绑定的端口；整段都满时让系统给一个空闲高位端口。 */
let calls = 0
export async function freePort({ base = 18441, span = 900, tries = 12 } = {}) {
  // 起点：pid 打散（不同进程不撞同一候选）+ 调用序号打散（同一进程里连开五个面板不反复要同一个口）
  const offset = ((process.pid * 7919) + calls++ * 131) % span
  for (let k = 0; k < tries; k++) {
    const port = base + ((offset + k * 37) % span)
    if (await canBind(port)) return port
  }
  return await new Promise((resolve, reject) => {
    const s = net.createServer()
    s.once('error', reject)
    s.once('listening', () => {
      const port = s.address().port
      s.close(() => resolve(port))
    })
    s.listen({ port: 0, host: '127.0.0.1' })
  })
}
