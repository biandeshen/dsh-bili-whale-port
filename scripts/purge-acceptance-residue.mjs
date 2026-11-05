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
// 她的工作区仓库就是记忆与日记共用的那份历史；搬走测试卡要在这份历史里留一笔，
// 所以复用能力包里那套 git（自己拼 git 命令等于第二套真相）。
import { WorkspaceGit, AUTHOR_OPERATOR } from '../packages/cap-memory/src/workspace-git.ts'

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

/**
 * 搬走「已作废」层里那些验收标记的测试卡（2026-11-05 主人点头：「测试卡搬走吧」）。
 *
 * 为什么 F5 清了还要再动一次：那轮是按"作废留痕"处理的，卡片还在账上——
 * 主人每次开记忆面板选「全部」就看见「验收标记-acc…」这种字样，我们的脚印赖在她家里。
 *
 * 两条硬边界：
 *   · **只动 `memo/voided/`**。active / core / archived 里如果出现匹配标记，只报警不搬——
 *     那说明这条还在她的日常里，是不是要搬得逐条看，不由脚本替她决定。
 *   · 搬 = 移到 `data/quarantine/acceptance-memo-<时间戳>/` 并写 manifest，
 *     然后在同一份 workspace git 里留一次提交。**能搬回来，也能查搬走了什么**。
 */
function quarantineMemoCards() {
  /**
   * 记忆卡专用的一层额外识别：**联调 / 浏览器直发**那两条塞入验证。
   *
   * 它们不含"验收标记"字样，所以 MARK 抓不到，第一轮搬完还剩在 voided 里。
   * 锚在正文开头（`^` + /m）而不是全文搜：她有一条真实反思写着
   * 「记忆大扫除第二轮：又清了 2 条联调/浏览器直发测试塞入的假记忆」——
   * 那句话里也出现这两个词，但她那条是**她记的事**，不能跟着一起搬走。
   */
  const MEMO_MARK = (text) => MARK.test(text) || /^(?:联调验证\d*|浏览器直发验证|直发验证\d*)[：:]/m.test(text)
  const memoRoot = path.join(HOME, 'workspace', 'memo')
  const qdir = path.join(HOME, 'data', 'quarantine', `acceptance-memo-${STAMP}`)
  const moved = []
  const outside = []
  for (const tier of ['core', 'active', 'archived', 'voided']) {
    const dir = path.join(memoRoot, tier)
    if (!fs.existsSync(dir)) continue
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.md')) continue
      const p = path.join(dir, f)
      let text = ''
      try { text = fs.readFileSync(p, 'utf8') } catch { continue }
      if (!MEMO_MARK(text)) continue
      if (tier !== 'voided') { outside.push(`${tier}/${f}`); continue }
      moved.push({ p, f, text })
    }
  }

  if (outside.length) {
    report.push(['记忆·警报', `${outside.length} 条匹配标记但不在已作废层：${outside.slice(0, 3).join('、')}${outside.length > 3 ? ' …' : ''} —— 不搬，需要逐条看`, 0])
  }
  if (!moved.length) {
    report.push(['记忆·测试卡', GO ? '已作废层里没有匹配标记的卡（上一轮已搬走）' : '已作废层里没有匹配标记的卡', 0])
    return
  }
  if (!GO) { report.push(['记忆·测试卡', `将搬走 ${moved.length} 条（只动 voided）`, moved.length]); return }

  fs.mkdirSync(qdir, { recursive: true })
  const manifest = []
  for (const { p, f, text } of moved) {
    const to = path.join(qdir, f)
    fs.copyFileSync(p, to)
    fs.rmSync(p)
    manifest.push({ file: f, bytes: Buffer.byteLength(text, 'utf8'), quarantinePath: path.relative(HOME, to), at: new Date().toISOString() })
  }
  fs.writeFileSync(path.join(qdir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')

  // 在同一份工作区仓库留一次提交：日记与记忆共享历史，搬走这件事也得在历史里看得见
  let committed = '未接 git（文件已搬走）'
  try {
    const git = new WorkspaceGit(path.join(HOME, 'workspace'))
    const sha = git.commitAll(`memory: 搬走 ${moved.length} 条验收标记的测试卡（备份 data/quarantine/acceptance-memo-${STAMP}）`, AUTHOR_OPERATOR)
    committed = sha ? `已提交 ${String(sha).slice(0, 8)}` : '无改动可提交'
  } catch (e) {
    committed = `提交失败（文件已搬走，可手动补提交）：${String(e && e.message ? e.message : e).slice(0, 80)}`
  }
  report.push(['记忆·测试卡', `搬走 ${moved.length} 条 → data/quarantine/acceptance-memo-${STAMP}；${committed}`, moved.length])
}

purgeChain()
purgeJsonl('判断卡', 'data/persona/judgment.jsonl')
purgeJsonl('意见箱', 'data/persona/feedback.jsonl')
purgeDiary('公开日记', 'workspace/diary/public.md')
purgeDiary('私人日记', 'workspace/diary/private.md')
quarantineMemoCards()

let total = 0
for (const [what, how, n] of report) {
  total += n
  console.log(`  ${what.padEnd(6)} ${how}`)
}
console.log(`\n合计 ${total} 处${GO ? '已清（原件都留了 .pre-purge-* 备份）' : '待清；加 --go 才真改'}。`)
console.log('不碰：data/runs/**（宿主原始事件分片）、核心常驻里的旧拒稿（真实历史，主人拍板才动）。')
