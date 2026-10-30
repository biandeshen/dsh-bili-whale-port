/**
 * 凭据注册表（M1b）——新凭据 = 加一个 provider 模块 + 一行登记，调用方不改。
 *
 * 全局规则（所有 provider 必须满足）：
 *   1. secret 只在 provider 内被读出；调用方拿到后只进请求头或子进程 env，
 *      不打印、不写日志、不进面板/API 响应、不入 git；
 *   2. `describe(providerId, loaded)` 只回来源（env/file/missing），永不含值；
 *   3. 缺凭据 fail-closed：返回 {key:null}，由调用方明确报错，不猜、不兜底空串。
 *
 * 现有两个：bilibili（B 站 cookie，按 OS 用户）、mimo（MiMo API key，env→auth.json→credentials）。
 */
import { loadMimoKey, defaultCandidates, describeMimo } from './mimo.mjs'
import { loadCred, missingForWrite, describeBilibiliCred } from './bilibili.mjs'

export { loadMimoKey, defaultCandidates, describeMimo }
export { loadCred, missingForWrite, describeBilibiliCred }

export const CREDENTIAL_PROVIDERS = ['mimo', 'bilibili']

/** 统一入口：describe 永不含 secret。 */
export function describe(providerId, loaded) {
  if (providerId === 'mimo') return describeMimo(loaded)
  if (providerId === 'bilibili') return describeBilibiliCred()
  throw new Error('未知凭据 provider：' + providerId)
}
