/**
 * 控制台图片 World：宿主三个口子（store / blob / modelFacts）接得对不对。
 *
 * 这层只做接线，所以测试就用假 host 验"接上了没有"，不重复验业务逻辑
 * （那些在 cap-console-image/tests 里）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

const mod = await import('../src/index.ts')
const { createConsoleImageWorld } = mod

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])

/** 假 host：三样口子都给，看 World 有没有真的用上。 */
function fakeHost({ accepts = true, throws = false } = {}) {
  const calls = { range: [], blob: [], model: 0, accepts: [] }
  return {
    calls,
    store: {
      range(q) {
        calls.range.push(q)
        if (throws) throw new Error('store down')
        return [
          { cursor: 1, ts: '2026-11-20T09:00:00Z', senderKey: 'console', blobs: [{ handle: 'log:old', mime: 'image/png', fallbackText: '旧图' }] },
          { cursor: 2, ts: '2026-11-20T10:00:00Z', meta: { from: '主人' }, blobs: [
            { handle: 'log:a1', mime: 'image/png', fallbackText: '一张截图' },
            { handle: 'log:pdf', mime: 'application/pdf', fallbackText: '不是图' },
          ] },
        ]
      },
    },
    blob(handle) {
      calls.blob.push(handle)
      return handle === 'log:a1' ? { bytes: PNG, mime: 'image/png' } : null
    },
    modelFacts: {
      model() { calls.model++; return 'test-model' },
      accepts(mime) { calls.accepts.push(mime); return accepts },
    },
    pushEvent() {},
    log: { info() {}, warn() {}, error() {} },
  }
}

const toolOf = (w) => w.tools().find((t) => t.name === 'console_see_image')

/**
 * Cortico 的 handler 约定（cortico-adapter:76）：字符串原样返回，对象才 JSON.stringify。
 * 两者到达调用方时都是 string，所以这里先试着 JSON.parse，失败就当纯文本。
 */
async function call(world, args) {
  const raw = await toolOf(world).handler(args)
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

test('没 start 时：清单说没有、看图说取不到，都不抛', async () => {
  const { world } = createConsoleImageWorld()
  assert.match(await call(world, {}), /还没有图/)
  assert.match(await call(world, { handle: 'log:a1' }), /取不到这张图/)
})

test('start 之后：清单按来源查事件库，只列图片、同句柄只留最新', async () => {
  const { world } = createConsoleImageWorld()
  const h = fakeHost()
  await world.start(h)

  const out = await call(world, {})
  assert.equal(typeof out, 'string')
  assert.match(out, /控制台上还留着/)
  assert.match(out, /log:a1/)
  assert.match(out, /主人/, 'meta.from 优先于 senderKey')
  assert.doesNotMatch(out, /log:pdf/, '非图片不进清单')

  assert.equal(h.calls.range.length, 1)
  assert.equal(h.calls.range[0].source, 'console', '默认来源是 console')
})

test('来源可换：给别的 source 就只查那个', async () => {
  const { world } = createConsoleImageWorld({ source: 'qq' })
  const h = fakeHost()
  await world.start(h)
  await call(world, {})
  assert.equal(h.calls.range[0].source, 'qq')
})

test('模型收图：回执带字节', async () => {
  const { world } = createConsoleImageWorld()
  const h = fakeHost({ accepts: true })
  await world.start(h)

  const out = await call(world, { handle: 'log:a1' })
  assert.equal(typeof out, 'object')
  assert.match(out.text, /image\/png/)
  assert.equal(out.blobs.length, 1)
  assert.equal(out.blobs[0].mime, 'image/png')
  // 经 JSON.stringify 后 Uint8Array 会变成 {"0":..}；比对内容而不是类型
  assert.deepEqual(Object.values(out.blobs[0].bytes), [...PNG])
  assert.deepEqual(h.calls.blob, ['log:a1'])
  assert.equal(h.calls.model, 1)
  assert.deepEqual(h.calls.accepts, ['image/png'])
})

test('模型不收图：明说看了也收不到，不回字节', async () => {
  const { world } = createConsoleImageWorld()
  const h = fakeHost({ accepts: false })
  await world.start(h)

  const out = await call(world, { handle: 'log:a1' })
  assert.equal(typeof out, 'string', '不收图时不能带 blobs')
  assert.match(out, /test-model/)
  assert.match(out, /不接收图像/)
})

test('事件库挂了：清单当没有，不把工具带崩', async () => {
  const { world } = createConsoleImageWorld()
  await world.start(fakeHost({ throws: true }))
  assert.match(await call(world, {}), /还没有图/)
})

test('stop 之后回到"没启动"状态', async () => {
  const { world } = createConsoleImageWorld()
  await world.start(fakeHost())
  await world.stop()
  assert.match(await call(world, {}), /还没有图/)
})

test('面板：list 报能力与清单；setInventoryMax 可写', async () => {
  const { world, capability } = createConsoleImageWorld()
  await world.start(fakeHost({ accepts: true }))
  const ui = world.webUi()
  assert.equal(ui.panels.length, 1)
  const list = await ui.invoke('console-image', 'list', [])
  assert.equal(list.ok, true)
  assert.equal(list.accepts.accepts, true)
  assert.ok(list.images.length >= 1)

  const methods = capability.panels()[0].methods
  assert.ok(Object.values(methods).some((m) => m.writable === true && m.verb === 'POST'))
})

test('装载入口：create() 返回 world，id 稳定', () => {
  const w = mod.default.create({ cfg: {} })
  assert.equal(w.id, 'console-image')
  assert.equal(typeof w.tools, 'function')
  assert.equal(w.tools().length, 1)
})
