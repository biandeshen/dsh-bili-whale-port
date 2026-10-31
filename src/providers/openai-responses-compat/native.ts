/** Native Responses over any OpenAI-compatible endpoint: bearer key, stateless replay, no vendor branching. */
import type { Logger } from '../../core/types.ts';
import type { ListedModel } from '../base.ts';
import { nullLogger } from '../../core/util.ts';
import { OpenAIHttpClient } from '../transport/chat.ts';
import { ResponseProtocolError } from '../../protocol/open-responses/stream.ts';
import { createResponse, type Request } from '../../protocol/open-responses/index.ts';
import { GenerationError, standardUsage, type GenerateOptions, type Generation } from '../../core/generation.ts';
import { NativeResponseAssembly, normalizeCompletedFunctionCalls, type ResponseAssembly, type parseChatResponse } from '../transport/response-assembly.ts';
import { responseMeters } from '../transport/response-meters.ts';
import { responsesInput, type ReasoningReplay, type ResponsesInputOptions } from '../transport/responses-input.ts';

type Item = Record<string, unknown>;

export interface ResponsesProviderOptions {
  baseUrl: string;
  apiKey?: string;
  /** Path appended to `baseUrl`; default `/responses`. */
  endpointPath?: string;
  extraHeaders?: Record<string, string>;
  /** Merged into every request body last, so vendor-specific fields (`service_tier`, ...) win. */
  extraBody?: Record<string, unknown>;
  media?: ResponsesInputOptions['media'];
  keepThinking?: () => boolean;
  reasoningReplay?: ReasoningReplay;
  syntheticReasoningText?: string;
  /** Plaintext replay only; default true. */
  sendSyntheticReasoning?: boolean;
  log?: Logger;
}

/**
 * Send reasoning only when an effort is supplied; otherwise leave it to the endpoint.
 * Requests set store=false, so replay is local and follows `reasoningReplay`; encrypted replay asks
 * for the signed blocks back through `include`. Endpoint extraBody fields are merged last.
 */
export function buildResponsesBody(
  request: Request,
  options: GenerateOptions,
  input: ResponsesInputOptions,
  extraBody: Record<string, unknown> = {},
): Record<string, unknown> {
  const replay = responsesInput(request, options, input);
  const body: Item = {
    ...request,
    input: replay.input,
    store: false,
    stream: Boolean(options.onEvent),
  };
  // 加密形态靠 include 把签名推理块取回来,明文形态用不上它;端点不支持 include 时整条请求被拒,
  // 所以只在用得上的形态带。
  const include = new Set<string>(request.include ?? []);
  if (input.reasoningReplay !== 'plaintext') include.add('reasoning.encrypted_content');
  if (include.size) body.include = [...include];
  else delete body.include;
  delete body.previous_response_id;
  if (replay.instructions !== undefined) body.instructions = replay.instructions;
  else delete body.instructions;
  if (!request.reasoning?.effort) delete body.reasoning;
  if (options.sessionId) body.prompt_cache_key = options.sessionId;
  return { ...body, ...extraBody };
}

export class ResponsesProvider extends OpenAIHttpClient {
  private readonly opts: ResponsesProviderOptions;

  constructor(opts: ResponsesProviderOptions) {
    super(opts.baseUrl, opts.log ?? nullLogger());
    this.opts = opts;
    this.chatPath = opts.endpointPath ?? '/responses';
  }

  override async respond(request: Request, options: GenerateOptions = {}): Promise<Generation> {
    try {
      return await super.respond(request, options);
    } catch (error) {
      if (error instanceof GenerationError && error.status === 400 && /reasoning_text/.test(error.body)
        && this.opts.reasoningReplay === 'plaintext' && this.opts.sendSyntheticReasoning === false)
        throw new GenerationError(`${error.message}: 400 body names reasoning_text while sendSyntheticReasoning is off`,
          error.attempts, error.partial, error.origin, error.status, error.body, { cause: error });
      throw error;
    }
  }

  protected override buildResponseBody(request: Request, options: GenerateOptions): Record<string, unknown> {
    return buildResponsesBody(request, options, {
      media: this.opts.media, keepThinking: this.opts.keepThinking, reasoningReplay: this.opts.reasoningReplay,
      syntheticReasoningText: this.opts.syntheticReasoningText, sendSyntheticReasoning: this.opts.sendSyntheticReasoning,
    }, this.opts.extraBody);
  }

  /** The Chat body builder is unreachable here: `buildResponseBody` is overridden whole. */
  protected buildBody(): never {
    throw new Error('ResponsesProvider does not build Chat Completions bodies');
  }

  protected headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...this.opts.extraHeaders };
    if (this.opts.apiKey) headers.Authorization = `Bearer ${this.opts.apiKey}`;
    return headers;
  }

  protected override responseAssembly(): ResponseAssembly {
    return new NativeResponseAssembly();
  }

  protected override parseResponse(raw: unknown, request: Request): ReturnType<typeof parseChatResponse> {
    const data = raw as Item;
    if (typeof data.id !== 'string' || typeof data.model !== 'string' || !Array.isArray(data.output)
      || !['completed', 'incomplete', 'failed'].includes(String(data.status))) throw new ResponseProtocolError('Invalid native Responses resource');
    const meters = responseMeters(data.usage as Record<string, unknown> | null);
    return {
      response: normalizeCompletedFunctionCalls({ ...createResponse(data.id, request), ...data, usage: standardUsage(meters) }),
      meters,
      serviceTier: typeof data.service_tier === 'string' ? data.service_tier : null,
    };
  }
}

/**
 * `GET /models`: ids always. OpenRouter-style catalogs also state per model `name`,
 * `context_length`, `top_provider.max_completion_tokens` and `architecture.input_modalities`.
 */
interface RawModelRow {
  id?: unknown; name?: unknown; context_length?: unknown;
  top_provider?: { max_completion_tokens?: unknown } | null;
  architecture?: { input_modalities?: unknown } | null;
}

/** 网关返回的形状不止一种:`{data:[...]}`(OpenAI)与 `{models:[...]}`(部分兼容层)。都不是就回 null。 */
export function parseModelList(text: string): RawModelRow[] | null {
  let json: unknown;
  try { json = JSON.parse(text); } catch { return null; }
  const o = json as { data?: unknown; models?: unknown };
  for (const arr of [o?.data, o?.models]) if (Array.isArray(arr)) return arr as RawModelRow[];
  return null;
}

export class ModelCatalog {
  private known = new Map<string, number | undefined>();
  constructor(
    private readonly endpoint: () => { baseUrl: string; headers: Record<string, string> },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * 模型列表。网关把 `/models` 挂在哪一档不统一(有的跟着 baseUrl 的 `/v1`,有的挂在根),
   * 所以按候选逐个试;全部拿不到时给一句能照着做的话,而不是 `GET /models 404:`。
   */
  async list(): Promise<ListedModel[]> {
    const { baseUrl, headers } = this.endpoint();
    const root = baseUrl.replace(/\/+$/, '');
    const candidates = [...new Set([`${root}/models`, root.endsWith('/v1') ? `${root.slice(0, -3)}/models` : `${root}/v1/models`])];
    const tried: string[] = [];
    for (const url of candidates) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, { headers, signal: AbortSignal.timeout(15_000) });
      } catch (err) {
        tried.push(`${new URL(url).pathname} 连不上(${err instanceof Error ? err.message : String(err)})`);
        continue;
      }
      if (!res.ok) { tried.push(`${new URL(url).pathname} 回 ${res.status}`); continue; }
      const parsed = parseModelList(await res.text());
      if (!parsed) { tried.push(`${new URL(url).pathname} 返回的不是模型清单`); continue; }
      return this.record(parsed);
    }
    throw new Error(`这个端点不提供模型列表(${tried.join(';')})。不影响换模型:直接在「模型」里填名字,按「测试连接」验证。`);
  }

  /** 把一行行原始记录收进 Known 表并排序;形状兼容 `data` 与 `models` 两种。 */
  private record(rows: RawModelRow[]): ListedModel[] {
    const models: ListedModel[] = [];
    for (const row of rows) {
      if (typeof row.id !== 'string') continue;
      const model: ListedModel = { id: row.id };
      if (typeof row.name === 'string' && row.name.trim()) model.displayName = row.name;
      const window = typeof row.context_length === 'number' && Number.isInteger(row.context_length) && row.context_length > 0 ? row.context_length : undefined;
      if (window) model.contextWindow = window;
      const maxOutput = row.top_provider?.max_completion_tokens;
      if (typeof maxOutput === 'number' && Number.isInteger(maxOutput) && maxOutput > 0) model.maxOutputTokens = maxOutput;
      const modalities = row.architecture?.input_modalities;
      if (Array.isArray(modalities)) model.inputImages = modalities.includes('image');
      this.known.set(row.id, window);
      models.push(model);
    }
    return models.sort((a, b) => a.id.localeCompare(b.id));
  }

  contextWindow(model: string): number | undefined {
    return this.known.get(model);
  }
}
