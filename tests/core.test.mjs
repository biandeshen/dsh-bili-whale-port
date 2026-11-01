import test from 'node:test'
import assert from 'node:assert/strict'
import { canDraft, canApplyWatched, draftRefusal } from '../src/worlds/bili-account/gates.ts'
import { makeRunner } from '../src/worlds/bili-account/runner.ts'
import { emptyState, applyEvent, readMood, describeState, remember } from '../src/worlds/bili-account/personaAdapter.ts'
import { sanitizeEffects } from '../src/worlds/bili-account/definition.ts'
import { upsertDiarySection } from '../src/worlds/bili-account/diary.ts'
import { diaryFresh, diaryRefusal } from '../src/worlds/bili-account/gates.ts'

const HOUR = 3600_000

test('mood：同场值不同成因得到不同情绪', () => {
  const make = (preset) => applyEvent(emptyState(), preset)
  const silent = (days) => { let s = emptyState(); for (let i = 0; i < days; i++) s = applyEvent(s, 'masterSilentDay'); return s }
  assert.equal(readMood(make('masterReplied')).primary, '开心')
  assert.equal(readMood(make('watchedVideo')).primary, '满足')
  assert.equal(readMood(applyEvent(make('watchedVideo'), 'draftApproved')).primary, '雀跃')
  assert.equal(readMood(make('draftRejected')).primary, '失落')
  assert.equal(readMood(make('masterSilentDay')).primary, '平静') // 一天没说话还不至于想念
  assert.equal(readMood(silent(5)).primary, '想念')               // 连接跌破 0.35 才开始想念
  assert.equal(readMood(make('trafficPaused')).primary, '警觉')
})

test('mood：成因超过 6 小时窗口后不再主导标签', () => {
  const s = applyEvent(emptyState(), 'trafficPaused')
  const later = Date.now() + 7 * HOUR
  assert.notEqual(readMood(s, later).primary, '警觉')
})

test('describeState：给模型的状态块带情绪标签、成因和关系', () => {
  let s = emptyState()
  for (let i = 0; i < 5; i++) s = applyEvent(s, 'masterSilentDay')
  const text = describeState(s)
  assert.match(text, /【她现在的情绪】想念/)
  assert.match(text, /成因：主人沉默 \+ 连接感低/)
  assert.match(text, /【状态】体力/)
  assert.match(text, /关系：normal/)
})

test('gate：feed 后未 debrief 一律拒绝出稿（没有 2 小时自动放行）', () => {
  const now = Date.now()
  assert.equal(canDraft(now - 1000, false), false)
  assert.equal(canDraft(now - 1000, true), true)
  assert.equal(canDraft(now - 4 * HOUR, false), false)
  assert.equal(canDraft(0, false), true)
  assert.match(draftRefusal(), /bili_debrief/)
  assert.equal(canApplyWatched(false), false)
  assert.equal(canApplyWatched(true), true)
})

test('mood_apply：custom 效果只收合法原子场', () => {
  const ok = sanitizeEffects([
    { field: 'mood', delta: 0.1, source: 'x' },
    { field: 'boredom', delta: 0.1, source: 'x' },
    { field: 'energy', delta: 9, source: 'x' },
    { field: 'connection', delta: 'NaN', source: 'x' },
  ])
  assert.deepEqual(ok, [{ field: 'mood', delta: 0.1, source: 'custom', priority: 5 }])
  assert.deepEqual(sanitizeEffects('nope'), [])
})

test('remember：note 真正写进记忆（旧实现返回值被丢弃 = 永远不记）', () => {
  const s = remember(emptyState(), '今天鱼片夸我挑的视频好', { intensity: 0.5 })
  assert.equal(s.memories.length, 1)
  assert.match(s.memories[0].content, /鱼片/)
})

test('diary：新的一天自动建日期块，同名小节替换不重复', () => {
  let t = '# 鲸鱼日记 · 给鱼片\n\n'
  t = upsertDiarySection(t, { book: 'public', heading: '看过', body: '| 时间 | BV | 标题 |\n| 2026-10-27 | BV1 | 雨声 |', date: '2026-10-27' })
  t = upsertDiarySection(t, { book: 'public', heading: '想说', body: '- 今天想说的', date: '2026-10-27' })
  t = upsertDiarySection(t, { book: 'public', heading: '看过', body: '| 2026-10-27 | BV2 | 海浪 |', date: '2026-10-27' })
  assert.equal((t.match(/## 2026-10-27/g) || []).length, 1)
  assert.equal((t.match(/## 看过/g) || []).length, 1)
  assert.match(t, /BV2/)
  assert.doesNotMatch(t, /BV1/)
  assert.match(t, /今天想说的/)
})

test('diary：私有日记用三级标题，跨天不串段', () => {
  let t = ''
  t = upsertDiarySection(t, { book: 'private', heading: '本轮留下的判断', body: '- 第一条', date: '2026-10-27' })
  t = upsertDiarySection(t, { book: 'private', heading: '本轮留下的判断', body: '- 第二条', date: '2026-10-28' })
  assert.match(t, /## 2026-10-27/)
  assert.match(t, /## 2026-10-28/)
  assert.match(t, /### 本轮留下的判断/)
  assert.equal((t.match(/- 第一条/g) || []).length, 1)
})

test('gate：日记超过 24h 就不许出稿', () => {
  const now = Date.now()
  assert.equal(diaryFresh(now - 3600_000, now), true)
  assert.equal(diaryFresh(now - 25 * HOUR, now), false)
  assert.equal(diaryFresh(0, now), false)
  assert.match(diaryRefusal(), /bili_diary_append/)
})

test('kill runner：开关打开时拒绝 spawn', () => {
  let spawned = 0
  const r = makeRunner({
    nodePath: 'node', biliPath: 'x', killPath: 'KILL',
    exists: (p) => p === 'KILL',
    spawn: () => { spawned += 1; return { status: 0, stdout: 'ok', stderr: '' } },
  })
  assert.deepEqual(r(['traffic']), { status: -2, out: '[blocked] kill switch is on' })
  assert.equal(spawned, 0)
})
