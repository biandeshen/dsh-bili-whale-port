/**
 * MiMo 凭据 provider（M1b）。
 *
 * 规则（团队 M1b 门）：
 *   · secret 只在本 provider 里被读出来，调用方拿到后只允许进请求头，不打印、不写日志、不入 git；
 *   · `describeMimo()` 只回“从哪来的”（env/file/missing），永不含 key 本体；
 *   · 来源顺序与重构前 video-build.readMimoKey 完全一致：
 *       MIMO_API_KEY env → 本机 MiMo CLI auth.json → whale home credentials/mimo.json
 *     （先 env 后文件：换 key 不用改文件；测试可注入 env/candidates）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DSH_HOME } from '../paths.mjs'

/** 默认候选文件（按优先级；每次现算，setHomes/env 后跟着走）。 */
export function defaultCandidates() {
  return [
    path.join(os.homedir(), '.local', 'share', 'mimocode', 'auth.json'),
    path.join(DSH_HOME, 'bili-whale', 'credentials', 'mimo.json'),
  ]
}

/**
 * @returns {{key: string|null, source: string}} source ∈ 'env' | 'file:<path>' | 'missing'
 */
export function loadMimoKey({ env = process.env, candidates = defaultCandidates() } = {}) {
  if (env.MIMO_API_KEY) return { key: env.MIMO_API_KEY, source: 'env' }
  for (const f of candidates) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'))
      const k = j?.xiaomi?.key ?? j?.key ?? j?.apiKey
      if (k) return { key: String(k), source: 'file:' + f }
    } catch { /* 文件不存在/坏 JSON → 按来源顺序试下一个 */ }
  }
  return { key: null, source: 'missing' }
}

/** 人类/日志可读的来源描述；**不含 key**（M1b 测试锁这一点）。 */
export function describeMimo(loaded) {
  const s = String(loaded?.source ?? 'missing')
  return s === 'env' ? 'env' : s.startsWith('file:') ? 'file' : 'missing'
}
