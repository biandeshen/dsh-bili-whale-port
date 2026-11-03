/**
 * TTS 层（M1c 抽自 video-build）：MiMo → edge-tts 回退，key 只从 credentials provider 取。
 *
 * ttsPlan(arg)        → { order: ['mimo','edge'] | [x] | [], voiceFor: fn }
 * synthesize({...})   → { provider, voice }，按 plan 顺序试，全败抛错
 * describeTts()       → 给 --plan/日志用的提供方描述，永不含 key
 * 缺 key = fail-closed：显式 --tts mimo 时直接拒，不静默回退（回退只发生在 auto）。
 */
import fs from 'node:fs'
import path from 'node:path'
import https from 'node:https'
import { loadMimoKey, describeMimo } from './mimo.mjs'
import { runBin } from './proc.mjs'

const VOICE_DEFAULTS = { mimo: '茉莉', edge: 'zh-CN-XiaoyiNeural' }

export function ttsPlan(arg) {
  const a = String(arg ?? 'auto').toLowerCase()
  if (a === 'none') return { order: [], voiceFor: (p) => VOICE_DEFAULTS[p] }
  const order = a === 'auto' ? ['mimo', 'edge'] : [a]
  return { order, voiceFor: (p) => VOICE_DEFAULTS[p] ?? VOICE_DEFAULTS.edge }
}

/** 给 --plan/日志用；测试可注入 creds（同 loadMimoKey）。永不含 key 本体。 */
export function describeTts(creds = {}) {
  const loaded = loadMimoKey(creds)
  return { mimoKey: loaded.key ? `loaded(${describeMimo(loaded)})` : 'missing', voices: { ...VOICE_DEFAULTS } }
}

async function mimoTts({ text, voice, outFile, style, model, creds = {} }) {
  const { key } = loadMimoKey(creds)
  if (!key) throw new Error('未找到 MiMo API key（~/.local/share/mimocode/auth.json 或 MIMO_API_KEY）')
  const payload = JSON.stringify({
    model,
    messages: [
      { role: 'user', content: style },
      { role: 'assistant', content: text },
    ],
    audio: { format: 'mp3', voice },
  })
  const r = await httpsPost('https://api.xiaomimimo.com/v1/chat/completions', payload, {
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  }, 180_000)
  if (r.status >= 400) throw new Error(`MiMo TTS ${r.status}: ${r.buffer.toString('utf8').slice(0, 300)}`)
  const ct = String(r.headers['content-type'] || '')
  let buf
  if (ct.includes('application/json')) {
    const j = JSON.parse(r.buffer.toString('utf8'))
    const data = j?.choices?.[0]?.message?.audio?.data
    if (!data) throw new Error('MiMo 响应缺少 message.audio.data')
    buf = Buffer.from(data, 'base64')
  } else {
    buf = r.buffer
  }
  if (!buf.length) throw new Error('MiMo 返回空音频')
  fs.writeFileSync(outFile, buf)
}

/** 只用于 MiMo TTS（不是 B 站后端，不走 traffic 闸）。 */
function httpsPost(url, payload, headers, timeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    const req = https.request(new URL(url), { method: 'POST', headers }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, buffer: Buffer.concat(chunks) }))
    })
    req.setTimeout(timeoutMs, () => req.destroy(new Error('MiMo 请求超时')))
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

async function edgeTts({ text, voice, outFile, binDir }) {
  const bin = fs.existsSync(path.join(binDir, 'edge-tts.exe'))
    ? path.join(binDir, 'edge-tts.exe')
    : fs.existsSync(path.join(binDir, 'edge-tts'))
      ? path.join(binDir, 'edge-tts')
      : 'edge-tts'
  const r = await runBin(bin, ['--voice', voice, '--rate', '-4%', '--text', text, '--write-media', outFile], 180_000)
  if (r.code !== 0 || !fs.existsSync(outFile)) throw new Error((r.stderr || 'edge-tts 无输出').slice(-300))
}

/**
 * 按 plan 顺序合成。order=[]（--tts none）→ 直接返回 null。
 * 显式指定的 provider 失败即抛（调用方决定是否兜底）；auto 模式内部逐个试。
 */
export async function synthesize({ plan, text, voiceArg, outFile, style, model, binDir, creds = {}, onWarn = () => {} }) {
  if (!plan.order.length) return null
  let lastErr = null
  for (const p of plan.order) {
    const voice = voiceArg === 'auto' ? plan.voiceFor(p) : voiceArg
    try {
      if (p === 'mimo') await mimoTts({ text, voice, outFile, style, model, creds })
      else await edgeTts({ text, voice, outFile, binDir })
      return { provider: p, voice }
    } catch (e) {
      lastErr = e
      onWarn(`${p} 失败：${String(e?.message ?? e).slice(0, 200)}`)
    }
  }
  throw new Error('TTS 全部失败（--tts none 可跳过配音）：' + String(lastErr?.message ?? lastErr))
}
