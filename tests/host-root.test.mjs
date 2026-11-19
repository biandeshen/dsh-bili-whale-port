// host-root：「宿主在哪 / 回滚点在哪」的解析契约。
// 这不是测"函数能不能跑"，是测**拿不到配置时会不会安静猜一个路径**——
// 本仓那 7 个脚本的故障形态就是硬默认活着、报告看起来正常。
// 做法：把 lib 文件复制进一个临时仓骨架（temp/scripts/lib/），让它的 REPO 指向临时仓，
// 于是「有没有 .env」这件事可以被真的构造出来，而不是靠改本机配置。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LIB = path.join(REPO, 'scripts', 'lib', 'host-root.mjs')

function fixture({ envFile = null, hostDir = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'host-root-'))
  const libDir = path.join(root, 'scripts', 'lib')
  fs.mkdirSync(libDir, { recursive: true })
  fs.copyFileSync(LIB, path.join(libDir, 'host-root.mjs'))
  if (envFile !== null) fs.writeFileSync(path.join(root, '.env'), envFile)
  if (hostDir) fs.mkdirSync(hostDir, { recursive: true })
  return { root, lib: path.join(libDir, 'host-root.mjs') }
}

/** 在子进程里调一个导出函数，把结果或错误原样带回来（不污染本进程的环境）。 */
function call(fx, expr, env = {}) {
  const code = `const m = await import(${JSON.stringify('file:///' + fx.lib.replace(/\\/g, '/'))});\n`
    + `try { console.log('OK ' + JSON.stringify(${expr})) } catch (e) { console.log('ERR ' + (e?.message ?? e)) }\n`
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, CORTICO_ROOT: undefined, XIAOYU_ROLLBACK_ROOT: undefined, ...env },
  })
  const out = `${r.stdout ?? ''}`.trim()
  return { code: r.status, ok: out.startsWith('OK '), text: out.slice(3), stderr: r.stderr ?? '' }
}

test('缺 CORTICO_ROOT 且没有 .env：明确报错并提示该设什么，不猜路径', () => {
  const fx = fixture()
  const r = call(fx, 'm.hostRoot()')
  assert.equal(r.ok, false, r.text + r.stderr)
  assert.match(r.text, /缺 CORTICO_ROOT/)
  assert.match(r.text, /\.env/)
  assert.match(r.text, /Cortico-up/)
})

test('.env 里的 CORTICO_ROOT 生效（本机落盘答案）', () => {
  const host = path.join(os.tmpdir(), 'host-root-live-' + Date.now())
  const fx = fixture({ envFile: `# 注释\nCORTICO_ROOT=${host.replace(/\\/g, '/')}\n`, hostDir: host })
  const r = call(fx, 'm.hostRoot()')
  assert.equal(r.ok, true, r.text + r.stderr)
  assert.equal(fs.realpathSync(JSON.parse(r.text)), fs.realpathSync(host))
  fs.rmSync(host, { recursive: true, force: true })
})

test('进程环境优先于 .env', () => {
  const a = path.join(os.tmpdir(), 'host-root-a-' + Date.now())
  const b = path.join(os.tmpdir(), 'host-root-b-' + Date.now())
  const fx = fixture({ envFile: `CORTICO_ROOT=${a.replace(/\\/g, '/')}\n`, hostDir: a })
  fs.mkdirSync(b, { recursive: true })
  const r = call(fx, 'm.hostRoot()', { CORTICO_ROOT: b })
  assert.equal(r.ok, true, r.text + r.stderr)
  assert.equal(fs.realpathSync(JSON.parse(r.text)), fs.realpathSync(b))
  fs.rmSync(a, { recursive: true, force: true })
  fs.rmSync(b, { recursive: true, force: true })
})

test('CORTICO_ROOT 指向不存在的目录：报错说"目录不存在"，不是 ERR_MODULE_NOT_FOUND', () => {
  const fx = fixture()
  const missing = path.join(os.tmpdir(), 'host-root-nope-' + Date.now())
  const r = call(fx, 'm.hostRoot()', { CORTICO_ROOT: missing })
  assert.equal(r.ok, false, r.text)
  assert.match(r.text, /指向的目录不存在/)
})

test('hostImport 先确认文件真在这棵检出里：缺文件时报"宿主检出里没有"', () => {
  const host = path.join(os.tmpdir(), 'host-root-imp-' + Date.now())
  const fx = fixture({ hostDir: host })
  const r = call(fx, `m.hostImport('persona-core/src/rhythm.ts')`, { CORTICO_ROOT: host })
  assert.equal(r.ok, false, r.text)
  assert.match(r.text, /宿主检出/)
  assert.match(r.text, /persona-core\/src\/rhythm\.ts/)
  fs.rmSync(host, { recursive: true, force: true })
})

test('hostImport 文件在场：给出可 import 的 file:// 地址', () => {
  const host = path.join(os.tmpdir(), 'host-root-imp2-' + Date.now())
  const fx = fixture({ hostDir: host })
  fs.mkdirSync(path.join(host, 'persona-core', 'src'), { recursive: true })
  fs.writeFileSync(path.join(host, 'persona-core', 'src', 'rhythm.ts'), 'export const x = 1\n')
  const r = call(fx, `m.hostImport('persona-core/src/rhythm.ts')`, { CORTICO_ROOT: host })
  assert.equal(r.ok, true, r.text + r.stderr)
  const url = JSON.parse(r.text)
  assert.match(url, /^file:\/\/\//)
  assert.ok(fs.existsSync(fileURLToPath(url)))
  fs.rmSync(host, { recursive: true, force: true })
})

test('rollbackRoot 缺省 ~/.xiaoyu-home/rollback/deployments，可被 XIAOYU_ROLLBACK_ROOT 覆盖', () => {
  const fx = fixture()
  const d = call(fx, 'm.rollbackRoot()')
  assert.equal(d.ok, true, d.text + d.stderr)
  assert.equal(JSON.parse(d.text), path.join(os.homedir(), '.xiaoyu-home', 'rollback', 'deployments'))
  const over = path.join(os.tmpdir(), 'host-root-rb-' + Date.now())
  const o = call(fx, 'm.rollbackRoot()', { XIAOYU_ROLLBACK_ROOT: over })
  assert.equal(o.ok, true, o.text)
  assert.equal(JSON.parse(o.text), path.resolve(over))
})

test('路径里有空格/中文/~ 也读得到 .env（percent-encode 回归）', () => {
  // 本机 os.tmpdir() 是 8.3 短名 ADMINI~1，new URL(...).pathname 会把它变成 ADMINI%7E1，
  // 算出来的 REPO 不存在 → .env 明明在也报"缺 CORTICO_ROOT"。换台机器 tmpdir 没 ~ 就测不出来，
  // 所以这里显式造一个带空格+中文+~ 的仓根。
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'host-root-'))
  const root = path.join(base, '仓 根~测试')
  const libDir = path.join(root, 'scripts', 'lib')
  fs.mkdirSync(libDir, { recursive: true })
  fs.copyFileSync(LIB, path.join(libDir, 'host-root.mjs'))
  const host = path.join(base, '宿主 检出~')
  fs.mkdirSync(host, { recursive: true })
  fs.writeFileSync(path.join(root, '.env'), 'CORTICO_ROOT=' + host.replace(/\\/g, '/') + '\n')
  const r = call({ root, lib: path.join(libDir, 'host-root.mjs') }, 'm.hostRoot()')
  assert.equal(r.ok, true, r.text + r.stderr)
  assert.equal(fs.realpathSync(JSON.parse(r.text)), fs.realpathSync(host))
  fs.rmSync(base, { recursive: true, force: true })
})

test('真仓当前配置解析得出来，且指向的检出是真宿主（唯一一份 persona-core 在本仓）', () => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e',
    `const m = await import(${JSON.stringify('file:///' + LIB.replace(/\\/g, '/'))});console.log(m.hostRoot())`],
    { encoding: 'utf8', timeout: 30000 })
  assert.equal(r.status, 0, r.stderr)
  const host = r.stdout.trim()
  // 用宿主自己一定有的入口当锚，而不是 persona-core——那份 2026-11-19 已删（#88），
  // 唯一一份在 packages/persona-core。拿已删的东西当"宿主是真的"的凭据，
  // 就会把"代码搬走了"误报成"宿主指错了"。
  assert.ok(fs.existsSync(path.join(host, 'src', 'core', 'loop.ts')), `${host} 不像是宿主检出（缺 src/core/loop.ts）`)
  assert.equal(fs.existsSync(path.join(host, 'persona-core')), false,
    `${host} 里又出现了一份 persona-core —— 第二份真相，见 docs/evidence/host-persona-core-disposition.md`)
})