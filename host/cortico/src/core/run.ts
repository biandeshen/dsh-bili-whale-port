/**
 * 一次进程运行对应一个 run，运行日志保存在 data/runs/<run>/。
 * index.jsonl 在启动与正常关机时各追加一行；暂停沿用 run，重启创建新 run。
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { nowIso, readTextFile } from './util.ts';
import { retryBusy } from './fs-busy.ts';

export interface RunInfo {
  id: string;
  dir: string;
  runsDir: string;
  startedAt: string;
  previousRun: string | null;
  /** 开机那行没写进 index.jsonl 的原因;index 只是索引，缺一行不影响运行。 */
  indexError?: string;
}

export interface RunOpenMeta {
  timezone: string;
  bot: string;
  repoRoot?: string;
}

export interface RunCloseSummary {
  endedAt: string;
  lastCursor: number;
  /** 关机步骤是否全部完成。 */
  complete: boolean | null;
  reason: string;
}

const RUN_ID = /^r-\d{8}-\d{6}-[0-9a-f]{4}$/;

export function runsDirOf(dataDir: string): string {
  return join(dataDir, 'runs');
}

/**
 * 已存在的 run id,按字典序。id 里是写入时区的墙钟时间,换过时区或跨夏令时后
 * 字典序不等于时间序;要时间序看 index.jsonl 的行序或事件游标。
 */
export function listRuns(dataDir: string): string[] {
  const dir = runsDirOf(dataDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => RUN_ID.test(name)).sort();
}

/**
 * 启动时记下"这一轮跑的是哪份代码"。
 *
 * 为什么之前一直是 null（2026-11-07 查到根因）：这里原先只认 `.git` 是**目录**的常规检出。
 * 而线上这台是 **linked worktree** —— `Cortico-up/.git` 是一个
 * `gitdir: E:/…/Cortico/.git/worktrees/Cortico-up` 指针文件，于是 `readTextFile(.git/HEAD)`
 * 每次抛错、被 catch 静吞，`runs/index.jsonl` 95 条 `gitSha` **100% 为 null**：
 * 任何一次故障都回溯不到当时跑的是哪份构建。家目录分叉能骗过只读评审，这是同一件事的另一半。
 *
 * 现在两种都认：`.git` 目录（常规）与 `gitdir:` 指针（worktree，HEAD 在指针指向的目录里）。
 * 仍然不联网、不起子进程，只读两个小文件；拿不到就照旧返回 null（不编一个看起来像的 sha）。
 */
export function gitSha(repoRoot: string | undefined): string | null {
  if (!repoRoot) return null;
  try {
    const dotGit = join(repoRoot, '.git');
    let gitDir = dotGit;
    if (statSyncSafe(dotGit)?.isFile()) {
      // worktree / submodule：`.git` 是 `gitdir: <路径>` 指针，路径可能是相对的
      const pointed = readTextFile(dotGit).trim().match(/^gitdir:\s*(.+)$/i)?.[1]?.trim();
      if (!pointed) return null;
      gitDir = isAbsolute(pointed) ? pointed : resolve(repoRoot, pointed);
    }
    const head = readTextFile(join(gitDir, 'HEAD')).trim();
    if (!head.startsWith('ref:')) return head.slice(0, 12); // 游离 HEAD（detached）
    const ref = head.slice(4).trim();
    // worktree 的分支通常存在**公共 gitdir** 里（loose 或 packed 两种都可能），
    // 而不在 worktree 自己的目录下——上面那句 resolve(gitDir, ref) 因此常常落空。
    // 刚才第一版修法就栽在这：只补了 packed-refs，实测仍返回 null。
    const candidates = [gitDir, resolve(gitDir, '..'), resolve(gitDir, '..', '..')]
    for (const dir of candidates) {
      const loose = resolve(dir, ref)
      if (existsSync(loose)) return readTextFile(loose).trim().slice(0, 12);
      const packed = join(dir, 'packed-refs');
      if (!existsSync(packed)) continue;
      for (const line of readTextFile(packed).split('\n')) {
        if (line.startsWith('#') || line.startsWith('^')) continue;
        const [sha, name] = line.trim().split(' ');
        if (name === ref && sha) return sha.slice(0, 12);
      }
    }
  } catch {
    // 不在 git 仓库里就不记；但**别再因为"是 worktree"而不记**
  }
  return null;
}

/** stat 但不抛（`.git` 可能不存在或无权限）。 */
function statSyncSafe(p: string) {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}

/** index.jsonl 按开机、关机的先后追加,最后一行属于最近一次 run。 */
function lastIndexedRun(runsDir: string): string | null {
  const file = join(runsDir, 'index.jsonl');
  if (!existsSync(file)) return null;
  const lines = retryBusy(() => readTextFile(file)).split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    try {
      const row = JSON.parse(lines[i]) as { run?: unknown };
      if (typeof row.run === 'string') return row.run;
    } catch {
      // 进程在追加中途结束会留下半行
    }
  }
  return null;
}

/** 生成 run id、建目录、在 index.jsonl 记一行开机。 */
export function openRun(dataDir: string, meta: RunOpenMeta): RunInfo {
  const runsDir = runsDirOf(dataDir);
  mkdirSync(runsDir, { recursive: true });
  const previousRun = lastIndexedRun(runsDir) ?? listRuns(dataDir).at(-1) ?? null;
  const startedAt = nowIso(meta.timezone);
  const stamp = startedAt.slice(0, 19).replace(/[-:T]/g, '');
  const id = `r-${stamp.slice(0, 8)}-${stamp.slice(8, 14)}-${randomBytes(2).toString('hex')}`;
  const dir = join(runsDir, id);
  mkdirSync(dir, { recursive: true });
  const indexError = appendIndex(runsDir, {
    run: id,
    startedAt,
    bot: meta.bot,
    pid: process.pid,
    gitSha: gitSha(meta.repoRoot),
    previousRun,
  });
  return { id, dir, runsDir, startedAt, previousRun, ...(indexError ? { indexError } : {}) };
}

/** 追加关机记录，写不进时返回原因；进程异常结束时可能没有该行，查询方需从已有记录推算结束时间。 */
export function closeRun(run: RunInfo, summary: RunCloseSummary): string | undefined {
  return appendIndex(run.runsDir, { run: run.id, ...summary });
}

/** 文件被别的程序占着时按 retryBusy 退避，仍写不进就返回原因，不抛出。 */
function appendIndex(runsDir: string, line: Record<string, unknown>): string | undefined {
  try {
    retryBusy(() => appendFileSync(join(runsDir, 'index.jsonl'), JSON.stringify(line) + '\n', 'utf8'));
    return undefined;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** run.json 保存本次运行的 World 清单与配置指纹。 */
export function writeRunJson(run: RunInfo, data: Record<string, unknown>): void {
  writeFileSync(join(run.dir, 'run.json'), JSON.stringify({ run: run.id, startedAt: run.startedAt, previousRun: run.previousRun, ...data }, null, 2), 'utf8');
}
