/**
 * 人格核心类型定义（7 原子场、效果总线、三层因果网、记忆结构与常量配置）。
 * 纯类型与纯常量，零外部依赖、零宿主耦合。
 */

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ============================================================
// 7 个原子场
// ============================================================
export interface AtomicFields {
  energy: number;       // 体力 (0-1)
  stimulation: number;  // 刺激量 (0-1)
  connection: number;   // 连接需求 (0-1)
  social: number;       // 社交能力 (0-1)
  mood: number;         // 情绪基调 (-1~1)
  curiosity: number;    // 好奇心 (0-1)
  creativity: number;   // 创造力 (0-1)
}

export interface AtomicFieldsWithVersion extends AtomicFields {
  version: number;
}

export const DEFAULT_ATOMIC_FIELDS: AtomicFields = {
  energy: 0.7,
  stimulation: 0.5,
  connection: 0.5,
  social: 0.5,
  mood: 0.2,
  curiosity: 0.6,
  creativity: 0.5,
};

// ============================================================
// 效果
// ============================================================
export interface Effect {
  field: keyof AtomicFields | string; // 支持原子场和涌现维度
  delta: number;
  source: string;
  priority: number;
}

export interface ResolvedEffect {
  field: string;
  totalDelta: number;
  contributions: Effect[];
}

// ============================================================
// 因果网（三层）
// ============================================================
export interface CausalEvent {
  id: string;
  npcId: string;
  timestamp: Date;
  layer: 'L0' | 'L1' | 'L2'; // L0=场事件, L1=实体响应, L2=涌现现象
  type: string;
  description: string;
  fieldChanges: Array<{ field: string; from: number; to: number }>;
  triggerId?: string;
  source?: string;
  temporalMeta?: {
    hour: number;
    circadianPhase: string;
    isLateNight: boolean;
    dayOfWeek: number;
  };
}

export interface FieldChange {
  field: string;
  from: number;
  to: number;
}

// ============================================================
// 记忆
// ============================================================
export type MemorySource = 'user_said' | 'npc_self' | 'dream' | 'imported' | 'user_voice' | 'user_image';

export interface Memory {
  id: string;
  npcId: string;
  sender: 'player' | 'npc';
  content: string; // 原始内容，永不删除
  emotion: { valence: number; intensity: number; tags: string[] };
  tags: string[];
  vividness: number; // 0-1
  accessCount: number;
  createdAt: Date;
  pinned?: boolean;
  encodingStrength?: number; // Yerkes-Dodson 曲线 (0-1)
  flashbulb?: boolean;       // 里程碑记忆，几乎不衰减
  source?: MemorySource;
  /** 作废（#55）：写错了的记忆撤不掉 = 她只能带着假记忆过日子。
   *  不删原文（content 仍"永不删除"），只盖作废章并退出召回；理由留痕，日后能复盘。 */
  voided?: boolean;
  voidedAt?: string;
  voidReason?: string;
  /**
   * 时间有效性（2026-11-21，记忆域分析 ①）。
   *
   * 为什么要它：她记了「主人不喜欢猫」，三个月后主人说「我其实喜欢猫」。
   * 以前会存成两条独立记忆，召回时权重相近——她分不清哪条现在算数。
   * Zep 的解法是给事实带有效性区间；我们只取最小必要的那一半：
   *
   *   validFrom   此事从何时开始成立（缺省 = 记下的那一刻）
   *   validUntil  到何时为止（缺省 = 一直有效）
   *   supersededBy 被哪条取代（不删原文，只标出处）
   *
   * **过期不等于删除**：`content` 仍永不删除，过期只是召回降权 + 回执注明
   * 「这是过去的」。她仍想得起来"我以前以为…"，但不会当成现在的事实。
   */
  validFrom?: string;
  validUntil?: string;
  supersededBy?: string;
}

// ============================================================
// 配置（仅保留 persona-core 需要的常量）
// ============================================================
export const CONFIG = {
  /** 场值变化广播阈值：|delta| < 0.03 不 emit */
  FIELD_CHANGE_THRESHOLD: 0.03,
  /** 同一来源最小发射间隔（ms） */
  SOURCE_MIN_INTERVAL_MS: 50,
  /** 记忆每日衰减基线 */
  MEMORY_DECAY_PER_DAY: 0.02,
  /** flashbulb 衰减倍率（0.2 = 慢 5 倍） */
  FLASHBULB_DECAY_FACTOR: 0.2,
  /** 回忆加成 */
  RECALL_BOOST: 0.05,
  RECALL_BOOST_FLOOR: 0.005,
  /** 编码峰值刺激量（Yerkes-Dodson） */
  ENCODING_PEAK_STIMULATION: 0.6,
} as const;
