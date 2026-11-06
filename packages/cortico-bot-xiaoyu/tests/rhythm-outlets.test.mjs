// 作息落手处提示：必须点名工具，不许只说"读侧命令"
// 背景（2026-11-06 首夜实锤）：226 笔 life_do、零次 bili_* 调用——
// explore 被做成了"翻自己的记忆池"（同一句 note 重复 10+ 次），一次都没去 B 站。
// 根因：落手处写"去推荐里翻一条没看过的（读侧命令）"——"读侧命令"是我们的说法，
// 不是工具名；她照字面理解成"读点东西"，就近选了最熟的 memory_recall。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'src', 'cortico-persona.ts')

function outlets() {
  const text = fs.readFileSync(SRC, 'utf8')
  const start = text.indexOf('const outlets: Record<string, string>')
  assert.ok(start > 0, '找不到 outlets 表')
  const end = text.indexOf('}', text.indexOf('rest:', start))
  const block = text.slice(start, end)
  const out = {}
  for (const m of block.matchAll(/(\w+):\s*'([^']*)'/g)) out[m[1]] = m[2]
  return out
}

test('落手处：explore/consume 必须点名 bili_feed（不许只写"读侧命令"）', () => {
  const o = outlets()
  assert.ok(o.explore, 'explore 要有落手处')
  assert.match(o.explore, /bili_feed/, 'explore 的落手处必须点名 bili_feed')
  assert.doesNotMatch(o.explore, /读侧命令/, '不许再用我们自己的说法"读侧命令"')
  assert.match(o.consume, /bili_feed/, 'consume 的落手处必须点名 bili_feed')
})

test('落手处：每类都点名一个真实工具名', () => {
  const o = outlets()
  const known = [
    'diary_write', 'memory_remember', 'memory_recall', 'mood_apply',
    'bili_feed', 'bili_debrief', 'bili_watch',
  ]
  for (const [type, text] of Object.entries(o)) {
    assert.ok(text && text.trim().length > 0, `${type} 要有落手处`)
    const hit = known.filter((k) => text.includes(k))
    assert.ok(hit.length > 0, `${type} 的落手处要点名已知工具，实际：${text}`)
  }
})
