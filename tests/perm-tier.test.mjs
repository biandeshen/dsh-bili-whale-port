// 分级放开（2026-10-31 主人拍板）的档位锁：
//   自发档 = 点赞 / 收藏 / 回主人私信——自己发（判据与额度仍在）；
//   公开表达档 = 评论 / 弹幕——仍必须过 go-gate 待审（防注入诱导的主要面）。
// 谁想"顺手"把某一边的闸挪走，这个测试要红。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const toolsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools')
const src = (p) => fs.readFileSync(path.join(toolsDir, p), 'utf8')

/**
 * 这条锁以前只断"源码里出现了 `go-gate.mjs` 这个字符串"——字符串能骗过断言：
 * 第三方评审就是据此报过"断言一个根本不存在的 go-gate.mjs"（真相是：存在的是
 * `tools/lib/go-gate.mjs`，从来没存在过的是案卷 `ARCHITECTURE-2026-11.md:133` 写的 `tools/go-gate.mjs`）。
 * 现在把 import 说明符真解析一遍、再真装载一次：**锁只能锁得住真存在的东西**。
 */
function resolveGoGate(fromFile) {
  const m = /import\s*\{[^}]*\}\s*from\s*'([^']*go-gate\.mjs)'/.exec(src(fromFile))
  assert.ok(m, `${fromFile} 必须 import go-gate`)
  const abs = path.resolve(toolsDir, path.dirname(fromFile), m[1])
  assert.ok(fs.existsSync(abs), `${fromFile} 里的 ${m[1]} 解析后不存在：${abs}`)
  return abs
}

test('go-gate 本身是真的：能解析、能装载、该导出的都导出', async () => {
  const abs = resolveGoGate('commands/comment.mjs')
  assert.equal(abs, path.join(toolsDir, 'lib', 'go-gate.mjs'))
  const mod = await import(pathToFileURL(abs).href)
  for (const fn of ['shouldGate', 'queueGo']) assert.equal(typeof mod[fn], 'function', `go-gate 必须导出 ${fn}()`)
})

test('自发档：like/fav 默认直发，入队只可能来自 publish-policy 的档位收回', () => {
  for (const [f, key] of [['commands/fav.mjs', 'fav'], ['commands/like.mjs', 'like']]) {
    const s = src(f)
    assert.ok(s.includes('tierQueues(') && s.includes(`readPolicy(`), `${f} 的入队必须包在 tierQueues(readPolicy(...)) 里`)
    // 收回开关只能由配置翻开：默认值在 publish-policy 测试里锁死为 'self'
    assert.ok(!/shouldGate\(/.test(s), `${f} 不得恢复"见 --go 就拦"的旧 go-gate 无条件语义`)
  }
  const fav = src('commands/fav.mjs')
  assert.ok(fav.includes('checkRules'), 'fav 的五判据不能被顺手删')
  assert.ok(src('commands/like.mjs').includes('30 * DAY'), 'like 要保留 30 天去重（B站接口是 toggle，重复点会取消赞）')
})

test('公开表达档：comment / danmaku 仍必须过 go-gate（人工放行保留）', () => {
  for (const f of ['commands/comment.mjs', 'commands/danmaku.mjs']) {
    const s = src(f)
    resolveGoGate(f) // 不是"字符串里有"，是"这个 import 解析得到、文件真在"
    assert.ok(/queueGo\(/.test(s), `${f} 必须把 --go 进待审队列`)
  }
})

test('回主人私信：dm 不经过待审队列（World 侧 dmAutoPlan 直接带 --go）', () => {
  assert.ok(!src('commands/dm.mjs').includes('go-gate.mjs'), 'dm 是专属通道，本来就不走 go-gate')
})
