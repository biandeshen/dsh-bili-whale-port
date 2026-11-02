// #49 配置总览开写：主人要求"所有配置都可以见到，而不是直接去改配置文件"。
// 可见不等于随便写 —— 这里锁的是三条：路径类与策略六项不在这里改、非法值拒并说清哪里坏、
// 改动原子落盘且保留其它键（以及测试上下文绝不碰正式配置）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { settingsSet, settingsOverview, policySet } from '../src/worlds/bili-account/tank.ts'

const tmp = (obj) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'settings-write-'))
  const file = path.join(dir, 'bili-whale.config.json')
  fs.writeFileSync(file, JSON.stringify(obj, null, 2))
  return { dir, file, read: () => JSON.parse(fs.readFileSync(file, 'utf8')) }
}

const BASE = {
  owner: { displayName: '主人', mid: 123456 },
  self: { name: '小鱼' },
  listen: { enabled: true, intervalMinutes: 20 },
  share: { via: 'dynamic', maxPerDay: 1 },
  publish: { draftMode: 'review', autoDailyCap: 0, autoWindow: '' },
  permissions: { like: 'self', fav: 'review', dmReply: 'direct' },
  home: 'C:/Users/x/.dsh',
  preferences: { like: ['猫', '鬼畜'] },
}

test('标量能改、其它键原样保留、回执说清要不要重启', () => {
  const h = tmp({ ...BASE })
  const r = settingsSet({ 'listen.intervalMinutes': 35, 'share.via': 'dynamic' }, h.file)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.deepEqual(r.changed.map((c) => c.key), ['listen.intervalMinutes'])
  assert.equal(r.changed[0].from, 20)
  assert.equal(r.changed[0].to, 35)
  assert.equal(r.changed[0].needsRestart, false)
  const cfg = h.read()
  assert.equal(cfg.listen.intervalMinutes, 35)
  assert.equal(cfg.owner.displayName, '主人', '没点名的键一个都不动')
  assert.equal(cfg.permissions.fav, 'review')
})

test('路径与策略类不在这里改（各有更严的入口）', () => {
  const h = tmp({ ...BASE })
  const a = settingsSet({ 'publish.draftMode': 'auto' }, h.file)
  assert.equal(a.ok, false)
  assert.match(a.error, /发送策略/)
  const b = settingsSet({ home: 'D:/别的家' }, h.file)
  assert.equal(b.ok, false)
  assert.match(b.error, /路径/)
  assert.equal(h.read().publish.draftMode, 'review', '被拒时一个字都不该写')
  assert.equal(h.read().home, BASE.home)
})

test('非法值拒，并把"要什么"说清楚', () => {
  const h = tmp({ ...BASE })
  const cases = [
    [{ 'listen.intervalMinutes': '二十分钟' }, /要的是数字/],
    [{ 'listen.maxPerDay': -3 }, /0 或更大的整数/],
    // 2026-11-01 真机点出来的洞：listen.commentIntervalSec=-5 当时被写进了正式配置，
    // 因为命名表只列了 Seconds/Ms，没列 Sec/Interval/Gap。
    [{ 'listen.commentIntervalSec': -5 }, /0 或更大的整数/],
    [{ 'listen.dmIntervalSec': -1 }, /0 或更大的整数/],
    [{ 'risk.minGapMs': -1 }, /0 或更大的整数/],
    [{ 'self.name': '' }, /不能是空的/],
    [{ 'self.name': '名字'.repeat(30) }, /最长 24 字/],
    [{ 'owner.displayName': 'x'.repeat(60) }, /最长 24 字/],
  ]
  for (const [patch, re] of cases) {
    const r = settingsSet(patch, h.file)
    assert.equal(r.ok, false, JSON.stringify(r) + ' 应该被拒')
    assert.match(r.error, re, `${JSON.stringify(patch)} 的错误语不对：${r.error}`)
  }
})

test('开关与名单按类型收：字符串 true/false、顿号逗号都能变回正确的形状', () => {
  const h = tmp({ ...BASE })
  assert.equal(settingsSet({ 'listen.enabled': 'false' }, h.file).ok, true)
  assert.equal(h.read().listen.enabled, false)
  assert.equal(settingsSet({ 'listen.enabled': 'on' }, h.file).ok, true)
  assert.equal(h.read().listen.enabled, true)
  assert.equal(settingsSet({ 'preferences.like': '猫、雨声, 鬼畜' }, h.file).ok, true)
  assert.deepEqual(h.read().preferences.like, ['猫', '雨声', '鬼畜'])
})

test('填的就是现值：不算改动，不写盘也不谎称"已保存"', () => {
  const h = tmp({ ...BASE })
  const before = fs.readFileSync(h.file, 'utf8')
  const r = settingsSet({ 'self.name': '小鱼' }, h.file)
  assert.equal(r.ok, true)
  assert.deepEqual(r.changed, [])
  assert.equal(fs.readFileSync(h.file, 'utf8'), before)
})

test('一次最多 12 项：批量改要看得出错在哪一项', () => {
  const h = tmp({ ...BASE })
  const many = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`misc.k${i}`, i]))
  const r = settingsSet(many, h.file)
  assert.equal(r.ok, false)
  assert.match(r.error, /最多改 12 项/)
})

test('总览把"在哪儿改"标对：一格一改 / 上方策略控件 / 只能改文件', () => {
  const s = settingsOverview({ ...BASE }, {})
  const find = (k) => s.groups.flatMap((g) => g.items).find((i) => i.key === k)
  assert.equal(find('listen.intervalMinutes').editVia, 'settings')
  assert.equal(find('preferences.like').editVia, 'settings')
  assert.equal(find('publish.draftMode').editVia, 'policy', '策略六项仍算页面可改，但走上面那组带护栏的控件')
  assert.equal(find('publish.draftMode').editable, true)
  assert.equal(find('home').editVia, null)
  assert.equal(find('home').editable, false)
  assert.equal(find('self.name').needsRestart, true)
  assert.equal(find('listen.intervalMinutes').needsRestart, false)
})

test('评论与弹幕的档位也能在策略页改（2026-11-03：它们原先写死在 dsh 各命令里，页面调不了）', () => {
  const h = tmp({ ...BASE })
  const r = policySet({ permissions: { comment: 'self', danmaku: 'self' } }, h.file)
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.policy.comment, 'self')
  assert.equal(r.policy.danmaku, 'self')
  const cfg = h.read()
  assert.equal(cfg.permissions.comment, 'self')
  assert.equal(cfg.permissions.danmaku, 'self')
  // 非法值收敛成默认（review = 等主人放行），不许靠写坏值把她放开
  const bad = policySet({ permissions: { comment: 'yolo', danmaku: 'true' } }, h.file)
  assert.equal(bad.policy.comment, 'review')
  assert.equal(bad.policy.danmaku, 'review')
  // 总览里这两项标成"策略控件可改"，不是只能改文件
  // （总览遍历的是配置文件里实际存在的键：第一次保存前这两个键不在文件里，保存后才出现）
  const withSaved = { ...BASE, permissions: { ...BASE.permissions, comment: 'self', danmaku: 'self' } }
  const s = settingsOverview(withSaved, {})
  const find = (k) => s.groups.flatMap((g) => g.items).find((i) => i.key === k)
  assert.equal(find('permissions.comment').editVia, 'policy')
  assert.equal(find('permissions.danmaku').editVia, 'policy')
})

test('测试上下文不许落到正式配置文件（2026-11-01 01:23 那次盲写的教训）', () => {
  process.env.NODE_TEST_CONTEXT = '1'
  const r = settingsSet({ 'self.name': '不许写正式配置' })
  assert.equal(r.ok, false)
  assert.match(r.error, /临时路径/)
})
