/**
 * 只读预览：当前状态 + 今天日记 → 她会想起什么、voice 会给草稿什么。
 * 不改任何状态、不联网、不产生草稿。
 *
 * 用法（从 Cortico 目录跑，tsx 才能解析类型）：
 *   cd ../Cortico && node --import tsx ../dsh-bili-whale/scripts/preview-recall.mjs
 */
import fs from 'node:fs'
import path from 'node:path'

const HOME = process.env.USERPROFILE || process.env.HOME || ''
const WHALE = process.env.WHALE_HOME || path.join(HOME, '.dsh')
const CORTICO = process.env.CORTICO_ROOT || path.resolve(process.cwd())
const base = 'file:///' + CORTICO.replace(/\\/g, '/')

const { loadState, describeState, recentWatch } = await import(base + '/src/worlds/bili-account/personaAdapter.ts')
const { buildVoiceBrief } = await import(base + '/persona-core/src/voice-brief.ts')
const { dayKey } = await import(base + '/persona-core/src/rhythm.ts')

const state = loadState(path.join(WHALE, 'bili-whale', 'fields.json'))
const diary = (() => { try { return fs.readFileSync(path.join(WHALE, 'whale-diary.md'), 'utf8') } catch { return '' } })()
const tail = diary.slice(-2000)
const seed = dayKey(Date.now())

console.log('== describeState（动作提示里她看到的）==')
console.log(describeState(state, 5, { queryText: tail, seed }))
console.log('\n== voiceBrief（草稿管线拿到的）==')
console.log(JSON.stringify(buildVoiceBrief(state, { now: Date.now(), query: { text: tail, seed } }), null, 2))
console.log('\n== 近 7 天看过 ==')
console.log(JSON.stringify(recentWatch(state), null, 2))
