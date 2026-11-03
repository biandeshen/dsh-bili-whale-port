/**
 * 存量真实数据无损接管脚本（见 docs/ARCHITECTURE-TARGET-2026-11-03.md §9.2）。
 *
 * 默认只读预演（--dry）：打印每项存量数据（fields.json 的 6 场值 + memories + chain、
 * 两本日记、judgment.jsonl、feedback.jsonl、causal.jsonl）的迁出计划与条数，不改任何文件。
 *
 * 用法：
 *   node scripts/migrate-capabilities-data.mjs [--dry] [--source <旧根>] [--target <新根>]
 *   node scripts/migrate-capabilities-data.mjs --apply --source <旧根> --target <新根>
 *   node scripts/migrate-capabilities-data.mjs --rollback <migrationId> --target <新根>
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { MemoryCardStore } from '../packages/cap-memory/src/index.ts'

export function runDataMigration(opts) {
  const mode = opts.apply ? 'apply' : 'dry'
  const id = 'mig-' + Date.now().toString(36) + '-' + crypto.randomBytes(2).toString('hex')
  const srcWhaleDir = path.join(opts.sourceDshDir, 'bili-whale')
  const srcFieldsFile = path.join(srcWhaleDir, 'fields.json')
  const srcPublicDiary = path.join(opts.sourceDshDir, 'whale-diary.md')
  const srcPrivateDiary = path.join(opts.sourceDshDir, 'whale-diary-private.md')

  const dstPersonaDir = path.join(opts.targetHomeDir, 'data', 'persona')
  const dstBiliDir = path.join(opts.targetHomeDir, 'data', 'bilibili')
  const dstWorkspaceDir = path.join(opts.targetHomeDir, 'workspace')
  const dstMemoRoot = path.join(dstWorkspaceDir, 'memo')
  const dstDiaryDir = path.join(dstWorkspaceDir, 'diary')

  let fieldsMigrated = false
  const memoriesCount = { total: 0, core: 0, active: 0, voided: 0 }
  let chainCount = 0

  if (fs.existsSync(srcFieldsFile)) {
    const raw = JSON.parse(fs.readFileSync(srcFieldsFile, 'utf8'))
    const memories = Array.isArray(raw.memories) ? raw.memories : []
    const chain = Array.isArray(raw.chain) ? raw.chain : []
    fieldsMigrated = true
    chainCount = chain.length
    for (const m of memories) {
      memoriesCount.total++
      if (m.voided) memoriesCount.voided++
      else if (m.flashbulb || m.pinned || (Array.isArray(m.tags) && m.tags.includes('milestone'))) memoriesCount.core++
      else memoriesCount.active++
    }

    if (opts.apply) {
      fs.mkdirSync(dstPersonaDir, { recursive: true })
      const slimFields = {
        schemaVersion: raw.schemaVersion ?? 5,
        fields: raw.fields,
        chain,
        memories: [],
        npcState: raw.npcState,
        budget: raw.budget,
        emotionHistory: raw.emotionHistory ?? [],
        lastAppliedAt: raw.lastAppliedAt ?? new Date().toISOString(),
      }
      fs.writeFileSync(path.join(dstPersonaDir, 'fields.json'), JSON.stringify(slimFields, null, 2), 'utf8')
      fs.writeFileSync(
        path.join(dstPersonaDir, 'runtime.json'),
        JSON.stringify({ chain, npcState: raw.npcState, budget: raw.budget, updatedAt: new Date().toISOString() }, null, 2),
        'utf8',
      )

      const store = new MemoryCardStore(dstMemoRoot)
      for (const m of memories) {
        const tier = m.voided
          ? 'voided'
          : (m.flashbulb || m.pinned || (Array.isArray(m.tags) && m.tags.includes('milestone')))
          ? 'core'
          : 'active'
        const card = store.create({
          id: m.id,
          content: m.content ?? '',
          sender: m.sender === 'player' ? 'player' : 'npc',
          tags: Array.isArray(m.tags) ? m.tags : [],
          tier: tier === 'core' ? 'core' : 'active',
          vividness: m.vividness ?? 0.9,
          intensity: m.emotion?.intensity ?? 0.5,
          mood: m.emotion?.valence ?? 0,
          source: m.source ?? 'npc_self',
          milestone: Boolean(m.flashbulb),
          createdAt: m.createdAt,
        })
        if (m.voided) {
          store.voidCard({ id: card.id }, m.voidReason || '历史已作废条目迁移')
        }
      }
    }
  }

  const diariesCopied = {
    publicBytes: fs.existsSync(srcPublicDiary) ? fs.statSync(srcPublicDiary).size : 0,
    privateBytes: fs.existsSync(srcPrivateDiary) ? fs.statSync(srcPrivateDiary).size : 0,
  }
  if (opts.apply) {
    fs.mkdirSync(dstDiaryDir, { recursive: true })
    if (fs.existsSync(srcPublicDiary)) {
      fs.copyFileSync(srcPublicDiary, path.join(dstDiaryDir, 'public.md'))
    }
    if (fs.existsSync(srcPrivateDiary)) {
      fs.copyFileSync(srcPrivateDiary, path.join(dstDiaryDir, 'private.md'))
    }
  }

  const extraPairs = [
    { src: path.join(srcWhaleDir, 'causal.jsonl'), dst: path.join(dstBiliDir, 'causal.jsonl') },
    { src: path.join(srcWhaleDir, 'control', 'judgment.jsonl'), dst: path.join(dstPersonaDir, 'judgment.jsonl') },
    { src: path.join(srcWhaleDir, 'control', 'feedback.jsonl'), dst: path.join(dstPersonaDir, 'feedback.jsonl') },
    { src: path.join(srcWhaleDir, 'life.json'), dst: path.join(dstPersonaDir, 'life.json') },
  ]
  const copiedFiles = []
  for (const pair of extraPairs) {
    if (fs.existsSync(pair.src)) {
      copiedFiles.push(path.relative(opts.targetHomeDir, pair.dst).replace(/\\/g, '/'))
      if (opts.apply) {
        fs.mkdirSync(path.dirname(pair.dst), { recursive: true })
        fs.copyFileSync(pair.src, pair.dst)
      }
    }
  }

  const report = {
    id,
    mode,
    at: new Date().toISOString(),
    sourceDshDir: opts.sourceDshDir,
    targetHomeDir: opts.targetHomeDir,
    fieldsMigrated,
    memoriesCount,
    chainCount,
    diariesCopied,
    copiedFiles,
  }

  if (opts.apply) {
    const ledgerFile = path.join(opts.targetHomeDir, 'data', 'migration-ledger.json')
    fs.mkdirSync(path.dirname(ledgerFile), { recursive: true })
    let list = []
    try { list = JSON.parse(fs.readFileSync(ledgerFile, 'utf8')) } catch {}
    list.push(report)
    fs.writeFileSync(ledgerFile, JSON.stringify(list, null, 2), 'utf8')
  }

  return report
}

export function rollbackDataMigration(targetHomeDir, migrationId) {
  const ledgerFile = path.join(targetHomeDir, 'data', 'migration-ledger.json')
  if (!fs.existsSync(ledgerFile)) {
    return { ok: false, error: '找不到 migration-ledger.json' }
  }
  const list = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'))
  const hit = list.find((x) => x.id === migrationId)
  if (!hit) {
    return { ok: false, error: `找不到迁移记录: ${migrationId}` }
  }
  for (const sub of ['data', 'workspace']) {
    const p = path.join(targetHomeDir, sub)
    if (fs.existsSync(p)) {
      fs.rmSync(p, { recursive: true, force: true })
    }
  }
  return { ok: true }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (isMain) {
  const argv = process.argv.slice(2)
  const val = (k, d) => {
    const i = argv.indexOf('--' + k)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : d
  }
  const sourceDshDir = path.resolve(val('source', path.join(os.homedir(), '.dsh')))
  const targetHomeDir = path.resolve(val('target', path.join(os.homedir(), '.xiaoyu-home')))
  const rollbackId = val('rollback', '')
  if (rollbackId) {
    const r = rollbackDataMigration(targetHomeDir, rollbackId)
    console.log(JSON.stringify(r, null, 2))
    process.exit(r.ok ? 0 : 1)
  }
  const apply = argv.includes('--apply')
  const report = runDataMigration({ sourceDshDir, targetHomeDir, apply })
  console.log(JSON.stringify(report, null, 2))
}
