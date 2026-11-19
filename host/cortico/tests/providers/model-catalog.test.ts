import { describe, expect, it, vi } from 'vitest';
import { ModelCatalog, parseModelList } from '../../src/providers/openai-responses-compat/native.ts';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** 网关把 /models 挂在哪一档不统一:先按 baseUrl 试,再试另一档,全失败要说人话。 */
describe('模型列表的候选路径与失败文案', () => {
  it('baseUrl 带 /v1 时先试 /v1/models,404 就回落到 /models', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(new URL(url).pathname);
      return urls.length === 1 ? new Response('', { status: 404 }) : json({ data: [{ id: 'z-model' }, { id: 'a-model', context_length: 128000 }] });
    }) as unknown as typeof fetch;
    const catalog = new ModelCatalog(() => ({ baseUrl: 'http://127.0.0.1:18910/v1', headers: {} }), fetchImpl);
    const list = await catalog.list();
    expect(urls).toEqual(['/v1/models', '/models']);
    expect(list.map((m) => m.id)).toEqual(['a-model', 'z-model']);
    expect(catalog.contextWindow('a-model')).toBe(128000);
  });

  it('两档都拿不到时报"不提供模型列表",并给出下一步(填名字 + 测试连接)', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    const catalog = new ModelCatalog(() => ({ baseUrl: 'http://127.0.0.1:18910/v1', headers: {} }), fetchImpl);
    await expect(catalog.list()).rejects.toThrow(/不提供模型列表[\s\S]*测试连接/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('端点活着但返回的不是清单形状时,也算没拿到(不静默给空列表)', async () => {
    const fetchImpl = vi.fn(async () => json({ hello: 'world' })) as unknown as typeof fetch;
    const catalog = new ModelCatalog(() => ({ baseUrl: 'http://x/v1', headers: {} }), fetchImpl);
    await expect(catalog.list()).rejects.toThrow(/不是模型清单/);
  });

  it('兼容 {models:[...]} 形状;非 JSON 回 null', () => {
    expect(parseModelList(JSON.stringify({ models: [{ id: 'm1' }] }))?.[0]?.id).toBe('m1');
    expect(parseModelList('not json')).toBeNull();
    expect(parseModelList(JSON.stringify({ data: 'not an array' }))).toBeNull();
  });
});
