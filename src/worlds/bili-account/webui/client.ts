/**
 * 小鱼 · 鱼缸 —— WebUI 世界页（`world:bili-account`）的浏览器面板。
 *
 * 2026-10-31 功能聚合：独立面板（dsh `panel/` 8447）的时间线/审批/意见箱/体征/日记
 * 全部搬进这一页，与聊天同入口同主题。服务端数据面见 `../definition.ts` 的 `webUi()`
 * 与 `../tank.ts`；本文件只画图与发请求，不带业务规则。
 */
import type { WebUiClientBundle, WebUiPanelContext } from '../../../web/shared/client-panel.ts';

const POLL_MS = 20_000;

// ── 服务端载荷（与 tank.ts / panel 模块同形状；浏览器端自声明，不 import Node 模块） ──
interface TankState {
  ok: boolean;
  error?: string;
  fields?: Record<string, number>;
  mood?: { primary: string; secondary: string | null; cause: string | null };
  described?: string;
  lastAppliedAt?: string | null;
}
interface DraftItem { queue?: string; id: string; date?: string; status: string; text?: string; image?: string }
interface DraftsState { ok?: boolean; error?: string; dynamic?: DraftItem[]; dm?: DraftItem[]; needs?: number; total?: number }
interface TimelineEntry { at?: string | null; kind?: string; note?: string; heading?: string; chars?: number; bvid?: string; result?: string }
interface TimelineState { ok?: boolean; error?: string; items?: TimelineEntry[]; next?: number | null; total?: number }
interface DiaryBook { bytes?: number; updatedAt?: string; text?: string }
interface DiaryState { ok?: boolean; owner?: DiaryBook | null; private?: DiaryBook | null }
interface FeedbackItem { id: string; at?: string; day?: string; issue: string; severity: 'high' | 'low'; selfHandled?: boolean; note?: string; resolved: boolean; resolvedBy?: string | null }
interface FeedbackState { ok?: boolean; error?: string; items?: FeedbackItem[] }
interface VitalsState {
  ok?: boolean; today?: string; shares?: number; commentsToday?: number;
  scheduler?: { ok?: boolean; reason?: string };
  pendingCount?: number;
  traffic?: { pausedUntil?: string | number | null; streak?: number; remaining?: Record<string, number> | null; settings?: Record<string, number> };
}

const FIELDS: Array<{ key: string; zh: string }> = [
  { key: 'energy', zh: '体力' },
  { key: 'stimulation', zh: '刺激' },
  { key: 'connection', zh: '想念' },
  { key: 'social', zh: '社交' },
  { key: 'curiosity', zh: '好奇' },
  { key: 'creativity', zh: '创作' },
];

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// ── 鱼缸：头像 + 心情 + 六条场值 ────────────────────────────────────────────
function mountTank(ctx: WebUiPanelContext): void {
  const { ui, root } = ctx;
  const card = ui.sheet({ title: '鱼缸', en: 'tank', desc: '她的场值、心情与头像' });
  root.appendChild(card.el);
  const err = ui.msgline();
  const hero = ui.h('div', 'tank-hero');
  const avatar = ui.h('div', 'tank-avatar', '🐟');
  const moodBox = ui.h('div', 'tank-mood');
  const moodMain = ui.h('div', 'tank-mood-main', '…');
  const moodCause = ui.h('div', 'tank-mood-cause');
  moodBox.append(moodMain, moodCause);
  hero.append(avatar, moodBox);
  const gauges = ui.h('div', 'tank-gauges');
  const bars = FIELDS.map((f) => {
    const p = ui.progress({ label: f.zh, value: 0 });
    gauges.append(p.el);
    return p;
  });
  const described = ui.h('div', 'tank-described');
  card.body.append(err, hero, gauges, described);

  void ctx.invokeBinary('avatar')
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      const img = ui.h('img', 'tank-avatar-img');
      img.src = url;
      img.alt = '头像';
      img.addEventListener('load', () => avatar.replaceChildren(img), { signal: ctx.signal });
      ctx.own({ dispose: () => URL.revokeObjectURL(url) });
    })
    .catch(() => { /* 没放头像就保留 🐟 */ });

  const draw = (st: TankState): void => {
    err.hidden = true;
    if (!st?.ok || !st.fields) {
      err.textContent = '状态读不到：' + (st?.error ?? 'fields.json 缺失');
      err.className = 'msgline bad';
      err.hidden = false;
      return;
    }
    moodMain.textContent = st.mood?.primary ?? '—';
    moodCause.textContent = st.mood?.cause ? `因为「${st.mood.cause}」` : '';
    FIELDS.forEach((f, i) => bars[i].setValue(Math.max(0, Math.min(1, Number(st.fields?.[f.key] ?? 0))), 1));
    described.textContent = st.described ?? '';
  };
  const poll = (): void => { void ctx.invoke<TankState>('state').then(draw).catch((e) => { err.textContent = errText(e); err.hidden = false; }); };
  poll();
  ctx.interval(poll, POLL_MS);
}

// ── 待审稿：放行 / 拒掉 ─────────────────────────────────────────────────────
function mountDrafts(ctx: WebUiPanelContext): void {
  const { ui, root } = ctx;
  const card = ui.sheet({ title: '待审稿', en: 'drafts', desc: '放行后直接发布到 B 站动态；拒掉她会收到反馈' });
  root.appendChild(card.el);
  const err = ui.msgline();
  const list = ui.h('div', 'draft-list');
  const meta = ui.h('div', 'sh-desc');
  card.body.append(err, meta, list);

  const draw = (st: DraftsState): void => {
    err.hidden = true;
    if (st?.error || st?.ok === false) {
      err.textContent = '草稿队列读不到：' + (st?.error ?? '未知');
      err.hidden = false;
      return;
    }
    const items = st?.dynamic ?? [];
    meta.textContent = items.length || st?.needs
      ? `需要处理 ${st?.needs ?? items.length} 条 · 队列共 ${st?.total ?? items.length} 条`
      : '队列是空的';
    list.replaceChildren();
    if (!items.length) {
      list.append(ui.placeholder('没有等放行的草稿——她没出稿，或者都处理完了'));
      return;
    }
    for (const d of items) {
      const row = ui.h('div', 'draft-card');
      const head = ui.h('div', 'draft-head');
      head.append(
        ui.h('span', 'draft-date', d.date ?? ''),
        ui.pill(d.status, d.status === 'pending' ? 'on' : d.status === 'failed' || d.status === 'cooldown' ? 'off' : 'plain'),
      );
      const body = ui.h('div', 'draft-text', String(d.text ?? '').replace(/\s+/g, ' '));
      const acts = ui.actions();
      const done = (ok: boolean, msg: string): void => {
        ui.toast(msg, ok ? 'ok' : 'bad');
        poll();
      };
      const btnOk = ui.button('✓ 放行发布', {
        variant: 'primary', size: 'sm',
        onClick: () => {
          void ui.confirm({ title: '放行并发布这条动态？', body: String(d.text ?? '').slice(0, 200), danger: true })
            .then((yes) => { if (!yes) return;
              void ctx.invoke<{ ok?: boolean; error?: string; dynId?: string | null }>('approve', [d.id])
                .then((r) => done(!!r?.ok, r?.ok ? `已发布 dyn_id=${r.dynId ?? '?'}` : r?.error ?? '放行失败'))
                .catch((e) => done(false, errText(e)));
            });
        },
      });
      const btnNo = ui.button('✗ 拒掉', {
        variant: 'danger', size: 'sm',
        onClick: () => {
          void ui.confirm({ title: '拒掉这条？', body: '她会收到 draftRejected，理由需要你在日记/私信里另说。', danger: true })
            .then((yes) => { if (!yes) return;
              void ctx.invoke<{ ok?: boolean; error?: string }>('reject', [d.id])
                .then((r) => done(!!r?.ok, r?.ok ? '已拒掉' : r?.error ?? '拒不掉'))
                .catch((e) => done(false, errText(e)));
            });
        },
      });
      if (d.status !== 'pending' && d.status !== 'failed' && d.status !== 'cooldown') {
        btnOk.disabled = true; btnNo.disabled = true;
      }
      acts.append(btnOk, btnNo);
      row.append(head, body, acts);
      list.append(row);
    }
  };
  const poll = (): void => { void ctx.invoke<DraftsState>('state').then(draw).catch((e) => { err.textContent = errText(e); err.hidden = false; }); };
  poll();
  ctx.interval(poll, POLL_MS);
}

// ── 她的一天：因果链 ────────────────────────────────────────────────────────
function mountTimeline(ctx: WebUiPanelContext): void {
  const { ui, root } = ctx;
  const card = ui.sheet({ title: '她的一天', en: 'timeline', desc: '因果链事件，只读；最新在前' });
  root.appendChild(card.el);
  const err = ui.msgline();
  const table = ui.table({ head: ['时间', '事件', '内容'] });
  const count = ui.h('div', 'sh-desc');
  const btn = ui.button('刷新', { size: 'sm', onClick: () => poll() });
  const bar = ui.rowbar(); bar.append(ui.h('span', 'grow'), btn);
  card.body.append(err, count, table.el, bar);

  const draw = (st: TimelineState): void => {
    err.hidden = true;
    if (st?.ok === false) { err.textContent = '时间线读不到：' + (st?.error ?? ''); err.hidden = false; return; }
    const items = st?.items ?? [];
    table.clear(items.length ? undefined : '还没有事件');
    for (const e of items) {
      const t = e.at ? new Date(e.at) : null;
      const hhmm = t ? `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` : '—';
      const content = e.note ?? e.heading ?? e.bvid ?? e.result ?? '';
      table.addRow([hhmm, String(e.kind ?? ''), String(content).slice(0, 90)]);
    }
    count.textContent = `共 ${st?.total ?? 0} 条`;
  };
  const poll = (): void => { void ctx.invoke<TimelineState>('state', [0, 50]).then(draw).catch((e) => { err.textContent = errText(e); err.hidden = false; }); };
  poll();
  ctx.interval(poll, POLL_MS);
}

// ── 日记：两本 ──────────────────────────────────────────────────────────────
function mountDiary(ctx: WebUiPanelContext): void {
  const { ui, root } = ctx;
  const card = ui.sheet({ title: '日记', en: 'diary', desc: '公开（给人看）与私人（偏好校准）' });
  root.appendChild(card.el);
  const err = ui.msgline();
  const mk = (title: string) => {
    const s = ui.section(title);
    const pre = ui.h('pre', 'diary-pre');
    return { s, pre };
  };
  const pub = mk('公开日记');
  const priv = mk('私人日记');
  card.body.append(err, pub.s, pub.pre, priv.s, priv.pre);

  const draw = (st: DiaryState): void => {
    err.hidden = true;
    const show = (b: DiaryBook | null | undefined, el: HTMLPreElement, empty: string): void => {
      if (!b?.text) { el.textContent = empty; return; }
      const at = b.updatedAt ? `（更新于 ${new Date(b.updatedAt).toLocaleString('zh-CN')}）` : '';
      el.textContent = b.text + '\n' + at;
    };
    show(st?.owner, pub.pre, '还没有公开日记');
    show(st?.private, priv.pre, '还没有私人日记');
  };
  const poll = (): void => { void ctx.invoke<DiaryState>('state').then(draw).catch((e) => { err.textContent = errText(e); err.hidden = false; }); };
  poll();
  ctx.interval(poll, POLL_MS * 2);
}

// ── 意见箱 ──────────────────────────────────────────────────────────────────
function mountFeedback(ctx: WebUiPanelContext): void {
  const { ui, root } = ctx;
  const card = ui.sheet({ title: '意见箱', en: 'issues', desc: '她报的问题；resolve = 已处理' });
  root.appendChild(card.el);
  const err = ui.msgline();
  const list = ui.h('div', 'fb-list');
  card.body.append(err, list);

  const draw = (st: FeedbackState): void => {
    err.hidden = true;
    if (st?.ok === false) { err.textContent = '意见箱读不到：' + (st?.error ?? ''); err.hidden = false; return; }
    list.replaceChildren();
    const items = st?.items ?? [];
    if (!items.length) { list.append(ui.placeholder('她还没报过问题（或者都清空了）')); return; }
    for (const it of [...items].reverse()) {
      const row = ui.h('div', 'fb-row');
      const text = ui.h('div', 'fb-issue');
      text.append(
        ui.pill(it.severity === 'high' ? 'high' : 'low', it.severity === 'high' ? 'off' : 'plain'),
        ui.h('span', '', ' ' + it.issue),
      );
      const meta = ui.h('div', 'fb-meta', [it.day ?? (it.at ?? '').slice(0, 10), it.selfHandled ? '· 她已绕开' : '', it.resolved ? `· 已解决（${it.resolvedBy ?? '?'}）` : ''].filter(Boolean).join(' '));
      const wrap = ui.h('div');
      wrap.append(text, meta);
      row.append(wrap);
      if (!it.resolved) {
        const btn = ui.button('标已解决', {
          size: 'sm',
          onClick: () => {
            void ctx.invoke<{ ok?: boolean; error?: string }>('resolve', [it.id])
              .then((r) => { ui.toast(r?.ok ? '已标解决' : r?.error ?? '失败', r?.ok ? 'ok' : 'bad'); poll(); })
              .catch((e) => ui.toast(errText(e), 'bad'));
          },
        });
        row.append(btn);
      }
      list.append(row);
    }
  };
  const poll = (): void => { void ctx.invoke<FeedbackState>('state').then(draw).catch((e) => { err.textContent = errText(e); err.hidden = false; }); };
  poll();
  ctx.interval(poll, POLL_MS * 2);
}

// ── 体征：额度与今日计数 ────────────────────────────────────────────────────
function mountVitals(ctx: WebUiPanelContext): void {
  const { ui, root } = ctx;
  const card = ui.sheet({ title: '体征', en: 'vitals', desc: '风控额度、今日计数与积压' });
  root.appendChild(card.el);
  const err = ui.msgline();
  const stats = ui.statgrid();
  const quota = ui.h('div', 'tank-gauges');
  const paused = ui.h('div', 'sh-desc');
  card.body.append(err, paused, stats, quota);

  const draw = (st: VitalsState): void => {
    err.hidden = true;
    if (st?.ok === false) { err.textContent = '体征读不到'; err.hidden = false; return; }
    stats.replaceChildren(
      ui.stat({ k: '今天动态', v: Number(st?.shares ?? 0), unit: '条' }),
      ui.stat({ k: '今天评论', v: Number(st?.commentsToday ?? 0), unit: '条' }),
      ui.stat({ k: '积压', v: Number(st?.pendingCount ?? 0), unit: '项', accent: Number(st?.pendingCount ?? 0) > 0 }),
    );
    const rem = st?.traffic?.remaining;
    quota.replaceChildren();
    if (rem) {
      const rows: Array<[string, number, number]> = [
        ['读/小时', rem.readHour ?? 0, st?.traffic?.settings?.readHourly ?? 1],
        ['读/天', rem.readDay ?? 0, st?.traffic?.settings?.readDaily ?? 1],
        ['写/小时', rem.writeHour ?? 0, st?.traffic?.settings?.writeHourly ?? 1],
        ['写/天', rem.writeDay ?? 0, st?.traffic?.settings?.writeDaily ?? 1],
      ];
      for (const [label, v, max] of rows) {
        quota.append(ui.progress({ label, value: v, max: max || 1, format: (x, m) => `${Math.round(x)} / ${Math.round(m)}` }).el);
      }
    } else {
      quota.append(ui.placeholder('额度数据还没出来'));
    }
    const pu = st?.traffic?.pausedUntil;
    paused.textContent = pu ? `⚠ 写操作暂停中（至 ${new Date(Number(pu) || Date.parse(String(pu)) || Date.now()).toLocaleString('zh-CN')}）` : '';
    paused.hidden = !pu;
  };
  const poll = (): void => { void ctx.invoke<VitalsState>('state').then(draw).catch((e) => { err.textContent = errText(e); err.hidden = false; }); };
  poll();
  ctx.interval(poll, POLL_MS);
}

// ── 发送策略：审核/自动、护栏、档位收回（红线常驻提示：kill 压过配置、auto 全留痕） ──
interface PolicyState {
  ok?: boolean;
  policy?: { draftMode: 'review' | 'auto'; autoDailyCap: number; autoWindow: string; like: 'self' | 'review'; fav: 'self' | 'review'; dmReply: 'direct' | 'queue' };
  file?: string; exists?: boolean; autoSentToday?: number; error?: string;
}
function mountPolicy(ctx: WebUiPanelContext): void {
  const { ui, root } = ctx;
  const card = ui.sheet({ title: '发送策略', en: 'send policy', desc: '默认全人工；auto 要你显式打开。kill 永远压过这里的一切设置。' });
  root.appendChild(card.el);
  const err = ui.msgline();
  const selMode = ui.select({ options: [{ value: 'review', label: '草稿：人工审核（默认）' }, { value: 'auto', label: '草稿：自动发送（auto）' }] });
  const inpCap = ui.input({ type: 'number', placeholder: '0 = 不限' });
  const inpWin = ui.input({ type: 'text', placeholder: '如 10:00-23:00；空 = 不限' });
  const selLike = ui.select({ options: [{ value: 'self', label: '点赞：她自己发' }, { value: 'review', label: '点赞：收回，等我审' }] });
  const selFav = ui.select({ options: [{ value: 'self', label: '收藏：她自己发' }, { value: 'review', label: '收藏：收回，等我审' }] });
  const selDm = ui.select({ options: [{ value: 'direct', label: '回主人私信：直发' }, { value: 'queue', label: '回信：收回，走草稿队列' }] });
  const status = ui.h('div', 'sh-desc');
  const save = ui.button('保存策略', {
    variant: 'primary',
    onClick: () => {
      const patch = {
        publish: { draftMode: selMode.value, autoDailyCap: Number(inpCap.value || 0), autoWindow: inpWin.value.trim() },
        permissions: { like: selLike.value, fav: selFav.value, dmReply: selDm.value },
      };
      void ctx.invoke<{ ok?: boolean; error?: string }>('set', [patch])
        .then((r) => { ui.toast(r?.ok ? '策略已保存' : r?.error ?? '保存失败', r?.ok ? 'ok' : 'bad'); if (r?.ok) poll(); })
        .catch((e) => ui.toast(errText(e), 'bad'));
    },
  });
  const acts = ui.actions(); acts.append(save);
  card.body.append(err, status,
    ui.field('草稿发送', selMode),
    ui.field('auto 每日上限（0=不限）', inpCap),
    ui.field('auto 时段（空=不限）', inpWin),
    ui.field('点赞档位', selLike),
    ui.field('收藏档位', selFav),
    ui.field('回信档位', selDm),
    acts);

  const draw = (st: PolicyState): void => {
    err.hidden = true;
    if (!st?.policy) { err.textContent = '策略读不到：' + (st?.error ?? st?.file ?? '?'); err.hidden = false; return; }
    const p = st.policy;
    status.textContent = `现行：草稿=${p.draftMode}${p.draftMode === 'auto' ? `（今日已 auto ${st.autoSentToday ?? 0} 条，上限 ${p.autoDailyCap || '不限'}，时段 ${p.autoWindow || '不限'}）` : ''} · 点赞=${p.like} · 收藏=${p.fav} · 回信=${p.dmReply}`;
    selMode.value = p.draftMode; inpCap.value = String(p.autoDailyCap); inpWin.value = p.autoWindow;
    selLike.value = p.like; selFav.value = p.fav; selDm.value = p.dmReply;
  };
  const poll = (): void => { void ctx.invoke<PolicyState>('state').then(draw).catch((e) => { err.textContent = errText(e); err.hidden = false; }); };
  poll();
  ctx.interval(poll, POLL_MS * 3);
}

// ── 面板注册（框架按 webUi() 声明的 id 挂载） ───────────────────────────────
const STYLE = `
.tank-hero{display:flex;gap:16px;align-items:center;margin:4px 0 12px}
.tank-avatar{width:76px;height:76px;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:38px;background:color-mix(in srgb, var(--accent, #4a9) 18%, transparent);border:2px solid color-mix(in srgb, var(--accent, #4a9) 45%, transparent);flex:none}
.tank-avatar-img{width:100%;height:100%;object-fit:cover}
.tank-mood-main{font-size:22px;font-weight:600}
.tank-mood-cause{font-size:13px;opacity:.75;margin-top:2px}
.tank-gauges{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px 18px;margin:8px 0}
.tank-described{font-size:13px;opacity:.8;line-height:1.6}
.draft-list{display:flex;flex-direction:column;gap:12px}
.draft-card{border:1px solid var(--line, rgba(128,128,128,.35));border-radius:10px;padding:10px 12px}
.draft-head{display:flex;gap:8px;align-items:center;margin-bottom:6px}
.draft-date{font-size:13px;opacity:.7}
.draft-text{line-height:1.7;white-space:normal}
.fb-list{display:flex;flex-direction:column;gap:10px}
.fb-row{display:flex;gap:10px;align-items:flex-start;justify-content:space-between;border-bottom:1px dashed var(--line, rgba(128,128,128,.3));padding-bottom:8px}
.fb-issue{line-height:1.6}
.fb-meta{font-size:12px;opacity:.65;margin-top:2px}
.diary-pre{max-height:260px;overflow:auto;font-size:13px;line-height:1.7;white-space:pre-wrap;background:transparent;border:none;padding:4px 0}
`;

function ensureStyle(root: HTMLElement): void {
  if (root.querySelector('style[data-tank]')) return;
  const s = document.createElement('style');
  s.dataset.tank = '1';
  s.textContent = STYLE;
  root.appendChild(s);
}

export default {
  panels: {
    tank: { mount(ctx: WebUiPanelContext) { ensureStyle(ctx.root); mountTank(ctx); } },
    drafts: { mount(ctx: WebUiPanelContext) { ensureStyle(ctx.root); mountDrafts(ctx); } },
    timeline: { mount(ctx: WebUiPanelContext) { ensureStyle(ctx.root); mountTimeline(ctx); } },
    diary: { mount(ctx: WebUiPanelContext) { ensureStyle(ctx.root); mountDiary(ctx); } },
    feedback: { mount(ctx: WebUiPanelContext) { ensureStyle(ctx.root); mountFeedback(ctx); } },
    policy: { mount(ctx: WebUiPanelContext) { ensureStyle(ctx.root); mountPolicy(ctx); } },
    vitals: { mount(ctx: WebUiPanelContext) { ensureStyle(ctx.root); mountVitals(ctx); } },
  },
} satisfies WebUiClientBundle;
