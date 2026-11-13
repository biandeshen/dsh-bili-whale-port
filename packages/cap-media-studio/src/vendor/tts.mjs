/**
 * TTS 层（M1c 抽自 video-build）：MiMo → edge-tts 回退，key 只从 credentials provider 取。
 *
 * ttsPlan(arg)        → { order: ['mimo','edge'] | [x] | [], voiceFor: fn }
 * synthesize({...})   → { provider, voice, usage? }，按 plan 顺序试，全败抛错
 * describeTts()       → 给 --plan/日志用的提供方描述，永不含 key
 * 缺 key = fail-closed：显式 --tts mimo 时直接拒，不静默回退（回退只发生在 auto）。
 *
 * 两条 2026-11-13 补的账（见 docs/evidence/host-claim-downgrade-2026-11-13.md ⑧）：
 *   · usage：MiMo 响应里的 usage 以前被丢掉 → 这一路花的钱宿主看不见；现在原样带出，
 *     由调用方交给宿主已有的 WorldCtx.reportUsage。**不编数**：响应没有 usage 就返回 undefined。
 *   · 冷却：402/429 以前每次渲染都重试一次 MiMo → 欠费时等于每次白等一轮。现在写一个冷却文件，
 *     冷却期内直接走 edge，并把停摆原因记成可读文本（接 B22-P3 的 402 感知）。
 */
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'
import { loadMimoKey, describeMimo } from './mimo.mjs'
import { runBin } from './proc.mjs'

const VOICE_DEFAULTS = { mimo: '茉莉', edge: 'zh-CN-XiaoyiNeural' }

/** 冷却文件放在 TTS 输出同目录：没有额外状态根，删掉它等于"立刻再试一次"。 */
export const TTS_COOLDOWN_FILE = '.tts-cooldown.json'
const COOLDOWN_402_MS = 6 * 3600_000   // 欠费要人充值，等久点
const COOLDOWN_429_MS = 10 * 60_000    // 限流自己会好

function cooldownPath(stateDir) {
  return stateDir ? path.join(stateDir, TTS_COOLDOWN_FILE) : null
}

/** 读冷却状态；坏文件当没有（不因为一个坏 json 卡住配音）。 */
export function readTtsCooldown(stateDir) {
  const file = cooldownPath(stateDir)
  if (!file) return null
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!j || typeof j.until !== 'number') return null
    return j
  } catch {
    return null
  }
}

function writeTtsCooldown(stateDir, status, message) {
  const file = cooldownPath(stateDir)
  if (!file) return
  const now = Date.now()
  const until = now + (status === 402 ? COOLDOWN_402_MS : COOLDOWN_429_MS)
  const body = {
    until,
    status,
    reason: status === 402 ? 'MiMo 欠费/未授权（402）' : 'MiMo 限流（429）',
    detail: String(message ?? '').slice(0, 300),
    setAt: new Date(now).toISOString(),
  }
  try {
    fs.mkdirSync(stateDir, { recursive: true })
    fs.writeFileSync(file, JSON.stringify(body, null, 2), 'utf8')
  } catch {}
}

/** 现在是否还在冷却里；返回可读原因供面板显示。 */
export function ttsCooldownStatus(stateDir, now = Date.now()) {
  const c = readTtsCooldown(stateDir)
  if (!c || c.until <= now) return { active: false }
  return { active: true, until: c.until, status: c.status, reason: c.reason, detail: c.detail }
}

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

/** MiMo 端点：默认官方域名；测试与自架代理可用 creds.baseUrl 或 MIMO_BASE_URL 换 origin。 */
export function mimoEndpoint(creds = {}) {
  const base = String(creds.baseUrl ?? creds.env?.MIMO_BASE_URL ?? process.env.MIMO_BASE_URL ?? '').trim()
  const origin = (base || 'https://api.xiaomimimo.com').replace(/\/+$/, '')
  return origin + '/v1/chat/completions'
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
  const r = await httpsPost(mimoEndpoint(creds), payload, {
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  }, 180_000)
  if (r.status >= 400) {
    const err = new Error(`MiMo TTS ${r.status}: ${r.buffer.toString('utf8').slice(0, 300)}`)
    err.status = r.status
    throw err
  }
  const ct = String(r.headers['content-type'] || '')
  let buf
  let usage
  if (ct.includes('application/json')) {
    const j = JSON.parse(r.buffer.toString('utf8'))
    const data = j?.choices?.[0]?.message?.audio?.data
    if (!data) throw new Error('MiMo 响应缺少 message.audio.data')
    buf = Buffer.from(data, 'base64')
    // 有的响应对音频不给 usage。给就带出去，不给就留 undefined —— 绝不编 0 冒充"没花钱"。
    if (j?.usage && typeof j.usage === 'object') usage = j.usage
  } else {
    buf = r.buffer
  }
  if (!buf.length) throw new Error('MiMo 返回空音频')
  fs.writeFileSync(outFile, buf)
  return { usage }
}

/** 只用于 MiMo TTS（不是 B 站后端，不走 traffic 闸）。按协议选模块：默认 https，自架代理可能是 http。 */
function httpsPost(url, payload, headers, timeoutMs = 180_000) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const mod = target.protocol === 'http:' ? http : https
    const req = mod.request(target, { method: 'POST', headers }, (res) => {
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
 *
 * stateDir 给了就启用 402/429 冷却：冷却期内**跳过 mimo**，不白等一轮；
 * 显式 --tts mimo 时不受冷却影响（主人明确要它，就把真实错误抛出去）。
 */
export async function synthesize({ plan, text, voiceArg, outFile, style, model, binDir, creds = {}, onWarn = () => {}, stateDir = null }) {
  if (!plan.order.length) return null
  const explicitMimo = plan.order.length === 1 && plan.order[0] === 'mimo'
  const cooling = !explicitMimo ? ttsCooldownStatus(stateDir) : { active: false }
  let lastErr = null
  for (const p of plan.order) {
    if (p === 'mimo' && cooling.active) {
      onWarn(`mimo 冷却中（${cooling.reason}，至 ${new Date(cooling.until).toISOString()}），本次直接用 edge`)
      lastErr = new Error(`mimo 冷却中：${cooling.reason}`)
      continue
    }
    const voice = voiceArg === 'auto' ? plan.voiceFor(p) : voiceArg
    try {
      if (p === 'mimo') {
        const r = await mimoTts({ text, voice, outFile, style, model, creds })
        return { provider: p, voice, usage: r?.usage }
      }
      await edgeTts({ text, voice, outFile, binDir })
      return { provider: p, voice }
    } catch (e) {
      lastErr = e
      const st = Number(e?.status)
      if (p === 'mimo' && (st === 402 || st === 429)) writeTtsCooldown(stateDir, st, e?.message)
      onWarn(`${p} 失败：${String(e?.message ?? e).slice(0, 200)}`)
    }
  }
  throw new Error('TTS 全部失败（--tts none 可跳过配音）：' + String(lastErr?.message ?? lastErr))
}
