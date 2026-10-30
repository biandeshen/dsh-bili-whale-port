/**
 * go-rebuild —— 审批对象必须等于执行对象（M1e）。
 *
 * 背景：go-gate 队列里存的 argv 是**模型可写**的，panel 放行时如果原样重放再补 --go，
 * 主人看到的 message 就不等于实际执行的命令（可夹带 --share/--force/换子命令）。
 *
 * 规则（全部 fail-closed，宁可拒也不猜）：
 *   ① kind 必须映射到白名单命令（评论/收藏/弹幕，仅此三条）；
 *   ② argv 只接受该命令的白名单旗标，出现任何其它旗标直接拒；
 *   ③ 结构化字段（主人面板上看到的 message/oid/bvid、danmaku 的 src 房间号）**覆盖** argv ——
 *      展示给谁看，就执行什么；
 *   ④ 值不允许以 `--` 开头（朴素旗标解析会把值吞成布尔），oid/root/parent/room/type 数字校验。
 *
 * 返回 { ok: true, args }：args 不含 --go，由调用方（routes approve）追加；
 * 或 { ok: false, error }，调用方 400 拒绝放行。
 */

const KIND_CMD = { 评论: 'comment', 收藏: 'fav', 弹幕: 'danmaku' }

// 取值旗标：其后必须跟一个值；布尔旗标单列
const VALUE_FLAGS = {
  comment: ['--oid', '--bvid', '--root', '--parent', '--message', '--type', '--referer'],
  fav: ['--reason'],
  danmaku: ['--room', '--msg', '--reply-mid', '--reply-name', '--reply-dmid'],
}
const BOOL_FLAGS = {
  comment: ['--once-per-person'],
  fav: ['--better'],
  danmaku: [],
}

const NUM = /^\d+$/
const BVID = /^BV[0-9A-Za-z]+$/
const badValue = (v) => String(v ?? '').startsWith('--') || !String(v ?? '').trim()

/** 严格解析一条队列 argv；出现白名单外的旗标 → 拒（不静默丢弃，丢了就成了"展示≠执行"的另一种形态）。 */
function parseArgv(argv, cmd) {
  const valueSet = new Set(VALUE_FLAGS[cmd])
  const boolSet = new Set(BOOL_FLAGS[cmd])
  const vals = {}
  const positionals = []
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === cmd) continue
    if (cmd === 'danmaku' && a === 'send') { positionals.push(a); continue }
    if (a.startsWith('--')) {
      if (valueSet.has(a)) {
        const v = argv[i + 1]
        if (v === undefined || v.startsWith('--')) return { ok: false, error: `旗标 ${a} 缺值` }
        vals[a] = v
        i += 1
      } else if (boolSet.has(a)) {
        vals[a] = true
      } else {
        return { ok: false, error: `白名单外旗标：${a}` }
      }
    } else {
      positionals.push(a)
    }
  }
  return { ok: true, vals, positionals }
}

function validateComment(vals) {
  if (!vals['--message'] || !vals['--oid']) return '缺 --oid / --message'
  if (badValue(vals['--message'])) return 'message 为空或以 -- 开头'
  if (!NUM.test(vals['--oid'])) return '--oid 必须是数字'
  for (const k of ['--root', '--parent', '--type']) if (vals[k] !== undefined && !NUM.test(vals[k])) return `${k} 必须是数字`
  if (vals['--bvid'] !== undefined && !BVID.test(vals['--bvid'])) return '--bvid 格式不对'
  if (vals['--referer'] !== undefined && !/^https:\/\/([a-z0-9-]+\.)*bilibili\.com\//i.test(vals['--referer'])) return '--referer 只允许 bilibili.com'
  return null
}

export function rebuildApproveArgs(item) {
  const kind = String(item?.kind ?? '')
  const cmd = KIND_CMD[kind]
  if (!cmd) return { ok: false, error: `未知类型（拒绝重放）：${kind || '空'}` }
  if (!Array.isArray(item.argv) || item.argv.length === 0) return { ok: false, error: '队列项缺 argv' }

  const parsed = parseArgv(item.argv, cmd)
  if (!parsed.ok) return parsed
  const vals = parsed.vals
  const pos = parsed.positionals

  // ── 结构化字段覆盖：面板上展示的就是这些，执行必须用同一份 ──
  const structured = {
    message: String(item.message ?? '').trim(),
    oid: String(item.oid ?? '').trim(),
    bvid: String(item.bvid ?? '').trim(),
  }
  if (cmd === 'comment') {
    if (structured.message) vals['--message'] = structured.message
    if (structured.oid) vals['--oid'] = structured.oid
    if (structured.bvid) vals['--bvid'] = structured.bvid
    // 结构化坐标也覆盖 argv（入队时由 comment.mjs 自己填的）
    if (String(item.root ?? '').trim()) vals['--root'] = String(item.root).trim()
    if (String(item.parent ?? '').trim()) vals['--parent'] = String(item.parent).trim()
    if (String(item.type ?? '').trim()) vals['--type'] = String(item.type).trim()
    if (String(item.referer ?? '').trim()) vals['--referer'] = String(item.referer).trim()
    if (pos.length) return { ok: false, error: 'comment 不接受位置参数' }
    const err = validateComment(vals)
    if (err) return { ok: false, error: err }
    const args = ['comment', '--oid', vals['--oid']]
    if (vals['--bvid']) args.push('--bvid', vals['--bvid'])
    if (vals['--type']) args.push('--type', vals['--type'])
    if (vals['--referer']) args.push('--referer', vals['--referer'])
    if (vals['--root']) args.push('--root', vals['--root'])
    if (vals['--parent']) args.push('--parent', vals['--parent'])
    args.push('--message', vals['--message'])
    if (vals['--once-per-person']) args.push('--once-per-person')
    return { ok: true, args }
  }

  if (cmd === 'fav') {
    const bv = structured.bvid || pos[0] || ''
    if (!BVID.test(bv)) return { ok: false, error: 'fav 缺合法 BV 号' }
    if (pos.length > 1) return { ok: false, error: 'fav 只接受一个 BV' }
    const reason = structured.message || vals['--reason'] || ''
    if (badValue(reason)) return { ok: false, error: 'fav 缺理由（--reason）' }
    const args = ['fav', bv, '--reason', reason]
    if (vals['--better']) args.push('--better')
    return { ok: true, args }
  }

  // cmd === 'danmaku'
  if (pos[0] !== 'send') return { ok: false, error: '弹幕只允许 send' }
  if (pos.length > 1) return { ok: false, error: '弹幕不接受多余位置参数' }
  let room = ''
  const m = /^room\s+(\d+)$/.exec(String(item.src ?? ''))
  if (m) room = m[1]
  if (!room && structured.oid && NUM.test(structured.oid)) room = structured.oid
  if (!room) room = vals['--room'] ?? ''
  const msg = structured.message || vals['--msg'] || ''
  if (!NUM.test(room)) return { ok: false, error: '弹幕缺合法 --room' }
  if (badValue(msg)) return { ok: false, error: '弹幕缺 --msg' }
  const args = ['danmaku', 'send', '--room', room, '--msg', msg]
  for (const k of ['--reply-mid', '--reply-name', '--reply-dmid']) {
    if (vals[k] !== undefined) {
      if (badValue(vals[k])) return { ok: false, error: `${k} 值非法` }
      if ((k === '--reply-mid' || k === '--reply-dmid') && !NUM.test(vals[k])) return { ok: false, error: `${k} 必须是数字` }
      args.push(k, vals[k])
    }
  }
  return { ok: true, args }
}
