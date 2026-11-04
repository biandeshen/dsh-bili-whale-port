import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadCredentials } from '../src/client/bili-read.ts'

/**
 * 凭据文件的两种形状（2026-11-05 线上事故）。
 *
 * 同一个文件要同时喂两条路：
 *   · 读工具走 `credentialsFile` → 本函数
 *   · 写工具走 `ctx.secret('BILI_SESSDATA')` → 宿主 secretReader（只认 `NAME=value`）
 *
 * 以前本函数只认 JSON，而写工具只认 env 格式，于是：
 *   · 部署家没有凭据文件 → 本函数**静默返回空凭据**，她照常调用，
 *     只是带着空 cookie——失败信息指向风控，看着像"被 B 站 412 了"，其实是根本没登录；
 *   · 线上实测：无凭据时 `dynamicRecent` 返回 `code=-101（拿不到自己的 mid）`，
 *     有凭据时 `ok=true`。差别就在这儿。
 */

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cap-bili-cred-'))

test('凭据文件：JSON 形状要认（旧家 ~/.bili-ai/credentials.json 的形状）', () => {
  const dir = tmp()
  const file = path.join(dir, '.env')
  fs.writeFileSync(file, JSON.stringify({ sessdata: 'S1', bili_jct: 'J1', buvid3: 'B1' }))
  const c = loadCredentials(file)
  assert.equal(c.sessdata, 'S1')
  assert.equal(c.bili_jct, 'J1')
  assert.equal(c.buvid3, 'B1')
})

test('凭据文件：env 形状要认（宿主 secretReader 同口径，读到首个空白字符）', () => {
  const dir = tmp()
  const file = path.join(dir, '.env')
  fs.writeFileSync(file, [
    '# B 站凭据',
    'BILI_SESSDATA=S2',
    'BILI_JCT=J2',
    'BILI_BUVID3=B2',
    '',
  ].join('\n'))
  const c = loadCredentials(file)
  assert.equal(c.sessdata, 'S2')
  assert.equal(c.bili_jct, 'J2')
  assert.equal(c.buvid3, 'B2')
})

test('凭据文件：env 形状也认无前缀的别名（与 secretReader 的 NAME=value 同名习惯一致）', () => {
  const dir = tmp()
  const file = path.join(dir, '.env')
  fs.writeFileSync(file, 'SESSDATA=S3\nbili_jct=J3\n')
  const c = loadCredentials(file)
  assert.equal(c.sessdata, 'S3')
  assert.equal(c.bili_jct, 'J3')
})

test('凭据文件：不存在或坏了就返回空凭据，但**不许抛**（不能把整个调用带崩）', () => {
  const dir = tmp()
  const missing = loadCredentials(path.join(dir, 'nope.env'))
  assert.deepEqual(missing, { sessdata: '', bili_jct: '', buvid3: '' })

  const broken = path.join(dir, 'broken.env')
  fs.writeFileSync(broken, 'not json\nnot env either {')
  const c = loadCredentials(broken)
  assert.equal(c.sessdata, '')
})

test('凭据文件：JSON 里的大写键名也要认（与 env 别名一致）', () => {
  const dir = tmp()
  const file = path.join(dir, '.env')
  fs.writeFileSync(file, JSON.stringify({ SESSDATA: 'S4', BILI_JCT: 'J4' }))
  const c = loadCredentials(file)
  assert.equal(c.sessdata, 'S4')
  assert.equal(c.bili_jct, 'J4')
})
