/**
 * 原子场随时间衰减 —— 抽取自 AMpath `codex/ampath-unified-candidate`
 * `packages/shared/src/field-engine/real-time.ts`。
 *
 * 规则（每秒速率，线性）：
 *   energy      +0.001/hr（恢复）
 *   stimulation -0.005/hr
 *   connection  -0.001/hr
 *   social      -0.0005/hr
 *   mood        -0.002/hr（回归中性）
 *   curiosity   -0.0005/hr
 *   creativity  -0.0005/hr
 *
 * 硬耦合：energy<0.2 → mood 每小时 -0.02；connection<0.2 → social 每小时 +0.01；
 *         stimulation<0.1 → mood 每小时 -0.01。
 *
 * 与 AMpath 原版的唯一差异：衰减一步最多走到基线，不越过。
 * AMpath 每秒 tick 一次，步长极小，越过基线会立刻反向，问题不可见；
 * 这里按「离线一次补算」传入大 dt，若不截断会从 +0.99 一步冲到 -1。
 */
import type { AtomicFields } from './types.js';
import { clamp } from './types.js';

const DECAY_RATES: Record<keyof AtomicFields, number> = {
  energy: 0.000000278,
  stimulation: -0.000001389,
  connection: -0.000000278,
  social: -0.000000139,
  mood: -0.000000556,
  curiosity: -0.000000139,
  creativity: -0.000000139,
};

const BASELINES: Record<keyof AtomicFields, number> = {
  energy: 1.0,
  stimulation: 0.0,
  connection: 0.0,
  social: 0.3,
  mood: 0.0,
  curiosity: 0.5,
  creativity: 0.3,
};

export function decayAtomicFields(fields: AtomicFields, dtMs: number): AtomicFields {
  if (!(dtMs > 0)) return { ...fields };
  const dtSec = dtMs / 1000;
  const result = { ...fields };
  for (const key of Object.keys(DECAY_RATES) as Array<keyof AtomicFields>) {
    const rate = DECAY_RATES[key];
    const baseline = BASELINES[key];
    const current = result[key];
    const direction = Math.sign(baseline - current) || Math.sign(rate);
    const step = Math.abs(rate) * dtSec * direction;
    const next = current + step;
    const crossed = (direction > 0 && next > baseline) || (direction < 0 && next < baseline);
    result[key] = clamp(crossed ? baseline : next, key === 'mood' ? -1 : 0, 1);
  }
  return result;
}

/**
 * 硬耦合只在"最近一次结算窗口"内计息，最多算 COUPLING_CAP_MS。
 *
 * 为什么不能按真实离线时长线性算：AMpath 是每秒 tick，两次交互之间通常只有几十分钟，
 * 耦合永远累积不到极端值。我们按"离线一次补算"传大 dt，一周不上线就会把 mood 压到 -1、
 * social 顶到 1，而且没有任何机制拉回来——人物画像直接失真。
 * 这里的取舍：离线很久只说明"她最近没人陪、也没什么可看"，掉了 12 小时的分量就够了，
 * 不该按天数无限叠加。步长 1h 保证与连续 tick 的结果量级一致。
 */
export const COUPLING_CAP_MS = 12 * 3600_000;
const COUPLING_STEP_MS = 3600_000;

function applyCouplingsStep(fields: AtomicFields, dtSec: number): AtomicFields {
  const result = { ...fields };
  if (result.energy < 0.2) {
    result.mood = clamp(result.mood - 0.000005556 * dtSec, -1, 1);
  }
  if (result.connection < 0.2) {
    result.social = clamp(result.social + 0.000002778 * dtSec, 0, 1);
  }
  if (result.stimulation < 0.1) {
    result.mood = clamp(result.mood - 0.000002778 * dtSec, -1, 1);
  }
  return result;
}

export function applyHardCouplings(fields: AtomicFields, dtMs: number): AtomicFields {
  if (!(dtMs > 0)) return { ...fields };
  const capped = Math.min(dtMs, COUPLING_CAP_MS);
  let result = { ...fields };
  let left = capped;
  while (left > 0) {
    const step = Math.min(left, COUPLING_STEP_MS);
    result = applyCouplingsStep(result, step / 1000);
    left -= step;
  }
  return result;
}

/** 离线补算：从上次交互到现在，一次性结算场值漂移。 */
export function simulateOfflineTime(fields: AtomicFields, dtMs: number): AtomicFields {
  if (!(dtMs > 0)) return { ...fields };
  return applyHardCouplings(decayAtomicFields(fields, dtMs), dtMs);
}
