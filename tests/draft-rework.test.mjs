// 拒稿之后要能重出：#41 特意把主人的理由送到她眼前，如果"今天已有稿"这条硬规则
// 连被拒的也算，她就只读到理由、改不了稿（2026-11-02 主人的五条 reject 撞出的死路）。
// dsh 侧的写入闸门由 `dsh-bili-whale/tests/draft-rework.test.mjs` 证，这里证宿主话术。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-rework-host-'))
process.env.WHALE_HOME = HOME
const DRAFTS = path.join(HOME, 'drafts')
process.env.WHALE_DRAFTS = DRAFTS
fs.mkdirSync(DRAFTS, { recursive: true })

const { todayDraftLine } = await import('../src/worlds/bili-account/definition.ts')
const { dayKey } = await import('@xiaoyu/persona-core/rhythm')

const day = dayKey(Date.now())
const writeDraft = (over) => {
  fs.writeFileSync(path.join(DRAFTS, day + '.json'), JSON.stringify({ id: 'dyn-rework-1', date: day, ...over }))
}

test('今天的稿被拒 → 提示她照着理由重写一版，而不是"不用再出稿"', () => {
  writeDraft({ status: 'rejected', text: '第一版', rejectReason: '正文有星号' })
  const line = todayDraftLine()
  assert.match(line, /被主人拒了/, line)
  assert.match(line, /重写一版/, line)
  assert.doesNotMatch(line, /不用再出稿/, '被拒那条不能劝她别出：' + line)
})

test('已发出 / 在等审批 → 仍劝她这一轮别再出（防一天两条）', () => {
  for (const [status, want] of [['sent', '已发出'], ['pending', '等你审批']]) {
    writeDraft({ status, text: 'x' })
    const line = todayDraftLine()
    assert.match(line, /不用再出稿/, status + ' 这条必须拦住：' + line)
    assert.match(line, new RegExp(want), line)
  }
})

test('今天没有稿 → 不给这句话（不凭空说"已经出过"）', () => {
  fs.rmSync(path.join(DRAFTS, day + '.json'), { force: true })
  assert.equal(todayDraftLine(), '')
})
