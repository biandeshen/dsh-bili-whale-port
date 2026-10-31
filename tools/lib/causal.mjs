/**
 * causal.jsonl 的唯一写入口（append-only 因果账本）。
 *
 * 宿主（Cortico World）与工具链（私信/草稿审批）都往 `~/.dsh/bili-whale/causal.jsonl`
 * 追加事件，观测期按 `kind` + `atMs` 机械统计。写入口径只留这一份：
 * 目录自己建、`at` 由这里补、单行 JSON + 换行，字段由调用方给全。
 *
 * 红线：账本里不许出现正文、凭据（SESSDATA / bili_jct / dev_id）、token；
 * 只记身份（mid / draftId / dynId）、日期、长度、时间戳。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 账本路径（与宿主、面板读侧同一处）。 */
export const causalFile = (whaleHome) => path.join(whaleHome, 'bili-whale', 'causal.jsonl')

/**
 * 追加一条事件：`{at, ...event}`。写失败不抛——记账不能让发送半途炸掉，
 * 缺账由读侧（observation-day / ops-day）显式报「读不到」。
 */
export function appendCausal(whaleHome, event) {
  try {
    const file = causalFile(whaleHome)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...event }) + String.fromCharCode(10))
    return true
  } catch {
    return false
  }
}
