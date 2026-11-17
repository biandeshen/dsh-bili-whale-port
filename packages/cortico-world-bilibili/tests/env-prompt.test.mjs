// 环境提示词必须真的存在且能被渲染（2026-11-14）。
//
// 为什么这条测试必须有：
// 宿主 World 契约原文是「工具定义和用法由 World 提供；使用时机与跨工具指导写入环境提示词」。
// 我们此前只做了前半句——18 把 bili_* 工具注册了、模型也看得见，
// 但 webUi() 里没有声明 role='envPrompt' 的模板，
// 于是 envPromptVars() 返回的变量值**没有任何模板可渲染**。
//
// 实测证据：全仓 `grep -c "role: 'envPrompt'"` = 0，而宿主内置的
// bilibili/console/qq/minecraft 都有；对应地 777 次工具调用里 bili_* 为 0 次。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { createBiliWorld } from '../src/cortico-world.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'envprompt-'))

test('bili world 声明了 role=envPrompt 的模板', () => {
  const dir = tmp()
  const { world } = createBiliWorld({ dataDir: dir, outputDir: dir })
  const ui = world.webUi()
  const docs = ui.promptDocs ?? []
  const env = docs.find((d) => d.role === 'envPrompt')
  assert.ok(env, 'webUi() 必须声明 role=envPrompt 的模板，否则变量没有落点')
  assert.ok(env.path, '模板必须给 path')
  assert.ok(fs.existsSync(env.path), `模板文件必须存在：${env.path}`)
  assert.ok(env.vars?.length >= 3, '至少要声明 policy/queue/inbox 三个变量')
})

test('模板正文写了"什么时候该用"，不是只有变量占位', () => {
  const dir = tmp()
  const { world } = createBiliWorld({ dataDir: dir, outputDir: dir })
  const env = (world.webUi().promptDocs ?? []).find((d) => d.role === 'envPrompt')
  const text = fs.readFileSync(env.path, 'utf8')
  assert.ok(text.length > 300, '模板太短，不像"使用时机"的说明')
  // 关键：必须点名具体工具，否则等于没写
  for (const tool of ['bili_feed', 'bili_watch', 'bili_debrief']) {
    assert.ok(text.includes(tool), `模板里必须点名 ${tool}，否则她不知道有这个工具`)
  }
  // 必须写清"写操作进待放行队列"这条硬规矩
  assert.ok(/待放行/.test(text), '必须写清写操作要进待放行队列')
  // 必须声明变量占位（否则 envPromptVars 的值无处可去）
  assert.ok(/\{\{bili\./.test(text), '模板里必须有 {{bili.*}} 变量占位')
})

test('每个声明的变量都在模板里被用到（避免声明了但没用）', () => {
  const dir = tmp()
  const { world } = createBiliWorld({ dataDir: dir, outputDir: dir })
  const env = (world.webUi().promptDocs ?? []).find((d) => d.role === 'envPrompt')
  const text = fs.readFileSync(env.path, 'utf8')
  for (const v of env.vars ?? []) {
    assert.ok(text.includes(`{{${v.name}`),
      `变量 ${v.name} 声明了但模板没用它（声明与使用要一致）`)
  }
})

test('envPromptVars 返回的键与模板声明一一对应', () => {
  const dir = tmp()
  const { world } = createBiliWorld({ dataDir: dir, outputDir: dir })
  const env = (world.webUi().promptDocs ?? []).find((d) => d.role === 'envPrompt')
  const declared = new Set((env.vars ?? []).map((v) => v.name))
  const vars = world.envPromptVars()
  assert.ok(vars, 'envPromptVars 不该返回 null（那会整段省略）')
  for (const k of Object.keys(vars)) {
    assert.ok(declared.has(k), `envPromptVars 返回了未声明的变量 ${k}`)
  }
})

test('media world 同样声明了 envPrompt', () => {
  const dir = tmp()
  const modPath = path.join(HERE, '../../cortico-world-media/src/cortico-world.ts')
  // 直接读文件确认声明存在（避免为一条断言拉满整个 media 依赖）
  const src = fs.readFileSync(modPath, 'utf8')
  assert.ok(/role: 'envPrompt'/.test(src), 'media world 也必须声明 envPrompt')
  const tpl = fs.readFileSync(path.join(HERE, '../../cortico-world-media/src/ENV_PROMPT.md'), 'utf8')
  assert.ok(tpl.includes('media_video_build'), '模板要点名出片工具')
  assert.ok(/\{\{media\./.test(tpl), '模板要有 media.* 变量占位')
})
