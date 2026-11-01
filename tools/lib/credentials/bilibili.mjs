/**
 * B 站凭据 provider（M1b）：**只是把已有的 tools/lib/cred.mjs 归位到注册表**，
 * 不改任何行为——凭据按 OS 用户走 ~/.bili-ai/credentials.json，不随 whale home 漂移
 * （cred.mjs:19 与 paths.mjs:42 的既定契约）。
 * secret 只允许进请求头/子进程 env；describe 只回来源，不回值。
 */
import fs from 'node:fs'
import { loadCred, missingForWrite } from '../cred.mjs'
import { credentialsPath } from '../paths.mjs'

export { loadCred, missingForWrite }

/** 来源描述：'file' | 'missing'（不含任何凭据值）。 */
export function describeBilibiliCred() {
  try { return fs.existsSync(credentialsPath()) ? 'file' : 'missing' } catch { return 'missing' }
}
