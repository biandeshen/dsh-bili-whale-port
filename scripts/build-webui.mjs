/**
 * 构建各能力包的浏览器端面板产物（dist/webui.js）。
 *
 *   node scripts/build-webui.mjs                # 构建全部带 src/webui/client.ts 的包
 *   node scripts/build-webui.mjs <包名>          # 只构建某几个
 *
 * 产物必须是单文件 ESM：Cortico 扩展只声明一个 cortico.webUiClient 路径（dist/webui.js），
 * 浏览器端 import 不了包里的其它文件（也不会有 Node 模块可用）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES_DIR = path.join(ROOT, 'packages')

/**
 * 优先用 Cortico 检出里的 esbuild（走 JS API，不依赖 .CMD 可执行文件——
 * Windows 上 .bin/esbuild 是 shell 脚本，execFileSync 会 ENOENT）。
 */
async function loadEsbuild() {
  const candidates = [
    path.join(ROOT, '..', 'Cortico-up', 'node_modules', 'esbuild', 'lib', 'main.js'),
    path.join(ROOT, 'node_modules', 'esbuild', 'lib', 'main.js'),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      const mod = await import(pathToFileURL(c).href)
      return mod.default ?? mod
    }
  }
  throw new Error('找不到 esbuild（试过 Cortico-up/node_modules/esbuild 与本仓 node_modules/esbuild）')
}

function targets() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  const names = fs
    .readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
  const picked = only.length ? names.filter((n) => only.includes(n)) : names
  return picked.filter((n) => fs.existsSync(path.join(PACKAGES_DIR, n, 'src', 'webui', 'client.ts')))
}

const esbuild = await loadEsbuild()
const built = []

for (const name of targets()) {
  const pkgDir = path.join(PACKAGES_DIR, name)
  const entry = path.join(pkgDir, 'src', 'webui', 'client.ts')
  const outfile = path.join(pkgDir, 'dist', 'webui.js')
  fs.mkdirSync(path.dirname(outfile), { recursive: true })

  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
  })

  // 只给扩展包（声明了 cortico.kind 的）补 webUiClient：能力包不是扩展包，
  // 它们的面板由所属扩展包合并后统一声明（一个扩展包只能有一个 webUiClient）。
  const pkgFile = path.join(pkgDir, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
  const isExtension = Boolean(pkg.cortico?.kind)
  if (isExtension && !pkg.cortico.webUiClient) {
    pkg.cortico.webUiClient = 'dist/webui.js'
    fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  }
  if (!isExtension && pkg.cortico?.webUiClient) {
    delete pkg.cortico.webUiClient
    fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  }
  if (isExtension) {
    pkg.files = [...new Set([...(pkg.files ?? []), 'dist', 'src'])].sort()
    fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  }
  built.push(`${name} → ${path.relative(ROOT, outfile)} (${fs.statSync(outfile).size} B${isExtension ? '，已声明 webUiClient' : '，能力包不声明'})`)
}

console.log(built.length ? built.join('\n') : '没有需要构建的 webui 产物')
