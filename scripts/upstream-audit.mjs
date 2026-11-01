#!/usr/bin/env node
/**
 * 上游对账：我们落后上游多少、差的是哪些提交、哪些文件动过。
 *
 * 为什么要有它：`git rev-list --count HEAD..upstream/main` 给一个数字，但数字本身
 * 不能决定要不要跟——要看到"差的这些提交碰的是哪些文件"才知道会跟我们的改动打不打架。
 * 这个脚本只读本地已有的 upstream 引用，不 fetch（网络与代理状态是另一件事）。
 *
 * 用法：
 *   node scripts/upstream-audit.mjs              人类可读
 *   node scripts/upstream-audit.mjs --json       机器读
 *   node scripts/upstream-audit.mjs --limit 60   只看最近 60 条
 *
 * 退出码：0 = 有共同祖先；2 = 没有共同祖先（历史被重写过，不能按常规 merge 处理）
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const JSONOUT = argv.includes('--json')
const limitAt = argv.indexOf('--limit')
const LIMIT = limitAt >= 0 ? Math.max(1, Number(argv[limitAt + 1]) || 50) : 50

const git = (...args) => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
const tryGit = (...args) => { try { return git(...args) } catch { return '' } }

const upstreamRef = tryGit('rev-parse', '--verify', 'upstream/main') ? 'upstream/main' : ''
if (!upstreamRef) {
  console.error('本地没有 upstream/main 引用。先 `git fetch upstream`（会联网）。')
  process.exit(3)
}

const base = tryGit('merge-base', 'HEAD', upstreamRef)
const ahead = Number(tryGit('rev-list', '--count', `${upstreamRef}..HEAD`) || 0)
const behind = Number(tryGit('rev-list', '--count', `HEAD..${upstreamRef}`) || 0)
const commits = tryGit('log', '--oneline', '--no-merges', `--max-count=${LIMIT}`, `HEAD..${upstreamRef}`)
  .split('\n').filter(Boolean)
  .map((line) => {
    const [sha, ...rest] = line.split(' ')
    return { sha, subject: rest.join(' ') }
  })

// 差集里动过的文件：这是"要不要跟"的真正判据。
const files = tryGit('diff', '--name-only', ...(base ? [`${base}..${upstreamRef}`] : [`HEAD..${upstreamRef}`]))
  .split('\n').filter(Boolean)
// 我们改过、上游也改过的：最可能打架的那批。
//
// 有共同祖先时，两边都以 base 为参照各给一份改动集，交集就是冲突候选。
// 没有共同祖先时这个问法不成立（"我们改过什么"是相对谁说的？），只能退一步：
// 看上游这轮改动里有没有碰我们仓库里确实动过的文件。这个判据偏松，所以
// 报告里标 conflictBasis，读的人知道这个数字建立在什么之上。
const ourRange = base ? `${base}..HEAD` : null
const oursChanged = new Set(ourRange
  ? tryGit('diff', '--name-only', ourRange).split('\n').filter(Boolean)
  // 无 base：拿我们的工作副本跟上游比，只挑"我们这边和上游不一样"的文件
  : tryGit('diff', '--name-only', upstreamRef, '--', '.').split('\n').filter(Boolean))
const both = base ? files.filter((f) => oursChanged.has(f)) : []

const report = {
  upstream: upstreamRef,
  upstreamHead: tryGit('rev-parse', '--short', upstreamRef),
  head: tryGit('rev-parse', '--short', 'HEAD'),
  mergeBase: base ? base.slice(0, 8) : null,
  behind,
  ahead,
  commits,
  upstreamFiles: files.length,
  ourFiles: oursChanged.size,
  conflictBasis: base ? 'merge-base' : 'none (no common ancestor: no reliable conflict set)',
  conflictCandidates: both,
}

if (JSONOUT) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`上游 ${report.upstream} @ ${report.upstreamHead}｜我们 @ ${report.head}`)
  console.log(`落后 ${behind} 个提交，本地领先 ${ahead} 个`)
  if (!base) {
    console.log('')
    console.log('⚠ 没有共同祖先：上游历史被重写过（或本地是另起的根）。')
    console.log('  这种情况下 `git merge upstream/main` 会把两边都当成新文件，等于重来一遍。')
    console.log('  要么整跟到某个上游 tag 再重新施加我们的改动，要么继续只做定点 backport。')
  }
  console.log('')
  console.log(`差的提交（最多 ${LIMIT} 条，已跳过 merge）：`)
  for (const c of commits) console.log(`  ${c.sha}  ${c.subject}`)
  console.log('')
  console.log(`这次差集里动过的文件：${report.upstreamFiles} 个；我们仓库里与上游不同的：${report.ourFiles} 个`)
  if (!base) {
    console.log('没有共同祖先，算不出"两边都改过"的可靠清单（判据要一个共同的参照点）。')
    console.log('跟之前先决定用哪条路：整跟到上游某个 tag 再重放我们的改动，或者继续定点 backport。')
  } else {
    console.log(`两边都动过（最可能冲突）：${both.length} 个`)
    for (const f of both.slice(0, 40)) console.log(`  ⚠ ${f}`)
    if (both.length > 40) console.log(`  …还有 ${both.length - 40} 个`)
  }
}

process.exit(base ? 0 : 2)
