/**
 * 旧共享配置的身份桥（迁移欠账，2026-11-06）。
 *
 * 「谁是主人、她自己是哪个号」这两条，旧架构存在共享配置里：
 *   `~/.dsh/bili-whale.config.json` → `owner.mid` / `self.mid`
 * 能力包重写之后**没有任何代码读它**——迁移对账一开始我把这两个键误标成"已改名"，
 * 实际全仓搜不到读点（见 docs/DEEP-AUDIT 的 §12.15）。
 *
 * 后果很具体：监听器不知道"主人是谁"，私信这一路就无法只认那一个会话；
 * 不知道"她自己是谁"，就会把她自己的回信当成新私信叫醒她（自激循环）。
 *
 * 这里的规矩：
 *   · **新配置优先**（`worlds.bili-account.identity.*`），桥接值只兜底；
 *   · 读旧文件是**只读**，不迁移、不改写、不删——它是主人的原始账本；
 *   · 读不到就返回空，让调用方明说"缺身份"，不许猜一个 mid 上去。
 */
import fs from 'node:fs'
import path from 'node:path'

export interface LegacyIdentity {
  ownerMid?: string
  selfMid?: string
  ownerName?: string
  selfName?: string
  /** 桥接文件路径；没找到时说明为什么，面板上要说得清。 */
  source: string
}

const LEGACY_CANDIDATES = [
  process.env.BILI_WHALE_CONFIG,
  path.join(process.env.USERPROFILE || process.env.HOME || '', '.dsh', 'bili-whale.config.json'),
].filter(Boolean) as string[]

function readJson(f: string): any | null {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null }
}

/** 取第一个读得到、且带着 mid 的旧共享配置。 */
export function readLegacyIdentity(): LegacyIdentity {
  for (const f of LEGACY_CANDIDATES) {
    const j = readJson(f)
    if (!j) continue
    const ownerMid = String(j?.owner?.mid ?? '').trim()
    const selfMid = String(j?.self?.mid ?? '').trim()
    if (!ownerMid && !selfMid) continue
    return {
      ...(ownerMid ? { ownerMid } : {}),
      ...(selfMid ? { selfMid } : {}),
      ...(String(j?.owner?.displayName ?? j?.owner?.name ?? '').trim()
        ? { ownerName: String(j.owner.displayName ?? j.owner.name) } : {}),
      ...(String(j?.self?.name ?? '').trim() ? { selfName: String(j.self.name) } : {}),
      source: f,
    }
  }
  return { source: '' }
}
