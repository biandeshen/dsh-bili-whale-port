/**
 * 旧共享配置 → 新架构的迁移对账（只读，不调模型、不碰 B 站）。
 *
 *   node scripts/audit-config-migration.mjs [--json]
 *
 * 背景（2026-11-06 主人："原本的 B 站那些配置什么的全部都没迁移过来，还好意思说"）：
 * 旧底座 `~/.dsh/bili-whale.config.json` 有 61 个叶子键；能力包重写（A2「消灭双仓与 spawn」）
 * 之后，有多少真的还有代码在读、有多少是整块掉在地上，之前没人对过账。
 * 本脚本就干这一件事：**把每个旧键的去处查清楚**，不许凭印象说"迁好了"。
 *
 * 判据分三档：
 *   live    —— 新代码里读得到（键名或等价字段出现在能力包/宿主配置里）
 *   renamed —— 旧键名没了，但等价的实现换了个名字（人工确认后写进 RENAMED 表）
 *   gone    —— 查无此物：功能整块没迁
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOME = process.env.USERPROFILE || os.homedir()
const OLD = process.env.BILI_WHALE_CONFIG || path.join(HOME, '.dsh', 'bili-whale.config.json')
const asJson = process.argv.includes('--json')

/**
 * 人工确认的"改名/等价实现"表。
 * 每条都要写清**落在哪里**，不然就是拿新名字糊弄旧功能。
 */
const RENAMED = {
  'risk.minGapMs': 'cap-bilibili WriteGate 写冷却（writeGapSec 等价，见 domain/write-gate.ts）',
  'risk.readHourly': 'cap-bilibili domain/read-quota.ts 读配额（小时窗）',
  'risk.readDaily': 'cap-bilibili domain/read-quota.ts 读配额（日窗）',
  'risk.writeHourly': 'cap-bilibili WriteGate 写侧风控',
  'risk.writeDaily': 'cap-bilibili WriteGate 写侧风控',
  'risk.writeGapSec': 'cap-bilibili BilibiliCapabilityConfig.writeGapSec',
  'risk.dmGapSec': 'cap-bilibili WriteGate 私信冷却',
  'owner.mid': 'cap-bilibili 身份账（转接头 legacy-identity.ts 现读旧配置 → 监听/私信过滤用；写入处是宿主 config.identity）',
  'owner.name': 'cap-bilibili bili-connection.json 显示名（同 self.mid，只桥接不迁移）',
  'owner.displayName': 'cap-bilibili bili-connection.json 显示名（同上）',
  'persona.name': 'cortico-bot-xiaoyu persona（人设正本 CONSTITUTION）',
  'persona.ownerTitle': 'cortico-bot-xiaoyu persona',
  'persona.selfClaim': 'cortico-bot-xiaoyu persona',
  'self.mid': 'cap-bilibili 身份账 selfMid（启动补齐 + 连接页绑定后写；legacy-identity.ts 桥接旧值）',
  'self.name': 'cap-bilibili bili-connection.json 账号身份（绑定后由 nav 回填）',
  'preferences.like': 'cap-bilibili client/inbox.ts WatchPreferences.like',
  'preferences.dislike': 'cap-bilibili client/inbox.ts WatchPreferences.dislike',
  'preferences.keywords': 'cap-bilibili client/inbox.ts WatchPreferences.keywords',
  'publish.draftMode': 'cap-bilibili domain/write-gate.ts BiliPublishPolicy.draftMode',
  'publish.autoDailyCap': 'cap-bilibili write-gate autoDailyCap',
  'publish.autoWindow': 'cap-bilibili write-gate autoWindow',
  'permissions.like': 'cap-bilibili write-gate BiliPublishPolicy.like',
  'permissions.fav': 'cap-bilibili write-gate BiliPublishPolicy.fav',
  'permissions.dmReply': 'cap-bilibili write-gate BiliPublishPolicy.dmReply',
  'permissions.comment': 'cap-bilibili write-gate BiliPublishPolicy.comment',
  'permissions.danmaku': 'cap-bilibili write-gate BiliPublishPolicy.danmaku',
  'quota.shareDaily': 'cap-bilibili BilibiliCapabilityConfig.shareDailyCap',
  'diary.enabled': 'cap-journal diary_write（两本日记）',
  'clock.enabled': 'cap-state-rhythm 作息（睡眠时段/心跳）',
  'night.maxVideos': 'cap-state-rhythm 夜间时段不叫她（B14 改的 decideStage）',
  'night.minGapMin': 'cap-state-rhythm 心跳间隔（tick.intervalMinutes）',
  'night.skipChance': 'cap-state-rhythm 行动概率门（rhythm CHECK_PROB）',
  // 2026-11-06 补齐的这一块：旧定时器整块落下，现在回到 cap-bilibili（键名沿用旧名，面板可改）
  'listen.comment': 'cap-bilibili domain/inbox-listener.ts（配置键 listen.comment，60s 起）',
  'listen.commentIntervalSec': 'cap-bilibili inbox-listener commentIntervalSec + 连败退避（上限 15 分钟）',
  'listen.dm': 'cap-bilibili inbox-listener（配置键 listen.dm，只看主人那一个会话）',
  'listen.dmIntervalSec': 'cap-bilibili inbox-listener dmIntervalSec（默认 150s）',
  'listen.scope': "cap-bilibili 配置键 listen.scope（'both'=回复+@我 / 'reply'=只看回复我的）",
  'listen.allDay': 'cap-bilibili 配置键 listen.allDay（关掉=只在她醒着的时段守，窗口外不占间隔、不计失败）',
  'listen.mentionSummary': 'cap-bilibili bili-account.inbox 事件正文（逐条列 @谁 说了什么）',
}

/** 明确判定"没迁"的键，写清它原来干什么——这样"掉在地上"是账，不是猜测。 */
const GONE_NOTES = {
  'listen.oncePerPerson': '旧「每人只回一次」规则。',
  'listen.live': '旧「直播挂机」开关——她去直播间挂着。',
  'listen.liveRoom': '旧直播间隔间号。',
  'listen.liveScope': '旧直播监听范围。',
  'sessionRotateDays': '旧会话轮换天数。',
  'personaOncePerSession': '旧「每会话注入一次人设」。',
  'night.windows': '旧夜间窗口数组（新架构是 sleepWindow 时段，口径不同，见 cap-state-rhythm）。',
  'night.maxWakesPerDay': '旧「每天最多醒几次」——**这是配额，主人已拍板拆掉，不该迁**。',
  'diary.push': '旧「日记推送」开关。',
  'notify.*': '旧通知通道（type/url/template/cmd）——新架构没有外推通知。',
  'share.*': '旧「分享/自动发评」策略组（aiCommentGuard/aiThreshold/enabled/via/minScore/silentAfterDays）。',
  'toolsPath': '旧 CLI 工具路径（A2 消灭 spawn 后本就该废）。',
  'home': '旧数据根目录 D:/AI/养鱼。',
  'preferences.judgments': '旧判断偏好数组（新架构判断卡在 judgment.jsonl，不在这）。',
}

function flatten(obj, prefix = '') {
  const out = []
  for (const [k, v] of Object.entries(obj ?? {})) {
    const p = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...flatten(v, p))
    else out.push({ key: p, value: Array.isArray(v) ? `[${v.length}]` : v })
  }
  return out
}

/** 收集新架构里"有人在读"的文本：各能力包源码 + 宿主配置 + 部署配置。 */
function collectCorpus() {
  const texts = []
  const walk = (dir, accept) => {
    if (!fs.existsSync(dir)) return
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist', 'data', 'workspace', 'memo', 'runs'].includes(ent.name)) continue
      const p = path.join(dir, ent.name)
      if (ent.isDirectory()) walk(p, accept)
      else if (accept(ent.name)) {
        try { texts.push(fs.readFileSync(p, 'utf8')) } catch { /* 读不到就算了 */ }
      }
    }
  }
  walk(path.join(ROOT, 'packages'), (f) => /\.(ts|mjs)$/.test(f))
  // 部署侧的真配置
  const deploy = process.env.CORTICO_HOME || path.join(HOME, '.xiaoyu-home')
  for (const f of [path.join(deploy, 'xiaoyu', 'config.json')]) {
    try { texts.push(fs.readFileSync(f, 'utf8')) } catch { /* 没有就不算 */ }
  }
  // 宿主内置 world（QQ 那类功能在宿主树里，也算"有实现"）
  const host = process.env.CORTICO_ROOT || path.resolve(ROOT, '..', 'Cortico-up')
  walk(path.join(host, 'src'), (f) => f.endsWith('.ts'))
  return texts.join('\n')
}

const old = JSON.parse(fs.readFileSync(OLD, 'utf8'))
const rows = flatten(old)
const corpus = collectCorpus()

const live = []
const renamed = []
const gone = []
for (const { key, value } of rows) {
  if (RENAMED[key]) { renamed.push({ key, value, where: RENAMED[key] }); continue }
  const leaf = key.split('.').pop()
  // 整条路径或叶子键在源码里出现过 → 算 live
  const hit = corpus.includes(key) || new RegExp(`[."'\\s]${leaf}[."'\\s:,)]`).test(corpus)
  if (hit) live.push({ key, value })
  else gone.push({ key, value, note: GONE_NOTES[key] || GONE_NOTES[key.split('.')[0] + '.*'] || '' })
}

const report = { old: OLD, total: rows.length, live: live.length, renamed: renamed.length, gone: gone.length, rows: { live, renamed, gone } }
if (asJson) console.log(JSON.stringify(report, null, 2))
else {
  console.log(`# 旧共享配置迁移对账：${rows.length} 个键`)
  console.log(`  代码里读得到（live）    ${live.length}`)
  console.log(`  等价实现换了名字（renamed） ${renamed.length}`)
  console.log(`  查无此物（gone）        ${gone.length}\n`)
  if (gone.length) {
    console.log('=== 掉在地上没迁的 ===')
    for (const g of gone) console.log(`  - ${g.key} = ${g.value}${g.note ? '｜' + g.note : ''}`)
  }
}
process.exitCode = gone.length ? 1 : 0
