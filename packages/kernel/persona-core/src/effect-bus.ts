import type { AtomicFields, Effect, ResolvedEffect } from './types.ts';
import { clamp } from './types.ts';

/** 场值变化过滤阈值 — |delta| < 0.03 不 emit */
const FIELD_CHANGE_THRESHOLD = 0.03;

/**
 * EffectBus — the unified pipeline for ALL state changes.
 *
 * Architecture: Collect → Resolve → Apply
 *
 * RULE: Direct field modification = architecture violation.
 * All changes must go through EffectBus.
 *
 * 注意：这里刻意不提供"同源高频丢弃"的频率门。
 * 一次事件 = 一个批次，同一来源的多条效果必须全部生效；
 * 早期移植版每次 new FrequencyGate(50) 会把同源第二条起全部吞掉（连接感/社交永远加不上）。
 */
export class EffectBus {
  private pending: Effect[] = [];

  /** Stage 1: Collect effects from any source */
  collect(effect: Effect): void {
    this.pending.push(effect);
  }

  /** Convenience: collect multiple effects at once */
  collectAll(effects: Effect[]): void {
    for (const e of effects) this.pending.push(e);
  }

  /** Stage 2: Resolve — merge effects by field, sort by priority */
  resolve(): ResolvedEffect[] {
    this.pending.sort((a, b) => a.priority - b.priority);

    const merged = new Map<string, { totalDelta: number; contributions: Effect[] }>();
    for (const effect of this.pending) {
      const existing = merged.get(effect.field);
      if (existing) {
        existing.totalDelta += effect.delta;
        existing.contributions.push(effect);
      } else {
        merged.set(effect.field, { totalDelta: effect.delta, contributions: [effect] });
      }
    }

    this.pending = [];

    return Array.from(merged.entries()).map(([field, data]) => ({
      field,
      totalDelta: data.totalDelta,
      contributions: data.contributions,
    }));
  }

  /** Stage 3: Apply resolved effects to AtomicFields */
  apply(fields: AtomicFields, resolved: ResolvedEffect[]): AtomicFields {
    const result = { ...fields };
    for (const r of resolved) {
      const key = r.field as keyof AtomicFields;
      if (key in result) {
        const min = key === 'mood' ? -1 : 0;
        result[key] = clamp((result[key] ?? 0) + r.totalDelta, min, 1);
      }
    }
    return result;
  }

  get pendingCount(): number {
    return this.pending.length;
  }

  clear(): void {
    this.pending = [];
  }
}

/**
 * 桥接函数：EffectBus 完成后自动触发 NPCEventBus
 * 这是两个总线的唯一桥接点。
 *
 * 每个显著变化（|delta| > FIELD_CHANGE_THRESHOLD）都 emit 到 Event Bus。
 * 阈值 0.03：过低(0.01)=噪音多，过高(0.05)=漏掉有意义的变化。
 *
 * @param emitFn 桥接 emit 函数，由调用方注入（避免循环依赖 NPCEventBus）
 */
export function applyAndEmit(
  fields: AtomicFields,
  effects: Effect[],
  emitFn: (field: string, from: number, to: number, delta: number) => void,
): [AtomicFields, ResolvedEffect[]] {
  const effectBus = new EffectBus();
  effectBus.collectAll(effects);
  const resolved = effectBus.resolve();
  const newFields = effectBus.apply(fields, resolved);

  for (const r of resolved) {
    if (Math.abs(r.totalDelta) > FIELD_CHANGE_THRESHOLD) {
      const from = fields[r.field as keyof AtomicFields] ?? 0;
      const to = newFields[r.field as keyof AtomicFields] ?? 0;
      emitFn(r.field, from, to, r.totalDelta);
    }
  }

  return [newFields, resolved];
}

/**
 * 重入保护：检查事件来源是否是 effect_bus
 * Event Bus handler 中用此判断，避免 EffectBus→EventBus→EffectBus 循环
 */
export function isFromEffectBus(source: string): boolean {
  return source === 'effect_bus';
}

/**
 * Convenience: run the full EffectBus pipeline in one call.
 * Returns [newFields, resolvedEffects].
 */
export function runEffectBus(
  fields: AtomicFields,
  effects: Effect[],
): [AtomicFields, ResolvedEffect[]] {
  const bus = new EffectBus();
  bus.collectAll(effects);
  const resolved = bus.resolve();
  const newFields = bus.apply(fields, resolved);
  return [newFields, resolved];
}
