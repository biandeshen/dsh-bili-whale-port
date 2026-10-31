import test from 'node:test'
import assert from 'node:assert/strict'
import { canDraft, canApplyWatched, draftRefusal } from '../src/worlds/bili-account/gates.ts'
import { makeRunner } from '../src/worlds/bili-account/runner.ts'
import { emptyState, applyEvent, readMood, describeState, remember, recentWatch, annotateFeed } from '../src/worlds/bili-account/personaAdapter.ts'
import { sanitizeEffects } from '../src/worlds/bili-account/definition.ts'
import { upsertDiarySection, sectionStats } from '../src/worlds/bili-account/diary.ts'
import { canReply, dmAutoPlan, DM_REPLY_WINDOW_MS } from '../src/worlds/bili-account/dm-reply.ts'
import { diaryFresh, diaryRefusal } from '../src/worlds/bili-account/gates.ts'

const HOUR = 3600_000
const DAY = 86400_000
const T0 = Date.parse('2026-10-01T21:40:00+08:00')

test('mood：同场值不同成因得到不同情绪', () => {
  const make = (preset) => applyEvent(emptyState(), preset)
  // 一天一次、跨天调用：同一天里连刷 5 次会被来源预算按天封顶（不是 5 天的效果）
  const silent = (days) => { let s = emptyState(); for (let i = 1; i <= days; i++) s = applyEvent(s, 'masterSilentDay', T0 + i * DAY); return s }
  assert.equal(readMood(make('masterReplied')).primary, '温暖')
  assert.equal(readMood(make('watchedVideo')).primary, '灵感')
  assert.equal(readMood(applyEvent(make('watchedVideo'), 'draftApproved')).primary, '快乐')
  assert.equal(readMood(make('draftRejected')).primary, '挫败')
  assert.equal(readMood(make('masterSilentDay')).primary, '宁静') // 一天没说话还不至于孤独
  assert.equal(readMood(silent(5)).primary, '孤独')               // 连接跌破 0.35 才转孤独
  assert.equal(readMood(make('trafficPaused')).primary, '焦虑')
})

test('mood：成因超过 6 小时窗口后不再主导标签', () => {
  const s = applyEvent(emptyState(), 'trafficPaused')
  const later = Date.now() + 7 * HOUR
  assert.notEqual(readMood(s, later).primary, '警觉')
})

test('mood：刚起身的 action 成因不再恒为「平静」', () => {
  const withAction = (fields = {}) => {
    const s = emptyState()
    s.fields = { ...s.fields, ...fields }
    s.chain.push({
      id: 'c-action', timestamp: new Date(), npcId: 'xiaoyu', layer: 'L0',
      type: 'field_change', description: '刚起身', fieldChanges: [], source: 'action',
    })
    return s
  }
  assert.equal(readMood(withAction({ energy: 0.2, mood: -0.1 })).primary, '忧郁')
  assert.equal(readMood(withAction({ energy: 0.7, mood: 0.1, curiosity: 0.8, stimulation: 0.2 })).primary, '渴望')
  assert.equal(readMood(withAction({ energy: 0.7, mood: 0.1, curiosity: 0.4, creativity: 0.7 })).primary, '灵感')
  // 场值中性时标签可以就是宁静，但成因必须仍然认得出是「刚起身」
  const calm = readMood(withAction({ energy: 0.7, mood: 0.1, curiosity: 0.4, creativity: 0.4 }))
  assert.match(calm.reason, /刚起身/)
})

test('describeState：给模型的状态块带情绪标签、成因和关系', () => {
  const now = Date.now()
  let s = emptyState()
  for (let i = 1; i <= 5; i++) s = applyEvent(s, 'masterSilentDay', now - (5 - i) * DAY) // 最后一次就在刚才
  const text = describeState(s)
  assert.match(text, /【她现在的情绪】孤独/)
  assert.match(text, /成因：主人沉默 \+ 连接感低/)
  assert.match(text, /【状态】体力/)
  assert.match(text, /关系：未判定/)
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

test('diary：同一天历史重复「想说」收拢为一个，保留其它小节', () => {
  let t = '# 鲸鱼日记 · 给鱼片\n\n## 2026-10-30\n\n## 想说\n\n- 09:12 的旧段 Yoga Nidra\n\n## 看过\n\n| 时间 | BV | 标题 |\n| 2026-10-30 | BV1d3411t7dV | 雷雨声 |\n\n## 想说\n\n- 11:11 的雷雨 283 桶\n'
  t = upsertDiarySection(t, { book: 'public', heading: '想说', body: '- 最新写入', date: '2026-10-30' })
  const dateBlock = t.slice(t.indexOf('## 2026-10-30'))
  assert.equal((dateBlock.match(/## 想说/g) || []).length, 1)
  assert.equal((dateBlock.match(/## 看过/g) || []).length, 1)
  assert.match(dateBlock, /最新写入/)
  assert.doesNotMatch(dateBlock, /Yoga Nidra/)
  assert.doesNotMatch(dateBlock, /雷雨 283 桶/)
  assert.match(dateBlock, /雷雨声/)
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

test('时钟回拨：applyEvent 不把 lastAppliedAt 倒退', () => {
  const s = emptyState()
  const future = new Date(Date.now() + 86400_000).toISOString()
  s.lastAppliedAt = future
  const after = applyEvent(s, 'watchedVideo')
  assert.ok(Date.parse(after.lastAppliedAt) >= Date.parse(future))
})

test('M4：今天日记写雨，「记得」里雨声那条排在最前（不是最鲜活那条）', () => {
  let s = emptyState()
  s = remember(s, '看过《雨声》（雨声实验室） —— BV1aaBBccDD1', { sender: 'npc', intensity: 0.4, source: 'npc_self' })
  s.memories[s.memories.length - 1].createdAt = new Date(Date.now() - 5 * DAY)
  s = remember(s, '看过《猫咪日常》（猫猫台） —— BV1xxYYzz001', { sender: 'npc', intensity: 0.95, source: 'npc_self' })
  s.memories[s.memories.length - 1].createdAt = new Date(Date.now() - DAY)
  const text = describeState(s, 5, { queryText: '今天又下雨了，雨声一直没停', seed: '2026-10-29' })
  const iRain = text.indexOf('看过《雨声》')
  const iCat = text.indexOf('猫咪日常')
  assert.ok(iRain >= 0 && iCat >= 0, text)
  assert.ok(iRain < iCat, '相关的旧记忆应该排在新记忆前面')
})

test('M4：feed 标注近 7 天看过的 BV，并提示避开同 UP', () => {
  let s = emptyState()
  s = remember(s, '看过《雨声》（雨声实验室） —— BV1aaBBccDD1', { sender: 'npc', intensity: 0.5, source: 'npc_self' })
  s.memories[s.memories.length - 1].createdAt = new Date(Date.now() - 2 * DAY)
  const recent = recentWatch(s)
  assert.deepEqual(recent.bvs, ['BV1aaBBccDD1'])
  const out = annotateFeed([
    '今天可以看这几条：',
    '  1. BV1aaBBccDD1   120s  雨声  @雨声实验室',
    '  2. BV1newCandidate  90s  海浪  @另一家',
  ].join('\n'), recent)
  assert.match(out, /BV1aaBBccDD1.*\[近 7 天看过\]/)
  assert.doesNotMatch(out, /BV1newCandidate.*\[近 7 天看过\]/)
  assert.match(out, /避开同题材/)
  assert.match(out, /雨声实验室/)
})

test('OPS-B2：sectionStats 与 upsert 同源——回执能区分替换/追加', () => {
  const pub = ['# 鲸鱼日记', '', '## 2026-10-30', '', '## 想说', '', '- 旧内容一二三四', ''].join(String.fromCharCode(10))
  const r1 = sectionStats(pub, '2026-10-30', '想说', 'public')
  assert.equal(r1.existed, true)
  assert.ok(r1.chars > 0, '已有小节要报出字数')
  assert.equal(sectionStats(pub, '2026-10-30', '今日指标', 'public').existed, false, '没有的小节 = 追加')
  assert.equal(sectionStats(pub, '2026-10-31', '想说', 'public').existed, false, '没有的日期 = 追加')
  const priv = ['## 2026-10-30', '', '### 本轮留下的判断', '', '- 甲', ''].join(String.fromCharCode(10))
  assert.equal(sectionStats(priv, '2026-10-30', '本轮留下的判断', 'private').existed, true, '私人日记三级标题')

  const replaced = upsertDiarySection(pub, { book: 'public', heading: '想说', body: '- 新内容', date: '2026-10-30' })
  assert.ok(sectionStats(replaced, '2026-10-30', '想说', 'public').existed)
  assert.ok(replaced.includes('- 新内容'))
  const appended = upsertDiarySection(pub, { book: 'public', heading: '今日指标', body: 'X=1', date: '2026-10-30' })
  assert.equal(sectionStats(appended, '2026-10-30', '今日指标', 'public').existed, true)
})
test('OPS-故障：回信时效=最后一次成功读收件箱，空读解锁（她的死循环）', () => {
  const now = Date.parse('2026-10-31T00:00:00+08:00')
  // 默认窗口不限（主人 11-01 判定），这里显式给一档来验"窗口"这件事本身还成立
  const WINDOW = 7 * 86400_000
  // 旧行为：只有消息时刻 → 超过窗口永远拒
  const lifeOld = { lastInboundKey: 'k1', lastInboundAt: now - (WINDOW + 1000) }
  assert.equal(canReply(lifeOld, now, WINDOW).reason, 'stale', '没读过时退回消息时刻：超窗仍拒')
  assert.equal(canReply(lifeOld, now).reason, 'ok', '默认不限：同一份数据不再被拒')
  // 新行为：刚读过（哪怕是空读）→ 解锁
  const lifeRead = { ...lifeOld, lastDmReadAt: now - 5000 }
  assert.deepEqual(canReply(lifeRead, now, WINDOW), { ok: true, reason: 'ok' })
  // 读过但超过窗口 → 仍拒（上下文真的旧了）
  const lifeStale = { lastInboundKey: 'k1', lastDmReadAt: now - (WINDOW + 1) }
  assert.equal(canReply(lifeStale, now, WINDOW).reason, 'stale')
  // 没有来信 → no-key（不凭空写私信）
  assert.equal(canReply({ lastDmReadAt: now }, now).reason, 'no-key')
  assert.equal(canReply(null, now).reason, 'no-key')
})
test('分级放开：bili_dm_reply 直发计划 = 文案校验 + 时效门，参数永远带 --go', () => {
  const now = Date.parse('2026-10-31T00:00:00+08:00')
  const life = { lastInboundKey: 'k1', lastDmReadAt: now - 5000 }
  // 合法 → 直发参数
  assert.deepEqual(dmAutoPlan('  收到，本小姐这就去看  ', life, now), {
    ok: true, reason: 'ok', args: ['dm', '--msg', '收到，本小姐这就去看', '--go'],
  })
  // 文案校验先于时效门
  assert.equal(dmAutoPlan('', life, now).reason, 'empty')
  assert.equal(dmAutoPlan('  ', life, now).reason, 'empty')
  assert.equal(dmAutoPlan('字'.repeat(501), life, now).reason, 'too-long')
  assert.deepEqual(dmAutoPlan('字'.repeat(500), life, now).args.slice(0, 2), ['dm', '--msg'], '500 字整不拒')
  // 时效门原样传导（直发不放松任何门）
  // 默认时效窗不限（主人 11-01 判定 7 天窗没必要，它只会造死循环）：隔八天回也算合法计划
  assert.equal(dmAutoPlan('回一句', { lastInboundKey: 'k1', lastDmReadAt: now - (7 * 86400_000 + 1) }, now).reason, 'ok')
  assert.equal(dmAutoPlan('回一句', { lastDmReadAt: now }, now).reason, 'no-key')
  assert.equal(dmAutoPlan('回一句', null, now).reason, 'no-key')
})
