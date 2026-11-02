// 世界页契约：小鱼 · 鱼缸（2026-10-31 功能聚合 + 发送策略）——面板清单/写方法不进 GET/策略纯函数
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BILI_ACCOUNT, exportPolicyNotice } from '../src/worlds/bili-account/definition.ts'
import { readPolicyLite, policyInWindow, policySet, policyState, autoSentToday, draftForDay, freshAckToken, openFeedbackCount, settingsOverview, settingsState, personaNameFromConfig, hostDisplayName, renameSelf } from '../src/worlds/bili-account/tank.ts'

const decl = BILI_ACCOUNT.create().webUi('zh')

test('鱼缸页声明：8 块面板、id 合法且唯一、灯 ≤7', () => {
  // 标题不再写死"小鱼"：它跟配置里的 self.name 走（#48），所以这里断言的是同一来源，
  // 不把某一份具体配置当成规格。
  assert.equal(decl.label, `${personaNameFromConfig()} · 鱼缸`)
  assert.match(decl.label, /^.{1,24} · 鱼缸$/)
  const panels = decl.panels ?? []
  assert.deepEqual(panels.map((p) => p.id).sort(), ['diary', 'drafts', 'feedback', 'judgment', 'policy', 'tank', 'timeline', 'vitals'])
  for (const p of panels) assert.match(p.id, /^[a-z0-9-]+$/, `${p.id} id 合法性`)
  assert.equal(new Set(panels.map((p) => p.id)).size, panels.length, 'id 唯一')
  assert.ok((decl.lamps ?? []).length >= 1 && (decl.lamps ?? []).length <= 7, '灯 1–7')
  for (const l of decl.lamps ?? []) assert.ok(['online', 'loading', 'error', 'offline'].includes(l.state))
  assert.ok((decl.badges ?? []).length >= 1)
})

test('写方法只走 POST：approve/reject/resolve 不在 getMethods', () => {
  for (const p of decl.panels ?? []) {
    for (const m of p.getMethods ?? []) assert.equal(m, 'state', `${p.id} 只允许 state 进 GET`)
  }
})

test('invoke 路由：未知面板/未知方法显式拒绝，不静默吞', async () => {
  await assert.rejects(decl.invoke?.('nope', 'state', []), /unknown panel/)
  await assert.rejects(decl.invoke?.('tank', 'bogus', []), /unknown method/)
  // state 是真数据面：本地场值在本机必存在（缺文件时 ok:false 也不抛）
  const st = await decl.invoke?.('tank', 'state', [])
  assert.ok(st && typeof st === 'object' && 'ok' in st, 'tank/state 返回结构')
})

// ── 发送策略（tank.ts 纯函数；写盘只在临时文件里发生，绝不碰真配置） ──────────
test('readPolicyLite：空/野值都收敛到拍板默认', () => {
  assert.deepEqual(readPolicyLite({}), { draftMode: 'review', autoDailyCap: 0, autoWindow: '', like: 'self', fav: 'self', dmReply: 'direct', comment: 'review', danmaku: 'review' })
  assert.equal(readPolicyLite({ publish: { draftMode: 'yolo' } }).draftMode, 'review')
  assert.equal(readPolicyLite({ publish: { draftMode: 'auto' }, permissions: { fav: 'review' } }).draftMode, 'auto')
  // 2026-11-03：评论与弹幕补了档位，野值收敛到 review（等主人放行），不许被写成 self
  assert.equal(readPolicyLite({ permissions: { comment: 'yolo', danmaku: 'true' } }).comment, 'review')
  assert.equal(readPolicyLite({ permissions: { comment: 'yolo', danmaku: 'true' } }).danmaku, 'review')
})

test('policySet：临时文件 roundtrip，别的关键配置原样保留', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-'))
  const file = path.join(dir, 'bili-whale.config.json')
  fs.writeFileSync(file, JSON.stringify({ risk: { minGapMs: 1500 }, owner: { mid: '233643544' }, preferences: { like: ['助眠/ASMR'] } }))
  const ok = policySet({ publish: { draftMode: 'auto', autoDailyCap: 2, autoWindow: '10:00-23:00' }, permissions: { like: 'review' } }, file)
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.policy, { draftMode: 'auto', autoDailyCap: 2, autoWindow: '10:00-23:00', like: 'review', fav: 'self', dmReply: 'direct', comment: 'review', danmaku: 'review' })
  const back = policyState(file)
  assert.deepEqual(back.policy, ok.policy)
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(raw.risk.minGapMs, 1500, 'risk 节不能被动')
  assert.equal(raw.owner.mid, '233643544', 'owner 节不能被动')
  assert.deepEqual(raw.preferences.like, ['助眠/ASMR'], '偏好不能被动')
  assert.deepEqual(policySet({ publish: { draftMode: 'auto', autoDailyCap: -9 } }, file).policy.autoDailyCap, 0, '非法值写盘前就被收敛')
})

test('policyInWindow + autoSentToday：时段含始不含终/跨午夜；只数今天的 ok', () => {
  assert.equal(policyInWindow(new Date('2026-10-31T10:00:00'), ''), true)
  assert.equal(policyInWindow(new Date('2026-10-31T23:30:00'), '10:00-23:00'), false)
  assert.equal(policyInWindow(new Date('2026-10-31T03:00:00'), '23:00-07:00'), true)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'causal-'))
  const f = path.join(dir, 'causal.jsonl')
  fs.writeFileSync(f, [
    JSON.stringify({ kind: 'auto-publish', ok: true, at: '2026-10-31T01:00:00.000Z' }),
    JSON.stringify({ kind: 'auto-publish', ok: false, at: '2026-10-31T02:00:00.000Z' }),
    JSON.stringify({ kind: 'auto-publish', ok: true, at: '2026-10-30T02:00:00.000Z' }),
  ].join('\n') + '\n')
  assert.equal(autoSentToday({ file: f, day: '2026-10-31' }), 1, '只数成功的')
  assert.equal(autoSentToday({ file: f, day: '2026-10-31', attempts: true }), 2, '算上失败尝试才能堵住绕上限')
  assert.equal(autoSentToday({ file: path.join(dir, 'missing.jsonl') }), 0, '没账本 = 0，不抛')
})

test('freshAckToken + draftForDay：只认草稿自带且仍有效的令牌，绝不铸造', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ack-'))
  const whale = path.join(dir, 'whale')
  const drafts = path.join(dir, 'drafts')
  const pend = path.join(whale, 'bili-whale', 'control', 'pending')
  fs.mkdirSync(drafts, { recursive: true }); fs.mkdirSync(pend, { recursive: true })
  // 草稿文件名就是日期（<day>.json 是事实源），draftForDay 只认这一天
  const mk = (day, id, ackId, extra = {}) => {
    fs.writeFileSync(path.join(drafts, day + '.json'), JSON.stringify({ id, date: day, ackId, status: 'pending' }))
    fs.writeFileSync(path.join(pend, ackId + '.json'), JSON.stringify({ token: 'tk-' + ackId, used: false, expiresAt: Date.now() + 3600_000, payload: { draftId: id }, ...extra }))
  }
  mk('2026-10-31', 'dyn-20261031-aaa', 'ack-a')
  assert.equal(freshAckToken(draftForDay('2026-10-31', drafts), whale), 'tk-ack-a', '有效令牌才给')
  mk('2026-11-01', 'dyn-20261101-bbb', 'ack-b', { used: true })
  assert.equal(freshAckToken(draftForDay('2026-11-01', drafts), whale), null, '已用过 = 没有')
  mk('2026-11-02', 'dyn-20261102-ccc', 'ack-c', { expiresAt: Date.now() - 1 })
  assert.equal(freshAckToken(draftForDay('2026-11-02', drafts), whale), null, '过期 = 没有')
  mk('2026-11-03', 'dyn-20261103-ddd', 'ack-d', { payload: { draftId: 'other' } })
  assert.equal(freshAckToken(draftForDay('2026-11-03', drafts), whale), null, '绑定不符 = 没有')
  assert.equal(draftForDay('2026-11-04', drafts), null, '没那天的草稿文件 = null，不去别的草稿兜底')
})

test('意见箱灯：resolved 行不删原始条目，按同 id 折叠；已解决的不能再算未解决', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-count-'))
  const file = path.join(dir, 'feedback.jsonl')
  const line = (o) => JSON.stringify(o)
  const add = (id) => ({ kind: 'feedback', id, at: '2026-11-01T00:00:00Z', issue: 'x', severity: 'low' })
  const done = (id) => ({ kind: 'feedback-resolved', id, at: '2026-11-01T01:00:00Z', resolvedBy: 'owner' })
  // 顺序敏感：resolved 写在后面（真实实现就是只追加，永不删原条目）
  fs.writeFileSync(file, [line(add('a')), line(add('b')), line(done('a')), line(done('b'))].join('\n') + '\n')
  assert.equal(openFeedbackCount(file), 0, '全部解决 = 灯灭')

  fs.writeFileSync(file, [line(add('a')), line(done('a')), line(add('c'))].join('\n') + '\n')
  assert.equal(openFeedbackCount(file), 1, '只剩 c 未解决')

  // 坏行与无 id 的行跳过，不影响其它记录
  fs.writeFileSync(file, ['not json', line({ kind: 'feedback' }), line(add('d')), line(done('d'))].join('\n') + '\n')
  assert.equal(openFeedbackCount(file), 0)

  fs.rmSync(dir, { recursive: true, force: true })
})

// 2026-11-01 01:23：正式配置被人写过一次 draftMode=auto（载荷与测试夹具同源，且本机 7799 免口令）。
// 从那天起：测试不许碰真配置，auto 生效必须留一条她自己也读得到的痕迹。
// 全部配置总览（主人的硬要求：每一项都看得见，不是去翻 JSON）
test('settingsOverview：摊平、分组，并标出页面可改/要不要重启/有没有声明默认值', () => {
  const user = {
    owner: { mid: '233643544', name: '主人', displayName: '鱼片' },
    self: { mid: '497080562', name: '恐怖深海鱼' },
    preferences: { like: ['助眠/ASMR'], dislike: ['带货'], keywords: ['雨声'] },
    risk: { writeHourly: 12, writeGapSec: 120 },
    publish: { draftMode: 'review', autoDailyCap: 0, autoWindow: '' },
    permissions: { like: 'self' },
    notify: { type: 'none' },
  }
  const declared = { owner: { mid: '', name: '' }, risk: { writeHourly: 12 }, self: { mid: '' } }
  const o = settingsOverview(user, declared)
  assert.equal(o.total, 15, '嵌套对象摊平到叶子；数组算一项')
  assert.equal(o.groups.length, 7)
  const find = (k) => o.groups.flatMap((g) => g.items).find((i) => i.key === k)
  assert.equal(find('publish.draftMode').editable, true)
  assert.equal(find('owner.displayName').needsRestart, true, 'Cortico 只在启动时读称呼，页面上必须说明')
  assert.equal(find('risk.writeHourly').declared, true)
  assert.equal(find('notify.type').declared, false, '默认值里没写的要标出来，不许假装都声明了')
  assert.equal(o.undeclared, 11)
  assert.equal(find('preferences.keywords').value.join(' · '), '雨声', '数组值给可读文本')
  assert.equal(settingsOverview({ clock: { enabled: false } }, {}).groups[0].label, '时钟（插件时代遗留，待查实）', '遗留分组要标出来，不能露英文原名')
})

test('settingsState：读真配置文件，字段齐全且带文件位置（只读，不写盘）', () => {
  const s = settingsState()
  assert.equal(s.ok, true)
  assert.match(s.file, /bili-whale\.config\.json$/)
  assert.ok(s.total >= 1, '配置文件至少有一项')
  for (const g of s.groups) for (const it of g.items) {
    assert.equal(typeof it.key, 'string')
    assert.equal(typeof it.editable, 'boolean')
    assert.equal(typeof it.declared, 'boolean')
  }
})

test('auto 的痕迹：措辞由纯函数给；review 不留痕；测试上下文拒绝写真配置', async () => {
  assert.equal(exportPolicyNotice({ draftMode: 'review' }), null)
  const n = exportPolicyNotice({ draftMode: 'auto', autoDailyCap: 0, autoWindow: '' })
  assert.equal(n.heading, '策略变了')
  assert.match(n.body, /不等主人点头/)
  assert.match(n.body, /每日上限 不限，时段 不限/)
  assert.match(n.body, /这不是我改的/)
  assert.match(exportPolicyNotice({ draftMode: 'auto', autoDailyCap: 2, autoWindow: '10:00-23:00' }).body, /每日上限 2 条，时段 10:00-23:00/)
  const denied = policySet({ publish: { draftMode: 'auto' } })
  assert.equal(denied.ok, false, 'node:test 上下文里默认路径必须被拒')
  assert.match(denied.error, /临时路径/)
  // 显式临时文件仍然可用
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-guard-'))
  const file = path.join(dir, 'bili-whale.config.json')
  fs.writeFileSync(file, JSON.stringify({ home: 'D:/keep-me' }), 'utf8')
  assert.equal(policySet({ publish: { draftMode: 'review' } }, file).ok, true)
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).home, 'D:/keep-me', '别的键不许丢')
})

// #48 她的名字：主人要在页面上能改，不要散在代码里；但这一格改的是本机称呼，
// B 站昵称是账号字段——这一页不替他动账号，所以文案必须把这条说清（不许假装一个开关管两头）。
test('personaNameFromConfig：读 self.name，去空白、24 字封顶，空值回落默认称呼', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pname-'))
  const file = path.join(dir, 'bili-whale.config.json')
  const write = (self) => fs.writeFileSync(file, JSON.stringify({ self }), 'utf8')
  write({ name: '恐怖深海鱼' })
  assert.equal(personaNameFromConfig(file), '恐怖深海鱼')
  write({ name: '  大肥鱼  ' })
  assert.equal(personaNameFromConfig(file), '大肥鱼', '首尾空白不许进标题')
  write({ name: '名'.repeat(40) })
  assert.equal(personaNameFromConfig(file).length, 24, '与主人称呼同一道边界')
  write({ name: '' })
  assert.equal(personaNameFromConfig(file), '小鱼', '空值保持现名，不许把标题变成空白')
  write(null)
  assert.equal(personaNameFromConfig(file), '小鱼')
  fs.rmSync(file)
  assert.equal(personaNameFromConfig(path.join(dir, 'nope.json')), '小鱼', '读不到配置也要有名字')
})

test('renameSelf：改本机名字只动 self.name，别的一项不碰；空名与非字符串拒', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-'))
  const file = path.join(dir, 'bili-whale.config.json')
  fs.writeFileSync(file, JSON.stringify({ self: { name: '旧名', mid: '497080562' }, owner: { displayName: '鱼片' } }), 'utf8')
  const r = renameSelf('  新名  ', file)
  assert.equal(r.ok, true)
  assert.equal(r.name, '新名', '首尾空白裁掉')
  const after = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(after.self.name, '新名')
  assert.equal(after.self.mid, '497080562', '同段其他字段不许丢')
  assert.equal(after.owner.displayName, '鱼片', '别的段不许动')
  assert.equal(renameSelf('   ', file).ok, false)
  assert.match(renameSelf('', file).error, /不能是空/)
  assert.equal(renameSelf('名'.repeat(40), file).name.length, 24)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('改本机名字时部署那份 displayName 一起写：导航与标题不会各叫各的', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-host-'))
  const file = path.join(dir, 'bili-whale.config.json')
  const bot = path.join(dir, 'deploy', 'config.json')
  fs.mkdirSync(path.dirname(bot), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ self: { name: '旧名' } }), 'utf8')
  fs.writeFileSync(bot, JSON.stringify({ displayName: '旧名', activeProvider: 'x', worlds: { figure: { enabled: false } } }), 'utf8')

  const r = renameSelf('新名', file, bot)
  assert.equal(r.ok, true)
  assert.equal(r.hostUpdated, true)
  const deploy = JSON.parse(fs.readFileSync(bot, 'utf8'))
  assert.equal(deploy.displayName, '新名')
  assert.equal(deploy.activeProvider, 'x', '部署配置的其他键原样保留')
  assert.deepEqual(deploy.worlds, { figure: { enabled: false } })

  // 部署那份写不进去：本机名字照样生效，但要如实说导航没跟上
  const blocked = renameSelf('再来一个', file, path.join(dir, 'no-such-dir-x', '\u0000bad'))
  assert.equal(blocked.ok, true)
  assert.equal(blocked.hostUpdated, false)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('hostDisplayName：读部署 config.json 的 displayName，没有就说没有', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hostname-'))
  const bot = path.join(dir, 'config.json')
  assert.equal(hostDisplayName(null), null, '没拿到部署目录 = 没有第二个来源')
  assert.equal(hostDisplayName(bot), null, '文件不存在 = 没有')
  fs.writeFileSync(bot, JSON.stringify({ displayName: '  导航名  ' }), 'utf8')
  assert.equal(hostDisplayName(bot), '导航名')
  fs.writeFileSync(bot, JSON.stringify({ displayName: '   ' }), 'utf8')
  assert.equal(hostDisplayName(bot), null, '全空白当没有')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('世界页标题跟着 self.name 走；工具描述里不再写死名字', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pname-'))
  const file = path.join(dir, 'bili-whale.config.json')
  fs.writeFileSync(file, JSON.stringify({ self: { name: '深海大肥鱼' } }), 'utf8')
  const zh = BILI_ACCOUNT.describe.tools.find((t) => t.name === 'bili_mood_read')
  assert.equal(/Xiaoyu|小鱼/.test((zh.description ?? '') + JSON.stringify(zh.summary ?? '')), false, '改了名字之后这句话会变成假话')
  const declared = BILI_ACCOUNT.describe.tools.map((t) => t.name).join(',')
  assert.ok(declared.includes('bili_mood_read'))
})

// ── 待审稿读数只此一处（2026-11-01 审计 P0-2） ─────────────────────────────
// 症状：badge 报「待放行=0」、灯说「没有等放行的稿」，而同页面板列得出一条 pending 草稿。
// 根因不是数错，是两处各解析一次草稿目录，第二份漏了 legacy 分支，于是 badge 读的是一个
// 不存在的空目录。这条锁的是"面板、badge、灯、CLI 读的是同一个数"。
test('草稿目录只有一处解析：面板与 badge 同源，badge 数得出现在面板里的 pending', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drafts-one-'))
  const prev = process.env.WHALE_DRAFTS
  process.env.WHALE_DRAFTS = dir
  try {
    // 模块级 DRAFTS_DIR 在 import 时定值，所以带一个新的 query 重新加载一份拿新 env。
    const fresh = await import(`../src/worlds/bili-account/tank.ts?drafts=${Date.now()}`)
    fs.writeFileSync(path.join(dir, '2026-11-01.json'), JSON.stringify({ id: 'dyn-1', status: 'pending', text: 'x' }), 'utf8')
    fs.writeFileSync(path.join(dir, '2026-10-31.json'), JSON.stringify({ id: 'dyn-0', status: 'sent', text: 'y' }), 'utf8')
    assert.equal(fresh.pendingDraftCount(), 1, 'badge 数出的 pending 必须和面板看到的是同一批文件')
    assert.equal(fresh.consolePaths.DRAFTS_DIR, dir, '面板、badge、CLI 用的是同一个目录')
  } finally {
    if (prev === undefined) delete process.env.WHALE_DRAFTS
    else process.env.WHALE_DRAFTS = prev
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

// 同一类症状的第二半：待审回信队列（go-gate 写的 pending-replies.json）不在草稿目录里。
// 实测 2026-11-02：面板说 13（9 回信 + 4 草稿），世界页徽标只说 4 —— 少算的那 9 条
// 正好在旧家状态目录。这条锁的是"徽标 = 面板 = CLI"这个等式。
test('待放行 = 草稿 + 待审回信：徽标与面板同一口径，且新旧状态目录都认', async () => {
  const whale = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-total-'))
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-home-'))
  const drafts = path.join(whale, 'bili-whale', 'drafts')
  fs.mkdirSync(drafts, { recursive: true })
  fs.writeFileSync(path.join(drafts, '2026-11-01.json'), JSON.stringify({ status: 'pending' }), 'utf8')
  fs.writeFileSync(path.join(drafts, '2026-10-31.json'), JSON.stringify({ status: 'sent' }), 'utf8')

  const prevDrafts = process.env.WHALE_DRAFTS
  const prevWhale = process.env.WHALE_HOME
  const prevDsh = process.env.DSH_HOME
  const prevProfile = process.env.USERPROFILE
  process.env.WHALE_DRAFTS = drafts
  process.env.WHALE_HOME = whale
  delete process.env.DSH_HOME
  process.env.USERPROFILE = home
  try {
    // 先只放旧家：读取要能退到旧家（go-gate 在迁移前写的就是这里）
    fs.mkdirSync(path.join(home, '.bili-ai'), { recursive: true })
    fs.writeFileSync(path.join(home, '.bili-ai', 'pending-replies.json'), JSON.stringify({ items: [{}, {}, {}] }), 'utf8')
    let fresh = await import(`../src/worlds/bili-account/tank.ts?pending=${Date.now()}`)
    assert.equal(fresh.pendingReplyCount(), 3, '旧家那 3 条也要算进待放行')
    assert.equal(fresh.pendingTotal(), 4, '1 条草稿 + 3 条回信')

    // 再放新家：新家优先，旧家作废（两边都有时不叠加）
    fs.mkdirSync(path.join(whale, 'bili-ai'), { recursive: true })
    fs.writeFileSync(path.join(whale, 'bili-ai', 'pending-replies.json'), JSON.stringify({ items: [{}, {}] }), 'utf8')
    fresh = await import(`../src/worlds/bili-account/tank.ts?pending=${Date.now()}b`)
    assert.equal(fresh.pendingReplyCount(), 2, '新家存在就只认新家')
    assert.equal(fresh.pendingTotal(), 3, '1 条草稿 + 2 条回信')
  } finally {
    const restore = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    restore('WHALE_DRAFTS', prevDrafts); restore('WHALE_HOME', prevWhale)
    restore('DSH_HOME', prevDsh); restore('USERPROFILE', prevProfile)
    fs.rmSync(whale, { recursive: true, force: true })
    fs.rmSync(home, { recursive: true, force: true })
  }
})

// 2026-11-02 拆分：definition.ts 从 1440 行降到 ~1055 行，纯数据与纯函数搬到了
// tool-decls / capability / paths / causal-io / prompts。搬家的验收标准是**对外契约一模一样**，
// 这条锁住三件事：工具表仍按序、handler 下标仍对得上、旧入口仍能按名字 import。
test('拆出去的工具表与 handler 下标仍对得上，旧入口仍可用', async () => {
  const { DECLS, BILI_TOOL_DECLS } = await import('../src/worlds/bili-account/tool-decls.ts')
  const def = await import('../src/worlds/bili-account/definition.ts')

  // ① 声明是有序数组：handler 用 DECLS[n] 取参数 schema，顺序变了等于换了参数
  assert.equal(DECLS.length, 18, '工具数变了就要同步改 tools() 里的下标')
  assert.deepEqual(
    DECLS.map((d) => d.name),
    ['bili_traffic', 'bili_feed', 'bili_debrief', 'bili_diary_read', 'bili_mood_read', 'bili_mood_apply',
      'bili_draft_dynamic', 'bili_diary_append', 'bili_dm_read', 'bili_dm_reply', 'bili_feedback',
      'bili_like', 'bili_fav', 'bili_capabilities', 'bili_look', 'bili_alarm', 'bili_memory_void', 'bili_judgment'],
  )
  // ② 每个声明都有给人看的一句话（自描述与手脚清单共用）
  for (const d of DECLS) assert.ok(BILI_TOOL_DECLS.find((t) => t.name === d.name)?.summary, `${d.name} 缺摘要`)

  // ③ 旧调用方（测试、脚本）仍能按原来的名字从这个文件 import
  for (const name of ['countCausalActions', 'sanitizeEffects', 'parseDebriefMemory', 'exportPolicyNotice', 'consumeDraftResults', 'capabilityText']) {
    assert.equal(typeof def[name], 'function', `definition.ts 不再导出 ${name}`)
  }
  assert.ok(def.BILI_ACCOUNT, 'BILI_ACCOUNT 仍在 definition.ts')
})

// 2026-11-02 切 live 当场暴露：面板 6、世界页 5，差一条 dm 回信草稿。
// 「待放行」这一格三路都要算：动态草稿 / 待审回信队列 / 私信回信草稿。
test('待放行三路都算：漏掉 dm 回信就会和面板差数', async () => {
  const whale = fs.mkdtempSync(path.join(os.tmpdir(), 'pending3-'))
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pending3h-'))
  const drafts = path.join(whale, 'bili-whale', 'drafts')
  const ctrl = path.join(whale, 'bili-whale', 'control')
  fs.mkdirSync(drafts, { recursive: true })
  fs.mkdirSync(ctrl, { recursive: true })
  fs.mkdirSync(path.join(whale, 'bili-ai'), { recursive: true })

  fs.writeFileSync(path.join(drafts, '2026-11-02.json'), JSON.stringify({ status: 'pending' }), 'utf8')
  fs.writeFileSync(path.join(ctrl, 'dm-drafts.json'), JSON.stringify({ items: [
    { id: 'dm-p', status: 'pending' }, { id: 'dm-s', status: 'sent' },
  ] }), 'utf8')
  fs.writeFileSync(path.join(whale, 'bili-ai', 'pending-replies.json'), JSON.stringify({ items: [{}, {}] }), 'utf8')

  const prev = { WHALE_DRAFTS: process.env.WHALE_DRAFTS, WHALE_HOME: process.env.WHALE_HOME, DSH_HOME: process.env.DSH_HOME, USERPROFILE: process.env.USERPROFILE }
  process.env.WHALE_DRAFTS = drafts
  process.env.WHALE_HOME = whale
  delete process.env.DSH_HOME
  process.env.USERPROFILE = home
  try {
    const t = await import(`../src/worlds/bili-account/tank.ts?three=${Date.now()}`)
    assert.equal(t.pendingDraftCount(), 1, '动态稿 1')
    assert.equal(t.pendingReplyCount(), 2, '待审回信 2')
    assert.equal(t.pendingDmReplyCount(), 1, '私信回信只数待处理的（sent 不算）')
    assert.equal(t.pendingTotal(), 4, '三路相加')
  } finally {
    const restore = (k, v) => { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    restore('WHALE_DRAFTS', prev.WHALE_DRAFTS); restore('WHALE_HOME', prev.WHALE_HOME)
    restore('DSH_HOME', prev.DSH_HOME); restore('USERPROFILE', prev.USERPROFILE)
    fs.rmSync(whale, { recursive: true, force: true })
    fs.rmSync(home, { recursive: true, force: true })
  }
})
