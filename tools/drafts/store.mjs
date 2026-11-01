/**
 * 草稿存储层（M2）：草稿目录的读写与审计，无文案逻辑、无网络。
 * 消费方：scripts/draft-dynamic.mjs（写新稿）、scripts/dynamic-approve.mjs（审/发状态机）。
 * 命名约定：drafts 目录下 `<date>.json` 是事实源，`<date>.md` 是人读副本。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { appendCausal } from '../lib/causal.mjs'

/** @returns {{file: string, draft: object}|null} */
export function loadDraftById(draftsDir, id) {
  if (!id) return null
  const files = fs.existsSync(draftsDir) ? fs.readdirSync(draftsDir).filter((f) => f.endsWith('.json')) : []
  for (const f of files) {
    const p = path.join(draftsDir, f)
    try {
      const d = JSON.parse(fs.readFileSync(p, 'utf8'))
      if (d.id === id || f === id + '.json') return { file: p, draft: d }
    } catch {}
  }
  return null
}

/** 原子写：先写临时文件再 rename，进程被杀也不会留半份 JSON。 */
export function saveDraftFile(file, draft) {
  const tmp = file + '.' + process.pid + '.' + crypto.randomBytes(3).toString('hex') + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(draft, null, 2) + String.fromCharCode(10), 'utf8')
  fs.renameSync(tmp, file)
}

export function readAllDrafts(draftsDir) {
  if (!fs.existsSync(draftsDir)) return []
  return fs.readdirSync(draftsDir).filter((f) => f.endsWith('.json')).map((f) => {
    try { return JSON.parse(fs.readFileSync(path.join(draftsDir, f), 'utf8')) } catch { return null }
  }).filter(Boolean)
}

/** 新稿落盘：`<date>.json`（事实源）+ `<date>.md`（人读副本）。 */
export function writeNewDraft(draftsDir, draft) {
  fs.mkdirSync(draftsDir, { recursive: true })
  const outJson = path.join(draftsDir, draft.date + '.json')
  saveDraftFile(outJson, draft)
  fs.writeFileSync(path.join(draftsDir, draft.date + '.md'), `# 小鱼动态草稿 ${draft.date}\n\n- id: ${draft.id}\n- 图片: ${draft.image}\n- 状态: pending\n- diaryHash: ${draft.diaryHash}\n- textHash: ${draft.textHash}\n- voiceHash: ${draft.voiceHash}\n- degraded: ${draft.degraded}\n\n---\n\n${draft.text}\n`, 'utf8')
  return outJson
}

export function audit(draftsDir, entry) {
  fs.mkdirSync(draftsDir, { recursive: true })
  fs.appendFileSync(path.join(draftsDir, 'audit.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + String.fromCharCode(10))
}

/**
 * 把审批结果写进她自己的因果链：她下次醒来会由代码结算成 draftApproved/draftRejected。
 * 只写事件，不改场值——场值归 World（唯一事实源）管，这里不越权。
 */
export function recordDraftResult(whaleHome, draft, result, reason) {
  appendCausal(whaleHome, {
    kind: 'draft-result',
    draftId: draft.id,
    date: draft.date,
    result,
    // #41：她从"被拒"里学习，前提是理由真的传到位。没有理由就留空，
    // 宿主侧会据此说"主人没写理由"，而不是编一个。
    ...(String(reason ?? '').trim() ? { reason: String(reason).trim().slice(0, 300) } : {}),
    textHash: crypto.createHash('sha1').update(String(draft.text ?? '')).digest('hex').slice(0, 12),
  })
}

export function markUsed(image) {
  try {
    const f = path.join(path.dirname(image), 'used-images.json')
    const cur = JSON.parse(fs.readFileSync(f, 'utf8'))
    cur.used = [...new Set([...(cur.used || []), path.basename(image)])]
    cur.updatedAt = new Date().toISOString()
    fs.writeFileSync(f, JSON.stringify(cur, null, 2) + String.fromCharCode(10))
  } catch {}
}
