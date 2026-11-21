// 三层覆盖（中投入 2）。判据：优先级可证、坏配置不许把好配置带坏。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  readOverrides,
  writeOverrides,
  clearDeployOverride,
  resolveSelection,
  overridesPath,
} from '../packages/capabilities/cap-media-studio/src/prompt-layers.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'layer-'))
const base = { sceneId: '01-rain', form: 'chibi', style: true, formOn: true, character: true, scene: true, negative: true }

test('没有部署层 → 用 base', (t) => {
  const dir = tmp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const r = resolveSelection(dir, { base })
  assert.deepEqual(r.selection, base)
  assert.deepEqual(r.layers.map((l) => [l.name, l.present]), [['base', true], ['deploy', false], ['run', false]])
})

test('部署层覆盖 base 的对应字段，没提到的保持 base', (t) => {
  const dir = tmp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  writeOverrides(dir, { deploy: { ...base, negative: false, sceneId: '02-night' } })
  const r = resolveSelection(dir, { base })
  assert.equal(r.selection.negative, false, '部署层关了负面')
  assert.equal(r.selection.sceneId, '02-night', '部署层换了场景')
  assert.equal(r.selection.character, true, '没提到的字段保持 base')
  assert.equal(r.layers.find((l) => l.name === 'deploy').present, true)
})

test('单次参数优先级最高（run > deploy > base）', (t) => {
  const dir = tmp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  writeOverrides(dir, { deploy: { ...base, negative: false, character: false } })
  const r = resolveSelection(dir, { base, run: { character: true } })
  assert.equal(r.selection.character, true, 'run 把 deploy 关掉的又打开了')
  assert.equal(r.selection.negative, false, 'run 没提的仍听 deploy')
  assert.equal(r.selection.style, true, '再没提的仍听 base')
})

test('清掉部署层 → 回到 base（base 不可被清）', (t) => {
  const dir = tmp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  writeOverrides(dir, { deploy: { ...base, negative: false } })
  assert.equal(resolveSelection(dir, { base }).selection.negative, false)
  clearDeployOverride(dir)
  assert.equal(resolveSelection(dir, { base }).selection.negative, true)
})

test('坏覆盖文件当没有，但带 note（不许把好 base 带坏）', (t) => {
  const dir = tmp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dir, 'prompts'), { recursive: true })
  fs.writeFileSync(overridesPath(dir), '{坏', 'utf8')
  const r = readOverrides(dir)
  assert.equal(r.overrides.deploy, undefined)
  assert.match(r.note ?? '', /不是合法 JSON/)
  // 合并结果仍是可用的 base
  const merged = resolveSelection(dir, { base })
  assert.deepEqual(merged.selection, base)
})

test('覆盖里的 deploy 不合格（缺 sceneId）→ 忽略并说明', (t) => {
  const dir = tmp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dir, 'prompts'), { recursive: true })
  fs.writeFileSync(overridesPath(dir), JSON.stringify({ deploy: { negative: false } }), 'utf8')
  const r = readOverrides(dir)
  assert.equal(r.overrides.deploy, undefined)
  assert.match(r.note ?? '', /不合格/)
})

test('脏键不进合并结果（部署文件被人手改坏也不会污染 selection）', (t) => {
  const dir = tmp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  writeOverrides(dir, { deploy: { ...base, 偷偷加的键: 'x' } })
  const r = resolveSelection(dir, { base })
  assert.equal('偷偷加的键' in r.selection, false)
})

test('原子写：不留 .tmp', (t) => {
  const dir = tmp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  writeOverrides(dir, { deploy: base })
  const leftovers = fs.readdirSync(path.join(dir, 'prompts')).filter((f) => f.endsWith('.tmp'))
  assert.deepEqual(leftovers, [])
})
