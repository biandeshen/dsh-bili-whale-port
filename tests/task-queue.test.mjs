import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  readQueue, writeQueue, newTask, dueTasks, markDelivered, markAttempt, prune, expireStale,
} from '../src/worlds/bili-account/task-queue.ts'

const T = Date.parse('2026-10-29T12:00:00+08:00')

test('任务队列：落盘后可读回，坏文件按空队列处理', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'queue-'))
  const file = path.join(dir, 'queue.json')
  const tasks = [newTask('action-due', '去看看', T, 't1')]
  writeQueue(file, tasks)
  const back = readQueue(file)
  assert.equal(back.length, 1)
  assert.equal(back[0].id, 't1')
  assert.equal(back[0].status, 'pending')

  fs.writeFileSync(file, '{broken')
  assert.deepEqual(readQueue(file), [])
})

test('任务队列：只取到期且 pending 的任务', () => {
  const tasks = [
    newTask('action-due', 'a', T - 1000, 'a'),
    newTask('action-due', 'b', T + 1000, 'b'),
    { ...newTask('action-due', 'c', T - 1000, 'c'), status: 'delivered' },
  ]
  assert.deepEqual(dueTasks(tasks, T).map((t) => t.id), ['a'])
})

test('任务队列：投递成功标记 delivered 并回填 deliveredTaskId', () => {
  const tasks = [newTask('action-due', 'a', T, 'a')]
  const after = markDelivered(tasks, 'a', T + 10)
  assert.equal(after[0].status, 'delivered')
  assert.equal(after[0].deliveredTaskId, 'a')
  assert.ok(after[0].deliveredAt)
})

test('任务队列：连续失败 5 次进 dead，不再重试', () => {
  let tasks = [newTask('action-due', 'a', T, 'a')]
  for (let i = 0; i < 4; i++) tasks = markAttempt(tasks, 'a')
  assert.equal(tasks[0].status, 'pending')
  tasks = markAttempt(tasks, 'a')
  assert.equal(tasks[0].status, 'dead')
  assert.deepEqual(dueTasks(tasks, T + 1000), [])
})

test('任务队列：pending 超过 24h 作废（提示里是旧状态）', () => {
  const tasks = [
    newTask('action-due', 'old', T - 25 * 3600_000, 'old'),
    newTask('action-due', 'fresh', T - 3600_000, 'fresh'),
  ]
  const after = expireStale(tasks, T)
  assert.equal(after.find((t) => t.id === 'old').status, 'dead')
  assert.equal(after.find((t) => t.id === 'fresh').status, 'pending')
})

test('任务队列：清理保留 pending 与 24h 内的投递记录', () => {
  const old = { ...markDelivered([newTask('action-due', 'old', T - 48 * 3600_000, 'old')], 'old', T)[0] }
  const recent = markDelivered([newTask('action-due', 'new', T, 'new')], 'new', T)[0]
  const pending = newTask('action-due', 'p', T + 10, 'p')
  const kept = prune([old, recent, pending], T)
  assert.deepEqual(kept.map((t) => t.id).sort(), ['new', 'p'])
})
