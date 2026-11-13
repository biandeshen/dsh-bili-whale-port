/**
 * 只读探针：把宿主那 9 份内核测试指向**本仓真内核**跑一遍，量出两份 persona-core 的行为差。
 *
 * 为什么需要它：宿主 `persona-core/` 是本仓 `packages/persona-core/` 的一份旧副本，
 * 宿主门禁里 9 个测试文件 / 90 个用例跑的是**那份旧副本**（`../src/*.ts`），
 * 而她真正在跑的是本仓这份（51 处相对路径 import）。不量就不知道差在哪。
 *
 * 只写临时目录，两个仓都不动，零模型调用。
 *
 * 用法：
 *   node --import tsx docs/evidence/probes/kernel-fork-probe.mjs
 *   CORTICO_ROOT=<宿主检出> 可覆盖宿主根（与 scripts/lib/host-root.mjs 同一口径）
 *
 * 三处工具坑（v1 曾因此报 0/9，那是工具坏了不是断言失败，别把那种读数当结论）：
 *  1. Windows 下 ESM 绝对路径必须是 file:// URL（pathToFileURL）；直接拼 'E:/...' → ERR_UNSUPPORTED_ESM_URL_SCHEME
 *  2. voice-brief.test.mjs:69 用 import.meta.url 读 ../../tests/fixtures/*.json，搬到临时目录后必须改写
 *  3. adapter.test.mjs 经 legacy/bili-account-retired/personaAdapter.ts 用**包名** @xiaoyu/persona-core/* 引内核，
 *     宿主 node_modules 里那个符号链接指向宿主自己那份；只改测试文件的 import 不够，
 *     得把 adapter 也复制到临时目录并改写它的包名 import（11 处）。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { hostRoot } from '../../../scripts/lib/host-root.mjs'

const HOST = hostRoot().replace(/\\/g, '/')
const WHALE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..').replace(/\\/g, '/')
const SRC = path.join(HOST, 'persona-core', 'tests')
const WHALE_SRC_URL = pathToFileURL(path.join(WHALE, 'packages', 'persona-core', 'src')).href + '/'
const FIXTURE_URL = pathToFileURL(path.join(HOST, 'tests', 'fixtures')).href + '/'
const ADAPTER_SRC = path.join(HOST, 'legacy', 'bili-account-retired', 'personaAdapter.ts')

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kernel-probe-'))
const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.test.mjs'))

let adapterUrl = null
if (fs.existsSync(ADAPTER_SRC)) {
  let a = fs.readFileSync(ADAPTER_SRC, 'utf8')
  const before = (a.match(/@xiaoyu\/persona-core\//g) || []).length
  a = a.replace(/@xiaoyu\/persona-core\/([A-Za-z0-9_-]+)/g, (_m, name) => `${WHALE_SRC_URL}${name}.ts`)
  fs.writeFileSync(path.join(out, 'personaAdapter.probe.ts'), a)
  adapterUrl = pathToFileURL(path.join(out, 'personaAdapter.probe.ts')).href
  console.log('退役适配器改写包名 import 数=' + before)
}

for (const f of files) {
  let t = fs.readFileSync(path.join(SRC, f), 'utf8')
  t = t.replaceAll("'../src/", `'${WHALE_SRC_URL}`)
  t = t.replaceAll("'../../tests/fixtures/", `'${FIXTURE_URL}`)
  if (adapterUrl) t = t.replaceAll("'../../legacy/bili-account-retired/personaAdapter.ts'", `'${adapterUrl}'`)
  fs.writeFileSync(path.join(out, f), t)
}
console.log('宿主=' + HOST)
console.log('本仓=' + WHALE)
console.log('探针目录=' + out)
console.log('改写测试文件数=' + files.length)

function run(label, argv, logName) {
  const r = spawnSync(process.execPath, argv, { cwd: HOST, encoding: 'utf8', env: { ...process.env }, timeout: 300000 })
  const text = (r.stdout || '') + (r.stderr || '')
  fs.writeFileSync(path.join(out, logName), text)
  console.log(`\n=== ${label} ===`)
  console.log('exit=' + r.status)
  for (const line of text.split('\n')) {
    if (/^# (tests|suites|pass|fail|skipped|todo|cancelled|duration)/.test(line)) console.log(line)
  }
  const bad = text.split('\n').filter((l) => /^\s*not ok/.test(l))
  console.log('not ok 行数=' + bad.length)
  if (bad.length) console.log(bad.slice(0, 60).join('\n'))
  // 工具性错误必须显式报出来：出现任一，这一轮读数作废，不许当成断言失败
  const scheme = (text.match(/ERR_UNSUPPORTED_ESM_URL_SCHEME/g) || []).length
  const notFound = (text.match(/ERR_MODULE_NOT_FOUND/g) || []).length
  console.log(`工具性错误：URL_SCHEME=${scheme} MODULE_NOT_FOUND=${notFound}`)
  if (scheme || notFound) console.log('!! 本轮读数无效（探针自身坏了），先修工具再下结论')
  console.log('原始 TAP=' + path.join(out, logName))
  return { status: r.status, bad }
}

const base = run('基线：宿主原样跑（指向宿主自己那份旧副本）',
  ['--import', 'tsx', '--test', '--test-reporter=tap', ...files.map((f) => path.join(SRC, f))], 'raw-tap-baseline.txt')
const probe = run('探针：同样 9 份测试指向本仓真内核',
  ['--import', 'tsx', '--test', '--test-reporter=tap', ...files.map((f) => path.join(out, f))], 'raw-tap-probe.txt')

console.log('\n=== 差值 ===')
console.log('基线 exit=' + base.status + ' / 探针 exit=' + probe.status)
console.log('基线 not ok=' + base.bad.length + ' / 探针 not ok=' + probe.bad.length)