/**
 * 「宿主检出在哪」与「回滚点在哪」的唯一答案。
 *
 * 为什么没有硬默认：本仓曾有 6 个脚本把 CORTICO_ROOT 的默认值写成第二宿主克隆
 * （目录名 `Cortico`，不带 `-up`），而线上跑的是另一棵检出。环境变量一处都没设，
 * 于是那些默认值是活的——脚本安静地读了另一棵树的代码与数据，报告却看起来正常。
 * 这是本项目「读错了家」那一类故障的标准形态，所以这里改成：拿不到就明确报错。
 *
 * 解析顺序：进程环境 CORTICO_ROOT → 本仓根 .env 里的 CORTICO_ROOT → 报错。
 * .env 不进版本控制（.gitignore 已覆盖），是「这台机器的宿主在哪」的落盘答案。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

// 用 fileURLToPath 而不是 new URL(...).pathname：后者把 `~`、空格、中文 percent-encode
// （本机 os.tmpdir() 是 8.3 短名 ADMINI~1 → ADMINI%7E1），算出来的 REPO 根本不存在，
// 于是 .env 明明在也读不到，报的却是"缺 CORTICO_ROOT"——错诊断比报错更坏。
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

export const HOST_ROOT_ENV = 'CORTICO_ROOT'
export const ROLLBACK_ROOT_ENV = 'XIAOYU_ROLLBACK_ROOT'
const HINT = `请把 ${HOST_ROOT_ENV} 设成宿主检出目录（live 那棵是 E:/WorkSpace_Qoder/Cortico-up），或写进本仓根 .env 的 ${HOST_ROOT_ENV}= 行`

/** 读本仓根 .env 里某个键；支持引号，不引任何第三方 dotenv。 */
function fromEnvFile(key) {
  const file = path.join(REPO, '.env')
  if (!fs.existsSync(file)) return ''
  const m = new RegExp(`^[ \\t]*${key}[ \\t]*=[ \\t]*(.*)$`, 'm').exec(fs.readFileSync(file, 'utf8'))
  const raw = m ? m[1].trim() : ''
  return raw.length >= 2 && (raw.startsWith('"') || raw.startsWith("'")) && raw.endsWith(raw[0]) ? raw.slice(1, -1).trim() : raw
}

/** 宿主检出根。拿不到就抛，绝不猜。 */
export function hostRoot() {
  const raw = (process.env[HOST_ROOT_ENV] || '').trim() || fromEnvFile(HOST_ROOT_ENV)
  if (!raw) throw new Error(`缺 ${HOST_ROOT_ENV}：${HINT}`)
  const root = path.resolve(raw)
  if (!fs.existsSync(root)) throw new Error(`${HOST_ROOT_ENV}=${raw} 指向的目录不存在。${HINT}`)
  return root
}

/**
 * 跨仓 import 用的 file:// 地址，并先确认目标文件真在这棵检出里。
 * 少了这一步，指错检出时报的是 ERR_MODULE_NOT_FOUND，看不出是「树指错了」还是「文件真没了」。
 */
export function hostImport(rel) {
  const root = hostRoot()
  const abs = path.join(root, rel)
  if (!fs.existsSync(abs)) {
    throw new Error(`宿主检出 ${root} 里没有 ${rel}：要么指错了检出，要么这段代码已经搬走（${HINT}）`)
  }
  return 'file:///' + abs.replace(/\\/g, '/')
}

/**
 * 回滚点部署根（cormini 人格 + 旧数据）。2026-11-12 从第二宿主克隆搬到这：
 *   ~/.xiaoyu-home/rollback/deployments/{mybot,providers}
 * 目录形状与旧克隆的 Cortico/deployments 一致，所以旧备份包里的
 * `cortico/deployments/mybot/...` 前缀仍然恢复得回来（ops-backup.mjs 靠这个）。
 * 完整回滚计划见 docs/specs/10-control-surface.md。
 */
export function rollbackRoot() {
  const raw = (process.env[ROLLBACK_ROOT_ENV] || '').trim() || fromEnvFile(ROLLBACK_ROOT_ENV)
  return path.resolve(raw || path.join(os.homedir(), '.xiaoyu-home', 'rollback', 'deployments'))
}