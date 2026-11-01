/**
 * 「两个家归一」的读写契约（tools/lib/paths.mjs）。
 *
 * HOME/WHALE_HOME 在 import paths.mjs 之前就指到临时目录，全程不碰真 ~/.dsh、~/.bili-ai。
 * 凭据不参与归一：读写都留在旧家，所以新家里那份过期副本不可能压住真 cookie（登录静默失效）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-state-home-'))
const home = path.join(tmp, 'user')
const whale = path.join(home, '.dsh')
const legacy = path.join(home, '.bili-ai')
fs.mkdirSync(legacy, { recursive: true })
fs.mkdirSync(whale, { recursive: true })
process.env.USERPROFILE = home
process.env.HOME = home
process.env.WHALE_HOME = whale

const P = await import('../../tools/lib/paths.mjs')
const { loadCred } = await import('../../tools/lib/cred.mjs')
const { queueGo } = await import('../../tools/lib/go-gate.mjs')

after(() => { fs.rmSync(tmp, { recursive: true, force: true }) })

const grab = (fn) => { try { fn(); return null } catch (e) { return e } }

test('状态写入只落新家，旧家不会被写', () => {
  P.writeStateText('{"log":[1]}', 'quota.json')
  assert.equal(P.stateDir(), path.join(whale, 'bili-ai'))
  assert.equal(fs.existsSync(P.statePath('quota.json')), true)
  assert.equal(fs.existsSync(path.join(legacy, 'quota.json')), false)
})

test('旧家独有的状态文件仍读得到（兼容期只读兜底）', () => {
  fs.writeFileSync(path.join(legacy, 'feedback.json'), '{"good":"看过的UP主"}')
  assert.equal(P.stateExists('feedback.json'), true)
  assert.equal(P.stateReadPath('feedback.json'), path.join(legacy, 'feedback.json'))
  assert.equal(JSON.parse(P.readStateText('feedback.json')).good, '看过的UP主')
})

test('两处都有时新那份赢，旧那份就此退役', () => {
  fs.writeFileSync(path.join(legacy, 'feedback.json'), '{"good":"旧家"}')
  P.writeStateText('{"good":"新家"}', 'feedback.json')
  assert.equal(P.stateReadPath('feedback.json'), P.statePath('feedback.json'))
  assert.equal(JSON.parse(P.readStateText('feedback.json')).good, '新家')
})

test('嵌套状态目录一样走新→旧', () => {
  fs.mkdirSync(path.join(legacy, 'ai-share', 'abc'), { recursive: true })
  fs.writeFileSync(path.join(legacy, 'ai-share', 'abc', 'BV1xx.sample.json'), '{"at":1}')
  assert.equal(P.stateExists('ai-share', 'abc', 'BV1xx.sample.json'), true)
  assert.equal(P.stateReadPath('ai-share', 'abc', 'BV1xx.sample.json'),
    path.join(legacy, 'ai-share', 'abc', 'BV1xx.sample.json'))
})

test('两处都没有 = 报错并列出两个找过的路径，不静默当空状态', () => {
  const err = grab(() => P.readStateText('replied.json'))
  assert.equal(err.code, 'ENOENT')
  assert.match(err.message, /replied\.json/)
  assert.ok(err.message.includes(P.statePath('replied.json')), '报错要说清新家路径')
  assert.ok(err.message.includes(path.join(legacy, 'replied.json')), '报错要说出旧家路径')
  assert.equal(P.stateExists('replied.json'), false)
})

test('credentials.json 留在旧家：新家里那份过期副本不会压住真 cookie', () => {
  const jct = 'a'.repeat(32)
  fs.writeFileSync(path.join(legacy, 'credentials.json'), JSON.stringify({ sessdata: '旧家真cookie', bili_jct: jct }))
  fs.writeFileSync(P.statePath('credentials.json'), JSON.stringify({ sessdata: '新家过期副本', bili_jct: jct }))
  assert.equal(P.credentialsPath(), path.join(legacy, 'credentials.json'))
  assert.equal(P.credentialsPath().startsWith(P.stateDir()), false)
  assert.equal(loadCred().sessdata, '旧家真cookie')
})

test('缺凭据是失败，不是空凭据', () => {
  fs.rmSync(path.join(legacy, 'credentials.json'))
  fs.rmSync(P.statePath('credentials.json'))
  const err = grab(() => loadCred())
  assert.match(err.message, /没有凭据文件/)
  assert.ok(err.message.includes(P.credentialsPath()), '报错要说出凭据路径')
})

test('读兜底 + 写新家 不会丢队列项：旧家待审的 argv 会被整份带进新家', () => {
  const legacyQueue = { items: [{ id: 'a1', kind: 'comment', argv: ['comment', '--go'] }] }
  fs.writeFileSync(path.join(legacy, 'pending-replies.json'), JSON.stringify(legacyQueue))
  queueGo({ argv: ['comment', '--go'], kind: 'fav', message: '第二条' })
  const now = JSON.parse(P.readStateText('pending-replies.json'))
  assert.equal(P.stateReadPath('pending-replies.json'), P.statePath('pending-replies.json'))
  assert.deepEqual(now.items.map((i) => i.kind), ['comment', 'fav'])
  assert.deepEqual(now.items[0].argv, ['comment', '--go'])
})

/**
 * core/api/routes.js 与 panel/data.js 的 `home` 是外面注进来的，不能直接用 stateReadPath
 * （那一对走 env 解析的旧家），所以有 stateReadPathFrom。这里锁的是"写的一侧换了家，
 * 读的一侧不能还守着旧家"——否则面板与审批视图会把新待审显示成 0 条。
 */
test('注入 home 的读点：新家有就用新家，新家没有才退到 <home>/.bili-ai', () => {
  const one = (tag) => JSON.stringify({ items: [{ id: tag, kind: 'fav', argv: ['fav', '--go'] }] })
  fs.mkdirSync(P.stateDir(), { recursive: true })
  fs.writeFileSync(P.statePath('pending-replies.json'), one('new'))
  fs.writeFileSync(path.join(legacy, 'pending-replies.json'), one('legacy'))
  // 两边都有：读必须跟着写的一侧（go-gate 往新家写）
  assert.equal(P.stateReadPathFrom(home, 'pending-replies.json'), P.statePath('pending-replies.json'))
  assert.equal(JSON.parse(fs.readFileSync(P.stateReadPathFrom(home, 'pending-replies.json'), 'utf8')).items[0].id, 'new')
  // 新家没了：退回旧家，兼容期不能把老队列当空的
  fs.rmSync(P.statePath('pending-replies.json'))
  assert.equal(P.stateReadPathFrom(home, 'pending-replies.json'), path.join(legacy, 'pending-replies.json'))
  // 两处都没有时给新家（读出来是 ENOENT），不许返回一个"看起来像旧家"的空文件
  fs.rmSync(path.join(legacy, 'pending-replies.json'))
  assert.equal(P.stateReadPathFrom(home, 'pending-replies.json'), P.statePath('pending-replies.json'))
})

// ── 读数只有一处来源（2026-11-01 审计 P0-1） ───────────────────────────────
// 分账的成因不是缺函数，而是调用方绕过函数自己拼 `.bili-ai`：
// 写落到 A、读落到 B，两边各自"正常"，合起来是两个数。所以这条锁的是**调用方**，
// 不是 paths.mjs 本身。
const REPO = path.resolve(import.meta.dirname, '..', '..')
const SRC_DIRS = ['tools', 'panel', 'scripts']

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue
      walk(abs, out)
      continue
    }
    if (/\.(mjs|js)$/.test(e.name)) out.push(abs)
  }
  return out
}

test('除 paths.mjs 与凭据外，没有脚本自己拼 .bili-ai 状态路径', () => {
  const offenders = []
  for (const dir of SRC_DIRS) {
    for (const file of walk(path.join(REPO, dir))) {
      if (path.basename(file) === 'paths.mjs') continue
      const text = fs.readFileSync(file, 'utf8')
      for (const [index, line] of text.split('\n').entries()) {
        if (!/['"`]\.bili-ai['"`]/.test(line)) continue
        // 注释与文档串说的是历史，不是代码路径；凭据是归一规则的明文例外。
        const code = line.split('//')[0]
        if (!/['"`]\.bili-ai['"`]/.test(code)) continue
        if (/credentials\.json|credentialsPath/.test(line)) continue
        // 备份脚本跨双家有明确理由，源码里那行上一句写了为什么；只放行 ops-backup。
        if (path.basename(file) === 'ops-backup.mjs') continue
        offenders.push(`${path.relative(REPO, file)}:${index + 1}  ${line.trim()}`)
      }
    }
  }
  assert.deepEqual(offenders, [], '状态路径必须走 paths.mjs（读写同一份实现），不能各拼各的')
})

test('额度读数只有一处来源：traffic 状态只在新家写', () => {
  const store = path.join(whale, 'bili-ai', 'traffic-state.json')
  fs.writeFileSync(store, JSON.stringify({ accounts: { a: { readDay: 7 } } }))
  assert.equal(P.stateExists('traffic-state.json'), true)
  assert.equal(P.stateReadPath('traffic-state.json'), store)
  // 旧家那份即使存在也不再被选中：新家优先
  fs.writeFileSync(path.join(legacy, 'traffic-state.json'), JSON.stringify({ accounts: { a: { readDay: 999 } } }))
  assert.equal(P.stateReadPath('traffic-state.json'), store)
})
