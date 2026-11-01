import fs from 'node:fs'
// 图文动态 CLI（M2 薄壳）：逻辑全在 tools/drafts/publishers/bilibili-dynamic.mjs。
//   node tools/bili.mjs dynamic-image --image <path> [--text "..."] [--at <mid> --at-name <名>] --dry | --go
import { postImageDynamic } from '../drafts/publishers/bilibili-dynamic.mjs'

const argv = process.argv.slice(2)
const args = new Map()
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i]
  if (a.startsWith('--')) args.set(a.slice(2), argv[i + 1]?.startsWith('--') ? true : argv[++i] ?? true)
}
const imagePath = args.get('image')
const text = args.get('text') ?? ''
const isDry = args.has('dry')
const isGo = args.has('go')

if (!imagePath || typeof imagePath !== 'string') { console.error('需要 --image <路径>'); process.exit(2) }
if (isDry === isGo) { console.error('必须且只能给一个 --dry 或 --go'); process.exit(2) }
if (!fs.existsSync(imagePath)) { console.error(`图片不存在: ${imagePath}`); process.exit(2) }

const r = await postImageDynamic({
  image: imagePath,
  text,
  atMid: args.get('at') ?? null,
  atName: args.get('at-name') ?? null,
  go: isGo,
})
console.log(r.out)
if (r.exit === 5 && /只收 jpg \/ png \/ gif/.test(r.out)) {
  // 打印给人看的转换示例；路径做转义（PR #21 同一条规则）
  const safePath = imagePath.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  console.error(`  python -c "from PIL import Image; Image.open(r'${safePath}').convert('RGBA').save(r'<out>.png')"`)
}
if (r.ok && r.dynId) {
  console.log(`   复核: node bili.mjs dynamic check --id ${r.dynId}`)
  console.log(`   撤掉: node bili.mjs dynamic rm --id ${r.dynId} --go`)
  // 发出去了一条动态，主人该知道（干跑不报）。
  const { report } = await import('../lib/report.mjs')
  const rep = await report('动态', String(r.dynId), `发了条动态：
${String(text ?? '').slice(0, 300)}`)
  if (rep.error) console.error('报备没发出去：' + rep.error)
}
// 不调 process.exit：fetch 的 keep-alive socket 还没关，强退会在 Windows 上触发
// libuv「UV_HANDLE_CLOSING」断言并把退出码打成 127（审批层虽已不走这里，CLI 也要准）
process.exitCode = r.exit
