// Cortico 链路健康检查：代理 Responses / WebUI / 21:40 排程 / World 日志
import fs from 'node:fs'
import path from 'node:path'
const H = process.env.USERPROFILE || ''
const out = []
const ok = (b, n, d) => { out.push((b ? '✓ ' : '✗ ') + n + (d ? '：' + d : '')); return b }
let pass = true
try {
  const s = JSON.parse(fs.readFileSync(path.join(H, '.dsh', 'our-free-model', 'settings.json'), 'utf8'))
  const key = s.aggregate.providers.opencode_go.apiKey
  const r = await fetch('http://127.0.0.1:18910/v1/responses', { method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'deepseek-flash', input: 'ping', max_output_tokens: 8 }) })
  pass = ok(r.ok, 'OFM Responses', 'HTTP ' + r.status) && pass
} catch (e) { pass = ok(false, 'OFM Responses', e.message) && pass }
try { const r = await fetch('http://127.0.0.1:7799/'); pass = ok(r.ok, 'Cortico WebUI', 'HTTP ' + r.status) && pass } catch (e) { pass = ok(false, 'Cortico WebUI', e.message) && pass }
try {
  const st = JSON.parse(fs.readFileSync(path.join(H, '.dsh', 'bili-whale', 'control', 'cortico-wake.json'), 'utf8'))
  pass = ok(st.nextWakeAt > Date.now(), '下次唤醒', new Date(st.nextWakeAt).toLocaleString()) && pass
} catch (e) { pass = ok(false, '下次唤醒', 'cortico-wake.json 缺失') && pass }
try { const k = fs.existsSync(path.join(H, '.dsh', 'bili-whale', 'control', 'kill')); pass = ok(!k, 'kill switch', k ? '已触发（应关闭）' : '未触发') && pass } catch {}
try {
  const dir = path.join(H, '.dsh', 'bili-whale', 'control', 'pending')
  const items = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { return null } }).filter((x) => x && !x.used)
    : []
  const now = Date.now()
  const soonest = items.map((x) => Date.parse(x.expiresAt)).filter(Number.isFinite).sort((a, b) => a - b)[0]
  const detail = items.length
    ? `${items.length} 条待审，最近过期 ${new Date(soonest).toLocaleString()}${soonest - now < 30 * 60000 ? '（⚠ <30 分钟）' : ''}`
    : '无待审'
  pass = ok(true, '待审令牌', detail) && pass
} catch (e) { pass = ok(true, '待审令牌', '读取失败：' + e.message) && pass }
console.log(out.join('\n')); console.log(pass ? '\n健康检查通过' : '\n健康检查失败')
process.exitCode = pass ? 0 : 1
