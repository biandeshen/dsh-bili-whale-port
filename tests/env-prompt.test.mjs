// #35：控制台里说话的她 = 鱼缸里的她。机制是框架自带的 envPrompt 通道——
// World 提供事实读数，措辞由模板与 Persona 负责（Core 不写人设文本）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { BILI_ACCOUNT } from '../legacy/bili-account-retired/definition.ts'

test('bili-account 声明了一份 envPrompt 模板，变量名与实现对得上', () => {
  const w = BILI_ACCOUNT.create()
  const doc = (w.webUi('zh').promptDocs ?? []).find((d) => d.role === 'envPrompt')
  assert.ok(doc, '没有 envPrompt 模板，她说话时就不知道自己此刻的状态')
  assert.deepEqual(doc.vars.map((v) => v.name), ['bili.state'])
  assert.ok(fs.existsSync(doc.path), `模板文件必须真的存在：${doc.path}`)
})

test('模板里 bili.state 有兜底文本，读不到状态时不谎报心情', () => {
  const doc = (BILI_ACCOUNT.create().webUi('zh').promptDocs ?? []).find((d) => d.role === 'envPrompt')
  const text = fs.readFileSync(doc.path, 'utf8')
  const m = /\{\{bili\.state\s*\|([^}]*)\}\}/.exec(text)
  assert.ok(m, '变量必须带 | 兜底文本')
  assert.match(m[1], /读不到/)
  assert.match(text, /发送策略、额度、审批档位只有主人能改/, '权限边界要写在给她的那份文本里')
})

test('envPromptVars 给她的是自己的读数：情绪+成因+状态条（读不到文件时返回 null，不抛）', () => {
  const v = BILI_ACCOUNT.create().envPromptVars()
  if (v === null) return // 本机没有 fields.json 的环境（CI/临时 home）——契约本身已由上面两条锁住
  const state = v['bili.state']
  assert.match(state, /【她现在的情绪】/)
  assert.match(state, /成因：/)
  assert.match(state, /【状态】/)
  // 读数里不许出现她无权改的配置值
  assert.doesNotMatch(state, /draftMode|autoDailyCap/)
})
