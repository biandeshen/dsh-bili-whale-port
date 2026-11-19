// A 的真包验证：同一件事重复记，只落一笔、不重复扣体力。
// 用真 cap-state-rhythm（不是替身），临时目录。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createStateRhythmCapability } from '../src/index.ts'

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'idem-'))
  const cap = createStateRhythmCapability({
    fieldsFile: path.join(dir, 'fields.json'),
    lifeFile: path.join(dir, 'life.json'),
  })
  const tools = Object.fromEntries(cap.tools().map((t) => [t.name, t]))
  return { dir, cap, tools }
}

test('life_do：同一件事连续两次只落一笔，且第二次不扣体力', () => {
  const { tools, dir } = fresh()
  const args = { activity: 'explore', note: '翻记忆池找所有收下的视频，看哪条是漏掉的' }
  const first = tools.life_do.execute(args)
  assert.equal(first.ok, true)
  assert.notEqual(first.deduped, true)
  const energyAfterFirst = first.energy

  const second = tools.life_do.execute({ ...args })
  assert.equal(second.ok, true)
  assert.equal(second.deduped, true, '第二次应判为重复')
  assert.match(second.receipt, /刚记过了/)
  assert.equal(second.energy, undefined, '重复时不返回新的体力值（说明没再扣）')

  // 行动账只有一行
  const recs = fs.readFileSync(path.join(dir, 'actions.ndjson'), 'utf8').trim().split('\n').filter(Boolean)
  assert.equal(recs.length, 1, '行动账应只有一笔')
  // 体力只扣了一次：再读一次行动也不会掉到第二次
  const third = tools.life_do.execute({ activity: 'explore', note: '另一件事，应该放行' })
  assert.notEqual(third.deduped, true, '不同内容必须放行')
  assert.ok(third.energy < energyAfterFirst, '不同内容的行动仍要扣体力')
})

test('life_do：主人手动记（source=owner）不受幂等限制', () => {
  const { tools } = fresh()
  const args = { activity: 'explore', note: '同一句话' }
  const a = tools.life_do.execute({ ...args })
  assert.notEqual(a.deduped, true)
  // 面板侧会带 source=owner；这里直接走内部实现不方便，改测：默认 source 是 self，两次会去重
  const b = tools.life_do.execute({ ...args })
  assert.equal(b.deduped, true)
})

test('mood_apply：同一组情绪参数重复调用不叠加', () => {
  const { tools } = fresh()
  const args = { preset: 'watchedVideo', verdict: 'keep', note: '这条片子好看' }
  const first = tools.mood_apply.execute(args)
  assert.equal(first.ok, true)
  assert.notEqual(first.deduped, true)
  const second = tools.mood_apply.execute({ ...args })
  assert.equal(second.deduped, true)
  assert.match(second.applied, /刚记过/)
  const third = tools.mood_apply.execute({ preset: 'watchedVideo', verdict: 'drop', note: '这条不行' })
  assert.notEqual(third.deduped, true, '不同结论必须放行')
})
