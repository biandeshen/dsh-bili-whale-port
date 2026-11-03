import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validateCapabilityContract } from '../../persona-core/src/capability.ts'
import { createJournalCapability } from '../src/index.ts'

test('cap-journal：日记幂等替换/在线编辑、判断卡独立表格、意见箱主人批复与一键转规则全闭环', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-journal-'))
  const publicDiaryFile = path.join(dir, 'public.md')
  const privateDiaryFile = path.join(dir, 'private.md')
  const judgmentFile = path.join(dir, 'judgment.jsonl')
  const feedbackFile = path.join(dir, 'feedback.jsonl')
  const convertedRules = []

  const cap = createJournalCapability({
    publicDiaryFile,
    privateDiaryFile,
    judgmentFile,
    feedbackFile,
    onRuleConverted: (r) => convertedRules.push(r),
  })
  assert.equal(validateCapabilityContract(cap).ok, true)

  const board = cap.panels()[0]
  assert.equal(board.id, 'journal-board')

  // 1. 她通过工具写日记（首次追加，同日同小节二次写入自动替换且不留重复标题）
  const writeTool = cap.tools().find((t) => t.name === 'diary_write')
  const w1 = await writeTool.execute({
    book: 'public',
    date: '2026-11-03',
    heading: '看过',
    body: '看了《猫眼三姐妹》OP合集 BV1234567890',
  })
  assert.equal(w1.mode, 'appended')

  const w2 = await writeTool.execute({
    book: 'public',
    date: '2026-11-03',
    heading: '看过',
    body: '重看了《猫眼三姐妹》OP合集 BV1234567890，分镜很利落',
  })
  assert.equal(w2.mode, 'replaced')

  // 2. 主人在面板在线编辑日记（修正格式或日期块）
  const editRes = await board.methods.saveDiarySection.invoke({
    book: 'public',
    date: '2026-11-03',
    heading: '想说',
    markdown: '今晚的雨声很安静。',
  })
  assert.equal(editRes.ok, true)

  const readRes = await board.methods.getDiary.invoke({ book: 'public', date: '2026-11-03' })
  assert.equal(readRes.ok, true)
  assert.match(readRes.body, /分镜很利落/)
  assert.match(readRes.body, /今晚的雨声很安静/)

  // 3. 判断卡独立视图：她提一张卡 → 主人在面板修改结论并备注
  const jWrite = cap.tools().find((t) => t.name === 'judgment_write')
  const j1 = await jWrite.execute({
    scope: 'feed',
    stance: 'avoid',
    verdict: 'drop',
    tokens: ['睡眠瑜伽', '引导冥想'],
    reason: '门上写着冥想，屋里全是游戏广告',
    bvid: 'BV1111111111',
  })
  assert.equal(j1.ok, true)

  const jUpsert = await board.methods.upsertJudgment.invoke({
    id: j1.id,
    verdict: 'drop',
    note: '主人确认：引导冥想一律拉黑不看',
    status: 'adopted',
  })
  assert.equal(jUpsert.ok, true)

  const jList = await board.methods.listJudgments.invoke({ verdict: 'drop' })
  assert.equal(jList.items.length, 1)
  assert.equal(jList.items[0].status, 'adopted')
  assert.match(jList.items[0].reason, /主人确认/)

  // 4. 意见箱闭环：她提意见 → 主人写批复并一键转成 dislike 过滤规则 → 下一轮系统前缀自动注入主人批复
  const fbSubmit = cap.tools().find((t) => t.name === 'feedback_submit')
  const f1 = await fbSubmit.execute({
    issue: '判断结果没有独立视图，只能从日记正文里捞',
    severity: 'high',
  })
  assert.equal(f1.ok, true)

  const openBefore = await board.methods.listFeedback.invoke({ status: 'open' })
  assert.equal(openBefore.openCount, 1)

  const rep = await board.methods.replyFeedback.invoke({
    id: f1.id,
    ownerReply: '已经给你把判断卡做成独立表格视图和 judgment_read 工具了！',
    resolve: true,
    convertRule: { kind: 'dislike', value: '游戏广告冥想' },
  })
  assert.equal(rep.ok, true)
  assert.equal(rep.resolved, true)
  assert.equal(convertedRules.length, 1)
  assert.deepEqual(convertedRules[0], { kind: 'dislike', value: '游戏广告冥想' })

  const openAfter = await board.methods.listFeedback.invoke({ status: 'open' })
  assert.equal(openAfter.openCount, 0)

  const prefixBlocks = await cap.contextSegments({ now: new Date(), timezone: 'Asia/Shanghai' })
  assert.equal(prefixBlocks.length, 1)
  assert.match(prefixBlocks[0].text, /已经给你把判断卡做成独立表格视图/)
})
