/**
 * 控制台图片能力包：她能不能真的看到主人发的图。
 *
 * 钉住四件事：
 *   ① 模型不收图时**明说**，不许把字节塞进回执假装能看；
 *   ② 不带参数 = 清单（看不了也照样告诉她图在、谁发的）；
 *   ③ 句柄可省略 `log:` 前缀；
 *   ④ 取不到 / 不是图片 → 回执里说清楚，不抛。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

const { createConsoleImageCapability } = await import('../src/index.ts')

const IMG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0])

function mk(over = {}) {
  return createConsoleImageCapability({
    listImages: () => [
      { handle: 'log:a1', from: '主人', at: '2026-11-20T10:00:00Z', fallbackText: '一张截图', mime: 'image/png' },
      { handle: 'log:b2', from: '主人', at: '2026-11-20T10:05:00Z', fallbackText: '第二张', mime: 'image/png' },
    ],
    readImage: (h) => (h === 'log:a1' ? { bytes: IMG, mime: 'image/png' } : null),
    acceptsImage: () => ({ model: 'm1', accepts: true }),
    ...over,
  })
}

const tool = (cap) => cap.tools().find((x) => x.name === 'console_see_image')

test('契约：三段式齐全，工具只读，面板有可写方法', () => {
  const cap = mk()
  assert.equal(cap.id, 'console-image')
  assert.equal(cap.kind, 'internal')
  assert.equal(cap.configSchema.type, 'object')
  const t = tool(cap)
  assert.ok(t, '要有 console_see_image')
  assert.notEqual(t.mutatesState, true, '看图不是写操作')
  const methods = Object.values(cap.panels()[0].methods)
  assert.ok(methods.some((m) => m.writable === true && m.verb === 'POST'))
})

test('不带参数 = 清单（看不了也照样告诉她图在）', async () => {
  const cap = mk({ acceptsImage: () => ({ model: 'm1', accepts: false }) })
  const out = await tool(cap).execute({})
  assert.match(out, /控制台上还留着/)
  assert.match(out, /log:a1/)
  assert.match(out, /主人/)
})

test('模型不收图：明说看了也收不到，不回字节', async () => {
  const cap = mk({ acceptsImage: () => ({ model: 'no-vision', accepts: false }) })
  const out = await tool(cap).execute({ handle: 'log:a1' })
  assert.equal(typeof out, 'string', '这种情况必须回文字，不能带 blobs')
  assert.match(out, /no-vision/)
  assert.match(out, /不接收图像/)
})

test('模型收图：回执带上字节与 mime', async () => {
  const cap = mk()
  const out = await tool(cap).execute({ handle: 'log:a1' })
  assert.equal(typeof out, 'object')
  assert.match(out.text, /image\/png/)
  assert.equal(out.blobs.length, 1)
  assert.equal(out.blobs[0].mime, 'image/png')
  assert.deepEqual([...out.blobs[0].bytes], [...IMG])
})

test('句柄可省略 log: 前缀', async () => {
  const cap = mk()
  const out = await tool(cap).execute({ handle: 'a1' })
  assert.match(out.text, /log:a1/, '回执里应回显补全后的句柄')
})

test('取不到那张图：说清楚并提示调清单，不抛', async () => {
  const cap = mk()
  const out = await tool(cap).execute({ handle: 'log:nope' })
  assert.equal(typeof out, 'string')
  assert.match(out, /取不到这张图/)
  assert.match(out, /不带参数/)
})

test('不是图片的 mime 也当取不到', async () => {
  const cap = mk({ readImage: () => ({ bytes: new Uint8Array([1]), mime: 'application/pdf' }) })
  const out = await tool(cap).execute({ handle: 'log:a1' })
  assert.equal(typeof out, 'string')
  assert.match(out, /取不到这张图/)
})

test('事件库读失败不许把工具带崩', async () => {
  const cap = mk({
    listImages: () => { throw new Error('store boom') },
    readImage: () => { throw new Error('blob boom') },
  })
  const list = await tool(cap).execute({})
  assert.match(list, /还没有图/, '读不到就当作没有，而不是抛')
  const one = await tool(cap).execute({ handle: 'log:a1' })
  assert.match(one, /取不到这张图/)
})

test('面板 list 同时报能力与清单', async () => {
  const cap = mk()
  const out = cap.panels()[0].methods.list.invoke()
  assert.equal(out.ok, true)
  assert.equal(out.accepts.accepts, true)
  assert.equal(out.images.length, 2)
})
