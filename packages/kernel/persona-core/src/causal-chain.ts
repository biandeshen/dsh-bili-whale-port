import type { CausalEvent } from './types.ts';
import { CONFIG } from './types.ts';

// ============================================================
// 因果网（三层结构，网络追溯）
//
// L0 场事件: field_change, emotion_decay, emotion_coupling
// L1 实体响应: autonomous_action, conversation, drive_trigger
// L2 涌现现象: dimension_emerge, tag_emerge, tag_revoke
//
// 不是线性链，是网络。一个事件可以有多个父事件和子事件。
// ============================================================

let nextId = 1;

function generateId(): string {
  return `causal_${nextId++}_${Date.now()}`;
}

/** 过滤阈值：|delta| < 0.03 不记录 */
const FIELD_CHANGE_THRESHOLD = CONFIG.FIELD_CHANGE_THRESHOLD; // 0.03

/**
 * Record a causal event.
 * 过滤规则：field_changes 中如果没有任何 |delta| >= 阈值，不记录。
 */
export function recordCausalEvent(
  event: Omit<CausalEvent, 'id' | 'timestamp'>,
  chain: CausalEvent[],
): CausalEvent | null {
  const hasSignificantChange = event.fieldChanges.some(
    fc => Math.abs(fc.to - fc.from) >= FIELD_CHANGE_THRESHOLD,
  );
  if (!hasSignificantChange && event.fieldChanges.length > 0) return null;

  const fullEvent: CausalEvent = {
    id: generateId(),
    timestamp: new Date(),
    ...event,
  };
  chain.push(fullEvent);
  return fullEvent;
}

/**
 * Record field changes as a L0 causal event.
 */
export function recordFieldChangeL0(
  npcId: string,
  field: string,
  from: number,
  to: number,
  description: string,
  chain: CausalEvent[],
  triggerId?: string,
): CausalEvent | null {
  if (Math.abs(to - from) < FIELD_CHANGE_THRESHOLD) return null;

  return recordCausalEvent({
    npcId,
    layer: 'L0',
    type: 'field_change',
    description,
    fieldChanges: [{ field, from, to }],
    triggerId,
  }, chain);
}

/**
 * Record an entity response (L1) with references to L0 causes.
 */
export function recordEntityResponseL1(
  npcId: string,
  type: string,
  description: string,
  fieldChanges: Array<{ field: string; from: number; to: number }>,
  chain: CausalEvent[],
  triggerIds?: string[],
): CausalEvent | null {
  return recordCausalEvent({
    npcId,
    layer: 'L1',
    type,
    description,
    fieldChanges,
    triggerId: triggerIds?.[0],
  }, chain);
}

/**
 * Record an emergence phenomenon (L2) with references to L1 causes.
 */
export function recordEmergenceL2(
  npcId: string,
  type: string,
  description: string,
  chain: CausalEvent[],
  triggerIds?: string[],
): CausalEvent | null {
  return recordCausalEvent({
    npcId,
    layer: 'L2',
    type,
    description,
    fieldChanges: [],
    triggerId: triggerIds?.[0],
  }, chain);
}

/**
 * Query causal events by NPC, optionally filtered by layer and time range.
 */
export function queryCausalEvents(
  chain: CausalEvent[],
  npcId: string,
  options?: {
    layer?: 'L0' | 'L1' | 'L2';
    layers?: Array<'L0' | 'L1' | 'L2'>;
    field?: string;
    since?: Date;
    limit?: number;
  },
): CausalEvent[] {
  let results = chain.filter(e => e.npcId === npcId);

  if (options?.layer) {
    results = results.filter(e => e.layer === options.layer);
  }
  if (options?.layers) {
    results = results.filter(e => options.layers!.includes(e.layer));
  }
  if (options?.field) {
    results = results.filter(e =>
      e.fieldChanges.some(fc => fc.field === options.field),
    );
  }
  if (options?.since) {
    results = results.filter(e => e.timestamp >= options.since!);
  }

  results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  if (options?.limit) {
    results = results.slice(0, options.limit);
  }

  return results;
}

/**
 * 因果树节点
 */
export interface CausalTreeNode {
  event: CausalEvent;
  children: CausalTreeNode[];
  depth: number;
}

/**
 * 从任意事件向上追溯，构建因果树。
 * 网络结构：一个事件可以有多个子事件（通过 trigger_id 关联）。
 */
export function buildCausalTree(
  chain: CausalEvent[],
  rootEventId: string,
  maxDepth: number = 10,
): CausalTreeNode {
  const root = chain.find(e => e.id === rootEventId);
  if (!root) {
    return { event: null as unknown as CausalEvent, children: [], depth: 0 };
  }

  const node: CausalTreeNode = { event: root, children: [], depth: 0 };

  if (maxDepth <= 0) return node;

  // 找所有子事件（trigger_id 指向当前事件的）
  const children = chain.filter(e => e.triggerId === rootEventId);

  for (const child of children) {
    const childNode = buildCausalTree(chain, child.id, maxDepth - 1);
    childNode.depth = node.depth + 1;
    node.children.push(childNode);
  }

  return node;
}

/**
 * 从事件向上追溯因果链（线性版本，适合快速查询）。
 * 沿 trigger_id 向上遍历。
 */
export function traceCausalChain(
  chain: CausalEvent[],
  eventId: string,
  maxDepth: number = 10,
): CausalEvent[] {
  const result: CausalEvent[] = [];
  let currentId: string | undefined = eventId;
  const visited = new Set<string>();

  while (currentId && result.length < maxDepth && !visited.has(currentId)) {
    visited.add(currentId);
    const event = chain.find(e => e.id === currentId);
    if (!event) break;
    result.push(event);
    currentId = event.triggerId;
  }

  return result;
}

/**
 * 从场值变化事件找到最近的 mood 下降事件，
 * 然后沿因果链向上追溯，构建完整因果路径。
 */
export function explainMoodDrop(
  chain: CausalEvent[],
  npcId: string,
  since?: Date,
): CausalEvent[] {
  const moodEvents = chain.filter(e =>
    e.npcId === npcId &&
    e.fieldChanges.some(fc => fc.field === 'mood' && fc.to < fc.from) &&
    (!since || e.timestamp >= since),
  );

  if (moodEvents.length === 0) return [];

  moodEvents.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  const latest = moodEvents[0];

  return traceCausalChain(chain, latest.id);
}
