// #55 后半：存量里有一批"她自己想的判断"被打成 source=user_said（主人说的）。
// 写入口径已在 personaAdapter 修好，这里清历史数据 —— 而且默认 dry-run，
// 因为改的是她整个人格的状态文件，名单必须先被人看过才允许落盘。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(ROOT, 'scripts', 'repair-memory-source.mjs')

function home(t, memories) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-repair-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dir, 'bili-whale'), { recursive: true })
  const file = path.join(dir, 'bili-whale', 'fields.json')
  fs.writeFileSync(file, JSON.stringify({ fields: {}, npcState: {}, memories }, null, 2))
  const run = (args = []) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8', timeout: 60000,
      env: { ...process.env, USERPROFILE: dir, HOME: dir, DSH_HOME: dir, NODE_TEST_CONTEXT: '1' } })
    return { out: r.stdout + r.stderr, status: r.status }
  }
  return { dir, file, run, text: (args) => run(args).out }
}

const M = (id, content, over) => ({ id, npcId: 'x', sender: 'npc', content, emotion: { valence: 0, intensity: 0, tags: [] }, tags: [], vividness: 0.8, accessCount: 0, createdAt: '2026-11-01T04:00:00.000Z', ...over })

const ROWS = [
  M('mem-1', '第五条尺子：引导和背景是品类之别', { source: 'npc_self' }),
  M('mem-2', '今天把弹幕密度这把尺子磨了一道', { source: 'user_said' }),
  M('mem-3', '可爱捏', { source: 'user_said', sender: 'player', tags: ['dm'] }),
  M('mem-4', '主人说他讨厌雨声', { source: 'user_said', sender: 'player' }),
  M('mem-5', '这条我已经撤掉了', { source: 'user_said', voided: true }),
]

test('dry-run：报告分类，但不碰盘', (t) => {
  const h = home(t, ROWS)
  const before = fs.readFileSync(h.file, 'utf8')
  const out = h.run([]).out
  assert.match(out, /"mislabelled": 1/)
  assert.match(out, /"suspicious": 1/)
  assert.match(out, /"voided": 1/)
  assert.match(out, /"mode": "dry-run"/)
  assert.ok(out.includes('mem-2'), '要改的条目必须列出来给人看')
  assert.ok(out.includes('mem-4'), '可疑条目也要列出来')
  assert.equal(fs.readFileSync(h.file, 'utf8'), before, 'dry-run 不该写盘')
  assert.equal(fs.readdirSync(path.dirname(h.file)).some((f) => f.includes('.bak')), false, 'dry-run 不该造备份')
})

test('--go：只改"她想的却标成主人说的"，主人真说的话与已作废的一条都不动', (t) => {
  const h = home(t, ROWS)
  const out = h.run(['--go']).out
  assert.match(out, /已改 1 条/)
  const after = JSON.parse(fs.readFileSync(h.file, 'utf8'))
  const by = Object.fromEntries(after.memories.map((m) => [m.id, m]))
  assert.equal(by['mem-2'].source, 'npc_self', '她自己想的判断该回到 npc_self')
  assert.equal(by['mem-1'].source, 'npc_self', '本来就对的不动')
  assert.equal(by['mem-3'].source, 'user_said', '主人私信里真说的话不能被改')
  assert.equal(by['mem-4'].source, 'user_said', '可疑但不属于机器能判的，交人工')
  assert.equal(by['mem-5'].source, 'user_said', '她已自己作废的，不替她再改一次')
  assert.deepEqual(after.memoryRepair.ids, ['mem-2'], '改了什么要留痕（含备份文件名）')
  assert.match(after.memoryRepair.backup, /^fields\.json\.bak-\d+$/)
  assert.ok(fs.existsSync(path.join(path.dirname(h.file), after.memoryRepair.backup)), '原件必须真在备份里')
})

test('坏文件不硬写：读不动就退出非 0，且不产生半截状态', (t) => {
  const h = home(t, ROWS)
  fs.writeFileSync(h.file, '{这不是 JSON')
  const r = spawnSync(process.execPath, [SCRIPT, '--go'], { encoding: 'utf8', timeout: 60000, env: { ...process.env, USERPROFILE: h.dir, HOME: h.dir, DSH_HOME: h.dir, NODE_TEST_CONTEXT: '1' } })
  assert.equal(r.status, 1)
  assert.match(r.stdout + r.stderr, /不要写/)
  assert.equal(fs.readFileSync(h.file, 'utf8'), '{这不是 JSON', '报错时原文件保持原样')
})
