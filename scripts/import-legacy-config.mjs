/**
 * 旧共享配置 → 部署侧真值的迁移器（默认只报告，`--go` 才写）。
 *
 *   node scripts/import-legacy-config.mjs          # 看要迁什么
 *   node scripts/import-legacy-config.mjs --go     # 落盘（每个被改的文件先留 .bak）
 *
 * 为什么有这个脚本（2026-11-06 主人："原本的 B 站那些配置什么的全部都没迁移过来，
 * 还他妈好意思说"）：能力包重写（A2「消灭双仓与 spawn」）把**代码**搬完了，
 * 但旧家 `~/.dsh/bili-whale.config.json` 里那些**她实际用了好几个月的值**没人接。
 * 迁移对账（audit-config-migration.mjs）只回答"这个键在新架构里有没有等价物"，
 * 回答不了"她的值进来了没有"——这一支就是补这一问。
 *
 * 三条规矩：
 *   ① 旧文件**只读**：它是主人的原始账本，迁完也不删、不改、不挪。
 *   ② 不覆盖人改过的值：只有"部署侧仍是代码默认值"才写入；面板上改过的一律保留
 *      ——写了反而把人的决定冲掉，那比没迁更糟。
 *   ③ 每个被改的文件先留一份带时间戳的 .bak，改错了原地退回。
 *
 * 不调模型、不碰 B 站：整支脚本零成本，随时可跑。
 */
import fs from 'node:fs'
import path from 'node:path'
import { configPath, deployHome } from '../packages/cap-bilibili/src/platform/paths.mjs'
import { DEFAULT_WATCH_PREFS } from '../packages/cap-bilibili/src/client/inbox.ts'

const GO = process.argv.includes('--go')
const STAMP = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')

function readJson(f) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null }
}

/** 计划写入：file → 新对象。最后统一备份 + 落盘，避免改一半。 */
const writes = new Map()
function planWrite(file, obj) {
  if (obj) writes.set(file, obj)
}

const home = deployHome()
const cfgFile = path.join(home, 'xiaoyu', 'config.json')
const oldCfg = readJson(configPath)
const cfg = readJson(cfgFile)

/** 她的 B 站数据目录：转接头用的是 `<部署 data>/bilibili`，两种摆法都探一下。 */
function biliDataDir() {
  for (const c of [path.join(home, 'xiaoyu', 'data', 'bilibili'), path.join(home, 'data', 'bilibili')]) {
    if (fs.existsSync(c)) return c
  }
  return path.join(home, 'xiaoyu', 'data', 'bilibili')
}
const dataDir = biliDataDir()
const prefsFile = path.join(dataDir, 'watch-prefs.json')
const trafficFile = path.join(dataDir, 'traffic-state.json')
const policyFile = path.join(dataDir, 'policy.json')

const rows = []
/** 记一条对账。action ∈ 迁 | 保留 | 对不上 | 不动 */
function note(where, key, from, to, action, why) {
  rows.push({ where, key, from, to, action, why })
}

/** 两组词表是不是同一套（顺序无关、重复无关） */
function sameSet(a, b) {
  const x = [...new Set((a ?? []).map(String))].sort()
  const y = [...new Set((b ?? []).map(String))].sort()
  return x.length === y.length && x.every((v, i) => v === y[i])
}

if (!oldCfg) {
  console.error(`旧共享配置读不到：${configPath}\n（先看是不是换了 whale home——不在迁移范围里，别硬猜。）`)
  process.exitCode = 1
} else if (!cfg) {
  console.error(`部署配置读不到：${cfgFile}\n（先把这台部署的 config.json 放回来再迁。）`)
  process.exitCode = 1
} else {
  const worlds = (cfg.worlds ??= {})
  const bili = (worlds['bili-account'] ??= {})

  // ── ① 身份：谁是主人、她自己是哪个号 ────────────────────────────────
  const oldIdentity = {
    ownerMid: String(oldCfg.owner?.mid ?? '').trim(),
    selfMid: String(oldCfg.self?.mid ?? '').trim(),
    ownerName: String(oldCfg.owner?.displayName ?? oldCfg.owner?.name ?? '').trim(),
    selfName: String(oldCfg.self?.name ?? '').trim(),
  }
  const curIdent = bili.identity ?? {}
  const identPatch = {}
  for (const k of ['ownerMid', 'selfMid', 'ownerName', 'selfName']) {
    if (oldIdentity[k] && !curIdent[k]) identPatch[k] = oldIdentity[k]
  }
  if (Object.keys(identPatch).length) {
    bili.identity = { ...curIdent, ...identPatch }
    planWrite(cfgFile, cfg)
    note('config.json › worlds.bili-account.identity', Object.keys(identPatch).join('/'),
      '(空)', Object.values(identPatch).join(' / '), '迁',
      '监听要知道"主人是谁"才能只认那一个会话，也要知道"她自己是谁"才不会把自己的回信当新私信叫醒自己')
  } else {
    note('config.json › worlds.bili-account.identity', 'ownerMid/selfMid',
      JSON.stringify(curIdent), '(不动)', Object.keys(curIdent).length ? '保留' : '不动',
      Object.keys(curIdent).length ? '部署侧已有身份，不覆盖' : '旧配置里也没有 mid，无可迁')
  }

  // ── ② 监听开关与间隔：用她实际跑的那套值，而不是代码默认 ────────────
  const oldListen = oldCfg.listen ?? {}
  const curListen = bili.listen ?? {}
  const listenPatch = {}
  for (const k of ['comment', 'commentIntervalSec', 'dm', 'dmIntervalSec', 'scope', 'allDay']) {
    if (oldListen[k] !== undefined && curListen[k] === undefined) listenPatch[k] = oldListen[k]
  }
  if (Object.keys(listenPatch).length) {
    bili.listen = { ...curListen, ...listenPatch }
    planWrite(cfgFile, cfg)
    note('config.json › worlds.bili-account.listen', Object.keys(listenPatch).join(','),
      '(空)', JSON.stringify(listenPatch), '迁',
      '旧值 comment=false / allDay=false 是她自己定的（只收私信、只在她醒着的时段守）；能力包默认是 comment=true / allDay=true，方向不一样')
  } else {
    note('config.json › worlds.bili-account.listen', 'listen.*',
      JSON.stringify(curListen), '(不动)', Object.keys(curListen).length ? '保留' : '不动',
      Object.keys(curListen).length ? '部署侧已设，不覆盖' : '旧配置里没有 listen 组')
  }
  /**
   * 有一处**语义变了**，不能当作"照抄旧值"就过去：
   * 旧 `listen.comment=false` 关掉的是"自动去主人评论下面回话"——那件事风险高，
   * 关掉是对的；新的 comment 监听**只把她叫醒、不代她发言**。
   * 所以这里照旧值写 false，同时把它列进「对不上」请主人拍板，而不是替她打开。
   */
  if (oldListen.comment === false) {
    note('config.json › worlds.bili-account.listen', 'comment',
      '旧值 false', '照旧值写入 false', '对不上',
      '旧监听关掉的是"自动回评论"，关得对；新监听只叫醒、不代回。要不要按新语义打开（评论/@我 也送进她眼前），请主人点头——面板 listen.comment 一键')
  }
  if (oldListen.allDay === false) {
    note('config.json › worlds.bili-account.listen', 'allDay',
      '旧值 false', '照旧值写入 false', '对不上',
      '"只在她醒着的时段守"这条线还没接上：作息在 cap-state-rhythm，bili-account 这侧的 inWindow 目前默认返回"醒着"，'
      + '所以 allDay=false 现在等价于全天守。要么把作息接过来，要么把这项改回 true——别留一个看着生效其实没生效的开关')
  }

  // ── ③ 写冷却：旧 120 秒 vs 新默认 10 秒 ─────────────────────────────
  const traffic = readJson(trafficFile) ?? {}
  const oldGap = Number(oldCfg.risk?.writeGapSec ?? 0)
  if (oldGap > 0 && Number(traffic.writeGapSec) === 10) {
    planWrite(trafficFile, { ...traffic, writeGapSec: oldGap })
    note('traffic-state.json', 'writeGapSec', '10（代码默认）', String(oldGap), '迁',
      '旧值 120 秒是她跑了几个月的写节奏；10 秒等于把对外写的节奏压放大 12 倍，这是风控上最实在的一条')
  } else {
    note('traffic-state.json', 'writeGapSec', String(traffic.writeGapSec ?? '(无)'),
      String(oldGap || '(旧配置没给)'), '保留',
      oldGap > 0 ? '部署侧不是默认值（=人在面板上改过），不覆盖' : '旧配置没给值')
  }

  // ── ④ 看片偏好：她那几组词表 ────────────────────────────────────────
  const prefs = readJson(prefsFile) ?? {}
  const prefsPatch = {}
  for (const k of ['like', 'keywords']) {
    const oldList = Array.isArray(oldCfg.preferences?.[k]) ? oldCfg.preferences[k].map(String) : []
    if (!oldList.length) continue
    if (sameSet(prefs[k], DEFAULT_WATCH_PREFS[k])) {
      prefsPatch[k] = oldList
      note('watch-prefs.json', k, JSON.stringify(prefs[k] ?? []), JSON.stringify(oldList), '迁',
        '部署侧这份与代码默认词表逐字相同——那是重写时我编的，不是她攒的；旧表才是她的口味账')
    } else {
      note('watch-prefs.json', k, JSON.stringify(prefs[k] ?? []), '(不动)', '保留',
        '部署侧改过词表（已不等于代码默认），不覆盖')
    }
  }
  {
    const oldDislike = Array.isArray(oldCfg.preferences?.dislike) ? oldCfg.preferences.dislike.map(String) : []
    const liveDislike = (prefs.dislike ?? []).map(String)
    // 人工加的词（不在代码默认表里的）必须保住；与旧表取并集，一条都不丢
    const humanAdded = liveDislike.filter((x) => !(DEFAULT_WATCH_PREFS.dislike ?? []).includes(x))
    const merged = [...new Set([...oldDislike, ...humanAdded])]
    if (merged.length && !sameSet(liveDislike, merged)) {
      prefsPatch.dislike = merged
      note('watch-prefs.json', 'dislike', JSON.stringify(liveDislike), JSON.stringify(merged), '迁',
        `旧表 ${oldDislike.length} 条是她攒的，另 ${humanAdded.length} 条是部署侧人工加的，并成一份`)
    } else {
      note('watch-prefs.json', 'dislike', JSON.stringify(liveDislike), '(不动)', '保留',
        merged.length ? '已经一致' : '旧配置没给屏蔽词')
    }
  }
  if (Object.keys(prefsPatch).length) {
    planWrite(prefsFile, { ...prefs, ...prefsPatch })
  }

  // ── ⑤ 只对账、不动手 ────────────────────────────────────────────────
  const policy = readJson(policyFile) ?? {}
  for (const k of ['like', 'fav', 'dmReply', 'comment', 'danmaku']) {
    const from = oldCfg.permissions?.[k]
    const eq = String(policy[k]) === String(from)
    note('policy.json', k, String(policy[k] ?? '(无)'), String(from ?? '(旧配置没给)'),
      eq ? '保留' : '对不上', eq ? '与旧值一致，无需迁' : '与旧值不一致——改不改请主人拍板，不自作主张')
  }
  note('config.json › worlds.bili-account.shareDailyCap', 'quota.shareDaily',
    '3（代码默认）', String(oldCfg.quota?.shareDaily ?? '(无)'),
    Number(oldCfg.quota?.shareDaily) === 3 ? '保留' : '对不上', '旧值 3 与新默认相同')
  for (const [k, why] of [
    ['risk.minGapMs / readHourly / readDaily / writeHourly / writeDaily', '新架构换成语义不同的读配额与写闸（read-quota.ts + write-gate.ts），数值不一一对应，不硬塞'],
    ['listen.oncePerPerson', '旧值 false（本来就没开）；新监听按 key 去重，等价于关掉'],
    ['listen.live / liveRoom / liveScope', '「直播挂机」整块没迁（旧值 live=false，本来也没在用）——要做得单独立项'],
    ['listen.mentionSummary', '旧值 true：新监听事件正文逐条列了 @我 内容，等价实现'],
    ['share.enabled / via / aiThreshold / minScore / aiCommentGuard / silentAfterDays', '旧「自动分享 / 自动发评」策略组没迁（现在只有 bili_comment / bili_dynamic 写执行器 + 草稿门）'],
    ['preferences.judgments / night.windows', '旧值都是空数组，无内容可迁；等价物是 judgment.jsonl 与作息 sleepWindow'],
    ['watch-prefs.minDurationSec（新有旧无）', '600 秒这条阈值是重写时我发明的，不是她的规则——留不留请主人拍板，本次不动'],
    ['notify.* / diary.push', '旧值 type=none、url 空：从来没有过外推通道，不是丢了'],
    ['night.maxWakesPerDay / maxVideos', '配额类，主人 2026-11-05 已拍板拆掉，不迁'],
    ['clock.enabled / personaOncePerSession / sessionRotateDays / toolsPath / home', '旧架构机制开关，新架构没有对应概念（A2 之后本就该废）'],
    ['diary.enabled', '旧值 true；新架构日记本来就在写'],
    ['persona.name / ownerTitle / selfClaim', '在人设正本（CONSTITUTION）里，不在配置文件里'],
    ['publish.draftMode / autoDailyCap / autoWindow', 'draftMode=auto、autoDailyCap=0 已一致；autoWindow 旧值空串=全天，新值 00:00-24:00 等价'],
  ]) note('（不动）', k, '', '', '不动', why)
}

// ── 落盘 ──────────────────────────────────────────────────────────────
if (GO && writes.size) {
  for (const [file, obj] of writes) {
    if (fs.existsSync(file)) console.log(`  备份：${backup(file)}`)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    writeJson(file, obj)
    console.log(`  写入：${file}`)
  }
  console.log('\n改的是配置与偏好文件；进程重启后全部生效（不重启也不会坏）。')
}

// ── 报告 ──────────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n)
console.log(`\n# 旧共享配置 → 部署真值对账（${GO ? '已写入' : '只报告，未写入'}）`)
console.log(`  旧配置（只读）：${configPath}`)
console.log(`  部署配置：${cfgFile}`)
console.log(`  B 站数据：${dataDir}\n`)
for (const a of ['迁', '对不上', '保留', '不动']) {
  const g = rows.filter((r) => r.action === a)
  if (!g.length) continue
  console.log(`=== ${a}（${g.length}）`)
  for (const r of g) {
    console.log(`  ${pad(r.where, 46)} ${pad(r.key, 30)} ${r.from}${r.to ? '  →  ' + r.to : ''}`)
    if (r.why) console.log(`  ${pad('', 46)} ${r.why}`)
  }
  console.log('')
}
if (!GO && rows.some((r) => r.action === '迁')) {
  console.log('标「迁」的项还没写盘。确认无误后跑：node scripts/import-legacy-config.mjs --go')
}

/** 写之前留一份原样备份；返回备份路径。 */
function backup(f) {
  const to = `${f}.bak-legacy-${STAMP}`
  fs.copyFileSync(f, to)
  return to
}

function writeJson(f, obj) {
  const tmp = `${f}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, f)
}
