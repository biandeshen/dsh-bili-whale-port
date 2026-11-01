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
 * 追加一条事件：`{at, actor, ...event}`。写失败不抛——记账不能让发送半途炸掉，
 * 缺账由读侧（observation-day / ops-day）显式报「读不到」。
 *
 * `actor` 是署名：这份账宿主与 CLI 都写，事后要能分清"这条是谁做的"。
 * 历史条目没有这个字段（补不回来），新写入一律带 `cli`。
 *
 * 例外：宿主页面点下去、实际由本仓脚本执行的动作（草稿放行/驳回）传 `actor: 'host'`
 * ——署名给"谁做的决定"，不是"哪个进程碰巧敲的字"。
 */
export function appendCausal(whaleHome, event) {
  try {
    const file = causalFile(whaleHome)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), actor: 'cli', ...event }) + String.fromCharCode(10))
    return true
  } catch {
    return false
  }
}
