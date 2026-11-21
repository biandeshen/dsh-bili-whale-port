// 预设存取层（中投入 1）。判据重点不是"能存能读"，而是**坏输入不许把列表写烂**。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  readPresets,
  writePresets,
  upsertPreset,
  deletePreset,
  importPresets,
  exportPresets,
  normalizeSelection,
  presetsPath,
} from '../packages/capabilities/cap-media-studio/src/prompt-presets.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'preset-'))
const sel = (over = {}) => ({ sceneId: '01-rain', form: 'chibi', style: true, formOn: true, character: true, scene: true, negative: true, ...over })

test('存 → 读 → 覆盖：同 id 更新而不是堆两条，createdAt 保留', (t) => {
  const dir = tmp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const a = upsertPreset(dir, { name: '雨夜', selection: sel() })
  assert.equal(a.ok, true)
  assert.equal(a.store.presets.length, 1)
  const createdAt = a.preset.createdAt

  const b = upsertPreset(dir, { id: a.preset.id, name: '雨夜（改）', selection: sel({ negative: false }) })
  assert.equal(b.ok, true)
  assert.equal(b.store.presets.length, 1, '同 id 必须覆盖，不许堆第二份')
  assert.equal(b.preset.name, '雨夜（改）')
  assert.equal(b.preset.createdAt, createdAt, 'createdAt 不该被覆盖')
  assert.equal(b.preset.selection.negative, false)

  const back = readPresets(dir)
  assert.equal(back.store.presets[0].name, '雨夜（改）')
  assert.equal(back.note, undefined, '好文件不该带 note')
})

test('删除：删不存在的给错，不是静默成功', (t) => {
  const dir = tmp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const a = upsertPreset(dir, { name: 'x', selection: sel() })
  const del = deletePreset(dir, a.preset.id)
  assert.equal(del.ok, true)
  assert.equal(del.store.presets.length, 0)
  const again = deletePreset(dir, a.preset.id)
  assert.equal(again.ok, false)
  assert.match(again.error, /没有这个预设/)
})

test('坏 JSON 当空处理，但要带 note 说出原因（不许静默消失）', (t) => {
  const dir = tmp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dir, 'prompts'), { recursive: true })
  fs.writeFileSync(presetsPath(dir), '{坏', 'utf8')
  const r = readPresets(dir)
  assert.equal(r.store.presets.length, 0)
  assert.match(r.note ?? '', /不是合法 JSON/)
})

test('一条坏预设只跳过它自己，好的照读', (t) => {
  const dir = tmp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dir, 'prompts'), { recursive: true })
  fs.writeFileSync(presetsPath(dir), JSON.stringify({
    version: 1,
    presets: [
      { id: 'ok', name: '好的', selection: sel() },
      { id: 'bad', name: '', selection: sel() },          // 缺 name
      { id: 'bad2', name: '坏场景', selection: { style: true } }, // 缺 sceneId
    ],
  }), 'utf8')
  const r = readPresets(dir)
  assert.equal(r.store.presets.length, 1)
  assert.equal(r.store.presets[0].id, 'ok')
  assert.match(r.note ?? '', /2 条预设不合格/)
})

test('导入：同 id 覆盖、新 id 追加；整批不合格时一条都不写', (t) => {
  const dir = tmp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const a = upsertPreset(dir, { id: 'p1', name: '原有', selection: sel() })
  assert.equal(a.ok, true)

  const imp = importPresets(dir, {
    presets: [
      { id: 'p1', name: '覆盖后', selection: sel({ style: false }) },
      { id: 'p2', name: '新来的', selection: sel() },
    ],
  })
  assert.equal(imp.ok, true)
  assert.equal(imp.added, 1)
  assert.equal(imp.replaced, 1)
  const after = readPresets(dir).store.presets
  assert.equal(after.length, 2)
  assert.equal(after.find((p) => p.id === 'p1').name, '覆盖后')
  assert.equal(after.find((p) => p.id === 'p1').selection.style, false)

  // 整批里有坏的一条 → 一条都不许进去
  const bad = importPresets(dir, { presets: [{ id: 'p3', name: '好的', selection: sel() }, { id: 'p4', selection: sel() }] })
  assert.equal(bad.ok, false)
  assert.match(bad.error, /整批未导入/)
  assert.equal(readPresets(dir).store.presets.length, 2, '坏批次不许污染现有列表')
})

test('导入也认纯数组（手写的常是这种）', (t) => {
  const dir = tmp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const r = importPresets(dir, [{ id: 'x', name: '数组来的', selection: sel() }])
  assert.equal(r.ok, true)
  assert.equal(r.added, 1)
})

test('导出 → 导入 往返无损（这是"换台机器也能带走"的判据）', (t) => {
  const a = tmp(); const b = tmp()
  t.after(() => { fs.rmSync(a, { recursive: true, force: true }); fs.rmSync(b, { recursive: true, force: true }) })
  upsertPreset(a, { id: 'p1', name: '雨夜', selection: sel(), note: '深夜雨声' })
  upsertPreset(a, { id: 'p2', name: '晚安', selection: sel({ sceneId: '02-night', character: false }) })
  const dumped = exportPresets(a)
  const r = importPresets(b, dumped)
  assert.equal(r.ok, true)
  assert.deepEqual(exportPresets(b).presets, dumped.presets, '往返之后必须一模一样')
})

test('selection 校验：非布尔的开关、缺 sceneId、refNote 非字符串都要拒', () => {
  assert.equal(normalizeSelection({ sceneId: 'a' }).ok, true)
  assert.equal(normalizeSelection({}).ok, false)
  assert.equal(normalizeSelection({ sceneId: 'a', style: 'yes' }).ok, false)
  assert.equal(normalizeSelection({ sceneId: 'a', refNote: 123 }).ok, false)
  // 未知字段被丢掉而不是带进去
  const r = normalizeSelection({ sceneId: 'a', 未知字段: 'x' })
  assert.equal(r.ok, true)
  assert.equal('未知字段' in r.value, false)
})

test('原子写：写完不留 .tmp 残渣', (t) => {
  const dir = tmp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  writePresets(dir, { version: 1, presets: [] })
  const leftovers = fs.readdirSync(path.join(dir, 'prompts')).filter((f) => f.endsWith('.tmp'))
  assert.deepEqual(leftovers, [])
})
