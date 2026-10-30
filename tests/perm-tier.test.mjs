// 分级放开（2026-10-31 主人拍板）的档位锁：
//   自发档 = 点赞 / 收藏 / 回主人私信——自己发（判据与额度仍在）；
//   公开表达档 = 评论 / 弹幕——仍必须过 go-gate 待审（防注入诱导的主要面）。
// 谁想"顺手"把某一边的闸挪走，这个测试要红。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const toolsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools')
const src = (p) => fs.readFileSync(path.join(toolsDir, p), 'utf8')

test('自发档：fav / like 不进 go-gate（判据与本地账仍在）', () => {
  const fav = src('commands/fav.mjs')
  assert.ok(!fav.includes('go-gate.mjs'), 'fav 是自发档，不得再 import go-gate')
  assert.ok(fav.includes('checkRules'), 'fav 的五判据不能被顺手删')
  const like = src('commands/like.mjs')
  assert.ok(!like.includes('go-gate.mjs'), 'like 是自发档，不得 import go-gate')
  assert.ok(like.includes('30 * DAY'), 'like 要保留 30 天去重（B站接口是 toggle，重复点会取消赞）')
})

test('公开表达档：comment / danmaku 仍必须过 go-gate（人工放行保留）', () => {
  for (const f of ['commands/comment.mjs', 'commands/danmaku.mjs']) {
    const s = src(f)
    assert.ok(s.includes("go-gate.mjs"), `${f} 必须保留 go-gate`)
    assert.ok(/queueGo\(/.test(s), `${f} 必须把 --go 进待审队列`)
  }
})

test('回主人私信：dm 不经过待审队列（World 侧 dmAutoPlan 直接带 --go）', () => {
  assert.ok(!src('commands/dm.mjs').includes('go-gate.mjs'), 'dm 是专属通道，本来就不走 go-gate')
})
