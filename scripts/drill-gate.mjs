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

// 假 CLI：feed 返回一个候选 BV，debrief 成功，draft 「真的出稿」打标记
fs.writeFileSync(path.join(repo, 'tools', 'bili.mjs'),
  'const a = process.argv.slice(2)\n' +
  'if (a[0] === "feed") console.log("candidate BV1TESTTEST1 title=demo")\n' +
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

// —— 场景 3：正常顺序（feed → debrief → draft）应当放行
await tools.bili_debrief.handler({ bvid: 'BV1TESTTEST1' })
const okDraft = await tools.bili_draft_dynamic.handler({})
check('debrief 后 draft 放行', okDraft.includes('DRAFT_WRITTEN'))

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

fs.rmSync(tmp, { recursive: true, force: true })
const failed = checks.filter((c) => !c.ok)
console.log('---\n' + (checks.length - failed.length) + '/' + checks.length + ' 通过')
process.exit(failed.length ? 1 : 0)
