/**
 * 三队列只读合并（M1a）：动态草稿 + 私信回信草稿 +（调用方自己拿的 go-gate）。
 *
 * 动机：三条待审队列分散在三个地方，面板只显示 go-gate 那条 ——
 * 主人在面板上看到“队列是空的 ✓”，实际上压着 3 条动态稿（2026-10-30 实测）。
 *
 * 约定：
 *   · 只读：本模块零写入、零审批、零发布；
 *   · 不暴露 token（M1e 不变量）：放行动态/回信必须走 CLI，token 用 `list --show-token <id>` 看；
 *   · 目录解析统一走 paths.draftsDir()（M1a 收口）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { draftsDir } from '../tools/lib/paths.mjs'

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }

/** 还需要主人表态的状态（dry-run 只是试发，不算用掉审批）。 */
export const NEEDS = new Set(['pending', 'failed', 'cooldown', 'dry-run'])

/**
 * @param {object} opts
 * @param {string} opts.whaleHome   whale home（动态回信草稿库 control/ 在它下面）
 * @param {string} [opts.draftsDirPath] 动态稿目录（缺省走 paths.draftsDir()，测试可注入）
 * @param {number} [opts.limit]     每类最多返回几条（最新在前）
 */
export function collectDrafts({ whaleHome, draftsDirPath, limit = 10 } = {}) {
  const dir = draftsDirPath ?? draftsDir()

  // ① 动态稿：<draftsDir>/<date>.json
  const dynamic = []
  try {
    const files = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse()
    for (const f of files.slice(0, Math.max(1, limit))) {
      const d = readJson(path.join(dir, f))
      if (!d?.id) continue
      dynamic.push({
        queue: '动态',
        id: d.id, date: d.date ?? f.replace('.json', ''),
        status: d.status ?? 'unknown',
        text: String(d.text ?? '').slice(0, 400),
        image: d.image ? path.basename(d.image) : '',
        createdAt: d.createdAt ?? null,
      })
    }
  } catch { /* 目录不存在 = 还没出过稿，不是错误 */ }

  // ② 私信回信：<whaleHome>/bili-whale/control/dm-drafts.json
  const dm = []
  const db = readJson(path.join(whaleHome, 'bili-whale', 'control', 'dm-drafts.json'))
  for (const d of (db?.items ?? []).slice(-Math.max(1, limit)).reverse()) {
    dm.push({
      queue: '回信',
      id: d.id, date: d.at ? String(d.at).slice(0, 10) : '',
      status: d.status ?? 'unknown',
      text: String(d.text ?? '').slice(0, 400),
      who: d.who ?? '',
      createdAt: d.at ?? null,
    })
  }

  const needs = dynamic.filter((x) => NEEDS.has(x.status)).length + dm.filter((x) => NEEDS.has(x.status)).length
  return { ok: true, dynamic, dm, needs, total: dynamic.length + dm.length, draftsDir: dir }
}
