/**
 * 清掉验收脚本污染进她真实生活的条目（批次 10 · F5）。
 *
 * 为什么这些算污染而不是历史：它们不是她经历的事，是我跑验收脚本时造的假条目——
 * 假判断卡（"验收标记-accXXX：判断卡验收"）、假意见（"…：批复"）、
 * 假场值变动（她根本没看过片子，体力却被记了一次扣减），
 * 还有一段「验收」挂在**公开日记**里。
 * 规则说"不删原始数据、不删负结果"，指的是**她的**数据；
 * 我的测试残留不在保护范围内，但**一律先备份再动**，可回退。
 *
 * 不碰的两处，理由是硬的：
 *   · `data/runs/**`（宿主 append-only 事件分片与逐字记录）——那是原始凭据，
 *     删了就没法复核任何一次线上行为；噪声照 §1.7 另治。
 *   · 核心常驻里那 3 条**旧拒稿**（十天的三次真拒稿）——那是真实历史，
 *     要不要退下来是主人拍板的事（§9.2），不在本脚本里替他决定。
 *
 * 用法：node scripts/purge-acceptance-residue.mjs         → 只报告，不改（dry）
 *      node scripts/purge-acceptance-residue.mjs --go     → 真的清
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const GO = process.argv.includes('--go')
const HOME = path.join(process.env.USERPROFILE || os.homedir(), '.xiaoyu-home', 'xiaoyu')
/**
 * 验收脚本写进去的标记。
 *
 * 两代命名都要认：早期是 `验收标记-accXXXX`，
 * 7799 验收那批改成了 `验收脚本标记-accept7798-XXXX`——
 * 第一版只匹配前者，跑完回读发现链里还站着后一种，等于漏清。
 */
const MARK = /验收标记-acc|验收脚本标记-|accept-?779[0-9]|验收脚本写入|^## 验收\s*$/
const STAMP = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)

const report = []
function backup(file) {
  const to = file + '.pre-purge-' + STAMP
  fs.copyFileSync(file, to)
  return to
}

/** fields.json 的因果账：整条丢掉带标记的条目（不是改描述——留着一条空壳更误导人）。 */
function purgeChain() {
  const file = path.join(HOME, 'data', 'persona', 'fields.json')
  if (!fs.existsSync(file)) return report.push(['因果账', '文件不存在', 0])
  const s = JSON.parse(fs.readFileSync(file, 'utf8'))
  const chain = Array.isArray(s.chain) ? s.chain : []
  const kept = chain.filter((c) => !MARK.test(JSON.stringify(c)))
  const n = chain.length - kept.length
  if (!n) return report.push(['因果账', '本来就没有标记', 0])
  if (GO) {
    const bak = backup(file)
    fs.writeFileSync(file + '.tmp', JSON.stringify({ ...s, chain: kept }, null, 2))
    fs.renameSync(file + '.tmp', file)
    report.push(['因果账', `删 ${n} 条，剩 ${kept.length} 条（备份 ${path.basename(bak)}）`, n])
  } else report.push(['因果账', `将删 ${n} 条 / 共 ${chain.length} 条`, n])
}

/** append-only 的 jsonl 台账：同样整条丢，但先备份。judgment / feedback 同形。 */
function purgeJsonl(name, rel) {
  const file = path.join(HOME, rel)
  if (!fs.existsSync(file)) return report.push([name, '文件不存在', 0])
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  const kept = lines.filter((l) => l.trim() && !MARK.test(l))
  const n = lines.filter((l) => l.trim()).length - kept.length
  if (!n) return report.push([name, '本来就没有标记', 0])
  if (GO) {
    const bak = backup(file)
    fs.writeFileSync(file, kept.join('\n') + '\n')
    report.push([name, `删 ${n} 条，剩 ${kept.length} 条（备份 ${path.basename(bak)}）`, n])
  } else report.push([name, `将删 ${n} 条`, n])
}

/** 日记里的「## 验收」小节：连标题带正文一起摘掉。公开本上挂着测试字样最要不得。 */
function purgeDiary(name, rel) {
  const file = path.join(HOME, rel)
  if (!fs.existsSync(file)) return report.push([name, '文件不存在', 0])
  const out = []
  let dropping = false
  let removed = 0
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (/^##\s+验收\s*$/.test(line)) { dropping = true; removed += 1; continue }
    // 小节边界：下一个 ## 或 # 开始就不再是验收段
    if (dropping && /^#{1,2}\s/.test(line)) dropping = false
    if (dropping) continue
    out.push(line)
  }
  if (!removed) return report.push([name, '没有验收小节', 0])
  if (GO) {
    const bak = backup(file)
    fs.writeFileSync(file, out.join('\n'))
    report.push([name, `摘掉 ${removed} 个小节（备份 ${path.basename(bak)}）`, removed])
  } else report.push([name, `将摘掉 ${removed} 个小节`, removed])
}

purgeChain()
purgeJsonl('判断卡', 'data/persona/judgment.jsonl')
purgeJsonl('意见箱', 'data/persona/feedback.jsonl')
purgeDiary('公开日记', 'workspace/diary/public.md')
purgeDiary('私人日记', 'workspace/diary/private.md')

let total = 0
for (const [what, how, n] of report) {
  total += n
  console.log(`  ${what.padEnd(6)} ${how}`)
}
console.log(`\n合计 ${total} 处${GO ? '已清（原件都留了 .pre-purge-* 备份）' : '待清；加 --go 才真改'}。`)
console.log('不碰：data/runs/**（宿主原始事件分片）、核心常驻里的旧拒稿（真实历史，主人拍板才动）。')
