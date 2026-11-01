/**
 * 控制台的历史记录（#59）。
 *
 * 为什么单独有它：时间线画的是**当前 session** 那份内存数组，交接/清空会整体替换它，
 * 所以"之前的聊天"在页面上就没了——可全量记录其实一直在盘上（各 run 的
 * transcript.jsonl，只追加、从不剪枝），缺的只是读它的接口和界面。
 * 这里不碰时间线（它的 append 按下标对齐，前插会打乱），只做一件事：
 * 往回翻页读 `/api/session/history`，把历史按 旧→新 列出来，边界标出"交接/清空"。
 */
import type { WebUi } from '../../../shared/client-panel.ts';
import { get } from '../../core/api.ts';
import { S } from './strings.ts';

const why = (err: unknown): string => (err instanceof Error ? err.message : String(err));

interface HistoryItem {
  kind: 'item' | 'boundary';
  ts?: string;
  run?: string;
  sess?: string;
  round?: number;
  item?: { type?: string; role?: string; content?: unknown };
  event?: string;
  data?: Record<string, unknown>;
}

interface HistoryPage {
  records: HistoryItem[];
  cursor: string | null;
  hasMore: boolean;
  scannedRuns: number;
}

/** message 的 content 是分段数组；别的类型（function_call 等）退化成一行摘要。 */
function describe(rec: HistoryItem): string {
  const item = rec.item ?? {};
  const parts = Array.isArray(item.content) ? item.content : [];
  const text = parts
    .map((p: any) => (typeof p?.text === 'string' ? p.text : typeof p?.input === 'string' ? p.input : ''))
    .filter(Boolean)
    .join(' ');
  if (text) return `${item.role ?? '?'}: ${text}`;
  return `${item.type ?? 'item'}${item.role ? `(${item.role})` : ''}`;
}

function when(rec: HistoryItem): string {
  const ts = typeof rec.ts === 'string' ? rec.ts : '';
  return ts ? ts.replace('T', ' ').slice(0, 16) : '';
}

const BOUNDARY_LABEL: Record<string, string> = {
  handoff: S.historyBoundaryHandoff,
  clear: S.historyBoundaryClear,
  'prefix-reload': S.historyBoundaryPrefix,
  'ephemeral-drop': S.historyBoundaryEphemeral,
  'orphan-result-drop': S.historyBoundaryOrphan,
};

export function createHistoryView(ui: WebUi, signal: AbortSignal): HTMLElement {
  const list = ui.h('div', 'live-history-list');
  const status = ui.h('div', 'live-history-status');
  const more = ui.button(S.historyLoadEarlier, { size: 'sm' });
  const sum = ui.h('summary', 'live-history-title', S.historyTitle);
  sum.title = S.historyHint;
  const box = ui.h('details', 'live-history');
  box.append(sum, status, list, more);

  let cursor: string | null | undefined;
  let loading = false;
  let firstDone = false;

  const say = (text: string, bad = false): void => {
    status.textContent = text;
    status.className = 'live-history-status' + (bad ? ' bad' : '');
  };

  async function load(before: string | null): Promise<void> {
    if (loading) return;
    loading = true;
    more.disabled = true;
    try {
      const query = before ? `?before=${encodeURIComponent(before)}&limit=80` : '?limit=80';
      const page = await get<HistoryPage>('/api/session/history' + query, { signal });
      const rows = (page.records ?? []).map((rec) => {
        const row = ui.h('div', rec.kind === 'boundary' ? 'live-history-boundary' : 'live-history-row');
        row.textContent = rec.kind === 'boundary'
          ? `— ${(rec.event && BOUNDARY_LABEL[rec.event]) || rec.event || S.historyBoundaryUnknown} · ${when(rec)} —`
          : `${when(rec)}  ${describe(rec)}`;
        return row;
      });
      // 往前翻的页更早，接在已列内容前面；首页直接铺满
      if (before) list.prepend(...rows);
      else list.replaceChildren(...rows);
      cursor = page.hasMore ? page.cursor : null;
      more.disabled = cursor === null;
      if (!firstDone) {
        firstDone = true;
        say((page.records ?? []).length ? S.historyLoaded((page.records ?? []).length) : S.historyEmpty);
      } else {
        say(S.historyLoaded((page.records ?? []).length));
      }
      if (cursor === null) say(firstDone ? S.historyEnd : S.historyEmpty);
    } catch (err) {
      if (!signal.aborted) say(S.historyFailed(why(err)), true);
      more.disabled = false;
    } finally {
      loading = false;
    }
  }

  const open = (): void => {
    if (firstDone || loading) return;
    void load(null);
  };
  more.addEventListener('click', () => {
    if (cursor) void load(cursor);
  }, { signal });
  // 展开才拉第一页：控制台每次都挂载，历史不该每次都来一遍全量读取
  box.addEventListener('toggle', () => {
    if (box.open) open();
  }, { signal });

  return box;
}
