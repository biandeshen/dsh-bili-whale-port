/**
 * XiaoyuCapability —— 万物皆能力扩展的统一宿主无关契约。
 *
 * 三条铁律（见 docs/ARCHITECTURE-TARGET-2026-11-03.md §2.1）：
 * 1. 所有业务域能力（state-rhythm / memory / journal / bilibili / media-studio）平级实现本接口；
 * 2. 能力包内部严禁直接 import 'cortico/*'，仅由外层薄转接头适配到具体宿主插座；
 * 3. 消灭只读黑盒：每个能力包必须同时声明 store + context/event + tools + panel（主人可读写操作台）。
 */

export type CapabilityKind = 'internal' | 'world';

export interface JsonSchemaProperty {
  readonly type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  readonly title?: string;
  readonly description?: string;
  readonly default?: unknown;
  readonly enum?: readonly (string | number)[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly items?: JsonSchemaProperty;
  readonly 'x-hot'?: boolean;
}

export interface JsonSchema {
  readonly type: 'object';
  readonly title: string;
  readonly description?: string;
  readonly properties: Readonly<Record<string, JsonSchemaProperty>>;
  readonly required?: readonly string[];
}

export interface StorageUnit {
  readonly key: string;
  readonly label: string;
  readonly kind: 'disk' | 'memory';
  readonly location?: string;
  readonly danger?: boolean;
  readonly note?: string;
  stat(): string;
  clear?(): Promise<string> | string;
}

export interface PrefixBlock {
  readonly title: string;
  readonly text: string;
  readonly sourceKey?: string;
}

export interface TurnContext {
  readonly now: Date;
  readonly timezone: string;
}

export interface InboundEventItem {
  readonly type: string;
  readonly source: string;
  readonly text: string;
  readonly atMs: number;
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface DeliveryContext {
  readonly now: Date;
  readonly timezone: string;
  readonly events: readonly InboundEventItem[];
}

export interface CapabilityHost {
  readonly homeDir: string;
  readonly dataDir: string;
  readonly workspaceDir: string;
  pushEvent(event: InboundEventItem): void;
  injectInternal?(text: string): void;
  log(level: 'info' | 'warn' | 'error', msg: string, meta?: Record<string, unknown>): void;
}

export interface ToolParameterSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, JsonSchemaProperty>>;
  readonly required?: readonly string[];
}

export interface ToolRegistration<TArgs = Record<string, unknown>, TResult = unknown> {
  readonly name: string;
  readonly summary: string;
  readonly description: string;
  readonly parameters: ToolParameterSchema;
  readonly mutatesState?: boolean;
  execute(args: TArgs): Promise<TResult> | TResult;
}

export interface PanelMethodDecl<TParams = Record<string, unknown>, TRes = unknown> {
  readonly name: string;
  readonly verb: 'GET' | 'POST';
  readonly summary: string;
  /** 是否修改状态/配置（每个面板必须至少包含一个 POST 写方法，禁止纯只读黑盒面板） */
  readonly writable: boolean;
  invoke(params: TParams): Promise<TRes> | TRes;
}

export interface CapabilityPanelDecl {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly methods: Readonly<Record<string, PanelMethodDecl<any, any>>>;
}

export interface XiaoyuCapability<TConfig = Record<string, unknown>> {
  readonly id: string;
  readonly title: string;
  readonly kind: CapabilityKind;
  readonly configSchema: JsonSchema;
  readonly defaultConfig: TConfig;

  start?(host: CapabilityHost): Promise<void> | void;
  stop?(): Promise<void> | void;
  storageParts?(): readonly StorageUnit[];

  contextSegments?(ctx: TurnContext): Promise<readonly PrefixBlock[]> | readonly PrefixBlock[];
  onMessageDelivery?(ctx: DeliveryContext): Promise<readonly string[]> | readonly string[];

  tools(): readonly ToolRegistration<any, any>[];
  panels(): readonly CapabilityPanelDecl[];
}

export interface CapabilityValidationResult {
  readonly ok: boolean;
  readonly errors: string[];
}

/**
 * 校验一个能力扩展包是否满足「四件套 + 禁止纯只读黑盒面板」硬门禁。
 */
export function validateCapabilityContract(cap: XiaoyuCapability<any>): CapabilityValidationResult {
  const errors: string[] = [];
  if (!cap || typeof cap.id !== 'string' || !/^[a-z0-9-]+$/.test(cap.id)) {
    errors.push('invalid capability id (must match /^[a-z0-9-]+$/)');
  }
  if (!cap?.title || typeof cap.title !== 'string') {
    errors.push('missing capability title');
  }
  if (cap?.kind !== 'internal' && cap?.kind !== 'world') {
    errors.push('kind must be "internal" or "world"');
  }
  if (!cap?.configSchema || cap.configSchema.type !== 'object') {
    errors.push('missing or invalid configSchema');
  }
  const tools = typeof cap?.tools === 'function' ? cap.tools() : [];
  if (!Array.isArray(tools) || tools.length === 0) {
    errors.push('capability must expose at least one tool');
  }
  const panels = typeof cap?.panels === 'function' ? cap.panels() : [];
  if (!Array.isArray(panels) || panels.length === 0) {
    errors.push('capability must expose at least one owner control panel');
  } else {
    for (const p of panels) {
      const methods = Object.values(p.methods ?? {});
      const hasWritable = methods.some((m) => m.writable === true && m.verb === 'POST');
      if (!hasWritable) {
        errors.push(`panel "${p.id}" is read-only (must provide at least one POST writable control method)`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}
