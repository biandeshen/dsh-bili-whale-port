/**
 * 出站清洗是不是**真的接在出口上**（2026-11-02）。
 *
 * 上一轮教训：#32 修星号只修了动态那条路，私信/评论/弹幕三条出站口裸着没人发现，
 * 于是 dm-20261101-cbc62a 带着 `**` 进了待审队列。所以这里不测纯函数（那在
 * plain-outbound.test.mjs 里），测的是**四个真实出口跑一遍之后落盘/返回的正文**。
 *
 * 全程不联网：私信草稿与动态成稿是纯本地；弹幕用 `--go` 走 go-gate 入队
 * （danmaku.mjs 的 send 分支在 queueGo 后立即 exit，任何请求都没发出去）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'outbound-plain-'))
const home = path.join(tmp, 'home')
fs.mkdirSync(path.join(home, 'bili-ai'), { recursive: true })
fs.mkdirSync(path.join(home, 'bili-whale', 'control'), { recursive: true })
// 弹幕脚本在模块顶部就要求凭据文件存在；给一份全假的，--go 分支不会碰它
fs.writeFileSync(path.join(home, 'bili-ai', 'credentials.json'), JSON.stringify({ sessdata: 'x', bili_jct: 'y', buvid3: 'z' }), 'utf8')
process.env.WHALE_HOME = home

const { addDraft, loadDrafts, textHash } = await import('../../tools/lib/dm-drafts.mjs')
const { composeDraft } = await import('../../tools/drafts/compose.mjs')

const DIRTY = '这个问题我得先说实话：**我不知道自己跑在什么模型上。**\n- 第一条\n- 第二条'

test('私信草稿：入队落盘的那份就是干净的，textHash 也对齐干净稿', () => {
  const file = path.join(tmp, 'dm-drafts.json')
  const r = addDraft(file, { text: DIRTY, inboundKey: 'k-1', who: '鱼片' })
  assert.equal(r.ok, true, r.error)
  const item = loadDrafts(file).items[0]
  assert.ok(!item.text.includes('*'), '落盘正文里不许有星号：' + item.text)
  assert.ok(item.text.includes('我不知道自己跑在什么模型上'), '内容不能丢')
  assert.equal(item.textHash, textHash(item.text), '哈希必须对对齐后要发的那份字')
})

test('动态成稿：日记里的 Markdown 不会跟着进正文（审的就是发的）', () => {
  const diary = [
    '## 今天看过',
    '',
    '| 日期 | BV | 片名 |',
    '| --- | --- | --- |',
    '| 2026-10-29 | BV1oS4y197tX | 《**432Hz疗愈雨声**》 |',
    '',
    '今晚最想说的是：**它和助眠一点关系都没有**，但我还是听完了。',
  ].join('\n')
  const voice = {
    v: 1,
    mood: { label: '宁静', intensity: 0.3, reason: '雨声', cause: 'action' },
    relation: 'normal',
    memories: [],
    banned: [],
    stance: { share: true, because: '有想说的' },
  }
  const r = composeDraft(diary, { date: '2026-10-29', voice })
  assert.equal(r.ok, true, r.error)
  assert.ok(!r.text.includes('*'), '成稿正文里不许有星号：' + r.text)
  assert.ok(!/^#/m.test(r.text), '成稿正文里不许有行首井号：' + r.text)
})

test('弹幕出口：--go 入队时存的报备文案是清洗过的（不联网，queueGo 后立即退出）', () => {
  const r = spawnSync(process.execPath, [
    path.join(ROOT, 'tools', 'bili.mjs'), 'danmaku', 'send',
    '--room', '999999004', '--msg', '**主人** 我在', '--go',
  ], { env: { ...process.env, WHALE_HOME: home }, encoding: 'utf8', timeout: 60000 })
  assert.equal(r.status, 0, (r.stdout ?? '') + (r.stderr ?? ''))
  const qFile = path.join(home, 'bili-ai', 'pending-replies.json')
  assert.ok(fs.existsSync(qFile), '没有入队：' + (r.stdout ?? '') + (r.stderr ?? ''))
  const items = JSON.parse(fs.readFileSync(qFile, 'utf8')).items
  const hit = items.find((x) => String(x.kind ?? '').includes('弹幕'))
  assert.ok(hit, '队列里没有弹幕那条：' + JSON.stringify(items).slice(0, 300))
  assert.equal(hit.message, '主人 我在', '报备文案必须是发出去的那份字：' + hit.message)
})
