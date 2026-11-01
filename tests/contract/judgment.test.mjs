/**
 * 判断卡（方案 A）：她提卡 → 主人采纳 → feed 真按它筛。
 * 全部用临时目录，不碰真 ~/.dsh 与 ~/.bili-ai。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'judgment-'))
process.env.WHALE_HOME = home
process.env.USERPROFILE = home
process.env.HOME = home
process.env.BILI_WHALE_CONFIG = path.join(home, 'bili-whale.config.json')

const J = await import('../../tools/lib/judgment.mjs')

const file = path.join(home, 'control', 'judgment.jsonl')
const cfgFile = process.env.BILI_WHALE_CONFIG

test('提卡：立场/作用域/词/理由任一不合法就拒，合法时落一条 proposed', () => {
  assert.match(J.appendJudgment({ tokens: '助眠', reason: '' }, file).error, /理由太短/)
  assert.match(J.appendJudgment({ tokens: '', reason: '标题党太多看不下去' }, file).error, /tokens/)
  assert.match(J.appendJudgment({ scope: 'whatever', tokens: 'x', reason: '标题党太多看不下去' }, file).error, /scope/)
  assert.match(J.appendJudgment({ stance: 'maybe', tokens: 'x', reason: '标题党太多看不下去' }, file).error, /stance/)

  const r = J.appendJudgment({ scope: 'feed', stance: 'avoid', tokens: '助眠, 白噪音,助眠', reason: '高播放低命中+纯符号弹幕=噪声' }, file)
  assert.equal(r.ok, true)
  assert.deepEqual(r.tokens, ['助眠', '白噪音'], '去空白去重')
  const list = J.listJudgments(file)
  assert.equal(list.proposed, 1)
  assert.equal(list.items[0].status, 'proposed')
  assert.equal(list.items[0].reason, '高播放低命中+纯符号弹幕=噪声')
})

test('白名单：不认识的键不会被写进 jsonl（模型给多少都不认）', () => {
  const before = J.listJudgments(file).total
  J.appendJudgment({ tokens: '带货', reason: '这类我都不看', severity: 'high', approvalTier: 'auto', minScore: 1 }, file)
  const raw = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  const card = raw.filter((e) => e.kind === 'judgment').at(-1)
  assert.equal(card.severity, undefined)
  assert.equal(card.approvalTier, undefined)
  assert.equal(card.minScore, undefined)
  assert.equal(J.listJudgments(file).total, before + 1)
  // 清理：删掉这张，免得影响后面 adopt 的断言
  fs.writeFileSync(file, raw.slice(0, -1).map((e) => JSON.stringify(e)).join('\n') + '\n')
})

test('采纳：卡进 preferences.judgments，配置里别的键一个不动；activeJudgments 拆成两桶', () => {
  fs.writeFileSync(cfgFile, JSON.stringify({
    preferences: { like: ['助眠/ASMR'], dislike: ['带货'] },
    publish: { draftMode: 'review' },
  }, null, 2), 'utf8')
  const { id } = J.appendJudgment({ scope: 'feed', stance: 'avoid', tokens: '擦边球', reason: '封面露骨的不看' }, file)
  const r = J.adoptJudgment(id, 'owner', file)
  assert.equal(r.ok, true)

  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'))
  assert.equal(cfg.publish.draftMode, 'review', '别的键不许动')
  assert.deepEqual(cfg.preferences.like, ['助眠/ASMR'], '主人手写的词表不许动')
  assert.equal(cfg.preferences.judgments.length, 1)
  assert.deepEqual(cfg.preferences.judgments[0].tokens, ['擦边球'])
  assert.equal(cfg.preferences.judgments[0].stance, 'avoid')

  const active = J.activeJudgments()
  assert.ok(active.avoid.includes('擦边球'))
  assert.deepEqual(active.prefer, [])
})

test('采纳与驳回只能各做一次：已经了结的卡不能再点', () => {
  const { id } = J.appendJudgment({ tokens: '慢节奏', reason: '看不下去这类' }, file)
  assert.equal(J.rejectJudgment(id, '这条想再看', file).ok, true)
  assert.match(J.rejectJudgment(id, '', file).error, /没有这条待采纳/)
  assert.match(J.adoptJudgment(id, 'owner', file).error, /没有这条待采纳/)

  const { id: id2 } = J.appendJudgment({ tokens: '说书', reason: '这类值得多看' }, file)
  assert.equal(J.adoptJudgment(id2, 'owner', file).ok, true)
  assert.match(J.adoptJudgment(id2, 'owner', file).error, /没有这条待采纳/, '采纳过的不能再采纳一遍')

  const list = J.listJudgments(file)
  assert.equal(list.items.find((x) => x.id === id).status, 'rejected')
  assert.equal(list.items.find((x) => x.id === id).rejectedWhy, '这条想再看')
  assert.equal(list.items.find((x) => x.id === id2).status, 'adopted')
})

test('与主人词表冲突时主人赢，冲突逐个记下来', () => {
  fs.writeFileSync(cfgFile, JSON.stringify({
    preferences: {
      like: ['助眠/ASMR'],
      dislike: [],
      judgments: [
        { id: 'j-a', scope: 'feed', stance: 'prefer', tokens: ['助眠', '说书'] },
        { id: 'j-b', scope: 'feed', stance: 'avoid', tokens: ['标题党'] },
      ],
    },
  }, null, 2), 'utf8')
  const active = J.activeJudgments()
  assert.ok(active.prefer.includes('说书'), '不冲突的 prefer 生效')
  assert.ok(!active.prefer.includes('助眠'), '主人「爱看」里有的词不让卡改')
  assert.equal(active.conflicts.length, 1)
  assert.deepEqual(active.conflicts[0].tokens, ['助眠'])
  assert.equal(active.conflicts[0].winner, 'preferences.like')
  assert.ok(active.avoid.includes('标题党'))
})

test('过期的卡不再生效；没有卡时两个桶都是空（合并当天行为不变）', () => {
  fs.writeFileSync(cfgFile, JSON.stringify({
    preferences: {
      like: [], dislike: [],
      judgments: [{ id: 'j-old', scope: 'feed', stance: 'avoid', tokens: ['旧词'], expiresAt: Date.now() - 1000 }],
    },
  }, null, 2), 'utf8')
  assert.deepEqual(J.activeJudgments().avoid, [])
  fs.writeFileSync(cfgFile, JSON.stringify({ preferences: { like: [], dislike: [] } }, null, 2), 'utf8')
  const empty = J.activeJudgments()
  assert.deepEqual([empty.avoid, empty.prefer, empty.conflicts], [[], [], []], '没有卡时两个桶都空')
  assert.deepEqual(empty.ids, [])
})

test('坏行不拖垮整条链：半行损坏时其余照读', () => {
  fs.writeFileSync(file, '{"kind":"judgment","id":"j-ok","tokens":["a1"],"reason":"够长的理由","stance":"prefer"}\n{半行\n', 'utf8')
  const list = J.listJudgments(file)
  assert.equal(list.total, 1)
  assert.equal(list.items[0].id, 'j-ok')
})

test('采纳记在账本上、生效记在配置上：配置里被撤掉后不能继续报"已采纳"', () => {
  fs.writeFileSync(file, '', 'utf8')
  fs.writeFileSync(cfgFile, JSON.stringify({ preferences: { like: [], dislike: [], judgments: [] } }, null, 2), 'utf8')
  const { id } = J.appendJudgment({ tokens: '长视频', reason: '这类太长看不完' }, file)
  J.adoptJudgment(id, 'owner', file)
  assert.equal(J.listJudgments(file).items[0].status, 'adopted', '配置里在 = 已采纳')

  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'))
  cfg.preferences.judgments = []
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2), 'utf8')
  const after = J.listJudgments(file)
  assert.equal(after.items[0].status, 'retired', '配置里没了 = 撤下，不是还在生效')
  assert.equal(after.adopted, 0)
  assert.equal(after.retired, 1)
})

test.after(() => fs.rmSync(home, { recursive: true, force: true }))
