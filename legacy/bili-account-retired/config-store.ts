/**
 * 配置这一层：读策略、改策略、读/改名字。
 *
 * 与面板数据分开的理由：这一层只碰配置文件，不碰 dsh 模块缓存（`mods`），
 * 所以能单独测、也能被脚本直接引用。面板数据留在 `tank.ts`。
 */
import fs from 'node:fs'
import path from 'node:path'

import { WHALE } from './paths.ts'
import { readJson } from './tank.ts'

export function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
  fs.renameSync(tmp, file)
}

export const CONFIG_FILE = process.env.BILI_WHALE_CONFIG || path.join(WHALE, 'bili-whale.config.json')

export function policyState(file = CONFIG_FILE): { policy: any; file: string; exists: boolean } {
  const cfg = readJson(file) ?? {}
  return { policy: readPolicyLite(cfg), file, exists: fs.existsSync(file) }
}

export function policySet(patch: any, file = CONFIG_FILE): { ok: boolean; policy?: any; error?: string } {
  if (!patch || typeof patch !== 'object') return { ok: false, error: '缺策略对象' }
  // 测试上下文里禁止写真配置：2026-11-01 01:23 正式配置出现过一次没人承认的 draftMode=auto 写入
  // （7799 免口令 + 测试能碰到生产路径）。要测就显式传临时文件，否则宁可红。
  if (file === CONFIG_FILE && process.env.NODE_TEST_CONTEXT) return { ok: false, error: '测试里必须显式传临时路径，不许写正式配置' }
  const cfg = readJson(file) ?? {}
  const next = {
    ...cfg,
    publish: { ...(cfg.publish ?? {}), ...pick(patch.publish ?? {}, ['draftMode', 'autoDailyCap', 'autoWindow']) },
    permissions: { ...(cfg.permissions ?? {}), ...pick(patch.permissions ?? {}, ['like', 'fav', 'dmReply', 'comment', 'danmaku']) },
  }
  // 读回时统一收敛（readPolicy 语义）：写进去的必须先合法
  const normalized = readPolicyLite(next)
  next.publish = { draftMode: normalized.draftMode, autoDailyCap: normalized.autoDailyCap, autoWindow: normalized.autoWindow }
  next.permissions = {
    like: normalized.like, fav: normalized.fav, dmReply: normalized.dmReply,
    comment: normalized.comment, danmaku: normalized.danmaku,
  }
  try {
    const tmp = file + '.' + process.pid + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8')
    fs.renameSync(tmp, file)
    return { ok: true, policy: normalized }
  } catch (e: any) { return { ok: false, error: String(e?.message ?? e) } }
}

const pick = (o: any, keys: string[]) => Object.fromEntries(keys.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]))

/**
 * 主人让她怎么称呼自己：只认 `owner.displayName`。
 * 不回落 `owner.name`——那字段是角色标签（现值"主人"），拿它当昵称会在下次启动时改掉她的口吻。
 * 没配就沿用代码里的默认称呼。
 */
export function ownerNameFromConfig(file = CONFIG_FILE): string {
  return String(readJson(file)?.owner?.displayName ?? '').trim()
}

/**
 * 她在这一页叫什么：来自配置 `self.name`（现值是她 B 站账号名，主人也可能只当本机称呼用）。
 * 每次渲染现读，改了不用重启就能看到标题跟着变；空/读不到时回落到默认称呼，不做二次判断。
 * 这一格只改**本机称呼**。B 站昵称是账号字段，要真改必须一次账号写操作 + 二次确认。
 */
export function personaNameFromConfig(file = CONFIG_FILE): string {
  const v = String(readJson(file)?.self?.name ?? '').trim()
  return v.slice(0, 24) || '小鱼'
}

/**
 * 宿主导航上显示的名字：读部署 config.json 的 `displayName`。
 * 与 `self.name` 是同一件事的两个落点（导航读部署，页面标题读 WhALe 配置），
 * 改名字时两处一起写，否则导航与标题会各叫各的。
 */
export function hostDisplayName(botConfigFile: string | null): string | null {
  if (!botConfigFile) return null
  const v = String(readJson(botConfigFile)?.displayName ?? '').trim()
  return v ? v.slice(0, 24) : null
}

/**
 * 改名字。本机名字（配置 self.name）与 B站昵称是两件事：本机名字影响标题与提示词，
 * B站昵称别人看得见。页面一次只改一处，由调用方说明改的是哪种。
 * `botConfigFile` 给了就同时把部署 config.json 的 `displayName` 写成同一个名字——
 * 宿主导航读的是那一处，两者不同步会出现"标题叫一个、导航叫另一个"。
 * 与 settingsSet 同一条规矩：测试里不许写正式配置。
 */
export function renameSelf(
  name: string,
  file = CONFIG_FILE,
  botConfigFile: string | null = null,
): { ok: boolean; name?: string; hostUpdated?: boolean; error?: string } {
  if (file === CONFIG_FILE && process.env.NODE_TEST_CONTEXT) return { ok: false, error: '测试里必须显式传临时路径，不许写正式配置' }
  const next = String(name ?? '').trim().slice(0, 24)
  if (!next) return { ok: false, error: '名字不能是空的：留空等于让她没有名字。' }
  const cfg = readJson(file) ?? {}
  const out = { ...cfg, self: { ...(cfg.self ?? {}), name: next } }
  try {
    writeJsonAtomic(file, out)
  } catch (e: any) { return { ok: false, error: `写不进去：${String(e?.message ?? e)}` } }
  // 部署那份写不进去不算改名失败：本机名字已经生效，但要说清导航没跟上。
  let hostUpdated = false
  if (botConfigFile) {
    try {
      writeJsonAtomic(botConfigFile, { ...(readJson(botConfigFile) ?? {}), displayName: next })
      hostUpdated = true
    } catch {}
  }
  return { ok: true, name: next, hostUpdated }
}

/** 同目录临时文件 + 改名：写一半断掉不会留下半个 JSON。 */

export function readPolicyLite(cfg: any) {
  const p = cfg?.publish ?? {}
  const t = cfg?.permissions ?? {}
  return {
    draftMode: p.draftMode === 'auto' ? 'auto' : 'review',
    autoDailyCap: Math.max(0, Number(p.autoDailyCap ?? 0) || 0),
    autoWindow: typeof p.autoWindow === 'string' ? p.autoWindow.trim() : '',
    like: t.like === 'review' ? 'review' : 'self',
    fav: t.fav === 'review' ? 'review' : 'self',
    dmReply: t.dmReply === 'queue' ? 'queue' : 'direct',
    // 2026-11-03：评论与弹幕原来没有档位（行为写死在 dsh 各命令里，页面想调都调不了）。
    // 默认 'review' = 与今天行为一致（一律进待审队列等主人放行）。
    comment: t.comment === 'self' ? 'self' : 'review',
    danmaku: t.danmaku === 'self' ? 'self' : 'review',
  }
}
