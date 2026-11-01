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

function when(rec: Pick<HistoryItem, 'ts'>): string {
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

/** 检索一次：日期 + 关键词 + 角色，返回命中片段（跨 run）。 */
interface SearchHit {
  key: string;
  run: string;
  ts: string;
  role: 'user' | 'assistant' | 'tool' | 'reasoning' | 'other';
  excerpt: string;
  tool?: string | null;
}
interface SearchPage {
  hits: SearchHit[];
  cursor: string | null;
  hasMore: boolean;
  scannedRuns: number;
  matchingRuns: number;
}

const ROLE_LABEL: Record<SearchHit['role'], string> = {
  user: S.historyRoleUser,
  assistant: S.historyRoleAssistant,
  tool: S.historyRoleTool,
  reasoning: S.historyRoleReasoning,
  other: S.historyRoleOther,
};

export function createHistoryView(ui: WebUi, signal: AbortSignal): HTMLElement {
  const list = ui.h('div', 'live-history-list');
  const status = ui.h('div', 'live-history-status');
  const more = ui.button(S.historyLoadEarlier, { size: 'sm' });
  const sum = ui.h('summary', 'live-history-title', S.historyTitle);
  sum.title = S.historyHint;
  const box = ui.h('details', 'live-history');

  // ── 检索（#67）：分页只回答"最近说了什么"，找到"某天那句话"要靠这里 ──────────
  const dateInput = ui.input({ type: 'date' });
  dateInput.setAttribute('aria-label', S.historySearchDate);
  const queryInput = ui.input({ placeholder: S.historySearchPlaceholder });
  queryInput.setAttribute('aria-label', S.historySearchQuery);
  const roleSelect = ui.select({
    value: '',
    options: [
      { value: '', label: S.historyRoleAny },
      { value: 'user', label: S.historyRoleUser },
      { value: 'assistant', label: S.historyRoleAssistant },
      { value: 'tool', label: S.historyRoleTool },
    ],
  });
  roleSelect.setAttribute('aria-label', S.historySearchRole);
  const searchBtn = ui.button(S.historySearch, { size: 'sm', variant: 'primary' });
  const clearBtn = ui.button(S.historySearchClear, { size: 'sm' });
  const bar = ui.rowbar();
  bar.append(dateInput, queryInput, roleSelect, searchBtn, clearBtn);
  const searchBox = ui.h('div', 'live-history-search');
  searchBox.append(ui.field(S.historySearchDate, dateInput), ui.field(S.historySearchQuery, queryInput), bar);

  box.append(sum, searchBox, status, list, more);

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

  // ── 检索：换一套请求与渲染，但共用同一个列表与"加载更早"按钮的位子 ──────────
  let searching = false;
  let searchCursor: string | null = null;
  const searchParams = (before: string | null): string => {
    const params = new URLSearchParams();
    if (dateInput.value) params.set('date', dateInput.value);
    if (queryInput.value.trim()) params.set('q', queryInput.value.trim());
    if (roleSelect.value) params.set('role', roleSelect.value);
    if (before) params.set('before', before);
    params.set('limit', '40');
    return params.toString();
  };

  async function runSearch(before: string | null): Promise<void> {
    if (loading) return;
    loading = true;
    more.disabled = true;
    try {
      const page = await get<SearchPage>('/api/session/history/search?' + searchParams(before), { signal });
      const hits = page.hits ?? [];
      const rows = hits.map((hit) => {
        const row = ui.h('div', 'live-history-row');
        const head = ui.h('span', 'live-history-hit-head',
          `${when({ ts: hit.ts })}  ${ROLE_LABEL[hit.role] ?? hit.role}${hit.tool ? ` · ${hit.tool}` : ''}`);
        const body = ui.h('span', 'live-history-hit-body', hit.excerpt);
        row.append(head, body);
        return row;
      });
      if (before) list.prepend(...rows);
      else list.replaceChildren(...rows);
      searchCursor = page.hasMore ? page.cursor : null;
      more.disabled = searchCursor === null;
      if (!hits.length) say(S.historySearchEmpty(page.matchingRuns ?? 0));
      else say(S.historySearchHits(hits.length, page.matchingRuns ?? 0));
    } catch (err) {
      if (!signal.aborted) say(S.historyFailed(why(err)), true);
      more.disabled = false;
    } finally {
      loading = false;
    }
  }

  const doSearch = (): void => {
    searching = true;
    firstDone = true; // 检索和分页共用一块列表，别让 toggle 再拉一次分页把它冲掉
    void runSearch(null);
  };
  searchBtn.addEventListener('click', doSearch, { signal });
  queryInput.addEventListener('keydown', (ev) => {
    if ((ev as KeyboardEvent).key === 'Enter') doSearch();
  }, { signal });
  clearBtn.addEventListener('click', () => {
    dateInput.value = '';
    queryInput.value = '';
    roleSelect.value = '';
    searching = false;
    firstDone = false;
    cursor = undefined;
    void load(null);
  }, { signal });

  const open = (): void => {
    if (firstDone || loading) return;
    void load(null);
  };
  more.addEventListener('click', () => {
    if (searching) { if (searchCursor) void runSearch(searchCursor); return; }
    if (cursor) void load(cursor);
  }, { signal });
  // 展开才拉第一页：控制台每次都挂载，历史不该每次都来一遍全量读取
  box.addEventListener('toggle', () => {
    if (box.open) open();
  }, { signal });

  return box;
}
