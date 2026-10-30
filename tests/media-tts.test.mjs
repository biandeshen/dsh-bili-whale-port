// M1c：TTS 层——回退序、音色默认、缺 key fail-closed（不发网络）、describe 永不含 key
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ttsPlan, describeTts, synthesize } from '../tools/media/tts.mjs'

test('回退序：auto=mimo→edge；显式单选；none 为空序', () => {
  assert.deepEqual(ttsPlan('auto').order, ['mimo', 'edge'])
  assert.deepEqual(ttsPlan('mimo').order, ['mimo'])
  assert.deepEqual(ttsPlan('EDGE').order, ['edge'])
  assert.deepEqual(ttsPlan('none').order, [])
  assert.equal(ttsPlan('auto').voiceFor('mimo'), '茉莉')
  assert.equal(ttsPlan('auto').voiceFor('edge'), 'zh-CN-XiaoyiNeural')
})

test('缺 key fail-closed：显式 mimo 直接拒，不静默回退、不发请求', async () => {
  const creds = { env: {}, candidates: [path.join(os.tmpdir(), 'no-such-mimo-auth.json')] }
  await assert.rejects(
    synthesize({ plan: ttsPlan('mimo'), text: '测试', voiceArg: 'auto', outFile: path.join(os.tmpdir(), 'x.mp3'), style: 's', model: 'm', binDir: os.tmpdir(), creds }),
    /未找到 MiMo API key/,
  )
  // auto 模式继续试 edge；edge 也不可用时整体失败（沿用旧行为：报最后一个错）
  await assert.rejects(
    synthesize({ plan: ttsPlan('auto'), text: '测试', voiceArg: 'auto', outFile: path.join(os.tmpdir(), 'nope.mp3'), style: 's', model: 'm', binDir: path.join(os.tmpdir(), 'no-edge-here'), creds }),
    /TTS 全部失败/,
  )
})

test('describeTts 只回来源，永不含 key 本体', () => {
  const secret = 'sk-test-never-echo'
  const d = describeTts({ env: { MIMO_API_KEY: secret }, candidates: [] })
  assert.equal(d.mimoKey, 'loaded(env)')
  assert.ok(!JSON.stringify(d).includes(secret), 'describe 输出不得包含 key')
  assert.equal(describeTts({ env: {}, candidates: [] }).mimoKey, 'missing')
})
