// 她的意见箱契约（2026-10-31 主人要求机制）：add/list/resolve、折叠规则、CLI 出口
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { appendFeedback, listFeedback, resolveFeedback } from '../../tools/commands/feedback.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-home-'))
const FILE = path.join(HOME, 'bili-whale', 'control', 'feedback.jsonl')

test('意见箱：add→list→resolve 折叠；历史可回放', () => {
  const a = appendFeedback({ issue: 'feed 把已看的当新候选', severity: 'high', selfHandled: true, note: '认出来按旧结论处理' }, FILE)
  const b = appendFeedback({ issue: '私信回信卡队列外' }, FILE)
  assert.ok(a.ok && b.ok)
  let l = listFeedback(FILE)
  assert.equal(l.openCount, 2)
  assert.equal(l.items[0].id, b.id, '最新在前')
  const r = resolveFeedback(b.id, 'whale', FILE)
  assert.equal(r.ok, true)
  assert.equal(r.resolvedBy, 'whale')
  l = listFeedback(FILE)
  assert.equal(l.openCount, 1, 'resolve 后只剩 1 条开放')
  assert.equal(listFeedback(FILE, { all: true }).items.length, 2, '历史仍在（append-only）')
  assert.equal(resolveFeedback('f-zzzz', 'owner', FILE).ok, false, '未知 id 拒')
  assert.equal(appendFeedback({ issue: '' }, FILE).ok, false, '空 issue 拒')
})

test('意见箱 CLI：add/list/resolve 走真子进程（与 bili.mjs 派发一致）', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fb-cli-'))
  const env = { ...process.env, DSH_HOME: home, WHALE_HOME: home }
  const cli = path.join(ROOT, 'tools', 'commands', 'feedback.mjs')
  const add = spawnSync(process.execPath, [cli, 'add', '--issue', '测试：审批入口缺失', '--severity', 'high', '--self', '--note', '已用面板放行'], { env, encoding: 'utf8', timeout: 30000 })
  assert.equal(add.status, 0, add.stderr)
  assert.match(add.stdout, /已记入意见箱 f-/)
  const list = spawnSync(process.execPath, [cli, 'list', '--json'], { env, encoding: 'utf8', timeout: 30000 })
  const j = JSON.parse(list.stdout)
  assert.equal(j.openCount, 1)
  assert.match(j.items[0].issue, /审批入口缺失/)
  const res = spawnSync(process.execPath, [cli, 'resolve', j.items[0].id, '--by', 'owner'], { env, encoding: 'utf8', timeout: 30000 })
  assert.equal(res.status, 0, res.stderr)
  const list2 = spawnSync(process.execPath, [cli, 'list'], { env, encoding: 'utf8', timeout: 30000 })
  assert.match(list2.stdout, /开放 0 条/)
  const bad = spawnSync(process.execPath, [cli, 'resolve', 'f-nope'], { env, encoding: 'utf8', timeout: 30000 })
  assert.equal(bad.status, 2)
})
