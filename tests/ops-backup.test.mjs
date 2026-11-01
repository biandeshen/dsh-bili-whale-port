// ops-backup（缺口清单 #43）：人生档案从未进任何版本控制，手工 bundle 停在 10-31。
// 这个测试在临时目录造一份完整运行态（fields/causal/days/日记/草稿/配置/人设 + 凭据诱饵），
// 断言：①白名单源真进包、凭据与 pid/log 绝不进包；②--restore 默认 dry 一个字都不写；
// ③--apply 前当前状态被另存（原件可退）。spawn 真子进程，不是函数级假动作。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(ROOT, 'scripts', 'ops-backup.mjs')

function setup(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-backup-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const whale = path.join(home, 'whale')
  const bili = path.join(whale, 'bili-whale')
  const broot = path.join(home, 'broot')
  const drafts = path.join(home, 'drafts')
  const cortico = path.join(home, 'cortico')
  fs.mkdirSync(path.join(bili, 'days', '2026-11-01'), { recursive: true })
  fs.mkdirSync(path.join(bili, 'control'), { recursive: true })
  fs.mkdirSync(path.join(bili, 'feed'), { recursive: true })
  fs.mkdirSync(path.join(home, '.bili-ai'), { recursive: true })
  fs.mkdirSync(drafts, { recursive: true })
  fs.mkdirSync(path.join(cortico, 'deployments', 'mybot', 'prompts'), { recursive: true })
  fs.mkdirSync(path.join(cortico, 'deployments', 'mybot', 'workspace'), { recursive: true })
  const w = (p, s) => fs.writeFileSync(p, s)
  w(path.join(bili, 'fields.json'), JSON.stringify({ fields: { energy: 0.4 } }))
  w(path.join(bili, 'causal.jsonl'), '{"a":1}\n{"a":2}\n')
  w(path.join(bili, 'days', '2026-11-01', 'tick.jsonl'), '{"tick":1}\n')
  w(path.join(bili, 'days', '2026-11-01', 'summary.json'), '{"ok":true}')
  w(path.join(bili, 'control', 'feedback.jsonl'), '{"id":"f-test"}\n')
  w(path.join(bili, 'control', 'day-watchdog.pid'), '12345')
  w(path.join(bili, 'control', 'day-watchdog.log'), 'runtime junk')
  w(path.join(whale, 'whale-diary.md'), '# 公开日记\n')
  w(path.join(whale, 'whale-diary-private.md'), '# 私人日记\n')
  w(path.join(whale, 'whale-log.jsonl'), '{"kind":"watch"}\n')
  w(path.join(whale, 'bili-whale.config.json'), '{"preferences":{"like":["雨声"]}}')
  w(path.join(home, '.bili-ai', 'persona.md'), '# 人设镜像\n')
  w(path.join(home, '.bili-ai', 'credentials.json'), '{"sessdata":"SECRET-DO-NOT-BACKUP"}')
  w(path.join(home, '.bili-ai', 'github-token.json'), '{"token":"ghp_SECRET"}')
  w(path.join(drafts, 'dyn-20261101.json'), '{"status":"sent"}')
  w(path.join(cortico, 'deployments', 'mybot', 'prompts', 'ORIENTATION.md'), '# 本轮\n')
  w(path.join(cortico, 'deployments', 'mybot', 'workspace', 'CONSTITUTION.md'), '# 她是谁\n')
  const run = (args = []) => spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, USERPROFILE: home, HOME: home, WHALE_HOME: whale, WHALE_BACKUP_DIR: broot, WHALE_DRAFTS: drafts, CORTICO_ROOT: cortico, DSH_HOME: undefined },
  })
  const bundles = () => fs.existsSync(broot) ? fs.readdirSync(broot).filter((d) => d.startsWith('backup-')) : []
  const manifest = () => JSON.parse(fs.readFileSync(path.join(broot, bundles()[0], 'MANIFEST.json'), 'utf8'))
  return { home, whale, bili, broot, run, bundles, manifest }
}

test('备份打包人生档案：凭据与运行时垃圾一个字节都不进包', (t) => {
  const s = setup(t)
  const r = s.run()
  assert.equal(r.status, 0, r.stderr)
  assert.equal(s.bundles().length, 1, r.stdout)
  const m = s.manifest()
  const rels = m.files.map((f) => f.rel)
  for (const want of [
    'whale/bili-whale/fields.json', 'whale/bili-whale/causal.jsonl',
    'whale/bili-whale/days/2026-11-01/tick.jsonl',
    'whale/whale-diary.md', 'whale/whale-diary-private.md',
    'whale/bili-whale.config.json', 'bili-ai/persona.md',
    'drafts/dyn-20261101.json',
    'cortico/deployments/mybot/prompts/ORIENTATION.md',
    'cortico/deployments/mybot/workspace/CONSTITUTION.md',
    'whale/bili-whale/control/feedback.jsonl',
  ]) assert.ok(rels.includes(want), `没打包 ${want}`)
  assert.ok(!rels.some((x) => /credentials|github-token|token|secret/i.test(x)), '凭据混进了备份包')
  assert.ok(!rels.includes('whale/bili-whale/control/day-watchdog.pid'), 'pid 不是档案')
  assert.ok(!rels.includes('whale/bili-whale/control/day-watchdog.log'), 'log 不是档案')
  // 包内字节与源一致（真复制，不是空清单）
  const fields = m.files.find((f) => f.rel === 'whale/bili-whale/fields.json')
  const inBundle = fs.readFileSync(path.join(s.broot, s.bundles()[0], 'files', ...fields.rel.split('/')), 'utf8')
  assert.equal(inBundle, fs.readFileSync(path.join(s.bili, 'fields.json'), 'utf8'))
  // 清单写明排除项与恢复步骤；缺的源如实记 missing
  assert.ok(m.excluded.some((x) => x.includes('credentials.json')))
  assert.ok(m.restoreSteps.some((x) => x.includes('--restore')))
  assert.ok(Array.isArray(m.missing), 'missing 必须是清单字段（缺的源如实记录）')
  assert.equal(m.fileCount, m.files.length)
})

test('--restore 默认 dry：报告覆盖/新建清单，不写一个字', (t) => {
  const s = setup(t)
  assert.equal(s.run().status, 0)
  fs.writeFileSync(path.join(s.bili, 'fields.json'), 'MUTATED-AFTER-BACKUP')
  fs.rmSync(path.join(s.bili, 'days', '2026-11-01', 'tick.jsonl'))
  const r = s.run(['--restore', path.join(s.broot, s.bundles()[0])])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /覆盖\s+.*fields\.json/)
  assert.match(r.stdout, /新建\s+.*tick\.jsonl/)
  assert.match(r.stdout, /dry-run/)
  assert.equal(fs.readFileSync(path.join(s.bili, 'fields.json'), 'utf8'), 'MUTATED-AFTER-BACKUP', 'dry-run 写了盘')
  assert.ok(!fs.existsSync(path.join(s.bili, 'days', '2026-11-01', 'tick.jsonl')), 'dry-run 把删掉的文件补回来了')
  assert.ok(!fs.readdirSync(s.broot).some((d) => d.startsWith('pre-restore')), 'dry-run 不该建任何目录')
})

test('--apply：先另存当前状态再写，原件退得回去', (t) => {
  const s = setup(t)
  assert.equal(s.run().status, 0)
  fs.writeFileSync(path.join(s.bili, 'fields.json'), 'MUTATED-AFTER-BACKUP')
  const r = s.run(['--restore', path.join(s.broot, s.bundles()[0]), '--apply'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /恢复完成/)
  assert.equal(fs.readFileSync(path.join(s.bili, 'fields.json'), 'utf8'), JSON.stringify({ fields: { energy: 0.4 } }), '备份没写回目标')
  const pre = fs.readdirSync(s.broot).find((d) => d.startsWith('pre-restore'))
  assert.ok(pre, '真写前没有另存当前状态')
  assert.equal(fs.readFileSync(path.join(s.broot, pre, 'files', 'whale', 'bili-whale', 'fields.json'), 'utf8'), 'MUTATED-AFTER-BACKUP', '另存的不是当前原件')
  assert.ok(fs.existsSync(path.join(s.broot, pre, 'MANIFEST.json')))
})
