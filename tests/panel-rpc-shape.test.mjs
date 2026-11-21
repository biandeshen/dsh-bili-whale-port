// 面板 RPC 的**返回形状**契约（2026-11-21 真浏览器验收抓到的两个 bug 的回归）。
//
// 这两个 bug 的共性：函数本身是对的，但**返回形状和面板读的不是一回事**。
// 单测按"我以为是那个形状"写，永远抓不到；只有拿面板真正读的字段去断言才行。
//
//   ① getLayers 读 `o.deploy`，而 readOverrides 返回 `{overrides:{deploy}}`
//      → 设了部署默认，状态栏永远说"没有"
//   ② listPresets 返回 `{store:{presets}}`，面板读 `r.presets`
//      → 存了预设，列表永远说"还没有保存过"
//
// 判据：**以面板读取的字段名为准**断言，而不是以服务端"返回了什么"为准。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createMediaStudioCapability } from '../packages/capabilities/cap-media-studio/src/index.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'shape-'))

function mount() {
  const dir = tmp()
  const cap = createMediaStudioCapability({ outputDir: dir, bgmDir: path.join(dir, 'bgm') })
  const panel = cap.panels().find((p) => p.id === 'prompt-preset')
  return { cap, panel, dir }
}

const sel = { sceneId: '02-rain-a', form: 'chibi', style: true, formOn: true, character: true, scene: true, negative: false }

test('① setDeployOverride 之后，getLayers 的顶层 deploy 必须能读到（面板就是这么读的）', (t) => {
  const { panel, dir } = mount()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  const set = panel.methods.setDeployOverride.invoke({ selection: sel })
  assert.equal(set.ok, true)

  const layers = panel.methods.getLayers.invoke({})
  assert.equal(layers.ok, true)
  assert.notEqual(layers.deploy, null, '设过部署默认，getLayers 的 deploy 不许是 null')
  assert.equal(layers.deploy.sceneId, sel.sceneId)
  assert.equal(layers.deploy.negative, false)
})

test('① 清掉之后 getLayers 才回到 null（区分"没设过"与"读不到"）', (t) => {
  const { panel, dir } = mount()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  panel.methods.setDeployOverride.invoke({ selection: sel })
  panel.methods.clearDeployOverride.invoke({})
  assert.equal(panel.methods.getLayers.invoke({}).deploy, null)
})

test('② savePreset 之后，listPresets 的顶层 presets 必须是非空数组（面板读 r.presets）', (t) => {
  const { panel, dir } = mount()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))

  const saved = panel.methods.savePreset.invoke({ name: '雨夜', selection: sel })
  assert.equal(saved.ok, true)

  const list = panel.methods.listPresets.invoke({})
  assert.equal(list.ok, true)
  assert.ok(Array.isArray(list.presets), 'presets 必须是顶层数组，不能藏在 store 里')
  assert.equal(list.presets.length, 1)
  assert.equal(list.presets[0].name, '雨夜')
})

test('② 面板渲染预设列表时读到的四个字段都在（名字/场景/开关/操作）', (t) => {
  const { panel, dir } = mount()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  panel.methods.savePreset.invoke({ name: '雨夜', selection: sel })
  const p = panel.methods.listPresets.invoke({}).presets[0]
  // 面板那一行要画：p.name / p.selection.sceneId / 各开关 / p.id（删除要用）
  assert.equal(typeof p.name, 'string')
  assert.equal(typeof p.selection?.sceneId, 'string')
  assert.equal(typeof p.selection?.negative, 'boolean')
  assert.equal(typeof p.id, 'string')
})

test('② 导入之后 listPresets 立刻能看到（不是只写文件不回显）', (t) => {
  const { panel, dir } = mount()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const r = panel.methods.importPresets.invoke({ payload: { presets: [{ id: 'x1', name: '导入的', selection: sel }] } })
  assert.equal(r.ok, true)
  const list = panel.methods.listPresets.invoke({})
  assert.equal(list.presets.length, 1)
  assert.equal(list.presets[0].name, '导入的')
})

test('composePrompt 与 getLayers 对"部署层有没有生效"必须给出一致答案', (t) => {
  const { panel, dir } = mount()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  panel.methods.setDeployOverride.invoke({ selection: sel })

  const layers = panel.methods.getLayers.invoke({})
  const composed = panel.methods.composePrompt.invoke({})
  assert.equal(composed.ok, true)
  // 一个说"有部署层"，另一个也必须按它算——两处口径不一致就是这次 bug 的形态
  assert.notEqual(layers.deploy, null)
  assert.equal(composed.selection.negative, layers.deploy.negative)
  assert.equal(composed.selection.sceneId, layers.deploy.sceneId)
})
