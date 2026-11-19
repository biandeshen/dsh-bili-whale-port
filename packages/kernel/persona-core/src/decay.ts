/**
 * 原子场随时间自然衰减与离线补算纯函数。
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
 * 衰减一步最多走到基线，不越过：按「离线一次补算」传入大 dt 时，若不截断会从 +0.99 一步冲到 -1。
 */
import type { AtomicFields } from './types.ts';
import { clamp } from './types.ts';

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
 * 硬耦合：负向（缺刺激/体力低/孤独）与正向（被陪着）都有，按 1h 步长积分。
 *
 * 历史包袱：曾有 COUPLING_CAP_MS=12h 的封顶，导致"在线 168h 比离线 12h 罚得重 14 倍"，
 * 反而把场值冻结固化了。现在不在耦合层封顶——由调用方把一次结算限制在 24h（MAX_SETTLE_MS）。
 */
const COUPLING_STEP_MS = 3600_000;

/**
 * 硬耦合一次结算最多按 24h 计息（再久也不多压），避免跨周把场值钉到端点。
 * 衰减不封顶：它只会走到基线，长时间离线该回落的（刺激/连接/心情）照常回落。
 */
export const MAX_SETTLE_MS = 24 * 3600_000;

function applyCouplingsStep(fields: AtomicFields, dtSec: number): AtomicFields {
  const result = { ...fields };
  // 负向：长期低体力 / 低刺激会拖心情；孤独会把"社交需求"顶高
  if (result.energy < 0.2) {
    result.mood = clamp(result.mood - 0.000005556 * dtSec, -1, 1);
  }
  if (result.connection < 0.2) {
    result.social = clamp(result.social + 0.000002778 * dtSec, 0, 1);
  }
  if (result.stimulation < 0.1) {
    result.mood = clamp(result.mood - 0.000002778 * dtSec, -1, 1);
  }
  // 正向（M1，ARCHITECTURE §12.2）：被陪着能把她托起来，否则三条耦合全是下压
  if (result.social > 0.6) {
    result.mood = clamp(result.mood + (0.01 / 86400) * dtSec, -1, 1);       // +0.01/天
  }
  if (result.connection > 0.6) {
    result.energy = clamp(result.energy + (0.0005 / 3600) * dtSec, 0, 1);   // 恢复 ×1.5
  }
  return result;
}

export function applyHardCouplings(fields: AtomicFields, dtMs: number): AtomicFields {
  if (!(dtMs > 0)) return { ...fields };
  let result = { ...fields };
  let left = dtMs;
  while (left > 0) {
    const step = Math.min(left, COUPLING_STEP_MS);
    result = applyCouplingsStep(result, step / 1000);
    left -= step;
  }
  return result;
}

/** 离线补算：衰减跑满真实时长，硬耦合最多按 24h 计息。 */
export function simulateOfflineTime(fields: AtomicFields, dtMs: number): AtomicFields {
  if (!(dtMs > 0)) return { ...fields };
  return applyHardCouplings(decayAtomicFields(fields, dtMs), Math.min(dtMs, MAX_SETTLE_MS));
}
