import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createXiaoyuBotHub } from '../src/index.ts'
import { runDataMigration, rollbackDataMigration } from '../../../scripts/migrate-capabilities-data.mjs'

test('cortico-bot-xiaoyu：一拖三转接坞汇聚 3 个对内能力包 + 存量数据无损迁移与回滚全闭环', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoyu-hub-'))
  const legacyDsh = path.join(tmpRoot, 'legacy-dsh')
  const newHome = path.join(tmpRoot, 'xiaoyu-home')

  // 1. 构造模拟的存量真实数据（含 fields.json 里的场值+记忆+因果链、两本日记、judgment.jsonl、feedback.jsonl）
  fs.mkdirSync(path.join(legacyDsh, 'bili-whale', 'control'), { recursive: true })
  fs.writeFileSync(
    path.join(legacyDsh, 'bili-whale', 'fields.json'),
    JSON.stringify({
      schemaVersion: 5,
      fields: { energy: 0.82, stimulation: 0.6, connection: 0.75, social: 0.5, mood: 0.4, curiosity: 0.7, creativity: 0.65 },
      chain: [{ id: 'c1', npcId: 'xiaoyu', timestamp: new Date().toISOString(), layer: 'L0', type: 'field_change', description: '主人回信了', fieldChanges: [{ field: 'mood', from: 0.2, to: 0.4 }], source: 'masterReplied' }],
      memories: [
        { id: 'mem-core-1', npcId: 'xiaoyu', sender: 'player', content: '主人说喜欢听雨声入睡', emotion: { valence: 0.4, intensity: 0.8, tags: ['偏好'] }, tags: ['milestone', '偏好'], vividness: 0.95, accessCount: 2, createdAt: new Date().toISOString(), flashbulb: true, source: 'user_said' },
        { id: 'mem-active-1', npcId: 'xiaoyu', sender: 'npc', content: '今天分析了雷雨声 283 个桶', emotion: { valence: 0.2, intensity: 0.5, tags: ['看片'] }, tags: ['看片'], vividness: 0.85, accessCount: 1, createdAt: new Date().toISOString(), flashbulb: false, source: 'npc_self' },
      ],
      npcState: { current: 'normal', bond: { level: 0.4 } },
      budget: { day: '2026-11-03', spent: {} },
      emotionHistory: [],
      lastAppliedAt: new Date().toISOString(),
    }),
    'utf8',
  )
  fs.writeFileSync(path.join(legacyDsh, 'whale-diary.md'), '# 鲸鱼日记\n\n## 2026-11-02\n\n## 看过\n\n雷雨声分析\n', 'utf8')
  fs.writeFileSync(path.join(legacyDsh, 'whale-diary-private.md'), '# 私人日记\n\n## 2026-11-02\n\n### 本轮留下的判断\n\n雨声可收\n', 'utf8')

  // 2. 先跑 --dry 预演，确认目标目录未创建
  const dryReport = runDataMigration({ sourceDshDir: legacyDsh, targetHomeDir: newHome, apply: false })
  assert.equal(dryReport.mode, 'dry')
  assert.equal(dryReport.memoriesCount.total, 2)
  assert.equal(dryReport.memoriesCount.core, 1)
  assert.equal(dryReport.memoriesCount.active, 1)
  assert.equal(fs.existsSync(newHome), false)

  // 3. 跑 --apply 正式迁移，并用 cortico-bot-xiaoyu 挂载读取
  const applyReport = runDataMigration({ sourceDshDir: legacyDsh, targetHomeDir: newHome, apply: true })
  assert.equal(applyReport.mode, 'apply')
  assert.equal(fs.existsSync(path.join(newHome, 'workspace', 'diary', 'public.md')), true)

  const hub = createXiaoyuBotHub({ homeDir: newHome })
  assert.equal(hub.api, 7)
  assert.equal(hub.capabilities.length, 3)
  assert.equal(hub.panels().length, 3)
  assert.equal(hub.tools().length, 10)

  // 验证迁移后的场值与记忆在转接坞中直接可读可操作
  const snap = await hub.invokePanel('tank', 'getSnapshot', {})
  assert.equal(snap.ok, true)
  assert.equal(snap.fields.energy, 0.82)

  const memList = await hub.invokePanel('memory-center', 'list', { tier: 'all' })
  assert.equal(memList.ok, true)
  assert.equal(memList.counts.total, 2)
  assert.equal(memList.counts.core, 1)

  const diaryRead = await hub.invokePanel('journal-board', 'getDiary', { book: 'public', date: '2026-11-02' })
  assert.equal(diaryRead.ok, true)
  assert.match(diaryRead.body, /雷雨声分析/)

  // 验证跨渠道系统前缀与消息送达注入（解决"鱼缸里的她和控制台里的她不是同一个人"）
  const prefixes = await hub.assembleSystemPrefix({ now: new Date(), timezone: 'Asia/Shanghai' })
  assert.ok(prefixes.some((p) => p.title === '当前场值与心情'))
  assert.ok(prefixes.some((p) => p.title === '记忆摘要' && p.text.includes('喜欢听雨声入睡')))

  const injections = await hub.assembleDeliveryInjections({
    now: new Date(),
    timezone: 'Asia/Shanghai',
    events: [{ type: 'console.message', source: 'console', text: '今晚还在听雷雨声吗？', atMs: Date.now() }],
  })
  assert.ok(injections.some((line) => line.includes('雷雨声')))

  // 4. 验证 --rollback 一键回退（源目录完好无损）
  const rb = rollbackDataMigration(newHome, applyReport.id)
  assert.equal(rb.ok, true)
  assert.equal(fs.existsSync(path.join(legacyDsh, 'bili-whale', 'fields.json')), true)
})
