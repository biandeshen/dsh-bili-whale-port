// 已停用（2026-10-27）：调度统一到 Cortico World 的状态驱动节奏（persona-core/src/rhythm.ts）。
// 这个脚本只在手动运行时才会做事，HKCU Run 的 WhaleDraft 已删除；不要再注册自启，否则会和 Cortico 抢着出稿。
// 用户级每晚 21:30 出稿（登录自启；不发送）
import { spawnSync } from 'node:child_process'
import path from 'node:path'
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
function nextAt(h = 21, m = 30) {
  const now = new Date(); const t = new Date(now); t.setHours(h, m, 0, 0)
  if (t <= now) t.setDate(t.getDate() + 1)
  return t
}
async function loop() {
  for (;;) {
    const t = nextAt(); const ms = t - Date.now()
    console.log('[whale] next draft at', t.toLocaleString(), 'in', Math.round(ms / 60000), 'min')
    await new Promise((r) => setTimeout(r, Math.min(ms, 6 * 3600 * 1000)))
    if (Date.now() < t.getTime()) continue
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'draft-dynamic.mjs')], { encoding: 'utf8' })
    console.log('[whale] draft', r.status === 0 ? 'ok' : 'failed', String(r.stdout || r.stderr).slice(0, 300))
  }
}
loop()
