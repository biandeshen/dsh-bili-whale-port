/**
 * 存储清单与人设正本编辑入口（B13h）。
 *
 * 两件都是"声明了但没人往上带"：
 *   ① `storageParts` —— cap-vision 声明了三项（视觉配置 / 拼图产出 / 运行记录），
 *      但转接头的 `webUi()` 没带 `storage` 字段，宿主 `src/bot.ts` 的 webUiStorage
 *      只收 `parts.persona.webUi.storage` → 那三项是**死的**：清单里不出现，清了也没人管。
 *      而且 cap-memory（72 条记忆卡）与 cap-journal（两本日记）根本没声明过。
 *   ② `promptDocs` —— 她的正本（CONSTITUTION.md / ORIENTATION.md）**只能手改文件**，
 *      宿主的「系统提示词」页签里根本看不到它们。
 *
 * 这一条钉住：
 *   1. persona 的 webUi() 带上 storage（至少含记忆四层与日记四项）；
 *   2. 每项都有 stat（规模能报出来），清理页才不是一张空表；
 *   3. promptDocs 两份都在，且 **path 指包内正本、deploymentPath 指部署覆盖**
 *      （写覆盖不动正本，升级不会冲掉主人的微调）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createXiaoyuBotDefinition } from '../src/cortico-definition.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoyu-store-'))

function build(home = tmp()) {
  const def = createXiaoyuBotDefinition(home)
  const parts = def.build({ config: def.defaults(), memoryDir: home, rootDir: home })
  return { home, parts, persona: parts.persona }
}

test('persona 的 webUi 带上存储清单（宿主在装配期收这一份）', () => {
  const { persona } = build()
  const decl = persona.webUi('zh')
  const storage = decl?.storage ?? []
  assert.ok(Array.isArray(storage), 'storage 要是个数组')
  assert.ok(storage.length >= 5, `存储项至少要有记忆四层 + 日记四项，实得 ${storage.length}`)
  const keys = storage.map((s) => s.key)
  for (const k of ['memory.core', 'memory.active', 'memory.archived', 'memory.voided',
    'journal.public', 'journal.private', 'journal.judgments', 'journal.feedback',
    'vision.config', 'vision.sheets', 'vision.runs']) {
    assert.ok(keys.includes(k), `少了 ${k}（现有：${keys.join('、')}）`)
  }
  assert.equal(new Set(keys).size, keys.length, `键不能重：${keys.join('、')}`)
})

test('每一项存储都能报出规模（清理页不能是一张空表）', () => {
  const { persona } = build()
  const storage = persona.webUi('zh')?.storage ?? []
  for (const s of storage) {
    assert.equal(typeof s.stat, 'function', `${s.key} 要有 stat`)
    const text = s.stat()
    assert.equal(typeof text, 'string', `${s.key} 的 stat 要回字符串`)
    assert.ok(text.length > 0, `${s.key} 的 stat 不能是空串`)
    assert.ok(s.label, `${s.key} 缺 label`)
  }
})

test('私人本日记标 danger（删了不可恢复）', () => {
  const { persona } = build()
  const storage = persona.webUi('zh')?.storage ?? []
  const priv = storage.find((s) => s.key === 'journal.private')
  assert.ok(priv)
  assert.equal(priv.danger, true, '私人本要标 danger（宿主会要求额外确认）')
  const pub = storage.find((s) => s.key === 'journal.public')
  assert.notEqual(pub?.danger, true)
})

test('人设正本可编辑：path 指包内正本，deploymentPath 指部署覆盖', () => {
  const { home, persona } = build()
  const decl = persona.webUi('zh')
  const docs = decl?.promptDocs ?? []
  assert.equal(docs.length, 2, '两份正本都要能编辑')
  const keys = docs.map((d) => d.key)
  assert.deepEqual(keys, ['persona.CONSTITUTION', 'persona.ORIENTATION'])
  for (const d of docs) {
    assert.ok(d.title, `${d.key} 缺 title`)
    assert.ok(d.description, `${d.key} 缺 description`)
    assert.ok(fs.existsSync(d.path), `${d.key} 的 path 要指向真实存在的正本：${d.path}`)
    assert.ok(d.deploymentPath, `${d.key} 缺 deploymentPath（否则会写进代码包，升级就冲掉主人的微调）`)
    assert.equal(d.deploymentPath, path.join(home, 'prompts', path.basename(d.path)))
  }
})

test('部署覆盖优先于包内正本（与 personaText 的读法一致）', async () => {
  const { home, persona } = build()
  // 注意：systemSegments 里用 this.memoryDir，要按方法调（不能解构出来调）
  const segs = await persona.systemSegments({ now: new Date(), timezone: 'Asia/Shanghai', worlds: [] })
  const titles = segs.map((s) => s.title)
  assert.ok(titles.includes('我的宪法'), '正本要在前缀里')
  assert.ok(titles.includes('这一轮怎么做'))

  // 写一份部署覆盖 → 前缀应当用它
  fs.mkdirSync(path.join(home, 'prompts'), { recursive: true })
  fs.writeFileSync(path.join(home, 'prompts', 'CONSTITUTION.md'), '【部署覆盖的宪法】', 'utf8')
  const segs2 = await persona.systemSegments({ now: new Date(), timezone: 'Asia/Shanghai', worlds: [] })
  const constitution = segs2.find((s) => s.title === '我的宪法')
  assert.match(constitution.text, /部署覆盖的宪法/, '部署覆盖应当优先')
})
