import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createMemoryCapability } from '../src/index.ts'
import { createJournalCapability } from '../../cap-journal/src/index.ts'

test('cap-memory/git：记忆每次改动自动提交、主人编辑单独署名、checkpoint 回滚找回原文、与日记共享同一仓', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-git-'))
  const workspaceDir = path.join(home, 'workspace')
  const dataDir = path.join(home, 'data', 'persona')

  const memCap = createMemoryCapability({
    memoRoot: path.join(workspaceDir, 'memo'),
    workspaceDir,
    getCurrentMood: () => 0.2,
  })
  assert.ok(memCap.git, '应当建出 WorkspaceGit')

  const journalCap = createJournalCapability({
    publicDiaryFile: path.join(workspaceDir, 'diary', 'public.md'),
    privateDiaryFile: path.join(workspaceDir, 'diary', 'private.md'),
    judgmentFile: path.join(dataDir, 'judgment.jsonl'),
    feedbackFile: path.join(dataDir, 'feedback.jsonl'),
    git: memCap.git ?? undefined,
  })

  const memPanel = memCap.panels()[0]
  const journalBoard = journalCap.panels()[0]

  // 1. 建两条记忆 → 两条提交，作者署名 xiaoyu（她记的）/ owner（主人塞的）
  await memPanel.methods.create.invoke({ content: '主人说最喜欢雨声', tier: 'core' })
  const rememberTool = memCap.tools().find((t) => t.name === 'memory_remember')
  await rememberTool.execute({ content: '今天看了雷雨声分析' })

  // 2. 她写日记 → 同一个仓里再来一条提交
  const writeTool = journalCap.tools().find((t) => t.name === 'diary_write')
  await writeTool.execute({ book: 'public', date: '2026-11-04', heading: '想说', body: '今晚听雨。' })

  // 3. 主人在面板改日记 → 单独署名 owner 的提交
  await journalBoard.methods.saveDiarySection.invoke({
    book: 'public',
    date: '2026-11-04',
    markdown: '## 2026-11-04\n\n## 想说\n\n今晚听雨，改了个错字。',
  })

  const hist = await memPanel.methods.history.invoke({ limit: 10 })
  assert.equal(hist.ok, true)
  assert.ok(hist.status.repo, '工作区应当是 git 仓')
  assert.equal(hist.status.dirty, false, '全部改动都已提交')
  const authors = new Set(hist.log.map((c) => c.author))
  assert.ok(authors.has('xiaoyu'), '她自己的记忆/日记提交在')
  assert.ok(authors.has('owner'), '主人的提交在')
  // 记忆与日记共享同一个仓：一条 log 里能同时看到两类提交
  assert.ok(hist.log.some((c) => c.message.startsWith('memory:')), '记忆提交在')
  assert.ok(hist.log.some((c) => c.message.startsWith('diary:')), '日记提交在')

  // 4. checkpoint 后作废一条记忆 → 回滚能找回原文
  await memPanel.methods.checkpoint.invoke({ name: 'before-void', message: '作废前的存档点' })

  // 4b. 存档点的**形状**要在调用点上钉住。
  //     status 以前只给名字数组（tags: string[]），回滚 UI 按对象读 → 页面上渲染出
  //     `undefined`、按钮把 undefined 当存档点名发出去。离线 DOM 测试当时是绿的，
  //     因为它用的是我脑补的假形状；只有真 git + 真浏览器才照得出来。
  const afterCp = await memPanel.methods.history.invoke({ limit: 3 })
  const cps = afterCp.status.checkpoints
  assert.ok(Array.isArray(cps), 'status.checkpoints 是数组')
  const cp = cps.find((c) => c.name === 'before-void')
  assert.ok(cp, '刚打的存档点在列')
  assert.equal(cp.message, '作废前的存档点', '带说明（面板那一行要显示"存的是什么"）')
  assert.ok(cp.hash, '带 commit 哈希')
  assert.ok(!Number.isNaN(Date.parse(cp.date)), `日期要能解析：${cp.date}`)
  assert.equal(afterCp.status.tags, undefined, '旧的只有名字的 tags 已退场')
  // 没选到存档点要说人话，不能报「没有这个 checkpoint:」
  const noName = await memPanel.methods.rollback.invoke({ name: '', confirm: true })
  assert.equal(noName.ok, false)
  assert.match(noName.error, /没选到存档点/)

  const listBefore = await memPanel.methods.list.invoke({ tier: 'all' })
  const target = listBefore.items.find((x) => x.content.includes('雷雨声分析'))
  await memPanel.methods.void.invoke({ id: target.id, reason: '记混了出处，先作废' })
  const listVoided = await memPanel.methods.list.invoke({ tier: 'all' })
  assert.equal(listVoided.items.find((x) => x.id === target.id)?.tier, 'voided')

  // 回滚必须显式 confirm
  const noConfirm = await memPanel.methods.rollback.invoke({ name: 'before-void' })
  assert.equal(noConfirm.ok, false)
  assert.match(noConfirm.error, /confirm/)

  const rb = await memPanel.methods.rollback.invoke({ name: 'before-void', confirm: true })
  assert.equal(rb.ok, true)
  const listRestored = await memPanel.methods.list.invoke({ tier: 'all' })
  assert.equal(listRestored.items.find((x) => x.id === target.id)?.tier, 'active', '回滚后该记忆回到未作废状态')

  // 5. diff / fileAt：能看某次提交动了什么、能取历史版本原文
  const stat = await memPanel.methods.history.invoke({ limit: 5 })
  assert.equal(stat.ok, true)
  assert.ok(stat.logStat.length >= 1)
  const firstDiff = await memPanel.methods.history.invoke({ diffOf: stat.logStat[0].hash })
  assert.equal(firstDiff.ok, true)
  assert.ok(typeof firstDiff.diff === 'string' && firstDiff.diff.length > 0)

  // 6. 路径护栏照旧：resolveSafe 拒绝绝对路径与 ..
  const { GitWorkspaceMemory } = await import('../src/index.ts')
  const ws = new GitWorkspaceMemory({ memoryDir: workspaceDir })
  assert.throws(() => ws.resolveSafe('C:/Windows/system32'))
  assert.throws(() => ws.resolveSafe('../outside.txt'))
})
