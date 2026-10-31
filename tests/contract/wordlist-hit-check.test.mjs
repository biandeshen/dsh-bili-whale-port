/**
 * 复量脚本的行为测试：真的跑 learnTokens/collectLearnedTokens 与 28 条夹具片名，
 * 断言命中率与词表规模的关系；不联网（脚本本来也不联网）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  FIXTURE_TITLES, legacyTokens, stripFixtureMark,
  wordlistOf, hitCheck, report,
} from '../../scripts/wordlist-hit-check.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const avgMatched = (r) => (r.hitCount ? r.hits.reduce((n, h) => n + h.matched.length, 0) / r.hitCount : 0)

test('夹具片名表：28 条、每条都带【夹具】标记，不是真实视频标题', () => {
  assert.equal(FIXTURE_TITLES.length, 28)
  assert.equal(new Set(FIXTURE_TITLES).size, 28, '夹具片名不许重复')
  for (const t of FIXTURE_TITLES) {
    assert.ok(t.startsWith('【夹具】'), `没有夹具标记：${t}`)
    assert.ok([...stripFixtureMark(t)].length >= 6, `夹具片名正文太短：${t}`)
  }
})

test('空词表 = 零命中；词表里的词必须真出现在片名正文里', () => {
  assert.equal(hitCheck({ words: [] }).hitCount, 0)
  const words = ['关东煮', '不存在这个词']
  const r = hitCheck({ titles: ['【夹具】便利店关东煮的做法与汤底', '【夹具】雪落了一夜的小区院子'], words })
  assert.equal(r.hitCount, 1)
  assert.deepEqual(r.hits[0].matched, ['关东煮'])
  assert.equal(r.total, 2)
  assert.equal(r.rate, 0.5)
})

test('夹具标记不计入命中（它是标签，不是内容）', () => {
  const r = hitCheck({ titles: FIXTURE_TITLES, words: ['夹具'] })
  assert.equal(r.hitCount, 0, '【夹具】本身不该被算成偏好词命中')
})

test('词表只学已放行的稿子：pending 那条不进词表', () => {
  const words = wordlistOf()
  assert.ok(words.length > 0)
  // 只有 pending 稿子才有的片段，一旦出现在词表就说明未放行的文案被学了
  assert.equal(words.includes('这条不该进词'), false, 'pending 稿子的词组进了词表')
  assert.ok(words.some((w) => '山间小溪实拍无剪辑'.includes(w)), '已放行稿子里的《山间小溪实拍》应该进词表')
})

test('旧规则（3/4-gram）的复量可观察：词表规模与每条命中的碎片数都远大于现规则', () => {
  const out = report()
  assert.equal(out.current.total, 28)
  assert.equal(out.legacy.total, 28)
  assert.ok(out.legacy.wordCount > out.current.wordCount * 4, `词表规模没拉开：${out.legacy.wordCount} vs ${out.current.wordCount}`)
  assert.ok(out.legacy.hitCount >= out.current.hitCount, '旧规则的无差别命中不该比现规则少')
  assert.ok(avgMatched(out.legacy) > avgMatched(out.current) * 2, `碎片命中数没拉开：${avgMatched(out.legacy)} vs ${avgMatched(out.current)}`)
})

test('legacyTokens 确实按 3/4-gram 滑窗切散文', () => {
  const t = legacyTokens('雨声助眠')
  assert.deepEqual(t, ['雨声助', '声助眠', '雨声助眠'])
  assert.deepEqual(legacyTokens(''), [])
})

test('复量确定性：同一批夹具跑两次结果一字不差', () => {
  assert.deepEqual(report(), report())
  assert.deepEqual(wordlistOf(), wordlistOf())
})

test('CLI 默认离线跑通，--json 给出可机读的两条规则对比', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'wordlist-hit-check.mjs'), '--json'], { encoding: 'utf8', timeout: 30_000 })
  assert.equal(r.status, 0, r.stderr)
  const out = JSON.parse(r.stdout)
  assert.equal(out.titles, 28)
  for (const k of ['current', 'legacy']) {
    assert.equal(typeof out[k].rate, 'number')
    assert.ok(Array.isArray(out[k].hits))
    assert.equal(out[k].total, 28)
  }
})
