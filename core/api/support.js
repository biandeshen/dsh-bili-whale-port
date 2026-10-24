/**
 * core/api/support.js —— 路由与宿主无关的公共件（阶段 2 从 index.js 抽出）
 * dsh adapter、whale-panel、OpenCode 共用同一份配置读写与体检逻辑。
 */
import fs from 'node:fs'
import { execFile } from 'node:child_process'
import { RISK_DEFAULTS } from '../../tools/lib/traffic.mjs'
import { nodeEnv } from '../node-runtime.js'
import { DSH_HOME } from '../../tools/lib/paths.mjs'

export const clone = (o) => JSON.parse(JSON.stringify(o))
export const merge = (base, over) => {
  const out = { ...base }
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(base[k] ?? {}, v) : v
  }
  return out
}

/** 默认配置（与 tools/lib/config.mjs 的中性默认对齐；这里多一个 toolsPath） */
export const DEFAULTS = {
  sessionRotateDays: 0,
  personaOncePerSession: false,
  risk: RISK_DEFAULTS,
  owner: { mid: '', name: '' },
  night: {
    windows: [{ start: '20:00', end: '24:00', wakes: 1 }],
    skipChance: 0.3,
    minGapMin: 10, maxVideos: 5,
  },
  preferences: {
    like: ['DSH/AI 工具与插件', '鬼畜与怀旧向剪辑', '猫咪', 'Live2D/模型', 'B站生态八卦'],
    dislike: ['带货', '擦边', '标题党', '纯搬运'],
    keywords: [],
  },
  quota: { shareDaily: 3 },
  diary: { push: true, enabled: true },
  persona: { name: '', ownerTitle: '主人', selfClaim: '我' },
  self: { mid: '', name: '' },
  notify: { type: 'none', url: '', template: 'text', cmd: '' },
  listen: { comment: true, commentIntervalSec: 60, scope: 'both', oncePerPerson: false, allDay: false, dm: false, live: false, liveRoom: '', liveScope: 'owner' },
  share: { aiCommentGuard: false, aiThreshold: 30, enabled: true, via: 'comment', minScore: 13, silentAfterDays: 3 },
  toolsPath: '',
}

/** 写白名单（tests 与 docs/BASELINE 以此为唯一事实源） */
export const KNOWN_CONFIG_KEYS = ['persona', 'preferences', 'notify', 'aliases', 'owner', 'self', 'quota', 'share', 'listen', 'diary', 'night', 'toolsPath', 'home', 'risk', 'sessionRotateDays', 'personaOncePerSession']

/** execFile 安全包装：NODE_EXE 解析失败时把原因交回调，不抛 TypeError */
export function makeExecNode(nodeExeGetter) {
  return function execNode(args, options, cb) {
    const NODE_EXE = nodeExeGetter()
    if (!NODE_EXE) {
      const msg = globalThis.__biliWhaleNodeError || '未找到可用的 node 运行时'
      cb?.(new Error(msg), '', msg)
      return null
    }
    return execFile(NODE_EXE, args, { ...options, env: { ...nodeEnv(DSH_HOME), ...options?.env } }, cb)
  }
}

export function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(obj))
}

export function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(new Error('body too large')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function isLoopbackReq(req) {
  const host = String(req.headers?.host ?? '').toLowerCase()
  const h = host.split(':')[0]
  return h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1'
}
