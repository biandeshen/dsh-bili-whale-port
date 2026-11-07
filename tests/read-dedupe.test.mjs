// #3：同一入参的重复"读"不再重送全文，但**不能**变成替她决定读什么。
// 这文件钉的就是那条界线：省的是重复字节，不是她的选择权。
// 底数（2026-11-06 实测）：diary_read 172 次只有 17 种入参、占成本 34.7%。
import test from 'node:test'
import assert from 'node:assert/strict'
import { beforeEach } from 'node:test'
import { toCorticoToolDef, resetReadDedupe } from '../packages/cortico-adapter/src/index.ts'

const big = (tag) => 'x'.repeat(2000) + tag   // 过 READ_DEDUPE_MIN_BYTES
function mk(over = {}) {
  const state = { calls: 0, payload: big('a') }
  const def = toCorticoToolDef({
    name: 'diary_read',
    summary: '读日记',
    description: '读日记',
    parameters: { type: 'object', properties: {} },
    execute: async () => { state.calls += 1; return { text: state.payload } },
    ...over,
  })
  return { def, state }
}
const parse = async (def, args) => JSON.parse(await def.handler(args ?? {}))

beforeEach(() => resetReadDedupe())

test('第二次同入参只给短引用，全文不再重送', async () => {
  const { def, state } = mk()
  const first = await parse(def, { date: '2026-11-06' })
  assert.ok(first.text.length > 1000, '第一次必须是全文')
  const second = await parse(def, { date: '2026-11-06' })
  assert.equal(second.deduped, true)
  assert.equal(second.unchanged, true)
  assert.ok(second.text === undefined, '不能再带全文')
  assert.match(second.note, /again:true/, '逃生口要写在返回里，不能靠她猜')
  assert.equal(state.calls, 2, '执行本身照跑（内容变了要能发现），省的是回灌的字节')
})

test('内容变了必须给全文（去重不能变成拿旧内容糊弄她）', async () => {
  const { def, state } = mk()
  await parse(def, {})
  state.payload = big('b')            // 她刚写了新日记
  const again = await parse(def, {})
  assert.ok(!again.deduped, '指纹变了就该重新展开')
  assert.match(again.text, /b$/)
})

test('入参不同不算重复；带 again/rerun 永远给全文', async () => {
  const { def } = mk()
  await parse(def, { heading: '想说' })
  const other = await parse(def, { heading: '看过' })
  assert.ok(!other.deduped, '换小节是新的读，不该被去重')
  const forced = await parse(def, { heading: '想说', again: true })
  assert.ok(!forced.deduped, '明说要重看就必须真给')
  const forced2 = await parse(def, { heading: '看过', rerun: true })
  assert.ok(!forced2.deduped)
})

test('写类工具一律不去重（mutatesState 的返回必须原样给）', async () => {
  const { def } = mk({ mutatesState: true })
  const a = await parse(def, {})
  const b = await parse(def, {})
  assert.ok(a.text && b.text, '写路径两次都拿原文')
  assert.equal(b.deduped, undefined)
})

test('小返回不折腾；缓存有条数上限（不无界长）', async () => {
  const small = toCorticoToolDef({
    name: 'tiny', summary: 's', description: 'd', parameters: {},
    execute: async () => ({ ok: true }),
  })
  const t1 = await parse(small, {}), t2 = await parse(small, {})
  assert.equal(t2.deduped, undefined, '不到阈值的返回不值得包一层')
  assert.deepEqual(t1, t2)
  for (let i = 0; i < 260; i += 1) {
    const one = toCorticoToolDef({
      name: `k${i}`, summary: 's', description: 'd', parameters: {},
      execute: async () => ({ text: 'y'.repeat(900) }),
    })
    await parse(one, {}); await parse(one, {})
  }
  const replay = await parse(toCorticoToolDef({
    name: 'k0', summary: 's', description: 'd', parameters: {},
    execute: async () => ({ text: 'y'.repeat(900) }),
  }), {})
  assert.equal(replay.deduped, undefined, '被挤出缓存的最多只是再给一次全文，不影响正确性')
})
