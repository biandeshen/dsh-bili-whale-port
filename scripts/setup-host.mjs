/**
 * 底座（别人那个项目）的克隆、更新与扩展挂载。
 *
 *   node scripts/setup-host.mjs                 # 没有就克隆最新；有就报当前版本，不动它
 *   node scripts/setup-host.mjs --tag v0.2.17   # 克隆/切到指定 tag（稳定版）
 *   node scripts/setup-host.mjs --pull          # 已有克隆 → git pull --ff-only 拉最新
 *   node scripts/setup-host.mjs --link          # 把本仓四个扩展挂上去（建 extensions/ + pnpm install）
 *
 * 为什么是独立克隆、不是 subtree：
 * 底座是**别人的**项目，我们一行都不改。只有它是独立 git 仓，`git pull` 才是拉最新代码，
 * 冲突才只可能出在我们自己新增的扩展目录上。用 subtree 并进本仓，等于把人家 1193 个文件
 * 抄进我们的提交历史，既不是我们写的，也没法"商量着不更新"。
 *
 * 目录：`host/cortico`（`.gitignore` 里排除整棵 `host/`）。
 * 位置只认 `<仓根>/host/<名字>`，名字由 HOST_DIR 覆盖（默认 cortico）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const URL = process.env.HOST_GIT_URL || 'https://github.com/Pal-AI-Lab/Cortico.git'
const DIR = path.join(REPO, 'host', process.env.HOST_DIR || 'cortico')
const argv = process.argv.slice(2)
const flag = (n) => argv.includes(n)
const valueOf = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined }

const EXTENSIONS = [
  'cortico-bot-xiaoyu',
  'cortico-world-bilibili',
  'cortico-world-media',
  'cortico-world-console-image',
]

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: DIR, encoding: 'utf8', stdio: opts.stdio ?? 'pipe', ...opts }).trim()
}

function run(cmd, args, cwd) {
  console.log(`$ ${cmd} ${args.join(' ')}`)
  // Windows 上 pnpm / git 是 .cmd 包装，execFileSync 不经 shell 会 ENOENT。
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
}

function has(rel) { return fs.existsSync(path.join(DIR, rel)) }

function describe() {
  const tag = git(['describe', '--tags', '--always'])
  const head = git(['rev-parse', '--short', 'HEAD'])
  const date = git(['log', '-1', '--format=%ci'])
  console.log(`底座：${DIR}`)
  console.log(`  版本  ${tag}  (${head}, ${date})`)
  console.log(`  来源  ${git(['config', '--get', 'remote.origin.url'])}`)
}

function clone(tag) {
  fs.mkdirSync(path.dirname(DIR), { recursive: true })
  console.log(`克隆 ${URL} → ${DIR}${tag ? `（tag ${tag}）` : ''}`)
  run('git', ['clone', ...(tag ? ['--branch', tag, '--depth', '1'] : []), URL, DIR], REPO)
  describe()
  console.log('\n下一步：node scripts/setup-host.mjs --link')
}

function pull() {
  describe()
  const dirty = git(['status', '--porcelain'])
  if (dirty) {
    console.error('\n底座里有未提交的改动，先自己处理（我们本来不该改它）：\n' + dirty)
    process.exit(1)
  }
  run('git', ['pull', '--ff-only'], DIR)
  describe()
  console.log('\n底座代码换了 → 跑 node scripts/build-webui.mjs 重建扩展面板，再重启实例。')
}

function link() {
  if (!has('package.json')) {
    console.error(`底座不在 ${DIR}，先跑 node scripts/setup-host.mjs`)
    process.exit(2)
  }
  const ext = path.join(DIR, 'extensions')
  fs.mkdirSync(ext, { recursive: true })
  // 相对路径从 extensions/ 出发：extensions → host/cortico → host → 仓根 → packages/adapters/<n>
  const rel = (n) => `link:${path.relative(ext, path.join(REPO, 'packages', 'adapters', n)).replace(/\\/g, '/')}`
  const pkg = {
    name: 'cortico-extensions',
    private: true,
    packageManager: 'pnpm@11.28.6',
    dependencies: Object.fromEntries(EXTENSIONS.map((n) => [n, rel(n)])),
  }
  const file = path.join(ext, 'package.json')
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  console.log(`写入 ${path.relative(REPO, file)}：`)
  for (const [n, v] of Object.entries(pkg.dependencies)) console.log(`  ${n}  ${v}`)
  if (!has('extensions/pnpm-workspace.yaml')) {
    fs.writeFileSync(path.join(ext, 'pnpm-workspace.yaml'), '', 'utf8')
  }
  run('pnpm', ['install'], ext)
  console.log('\n扩展已挂上。启动：node scripts/start-cortico.mjs')
}

const tag = valueOf('--tag')
if (flag('--link')) link()
else if (!fs.existsSync(DIR)) clone(tag)
else if (flag('--pull')) pull()
else {
  describe()
  console.log('\n未改动。--pull 拉最新；--link 重挂扩展；--tag <v> 需先删掉现有克隆。')
}
