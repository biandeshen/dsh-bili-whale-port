// 提示词预设系统（2026-11-21，主人拍板"小投入 5 条 + 中投入都做"）。
//
// 改造前的形状：`composeImagePrompt` 把 character + form + scene + negative
// 按固定公式拼成一串，**没有任何可调的手**——不能关掉某一段、不能插变量、
// 看不到拼出来长什么样、也没有"存一套/换一套"。
//
// 判据按主人点名的那五条小投入 + 三条中投入钉：
//   小1 分条：每个来源（形象正本/形态档/场景/负面）能单独开关
//   小2 实时预览：拿到最终会送出去的那段字
//   小3 token 估算：拼完给一个可核的估算
//   小4 变量插值：{{owner}} / {{today}} 之类从现有状态取
//   小5 重置为默认：改坏了能一键回基线
//   中1 预设存取：保存/命名/列表/删除/导入导出（JSON）
//   中2 三层覆盖：全局默认 → 部署覆盖 → 单轮临时
//   中3 按场景触发：不同场景可用不同条目（v1 先做"每条可绑场景"）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  loadPromptLibrary,
  composeImagePrompt,
  composeFromSelection,
  interpolate,
  estimateTokens,
  listParts,
  DEFAULT_SELECTION,
} from '../packages/capabilities/cap-media-studio/src/image-prompt.ts'

const SRC = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  '..', 'packages', 'capabilities', 'cap-media-studio', 'assets', 'prompts',
)

/** 用包内真实提示词库，避免造假的样本掩盖结构问题。 */
function lib() {
  const l = loadPromptLibrary(SRC)
  assert.ok(l, '包内提示词库必须存在')
  return l
}

const scene = () => lib().scenes[0]

// ── 小1 分条：每段可单独关 ───────────────────────────────────────────
test('小1 关掉负面段 → 拼出来的字里没有「避免出现」', () => {
  const sel = { ...DEFAULT_SELECTION, sceneId: scene().id, negative: false }
  const r = composeFromSelection(lib(), sel)
  assert.equal(r.ok, true)
  assert.doesNotMatch(r.prompt, /避免出现/, 'negative 段关了就不该出现')
})

test('小1 全开 = 与旧 composeImagePrompt 逐字一致（不许偷偷改公式）', () => {
  const s = scene().id
  const legacy = composeImagePrompt(lib(), { sceneId: s, form: 'chibi' })
  const modern = composeFromSelection(lib(), { ...DEFAULT_SELECTION, sceneId: s, form: 'chibi' })
  assert.equal(legacy.ok, true)
  assert.equal(modern.ok, true)
  assert.equal(modern.prompt, legacy.prompt, '默认全开时必须与已出片的公式一字不差')
})

test('小1 关掉形象正本 → 那段字消失，但其余段还在', () => {
  const l = lib()
  const sel = { ...DEFAULT_SELECTION, sceneId: scene().id, character: false }
  const r = composeFromSelection(l, sel)
  assert.equal(r.ok, true)
  assert.ok(!r.prompt.includes(l.character.slice(0, 20)), '形象正本关了就不该在')
  assert.ok(r.prompt.includes(scene().text.slice(0, 12)), '场景段要还在')
})

// ── 小4 变量插值 ─────────────────────────────────────────────────────
test('小4 {{owner}} / {{today}} 插值；未知变量原样留着（不吞掉，方便排查）', () => {
  const vars = { owner: '主人', today: '2026-11-21' }
  assert.equal(interpolate('你好 {{owner}}，今天是 {{today}}', vars), '你好 主人，今天是 2026-11-21')
  assert.equal(
    interpolate('{{owner}} 和 {{nobody}}', vars),
    '主人 和 {{nobody}}',
    '没有的变量保留原样——静默清空会让提示词悄悄变短，最难查',
  )
})

test('小4 变量出现在任意段都会被替换（不是只换第一处）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-'))
  try {
    fs.writeFileSync(path.join(dir, 'character.txt'), '她是 {{owner}} 的鲸鱼娘。', 'utf8')
    fs.writeFileSync(path.join(dir, 'negative.txt'), '出现 {{today}} 的日期水印', 'utf8')
    fs.writeFileSync(path.join(dir, '01-rain.txt'), '{{owner}} 在雨里', 'utf8')
    const l = loadPromptLibrary(dir)
    assert.ok(l)
    /**
     * 这个临时库**没有 form-*.txt**，所以必须显式关掉形态档段——
     * 这是分条开关存在的意义之一：库不完整时可以只关那一段继续用，
     * 而不是像旧函数那样"少一个档就整份拼不出来"。
     */
    const r = composeFromSelection(
      l,
      { ...DEFAULT_SELECTION, sceneId: '01-rain', formOn: false },
      { owner: '鱼片', today: '2026-11-21' },
    )
    assert.equal(r.ok, true, r.ok ? '' : r.error)
    assert.match(r.prompt, /她是 鱼片 的鲸鱼娘/)
    assert.match(r.prompt, /鱼片 在雨里/)
    assert.match(r.prompt, /避免出现 出现 2026-11-21 的日期水印/)
    assert.doesNotMatch(r.prompt, /\{\{/, '插值完不该再剩占位符（有剩就说明漏了某段）')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// ── 小3 token 估算 ───────────────────────────────────────────────────
test('小3 token 估算是可复算的（同输入同结果，且约等于字符数的合理倍数）', () => {
  const text = '竖版插画，日系赛璐璐平涂风格。' .repeat(10)
  const a = estimateTokens(text)
  const b = estimateTokens(text)
  assert.equal(a, b, '同输入必须同结果')
  assert.ok(a > 0)
  // 中文按 ~1 字 1 token 量级，英文按 4 字符 1 token；给一个宽但非零的区间
  const lo = Math.floor(text.length * 0.4)
  const hi = Math.ceil(text.length * 1.6)
  assert.ok(a >= lo && a <= hi, `估算 ${a} 不在 ${lo}~${hi} 的合理区间`)
})

// ── 小5 重置为默认 ───────────────────────────────────────────────────
test('小5 DEFAULT_SELECTION 是全开：重置要回到"和旧公式一致"的状态', () => {
  const s = scene().id
  const reset = composeFromSelection(lib(), { ...DEFAULT_SELECTION, sceneId: s })
  const legacy = composeImagePrompt(lib(), { sceneId: s })
  assert.equal(reset.ok, true)
  assert.equal(legacy.ok, true)
  assert.equal(reset.prompt, legacy.prompt)
})

// ── 小2 实时预览 ─────────────────────────────────────────────────────
test('小2 composeFromSelection 直接给 preview（就是最终 prompt）+ 分段明细', () => {
  const r = composeFromSelection(lib(), { ...DEFAULT_SELECTION, sceneId: scene().id })
  assert.equal(r.ok, true)
  assert.equal(r.preview, r.prompt, '预览必须就是最终要送出去的那段，不许是另拼的一份')
  assert.ok(Array.isArray(r.parts) && r.parts.length >= 4, '要能逐段看是哪几块拼的')
  assert.ok(r.parts.every((p) => typeof p.text === 'string' && typeof p.enabled === 'boolean'))
  assert.ok(typeof r.chars === 'number' && typeof r.tokens === 'number')
})

// ── 分条清单 ─────────────────────────────────────────────────────────
test('listParts 列出四类来源，且标出当前开没开', () => {
  const parts = listParts(lib(), { ...DEFAULT_SELECTION, sceneId: scene().id })
  const kinds = new Set(parts.map((p) => p.kind))
  for (const k of ['style', 'form', 'character', 'scene', 'negative']) {
    assert.ok(kinds.has(k), `缺少来源 ${k}`)
  }
  assert.ok(parts.every((p) => typeof p.enabled === 'boolean'))
})

// ── 参数完整性 ───────────────────────────────────────────────────────
test('缺场景 / 缺形态档时给明确错误，不是抛异常', () => {
  assert.equal(composeFromSelection(lib(), { ...DEFAULT_SELECTION, sceneId: '不存在的场景' }).ok, false)
  assert.equal(composeFromSelection(lib(), { ...DEFAULT_SELECTION, sceneId: scene().id, form: '不存在' }).ok, false)
})
