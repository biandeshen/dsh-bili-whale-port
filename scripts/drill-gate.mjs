/**
 * 离线验证「工具纪律门禁」真的会拦人（不联网、不触发真实唤醒）。
 * 用法：在装了 tsx 的目录运行 —— cd ../Cortico && node --import tsx ../dsh-bili-whale/scripts/drill-gate.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const CORTICO = process.env.CORTICO_ROOT || 'E:/WorkSpace_Qoder/Cortico'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drill-'))
const home = path.join(tmp, 'home')
const repo = path.join(tmp, 'repo')
fs.mkdirSync(path.join(home, 'bili-whale'), { recursive: true })
fs.mkdirSync(path.join(repo, 'tools'), { recursive: true })
fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true })

// 假 CLI：feed 返回一个候选 BV，debrief 回一份带「标题/UP」的回执（形状对齐真实 debrief），draft 「真的出稿」打标记
fs.writeFileSync(path.join(repo, 'tools', 'bili.mjs'),
  'const a = process.argv.slice(2)\n' +
  'if (a[0] === "feed") console.log("candidate BV1TESTTEST1 title=demo")\n' +
  'else if (a[0] === "debrief") console.log("标题: demo 雨声无人声\\nUP: 测试UP   时长: 44:00")\n' +
  'else console.log("ok")\n')
fs.writeFileSync(path.join(repo, 'scripts', 'draft-dynamic.mjs'), 'console.log("DRAFT_WRITTEN")\n')

process.env.BILI_WHALE_ROOT = repo
process.env.WHALE_HOME = home

const mod = await import('file:///' + CORTICO.replace(/\\/g, '/') + '/src/worlds/bili-account/definition.ts')
const tools = Object.fromEntries(mod.BILI_ACCOUNT.create().tools().map((t) => [t.name, t]))

const checks = []
const check = (name, ok, detail = '') => { checks.push({ name, ok, detail }); console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  ' + detail : '')) }

// —— 场景 1：feed 后不 debrief，直接出稿 / 记 watchedVideo
const feedOut = await tools.bili_feed.handler({ n: 1 })
check('feed 回执带 [NEXT] + BV', feedOut.includes('[NEXT]') && feedOut.includes('BV1TESTTEST1'))

const draftOut = await tools.bili_draft_dynamic.handler({})
check('未 debrief 时 draft 被拒', draftOut.startsWith('[refused]'), JSON.stringify(draftOut.slice(0, 40)))
check('被拒时没有真的出稿', !draftOut.includes('DRAFT_WRITTEN'))

const watchedOut = await tools.bili_mood_apply.handler({ preset: 'watchedVideo' })
check('未 debrief 时 watchedVideo 被拒', watchedOut.startsWith('[refused]'))

// —— 场景 2：违规是否真的落盘
const causalFile = path.join(home, 'bili-whale', 'causal.jsonl')
const lines = fs.existsSync(causalFile) ? fs.readFileSync(causalFile, 'utf8').trim().split('\n').filter(Boolean) : []
const violations = lines.map((l) => JSON.parse(l)).filter((o) => o.kind === 'discipline-violation')
check('纪律违规写入 causal.jsonl', violations.length >= 2, '条数=' + violations.length)
check('违规原因可区分', new Set(violations.map((v) => v.reason)).size >= 2,
  [...new Set(violations.map((v) => v.reason))].join(' / '))

// —— 场景 3：正常顺序（feed → debrief → 写日记 → draft）应当放行
await tools.bili_debrief.handler({ bvid: 'BV1TESTTEST1' })
const roundAfter = JSON.parse(fs.readFileSync(path.join(home, 'bili-whale', 'control', 'round.json'), 'utf8'))
check('debrief 状态落盘（进程重启后仍算这一轮）', roundAfter.debriefed === true && roundAfter.bvid === 'BV1TESTTEST1', JSON.stringify(roundAfter))
const staleDraft = await tools.bili_draft_dynamic.handler({})
check('没写当天日记时 draft 被拒', staleDraft.startsWith('[refused]') && !staleDraft.includes('DRAFT_WRITTEN'))
const today = new Date().toLocaleDateString('sv-SE')
const diaryOut = await tools.bili_diary_append.handler({
  book: 'public', heading: '看过',
  text: ['| 时间 | BV | 标题 | 简介 | 想法 |', '| --- | --- | --- | --- | --- |', `| ${today} | BV1TESTTEST1 | demo 雨声 | x | 想再看 |`].join('\n'),
})
check('日记写入成功（当天日期块）', diaryOut.startsWith('[diary]'))
await tools.bili_diary_append.handler({ book: 'public', heading: '想说', text: '- 今天这条雨声挺好，留着。' })
const diaryText = fs.readFileSync(path.join(home, 'whale-diary.md'), 'utf8')
check('日记按天/按节写入且不重复', (diaryText.match(new RegExp('## ' + today, 'g')) || []).length === 1 && (diaryText.match(/## 看过/g) || []).length === 1)
const okDraft = await tools.bili_draft_dynamic.handler({})
check('debrief + 当天日记后 draft 放行', okDraft.includes('DRAFT_WRITTEN'))

// —— 场景 3b：debrief 成功要把这条片子写进记忆（否则"有连续记忆"没有运行证据）
const stateAfterDebrief = JSON.parse(fs.readFileSync(path.join(home, 'bili-whale', 'fields.json'), 'utf8'))
const memHit = (stateAfterDebrief.memories || []).find((m) => String(m.content).includes('BV1TESTTEST1'))
check('debrief 后写入长期记忆', !!memHit, memHit ? JSON.stringify(memHit.content) : 'memories=' + (stateAfterDebrief.memories || []).length)
check('记忆带编码强度与来源', !!memHit && memHit.encodingStrength > 0 && memHit.source === 'npc_self')
const stateDesc = await tools.bili_mood_read.handler({})
check('状态回读里能看到这条记忆', stateDesc.includes('BV1TESTTEST1') || String(stateDesc).includes('看过《'))

// —— 场景 4：下一步动作对新的 feed 生效（debriefed 被重置）
await tools.bili_feed.handler({ n: 1 })
const againOut = await tools.bili_draft_dynamic.handler({})
check('新一轮 feed 后门禁重新生效', againOut.startsWith('[refused]'))

// —— 场景 5：情绪可追溯（before/after/effects 齐全）
const applyOut = await tools.bili_mood_apply.handler({ preset: 'masterReplied' })
const all = fs.readFileSync(causalFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
const traced = all.filter((o) => o.before && o.after && Array.isArray(o.effects))
check('情绪变化有 before/after/effects', traced.length >= 1)
if (traced.length) {
  const t = traced[traced.length - 1]
  console.log('      示例：mood ' + t.before.mood + ' -> ' + t.after.mood + '  成因 ' + t.kind)
  console.log('      回读：' + applyOut.split('\n')[0])
}

// —— 场景 6：ack 一次性批准（错误 token / 正常 / 重复 / 过期）
const ack = await import('./ack.mjs')
const q = ack.enqueue(home, { kind: 'dynamic', text: 'demo' }, { ttlMs: 60_000 })
check('入队返回 id+token', !!q.id && !!q.token)
check('错误 token 被拒', ack.approve(home, q.id, 'wrong').code === 'bad-token')
const a1 = ack.approve(home, q.id, q.token)
check('正确 token 放行', a1.ok && a1.payload.kind === 'dynamic')
check('重复放行被拒', ack.approve(home, q.id, q.token).code === 'used')
const q2 = ack.enqueue(home, { kind: 'expire' }, { ttlMs: 1 })
await new Promise((r) => setTimeout(r, 5))
check('过期被拒', ack.approve(home, q2.id, q2.token).code === 'expired')
check('不存在的 id 被拒', ack.approve(home, 'ack-missing', 'x').code === 'not-found')

// —— 场景 7：昨日违规 → kick 点名
const gates = await import('file:///' + CORTICO.replace(/\\/g, '/') + '/src/worlds/bili-account/gates.ts')
const yesterday = new Date(Date.now() - 20 * 3600_000).toISOString()
fs.appendFileSync(causalFile, JSON.stringify({ at: yesterday, kind: 'discipline-violation', reason: 'draft-without-debrief' }) + '\n')
const entries = fs.readFileSync(causalFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
const notice = gates.violationNotice(entries)
check('kick 点名昨日违规', /上一轮.*debrief/.test(notice), notice)
check('无违规时点名为空', gates.violationNotice([]) === '')

// —— 场景 8：生产审批必须带一次性 token
process.env.DSH_HOME = home
const draftDir = path.join(tmp, 'drafts')
fs.mkdirSync(draftDir, { recursive: true })
process.env.WHALE_DRAFTS = draftDir
const { approve } = await import('./dynamic-approve.mjs')
const ackItem = ack.enqueue(home, { draftId: 'd-prod' })
fs.writeFileSync(path.join(draftDir, 'd-prod.json'), JSON.stringify({ id: 'd-prod', text: 't', image: 'x.png', status: 'pending', ackId: ackItem.id }))
const fakeRun = () => ({ status: 0, stdout: 'dyn_id=1', stderr: '' })
check('无 token 真发被拒', approve({ id: 'd-prod', go: true, runner: fakeRun }).ok === false)
check('错 token 真发被拒', approve({ id: 'd-prod', go: true, token: 'bad', runner: fakeRun }).code === 'bad-token')
check('正确 token 真发放行', approve({ id: 'd-prod', go: true, token: ackItem.token, runner: fakeRun }).ok === true)
check('同 token 二次放行被拒', approve({ id: 'd-prod', go: true, token: ackItem.token, runner: fakeRun }).ok === false)

// —— 场景 9：审批结果回写因果，醒来时由代码结算（不靠模型自觉）
const resultLines = fs.readFileSync(causalFile, 'utf8').trim().split('\n').filter(Boolean)
  .map((l) => JSON.parse(l)).filter((o) => o.kind === 'draft-result')
check('真发成功写入 draft-result 因果', resultLines.length === 1 && resultLines[0].result === 'sent', JSON.stringify(resultLines[0]?.result))

const d2 = { id: 'd-prod2', text: 't2', image: 'x.png', status: 'pending', ackId: ack.enqueue(home, { draftId: 'd-prod2' }).id }
fs.writeFileSync(path.join(draftDir, 'd-prod2.json'), JSON.stringify(d2))
const { reject } = await import('./dynamic-approve.mjs')
check('拒稿成功', reject('d-prod2').ok === true)
check('已发出的草稿不能再改成 rejected', reject('d-prod').ok === false)

const stateBefore = JSON.parse(fs.readFileSync(path.join(home, 'bili-whale', 'fields.json'), 'utf8'))
const allEntries = fs.readFileSync(causalFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
const settled = mod.consumeDraftResults(stateBefore, allEntries, 0)
check('醒来时代码结算出情绪效果', settled.applied.length === 2 && settled.applied.includes('draftApproved') && settled.applied.includes('draftRejected'), JSON.stringify(settled.applied))
const settledAgain = mod.consumeDraftResults(stateBefore, allEntries, settled.consumedAt)
check('结算游标生效，不会重复扣', settledAgain.applied.length === 0)

fs.rmSync(tmp, { recursive: true, force: true })
const failed = checks.filter((c) => !c.ok)
console.log('---\n' + (checks.length - failed.length) + '/' + checks.length + ' 通过')
process.exit(failed.length ? 1 : 0)
