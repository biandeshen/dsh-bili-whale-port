// M2：动态发布器——dry 零写、闸在上传前、成功拿 dyn_id、冷却归 transient、失败不误报成功
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { postImageDynamic } from '../tools/drafts/publishers/bilibili-dynamic.mjs'

// 凭据按 OS 用户读 ~/.bili-ai —— 测试把 USERPROFILE 指到临时家，用假凭据
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pub-home-'))
fs.mkdirSync(path.join(home, '.bili-ai'), { recursive: true })
fs.writeFileSync(path.join(home, '.bili-ai', 'credentials.json'), JSON.stringify({ sessdata: 's'.repeat(8), bili_jct: 'j'.repeat(8), buvid3: 'b' }))
const png = path.join(home, 'px.png')
fs.writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))

const oldUser = process.env.USERPROFILE
const oldGap = process.env.DYNAMIC_WRITE_GAP_MS
process.env.USERPROFILE = home
process.env.DYNAMIC_WRITE_GAP_MS = '0'
test.after(() => { process.env.USERPROFILE = oldUser; if (oldGap === undefined) delete process.env.DYNAMIC_WRITE_GAP_MS; else process.env.DYNAMIC_WRITE_GAP_MS = oldGap })

/** 按 URL 分派的假 fetch：记录请求，按剧本返回。 */
function fakeFetch(script, calls = []) {
  const nav = { code: 0, data: { uname: 'tester', mid: 1, mobile_verified: true, wbi_img: { img_url: 'https://x/bfs/wbi/abc123.png', sub_url: 'https://x/bfs/wbi/def456.png' } } }
  return async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method ?? 'GET' })
    const u = String(url)
    if (u.includes('/nav')) return { status: 200, json: async () => nav }
    if (u.includes('upload_bfs')) return { status: 200, json: async () => script.upload }
    if (u.includes('create/dyn')) return { status: 200, json: async () => script.create }
    throw new Error('unexpected url ' + u)
  }
}

test('dry：只有登录态读请求，零写（上传也不发生）', async () => {
  const calls = []
  const r = await postImageDynamic({ image: png, text: 'hi', go: false, fetchImpl: fakeFetch({}, calls), gateFn: () => true })
  assert.equal(r.ok, true)
  assert.equal(r.dry, true)
  assert.ok(calls.every((c) => c.method === 'GET'), 'dry 不得有 POST：' + JSON.stringify(calls))
})

test('闸不通过 → 拒绝且没上传；上传失败 → exit 6；成功 → dyn_id', async () => {
  const gatedCalls = []
  const gated = await postImageDynamic({ image: png, text: 'hi', go: true, fetchImpl: fakeFetch({}, gatedCalls), gateFn: () => false })
  assert.equal(gated.ok, false)
  assert.equal(gated.exit, 2)
  assert.ok(gatedCalls.every((c) => c.method === 'GET'), '拒绝发生在上传前：' + JSON.stringify(gatedCalls))

  const calls = []
  const upFail = await postImageDynamic({ image: png, text: 'hi', go: true, fetchImpl: fakeFetch({ upload: { code: -404, message: 'x' } }, calls), gateFn: () => true })
  assert.equal(upFail.ok, false)
  assert.equal(upFail.exit, 6)
  assert.equal(calls.filter((c) => c.url.includes('create/dyn')).length, 0, '上传失败不发布')

  const ok = await postImageDynamic({ image: png, text: 'hi', go: true, fetchImpl: fakeFetch({ upload: { code: 0, data: { image_url: 'u', image_width: 1, image_height: 2, img_size: 3 } }, create: { code: 0, data: { dyn_id_str: '888' } } }), gateFn: () => true })
  assert.equal(ok.ok, true)
  assert.equal(ok.dynId, '888')
})

test('发布端点报错不误报成功；TrafficError 归 transient（审批层据此进 cooldown）', async () => {
  const bizFail = await postImageDynamic({ image: png, text: 'hi', go: true, fetchImpl: fakeFetch({ upload: { code: 0, data: { image_url: 'u', image_width: 1, image_height: 2, img_size: 3 } }, create: { code: 509, data: { errmsg: '请求过于频繁' } } }), gateFn: () => true })
  assert.equal(bizFail.ok, false)
  assert.equal(bizFail.dynId, null)

  const calls = []
  const thrower = async (url, opts = {}) => {
    calls.push(String(url))
    if (String(url).includes('/nav')) return { status: 200, json: async () => ({ code: 0, data: { uname: 't', mid: 1, mobile_verified: true, wbi_img: { img_url: 'https://x/bfs/wbi/a123.png', sub_url: 'https://x/bfs/wbi/b456.png' } } }) }
    const e = new Error('写操作冷却中，请稍后再发送'); e.name = 'TrafficError'
    throw e
  }
  const paused = await postImageDynamic({ image: png, text: 'hi', go: true, fetchImpl: thrower, gateFn: () => true })
  assert.equal(paused.ok, false)
  assert.equal(paused.transient, true)
})
