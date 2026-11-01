/**
 * 主 session 的追加记录，保存在 data/runs/<run>/transcript.jsonl。
 * session-main.jsonl 会在上下文替换时重写；本文件保留每次追加的正文，
 * 并在交接、清空和前缀重载时写入边界记录。
 */
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ContextRecord } from '../protocol/open-responses/context.ts';
import { currentAnchors } from './log-context.ts';
import { nowIso, SYSTEM_TIMEZONE } from './util.ts';

export type TranscriptBoundary = 'handoff' | 'clear' | 'prefix-reload' | 'ephemeral-drop' | 'orphan-result-drop';

export interface TranscriptItemRecord {
  kind: 'item';
  ts: string;
  run: string;
  sess?: string;
  round?: number;
  /** session 里的下标(append 时刻) */
  index: number;
  item: ContextRecord['item'];
  context: ContextRecord['context'];
}

export interface TranscriptBoundaryRecord {
  kind: 'boundary';
  ts: string;
  run: string;
  sess?: string;
  round?: number;
  event: TranscriptBoundary;
  data: Record<string, unknown>;
}

export type TranscriptRecord = TranscriptItemRecord | TranscriptBoundaryRecord;

export interface TranscriptOptions {
  run?: string;
  timezone?: string;
}

export class Transcript {
  private readonly run: string;
  private readonly timezone: string;

  constructor(private readonly file: string | null, opts: TranscriptOptions = {}) {
    this.run = opts.run ?? 'r-none';
    this.timezone = opts.timezone ?? SYSTEM_TIMEZONE;
  }

  item(record: ContextRecord, index: number): void {
    const anchors = currentAnchors();
    this.append({
      kind: 'item',
      ts: record.context.ts ?? nowIso(this.timezone),
      run: this.run,
      ...(anchors.sess !== undefined ? { sess: anchors.sess } : {}),
      ...(anchors.round !== undefined ? { round: anchors.round } : {}),
      index,
      item: record.item,
      context: record.context,
    });
  }

  boundary(event: TranscriptBoundary, data: Record<string, unknown>): void {
    const anchors = currentAnchors();
    this.append({
      kind: 'boundary',
      ts: nowIso(this.timezone),
      run: this.run,
      ...(anchors.sess !== undefined ? { sess: anchors.sess } : {}),
      ...(anchors.round !== undefined ? { round: anchors.round } : {}),
      event,
      data,
    });
  }

  private append(record: TranscriptRecord): void {
    if (!this.file) return;
    try {
      appendFileSync(this.file, `${JSON.stringify(record)}\n`, 'utf8');
    } catch {
      // 写不进去不影响运行
    }
  }
}

/**
 * ── 往回读全部对话历史（#59）─────────────────────────────────────────────
 * 为什么要它：`session-main.jsonl` 在交接/清空/前缀重载时被**整体替换**
 * （`SessionLog.reset` 写 tmp 再 rename），所以它不是账本；控制台上看到的也只是
 * 内存里那一份当前 session。真正"一条都不丢"的是各 run 的 transcript.jsonl——
 * 只追加、跨 run 全局递增、从不剪枝。但它过去**没有任何读取入口**（只有命令行
 * `scripts/logq.ts`），主人的历史记录等于不存在。
 *
 * 游标是 `run目录名#文件内行号`：run 名 `r-YYYYMMDD-HHMMSS-xxxx` 按字典序即时间序，
 * 所以"更早"就是键更小，翻页稳定、不依赖时间戳精度（同一毫秒也能分先后）。
 * 从最新的 run 往回扫，攒够 limit+1 条就停：不为了算总数把几年的盘都读一遍。
 */
export interface TranscriptPage {
  /** 旧→新，前端可直接前插。 */
  records: TranscriptRecord[];
  /** 本页最旧一条的键；下一次作为 `before` 传回来就是"再往前翻"。 */
  cursor: string | null;
  hasMore: boolean;
  scannedRuns: number;
}

const keyOf = (run: string, seq: number): string => `${run}#${String(seq).padStart(8, '0')}`;

export function readTranscriptHistory(dataDir: string, opts: { before?: string | null; limit?: number } = {}): TranscriptPage {
  const wanted = Math.round(Number(opts.limit));
  // 0/负数/NaN 一律回落默认，而不是"给 1 条"或"给 0 条"：调用方传坏值不该看到空页。
  const limit = Math.max(1, Math.min(500, Number.isFinite(wanted) && wanted > 0 ? wanted : 120));
  const before = typeof opts.before === 'string' && opts.before ? opts.before : null;
  const root = join(dataDir, 'runs');
  let runs: string[] = [];
  try {
    runs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    return { records: [], cursor: null, hasMore: false, scannedRuns: 0 };
  }
  const picked: { key: string; rec: TranscriptRecord }[] = [];
  let scannedRuns = 0;
  let overflow = false;
  let cursorAt = 0; // 已经翻过的更早 run 数（用于 hasMore）

  outer: for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i];
    const file = join(root, run, 'transcript.jsonl');
    if (!existsSync(file)) continue;
    scannedRuns++;
    let lines: string[] = [];
    try {
      lines = readFileSync(file, 'utf8').split('\n');
    } catch {
      continue; // 读不动的 run 跳过，但别让整页失败
    }
    for (let seq = lines.length - 1; seq >= 0; seq--) {
      const line = lines[seq];
      if (!line || !line.trim()) continue;
      let rec: TranscriptRecord;
      try {
        rec = JSON.parse(line) as TranscriptRecord;
      } catch {
        continue; // 半行/坏行不能把整页带走
      }
      const key = keyOf(run, seq);
      if (before && key >= before) continue;
      picked.push({ key, rec });
      if (picked.length > limit) {
        overflow = true;
        break outer;
      }
    }
    cursorAt = i;
  }

  const page = overflow ? picked.slice(0, limit) : picked;
  const hasMore = overflow || (picked.length > 0 && cursorAt > 0);
  const ordered = page.slice().reverse();
  return {
    records: ordered.map((p) => p.rec),
    cursor: ordered.length ? ordered[0].key : null,
    hasMore,
    scannedRuns,
  };
}
