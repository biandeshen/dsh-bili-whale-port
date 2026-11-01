/**
 * 因果账的读写。append-only，宿主与 CLI 都往里写。
 *
 * 写入口径只留这一份：目录自己建、`at` 与 `actor` 由这里补、单行 JSON + 换行。
 */
import fs from 'node:fs'
import path from 'node:path'
import { CAUSAL_FILE } from './paths.ts'

/**
 * 追加一条。写失败**往上抛**：autoSentToday 就是数这个文件里的条目，
 * 吞掉等于 autoDailyCap 形同虚设，而且时间线上看不到"这件事发生过"。
 *
 * `actor` 是署名：这份账有两个写者（宿主结算与 CLI 的 dm/草稿），事后查"这条是谁做的"
 * 只能靠它。历史条目没有这个字段（补不回来），新写入一律带上。
 */
export function causal(o: any): void {
  fs.mkdirSync(path.dirname(CAUSAL_FILE), { recursive: true })
  fs.appendFileSync(CAUSAL_FILE, JSON.stringify({ at: new Date().toISOString(), actor: 'host', ...o }) + String.fromCharCode(10))
}

/**
 * 正当"变更已经发生、只是记账失败"时用：手头的结果照常返回，同时把失败挂上去给主人看。
 * 不能因为账本坏了就把已经改好的配置说成没改，也不能假装记上了。
 */
export function withLedgerError<T extends { ok?: boolean; error?: string }>(result: T, entry: any): T {
  try { causal(entry); return result }
  catch (e: any) {
    const note = `因果账写不进去：${String(e?.message ?? e)}（这次改动已经生效，但时间线上不会有这条）`
    return { ...result, ok: false, error: result.error ? `${result.error}；${note}` : note }
  }
}

/** 最近 2000 条，解析失败的行直接跳过。 */
export function readCausal(): any[] {
  try {
    return fs.readFileSync(CAUSAL_FILE, 'utf8').split(String.fromCharCode(10)).slice(-2000)
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l) } catch { return null } })
      .filter(Boolean)
  } catch { return [] }
}
