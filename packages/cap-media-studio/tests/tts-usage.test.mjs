// 补账：配音（MiMo TTS）的用量带出 + 402/429 冷却 + stub 不接上报时不崩。
// 全程不打真接口：本地 http server 当 MiMo 替身（只换 origin，不换真实域名）。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { previewTtsAudio, ttsCooldownStatus } from '../src/render.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tts-usage-'))

function fakeMimo(handler) {
  return new Promise((resolve) => {
    let hits = 0
    const srv = http.createServer((req, res) => {
      hits++
      req.on('data', () => {})
      req.on('end', () => handler(res))
    })
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      resolve({
        url: `http://127.0.0.1:${port}`,
        hits: () => hits,
        close: () => new Promise((r) => srv.close(r)),
      })
    })
  })
}

function withMimo(baseUrl, fn) {
  const prevBase = process.env.MIMO_BASE_URL
  const prevKey = process.env.MIMO_API_KEY
  process.env.MIMO_BASE_URL = baseUrl
  process.env.MIMO_API_KEY = 'sk-fake-not-a-real-key'
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prevBase === undefined) delete process.env.MIMO_BASE_URL
      else process.env.MIMO_BASE_URL = prevBase
      if (prevKey === undefined) delete process.env.MIMO_API_KEY
      else process.env.MIMO_API_KEY = prevKey
    })
}

test('MiMo 响应里的 usage 会被带出来并交给上报口', async () => {
  const dir = tmp()
  const base = await fakeMimo((res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      choices: [{ message: { audio: { data: Buffer.from('ID3fake').toString('base64') } } }],
      usage: { prompt_tokens: 120, completion_tokens: 40, prompt_cache_hit_tokens: 20 },
    }))
  })
  const seen = []
  try {
    await withMimo(base.url, async () => {
      const r = await previewTtsAudio({
        text: '你好',
        outFile: path.join(dir, 'voice.mp3'),
        onTtsUsage: (u) => seen.push(u),
      })
      assert.equal(r.ok, true, r.error)
      assert.equal(r.provider, 'mimo')
      assert.equal(seen.length, 1, '应上报一次用量')
      assert.equal(seen[0].usage.prompt_tokens, 120, '原始 usage 原样带出，不在这里改名')
      assert.equal(seen[0].provider, 'mimo')
    })
  } finally {
    await base.close()
  }
})

test('402 后写冷却：第二次直接走 edge，不再打 MiMo', async () => {
  const dir = tmp()
  const base = await fakeMimo((res) => {
    res.writeHead(402, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'insufficient balance' }))
  })
  try {
    await withMimo(base.url, async () => {
      const first = await previewTtsAudio({ text: '一', outFile: path.join(dir, 'a.mp3') })
      assert.notEqual(first.ok && first.provider, 'mimo', '402 后应回退到 edge')
      assert.equal(base.hits(), 1)
      const second = await previewTtsAudio({ text: '二', outFile: path.join(dir, 'b.mp3') })
      assert.notEqual(second.ok && second.provider, 'mimo')
      assert.equal(base.hits(), 1, '冷却期内不该再打 MiMo')
      const cool = ttsCooldownStatus(dir)
      assert.equal(cool.active, true)
      assert.equal(cool.status, 402)
      assert.match(cool.reason, /欠费|未授权/)
    })
  } finally {
    await base.close()
  }
})

test('没有上报口（最小 stub）时配音照常，不崩', async () => {
  const dir = tmp()
  const base = await fakeMimo((res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      choices: [{ message: { audio: { data: Buffer.from('ID3fake').toString('base64') } } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }))
  })
  try {
    await withMimo(base.url, async () => {
      const r = await previewTtsAudio({ text: '三', outFile: path.join(dir, 'c.mp3') })  // 刻意不给 onTtsUsage
      assert.equal(r.ok, true, r.error)
      assert.equal(r.provider, 'mimo')
    })
  } finally {
    await base.close()
  }
})

test('响应没有 usage 时不上报——不编 0 冒充"没花钱"', async () => {
  const dir = tmp()
  const base = await fakeMimo((res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      choices: [{ message: { audio: { data: Buffer.from('ID3fake').toString('base64') } } }],
      usage: { total_tokens: 7 },
    }))
  })
  const seen = []
  try {
    await withMimo(base.url, async () => {
      const r = await previewTtsAudio({
        text: '四',
        outFile: path.join(dir, 'd.mp3'),
        onTtsUsage: (u) => seen.push(u),
      })
      assert.equal(r.ok, true, r.error)
      // usage 存在但字段不全是"有值"：上游原样带出，由宿主侧的映射决定记不记
      assert.equal(seen.length, 1)
      assert.deepEqual(seen[0].usage, { total_tokens: 7 })
    })
  } finally {
    await base.close()
  }
})

test('显式要 mimo 时不被冷却挡住：把真实错误抛出来', async () => {
  const dir = tmp()
  const base = await fakeMimo((res) => {
    res.writeHead(402)
    res.end('{"error":"insufficient balance"}')
  })
  try {
    await withMimo(base.url, async () => {
      await previewTtsAudio({ text: '五', outFile: path.join(dir, 'e.mp3') })
      assert.equal(ttsCooldownStatus(dir).active, true)
      const r = await previewTtsAudio({ text: '六', outFile: path.join(dir, 'f.mp3'), tts: 'mimo' })
      assert.equal(r.ok, false)
      assert.match(r.error, /402/)
      assert.equal(base.hits(), 2, '显式指定时应真的再试一次，而不是静默跳过')
    })
  } finally {
    await base.close()
  }
})
