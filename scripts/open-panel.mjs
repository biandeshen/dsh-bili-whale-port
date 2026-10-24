// 等待 panel 生成 token 后打开浏览器（start.cmd 的后台助手）
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const home = process.env.WHALE_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh')
const port = process.env.PANEL_PORT || '8447'
const file = path.join(home, 'panel.token')
const deadline = Date.now() + 20000
while (Date.now() < deadline) {
  try {
    const token = fs.readFileSync(file, 'utf8').trim()
    if (token) {
      const url = `http://127.0.0.1:${port}/?t=${token}`
      console.log(`\n[whale] 面板已就绪：${url}\n`)
      const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open'
      const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
      spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref()
      process.exit(0)
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 400))
}
console.error('[whale] 20 秒内没等到 panel.token：请手动打开日志里的 ?t= 链接')
process.exit(1)
