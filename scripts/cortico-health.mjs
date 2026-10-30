// Cortico 链路健康检查：代理 Responses / WebUI / 状态驱动的节奏 / World 日志
import fs from 'node:fs'
import path from 'node:path'
const H = process.env.USERPROFILE || ''
const out = []
const ok = (b, n, d) => { out.push((b ? '✓ ' : '✗ ') + n + (d ? '：' + d : '')); return b }
let pass = true
try {
  const s = JSON.parse(fs.readFileSync(path.join(H, '.dsh', 'our-free-model', 'settings.json'), 'utf8'))
  const key = s.aggregate.providers.opencode_go.apiKey
  const r = await fetch('http://127.0.0.1:18910/v1/responses', { method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'deepseek-v4.1-flash', input: 'ping', max_output_tokens: 8 }) })
  pass = ok(r.ok, 'OFM Responses', 'HTTP ' + r.status) && pass
} catch (e) { pass = ok(false, 'OFM Responses', e.message) && pass }
try { const r = await fetch('http://127.0.0.1:7799/'); pass = ok(r.ok, 'Cortico WebUI', 'HTTP ' + r.status) && pass } catch (e) { pass = ok(false, 'Cortico WebUI', e.message) && pass }
// 启动默认是暂停的（bin/cortico.mjs 注入 CORTICO_START_PAUSED=1）：
// 只看到 WebUI 200 不代表她在跑，暂停时事件只落库不投递，看起来"她不动"。
try {
  const r = await fetch('http://127.0.0.1:7799/api/status')
  const s = await r.json()
  const paused = s?.loop?.paused === true
  pass = ok(!paused, '运行状态', paused ? '已暂停（POST /api/run/resume）' : '运行中') && pass
  const behind = Number(s?.loop?.behind ?? 0)
  pass = ok(behind === 0, '事件积压', behind === 0 ? '无' : `behind=${behind}`) && pass
  const name = s?.displayName
  pass = ok(name === '小鱼', '显示名', name || '缺失') && pass
} catch (e) { pass = ok(false, '运行状态', e.message) && pass }
// 看门狗是"她的一天"的唯一 tick 来源：WebUI 活着不代表看门狗还活着。
// 5 分钟一跳，超过 10 分钟没有今日 tick 就说明观测链断了（机器睡眠也会触发，如实报）。
try {
  const day = new Date(Date.now()).toLocaleDateString('sv-SE') // 自然日
  const file = path.join(H, '.dsh', 'bili-whale', 'days', day, 'ticks.jsonl')
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean)
  const last = JSON.parse(lines[lines.length - 1])
  const age = Date.now() - Date.parse(last.at)
  pass = ok(age >= 0 && age < 10 * 60_000, '看门狗 tick',
    age < 0 ? '时间在未来' : Math.round(age / 60000) + ' 分钟前') && pass
} catch { pass = ok(false, '看门狗 tick', '今日无 tick（看门狗未运行）') && pass }
// D-19：人设分两段（ORIENTATION=这一轮做什么 / CONSTITUTION=她是谁）。以模型实际拿到的
// 前缀为准做漂移门：CONSTITUTION 若还是英文种子，一个会话里就同时存在两个人格。
try {
  const r = await fetch('http://127.0.0.1:7799/api/prompts/prefix')
  const { segments = [] } = await r.json()
  const seg = (t) => String(segments.find((x) => x.title === t)?.text ?? '')
  const orient = seg('ORIENTATION')
  const consti = seg('CONSTITUTION')
  const seed = consti.includes('I am a small, curious presence')
  pass = ok(orient.includes('小鱼'), '人设 ORIENTATION', orient ? '小鱼' : '缺失') && pass
  pass = ok(consti.includes('我是小鱼') && !seed, '人设 CONSTITUTION',
    seed ? '仍是英文种子（D-19）' : consti.includes('我是小鱼') ? '小鱼' : '缺失身份') && pass
} catch (e) { pass = ok(false, '人设前缀', e.message) && pass }
try {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(H, '.dsh', 'bili-whale', 'control', f), 'utf8'))
  let st = null
  try { st = read('life-status.json') } catch { st = read('cortico-wake.json') }
  const next = st.nextCheckAt || st.nextWakeAt
  const detail = new Date(next).toLocaleString()
    + (st.mode === 'state-driven' ? `（状态驱动；今天已行动 ${st.actionsToday ?? st.wakesToday ?? 0} 次${st.lastKind ? '，上次 ' + st.lastKind : ''}）` : '')
  pass = ok(next > Date.now(), '下次状态评估', detail) && pass
} catch (e) { pass = ok(false, '下次状态评估', 'life-status.json 缺失') && pass }
try { const k = fs.existsSync(path.join(H, '.dsh', 'bili-whale', 'control', 'kill')); pass = ok(!k, 'kill switch', k ? '已触发（应关闭）' : '未触发') && pass } catch {}
try {
  const { listPending } = await import('./ack.mjs')
  const now = Date.now()
  const items = listPending(path.join(H, '.dsh'))
  const soonest = items.map((x) => Date.parse(x.expiresAt)).filter(Number.isFinite).sort((a, b) => a - b)[0]
  const detail = items.length
    ? `${items.length} 条待审，最近过期 ${new Date(soonest).toLocaleString()}${soonest - now < 30 * 60000 ? '（⚠ <30 分钟）' : ''}`
    : '无待审'
  pass = ok(true, '待审令牌', detail) && pass
} catch (e) { pass = ok(true, '待审令牌', '读取失败：' + e.message) && pass }
console.log(out.join('\n')); console.log(pass ? '\n健康检查通过' : '\n健康检查失败')
process.exitCode = pass ? 0 : 1
