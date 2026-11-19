/**
 * 只读预览：当前状态 + 今天日记 → 她会想起什么、voice 会给草稿什么。
 * 不改任何状态、不联网、不产生草稿。
 *
 * 用法（从宿主检出目录跑，tsx 才能解析类型）：
 *   cd ../Cortico-up && node --import tsx ../dsh-bili-whale/scripts/preview-recall.mjs
 *
 * 现状（2026-11-12 实测）：它加载的 src/worlds/bili-account/ 只在第二宿主克隆里有，
 * live 那棵检出已经没有这个目录（世界搬进了 packages/cortico-world-bilibili）。
 * 所以本脚本对 live 宿主跑不起来，会明确报「宿主检出里没有 …」；退役与否归旧代码清理批次判。
 */
import fs from 'node:fs'
import path from 'node:path'
import { whaleHome } from '../tools/lib/paths.mjs'
import { hostImport } from './lib/host-root.mjs'

const { loadState, describeState, recentWatch } = await import(hostImport('src/worlds/bili-account/personaAdapter.ts'))
/**
 * 2026-11-19（#88）：persona-core 改读本仓那份。宿主树里那份副本已删，而且它是严格子集、
 * 节奏常量停在 B14 之前——预览要复现的是**线上**的她，不是另一份代码里的她。
 */
const { buildVoiceBrief } = await import('../packages/persona-core/src/voice-brief.ts')
const { dayKey } = await import('../packages/persona-core/src/rhythm.ts')

const state = loadState(path.join(whaleHome, 'bili-whale', 'fields.json'))
const diary = (() => { try { return fs.readFileSync(path.join(whaleHome, 'whale-diary.md'), 'utf8') } catch { return '' } })()
const tail = diary.slice(-2000)
const seed = dayKey(Date.now())

console.log('== describeState（动作提示里她看到的）==')
console.log(describeState(state, 5, { queryText: tail, seed }))
console.log('\n== voiceBrief（草稿管线拿到的）==')
console.log(JSON.stringify(buildVoiceBrief(state, { now: Date.now(), query: { text: tail, seed } }), null, 2))
console.log('\n== 近 7 天看过 ==')
console.log(JSON.stringify(recentWatch(state), null, 2))
