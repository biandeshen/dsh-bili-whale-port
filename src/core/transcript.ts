/**
 * 主 session 的追加记录，保存在 data/runs/<run>/transcript.jsonl。
 * session-main.jsonl 会在上下文替换时重写；本文件保留每次追加的正文，
 * 并在交接、清空和前缀重载时写入边界记录。
 */
import { appendFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { itemText, type ContextRecord } from '../protocol/open-responses/context.ts';
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

// ── 检索（#67）：跨 run、按日期、按关键词 ──────────────────────────────────
/**
 * 分页回答"最近的对话是什么"，检索回答"某天/某句话在哪"。两者读同一份账本，
 * 但取法不同：分页从最新往回攒够一页就停；检索必须先知道哪些 run 落在目标日期内，
 * 再在范围内做子串匹配——否则为了查一周前的一句话要把后面几十个 run 全读完。
 *
 * 日期以 run 目录名里的 `YYYYMMDD` 为准（`r-20261101-…`），不用记录里的 ts：
 * 交接、前缀重载这类边界记录写的时刻可能跨到第二天凌晨，按 ts 归日会把它算错一天。
 */
export interface TranscriptSearchOptions {
  /** `YYYY-MM-DD`；给了就只扫这一天的 run。 */
  date?: string | null;
  /** 不区分大小写的子串；空/缺省 = 不限（只按日期与游标翻页）。 */
  query?: string | null;
  /** 角色/类型过滤：只看她说的话、只看主人的话，或只看工具调用。 */
  role?: 'user' | 'assistant' | 'tool' | null;
  /** 从哪条更早的键接着往前找（上一次返回的 cursor）。 */
  before?: string | null;
  limit?: number;
}

export interface TranscriptHit {
  key: string;
  run: string;
  ts: string;
  /** 人看得懂的角色标签。 */
  role: 'user' | 'assistant' | 'tool' | 'reasoning' | 'other';
  /** 命中所在的整段文字，按关键词前后截一段。 */
  excerpt: string;
  /** 工具调用/回执的名字，其它角色为 null。 */
  tool?: string | null;
}

export interface TranscriptSearchPage {
  hits: TranscriptHit[];
  cursor: string | null;
  hasMore: boolean;
  scannedRuns: number;
  /** 目标日期内实际存在的 run 数（给了 date 才有意义）。 */
  matchingRuns: number;
}

/** `r-20261101-125921-dc5f` → `2026-11-01`；认不出形状的 run 返回 null。 */
export function runDate(run: string): string | null {
  const m = /^r-(\d{4})(\d{2})(\d{2})-/.exec(run);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

function roleOf(rec: TranscriptRecord): TranscriptHit['role'] {
  if (rec.kind === 'boundary') return 'other';
  const item = rec.item;
  if (item.type === 'message') return item.role === 'assistant' ? 'assistant' : 'user';
  if (item.type === 'function_call' || item.type === 'function_call_output') return 'tool';
  if (item.type === 'reasoning') return 'reasoning';
  return 'other';
}

function textOfRecord(rec: TranscriptRecord): string {
  if (rec.kind === 'boundary') return `${rec.event} ${JSON.stringify(rec.data ?? {})}`;
  const item = rec.item;
  if (item.type === 'function_call') return `${item.name} ${item.arguments ?? ''}`;
  return itemText(item);
}

/** 命中位置前后各留一点上下文，别把整段 12k 的工具回执塞进检索结果。 */
function excerptOf(text: string, query: string | null, span = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!query) return flat.slice(0, span * 2);
  const at = flat.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return flat.slice(0, span);
  const from = Math.max(0, at - span);
  return `${from > 0 ? '…' : ''}${flat.slice(from, at + query.length + span)}${at + query.length + span < flat.length ? '…' : ''}`
    .trim();
}

export function searchTranscript(dataDir: string, opts: TranscriptSearchOptions = {}): TranscriptSearchPage {
  const want = Math.round(Number(opts.limit));
  const limit = Math.max(1, Math.min(200, Number.isFinite(want) && want > 0 ? want : 40));
  const query = typeof opts.query === 'string' && opts.query.trim() ? opts.query.trim() : null;
  const date = typeof opts.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(opts.date) ? opts.date : null;
  const role = opts.role ?? null;
  const before = typeof opts.before === 'string' && opts.before ? opts.before : null;
  const root = join(dataDir, 'runs');

  let runs: string[] = [];
  try {
    runs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch {
    return { hits: [], cursor: null, hasMore: false, scannedRuns: 0, matchingRuns: 0 };
  }
  if (date) runs = runs.filter((run) => runDate(run) === date);

  const hits: TranscriptHit[] = [];
  let scannedRuns = 0;
  let overflow = false;
  let cursorAt = 0;

  outer: for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i];
    const file = join(root, run, 'transcript.jsonl');
    if (!existsSync(file)) continue;
    scannedRuns++;
    let lines: string[];
    try {
      lines = readFileSync(file, 'utf8').split('\n');
    } catch {
      continue;
    }
    for (let seq = lines.length - 1; seq >= 0; seq--) {
      const line = lines[seq];
      if (!line || !line.trim()) continue;
      let rec: TranscriptRecord;
      try {
        rec = JSON.parse(line) as TranscriptRecord;
      } catch {
        continue;
      }
      const key = keyOf(run, seq);
      if (before && key >= before) continue;
      const recRole = roleOf(rec);
      if (role && recRole !== role) continue;
      const body = textOfRecord(rec);
      if (query && !body.toLowerCase().includes(query.toLowerCase())) continue;
      hits.push({
        key, run, ts: rec.ts, role: recRole,
        excerpt: excerptOf(body, query),
        tool: rec.kind === 'item' && rec.item.type === 'function_call' ? rec.item.name : null,
      });
      if (hits.length > limit) { overflow = true; break outer; }
    }
    cursorAt = i;
  }

  const page = overflow ? hits.slice(0, limit) : hits;
  return {
    hits: page,
    cursor: page.length ? page[page.length - 1].key : null,
    hasMore: overflow || (hits.length > 0 && cursorAt > 0),
    scannedRuns,
    matchingRuns: runs.length,
  };
}
