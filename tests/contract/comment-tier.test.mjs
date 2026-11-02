/**
 * 评论与弹幕的档位（2026-11-03）。
 *
 * 起点：主人骂"这些很明显是配置参数，就不能把配置放那儿吗？我逼面上不能改吗"。
 * 查出来的实情：草稿/点赞/收藏/回信四个档位早就在策略页能改，但**评论与弹幕没有档位**——
 * 行为写死在各命令里（评论无条件进待审队列、弹幕无条件进队列），主人想调都调不了。
 * 现在补成同一节配置；默认值保持原行为（review = 等主人放行）。
 *
 * 这里跑的是真命令（起子进程），不联网：凭据检查在队列分支之后，所以 review 档能离线验证；
 * self 档会走到凭据检查并以 3 退出——那正是"没有进队列"的证据。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function homeWith(tier) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-tier-'))
  fs.mkdirSync(path.join(home, 'bili-ai'), { recursive: true })
  fs.mkdirSync(path.join(home, 'bili-whale', 'control'), { recursive: true })
  fs.writeFileSync(path.join(home, 'bili-whale.config.json'), JSON.stringify({
    owner: { displayName: '主人', mid: '1' },
    self: { mid: '2', name: '小鱼' },
    permissions: { comment: tier },
  }, null, 2), 'utf8')
  return home
}

const pendingFile = (home) => path.join(home, 'bili-ai', 'pending-replies.json')
const runComment = (home) => spawnSync(process.execPath, [
  path.join(ROOT, 'tools', 'bili.mjs'), 'comment', '--oid', '12345', '--bvid', 'BV1testBV001',
  '--message', '测试一条', '--go',
], { encoding: 'utf8', env: { ...process.env, WHALE_HOME: home, USERPROFILE: home, HOME: home }, timeout: 60000 })

test('档位 review（默认）：评论进待审队列，等主人放行', () => {
  const home = homeWith('review')
  const r = runComment(home)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /已进待审队列/, r.stdout)
  const items = JSON.parse(fs.readFileSync(pendingFile(home), 'utf8')).items
  assert.equal(items.length, 1)
  assert.equal(items[0].kind, '评论')
})

test('档位 self：评论不进队列（主人把这一项收放成她自己发）', () => {
  const home = homeWith('self')
  const r = runComment(home)
  // 没有凭据 → 走到凭据检查退出 3；关键是没有留下待审条目
  assert.equal(r.status, 3, r.stdout + r.stderr)
  assert.equal(fs.existsSync(pendingFile(home)), false, 'self 档不该进待审队列')
})

test('配置没写这一项时按默认走（review），不因为缺字段就放开', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'comment-tier-default-'))
  fs.mkdirSync(path.join(home, 'bili-ai'), { recursive: true })
  fs.writeFileSync(path.join(home, 'bili-whale.config.json'), JSON.stringify({
    owner: { displayName: '主人', mid: '1' }, self: { mid: '2' },
  }), 'utf8')
  const r = runComment(home)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const items = JSON.parse(fs.readFileSync(pendingFile(home), 'utf8')).items
  assert.equal(items.length, 1, '缺这一项 = 等主人放行，与今天行为一致')
})
