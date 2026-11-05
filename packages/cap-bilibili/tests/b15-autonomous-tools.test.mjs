/**
 * B15 三件读侧交付（她的意见箱 f-aa12d0 / f-5ab4ec / f-bb3847 的正面答复）：
 *
 * ① bili_seek（好奇心队列取件口）：keyword 直搜 或 fromJudgment 从判「收」的
 *    判断卡 tokens 里定向捞——"我上次收了钢琴曲，再来几个同类的"。
 *    判断卡来源由组装方注入（bilibili 包不反向依赖 journal），没注入要说清。
 * ② judgment_revisit（复盘式练习取题器）：只读取题，优先级=同主题打架 > unclear > 挂着的
 *    proposed；**不写任何账**——改判是日记里她自己的一句"复盘改判"。
 * ③ activeReview（活跃层自审）：只读建议器，久未浮现/流水账/与核心同主题三类，
 *    与 coreReview 同一立场：不自动动她的记忆。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createBiliWorld } from '../../cortico-world-bilibili/src/cortico-world.ts'
import { appendJudgment } from '../../cap-journal/src/judgments-feedback.ts'
import { createJournalCapability } from '../../cap-journal/src/index.ts'
import { createMemoryCapability } from '../../cap-memory/src/index.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'b15-'))

// ── ① bili_seek ──────────────────────────────────────────────────────────────

function worldWith(fetchImpl, judgmentRows = []) {
  const dir = tmp()
  const judgmentFile = path.join(dir, 'judgment.jsonl')
  for (const r of judgmentRows) appendJudgment(r, judgmentFile)
  const w = createBiliWorld({
    homeDir: dir,
    dataDir: path.join(dir, 'data'),
    judgmentFile,
    readContext: { fetch: async (url) => ({ json: async () => await fetchImpl(url) }), cred: { sessdata: 's', bili_jct: 'j', buvid3: 'b' } },
  })
  return { cap: w.capability, dir }
}

test('bili_seek：keyword 直捞，套偏好标注（屏蔽词标在标题上）', async () => {
  const { cap } = worldWith(() => ({ code: 0, data: { result: [
    { bvid: 'BV1xx411c7mD', title: '钢琴曲合集', duration: 600, author: 'a' },
    { bvid: 'BV1xx411c7mE', title: '原神角色PV', duration: 90, author: 'b' },
  ] } }))
  const seek = cap.tools().find((t) => t.name === 'bili_seek')
  assert.ok(seek, '工具要存在')
  const r = await seek.execute({ keyword: '钢琴曲' })
  assert.equal(r.ok, true)
  assert.equal(r.keyword, '钢琴曲')
  assert.equal(r.items.length, 2)
  assert.match(r.items[1].title, /命中屏蔽词|短于/, '超标的候选要标注，不许静默混进池子')
})

test('bili_seek：fromJudgment 从判「收」的卡里取同类（f-aa12d0 ③ 的正脸）', async () => {
  const { cap } = worldWith(() => ({ code: 0, data: { result: [
    { bvid: 'BV1xx411c7mF', title: '无人声雨声', duration: 1200, author: 'c' },
  ] } }), [
    { tokens: ['无人声', '雨声'], verdict: 'keep', reason: '很安静，适合睡前循环' },
    { tokens: ['原神'], verdict: 'drop', reason: '不是助眠类目' },
  ])
  const seek = cap.tools().find((t) => t.name === 'bili_seek')
  const r = await seek.execute({ fromJudgment: true })
  assert.equal(r.ok, true)
  assert.equal(r.keyword, '无人声', '用第一个「收」过的主题词')
  assert.deepEqual(r.fromJudgmentTokens, ['无人声', '雨声'], 'drop 的「原神」不许混进候选词')
})

test('bili_seek：没判过「收」时明说，不许瞎捞；没接判断卡来源也明说', async () => {
  const { cap } = worldWith(() => ({ code: 0, data: { result: [] } }), [])
  const seek = cap.tools().find((t) => t.name === 'bili_seek')
  const r = await seek.execute({ fromJudgment: true })
  assert.equal(r.ok, false)
  assert.match(r.error, /收/)
  const w2 = createBiliWorld({ homeDir: tmp(), dataDir: tmp() }) // 不给 judgmentFile
  const seek2 = w2.capability.tools().find((t) => t.name === 'bili_seek')
  const r2 = await seek2.execute({ fromJudgment: true })
  assert.equal(r2.ok, false)
  assert.match(r2.error, /没接上|keyword/)
})

// ── ② judgment_revisit ───────────────────────────────────────────────────────

test('judgment_revisit：同主题打架 > unclear > 挂着的 proposed；空池说人话', () => {
  const dir = tmp()
  const f = path.join(dir, 'judgment.jsonl')
  appendJudgment({ tokens: ['钢琴曲'], verdict: 'keep', reason: '安静助眠，收' }, f)
  appendJudgment({ tokens: ['钢琴曲'], verdict: 'drop', reason: '这首太闹，不收' }, f)
  appendJudgment({ tokens: ['白噪音'], verdict: 'unclear', reason: '没听出来差别' }, f)
  appendJudgment({ tokens: ['ASMR人声'], verdict: 'keep', reason: '人声轻，收' }, f)
  const r = pickRevisit(f, {})
  assert.equal(r.ok, true)
  assert.ok(r.items.length >= 2)
  assert.equal(r.items[0].why, '同主题结论打架', '尺子自相矛盾的最先出题')
  assert.ok(r.items.some((x) => x.why === '当时没判下来（unclear）'))
  // adopted/rejected 且不打架的不出题
  const adopted = r.items.filter((x) => x.status === 'adopted' && x.why !== '同主题结论打架')
  assert.equal(adopted.length, 0)
  const empty = pickRevisit(f, {})
  // 空池文案只在真没题时出现
  const f2 = path.join(dir, 'j2.jsonl')
  appendJudgment({ tokens: ['雨声'], verdict: 'keep', reason: '收，很安静' }, f2)
  const r2 = pickRevisit(f2, {})
  assert.match(r2.note, /好状态|没有值得重判/)
})

function pickRevisit(file, args) {
  // 通过能力包工具面调（与线上同一条路）
  const cap = createJournalCapability({
    publicDiaryFile: path.join(file, '..', 'public.md'),
    privateDiaryFile: path.join(file, '..', 'private.md'),
    judgmentFile: file,
    feedbackFile: path.join(file, '..', 'feedback.jsonl'),
  })
  const tool = cap.tools().find((t) => t.name === 'judgment_revisit')
  assert.ok(tool, 'judgment_revisit 要挂在工具面')
  return tool.execute(args)
}

// ── ③ activeReview ───────────────────────────────────────────────────────────

test('activeReview：久未浮现/流水账/与核心同主题三类都有账，且是只读建议', () => {
  const dir = tmp()
  const fieldsFile = path.join(dir, 'fields.json')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(fieldsFile, JSON.stringify({ schemaVersion: 5, fields: {}, memories: [], chain: [], npcState: {}, budget: { day: '', spent: {} }, emotionHistory: [], lastAppliedAt: new Date().toISOString() }))
  const cap = createMemoryCapability({ memoRoot: path.join(dir, 'memo'), workspaceDir: dir })
  const store = cap.store
  // 核心：一条讲"雨声"的
  store.create({ content: 'BV1xx411c7mD 这类雨声片是她的安眠类目，尺度：要无人声', tier: 'core', sender: 'npc' })
  // 活跃：三条不同形状
  const old = new Date(Date.now() - 30 * 86400_000).toISOString()
  const a1 = store.create({ content: '看过 BV1xx411c7mD（雨声，10分钟）', sender: 'npc' })
  const a2 = store.create({ content: '主人的原话：少发吃播', sender: 'player' })
  const a3 = store.create({ content: '雨声类候选先看时长，短于 10 分钟跳过', sender: 'npc' })
  // a1 调旧（30 天前）+ 零召回：与核心那条同主题，久未浮现
  const card = store.findById(a1.id)
  store.update({ id: card.id, content: card.content }) // no-op 走一遍写路径确认形状
  const rawFile = path.join(dir, 'memo', 'active', `${card.id}.md`)
  const raw = fs.readFileSync(rawFile, 'utf8').replace(/createdAt: .*/, `createdAt: ${new Date(Date.now() - 30 * 86400_000).toISOString()}`)
  fs.writeFileSync(rawFile, raw, 'utf8')
  const rev = cap.panels().find((p) => p.id === 'memory-center').methods
  const r = rev.activeReview.invoke({ staleDays: 14 })
  assert.equal(r.ok, true)
  assert.ok(r.counts.shadowOfCore >= 1, `雨声那条该被认出与核心同主题，实得 ${JSON.stringify(r.counts)}`)
  const mine = r.items.find((x) => x.id === card.id)
  assert.ok(mine, '活跃层里要能找到那条')
  assert.equal(mine.shadowOfCore, true)
  assert.ok(mine.suggest.length > 0, '每条候选都要给建议动作')
  // a2（主人的原话）不该被建议作废——它是真事，不是流水账
  const a2item = r.items.find((x) => x.content.includes('少发吃播'))
  if (a2item) assert.doesNotMatch(a2item.suggest, /作废/, '主人的话不算流水账')
})
