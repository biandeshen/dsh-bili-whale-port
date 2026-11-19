import { describe, expect, it, vi } from 'vitest';
import { fetchIndexFile, INDEX_BASES } from '../../src/extensions/market.ts';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** 前 N 个源失败时,按顺序问到下一个;这是加速器换证书场景下唯一能通的通路。 */
describe('索引源候选回落', () => {
  it('raw 被本机中间人挡下时,继续问镜像并返回结果', async () => {
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL) => {
      const u = String(url);
      urls.push(u);
      if (u.startsWith(INDEX_BASES[0])) {
        throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('unable to verify the first certificate'), { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' }) });
      }
      return ok({ schema: 1, hit: u });
    }) as unknown as typeof fetch;
    const got = await fetchIndexFile('catalog.json', { fetch: fetchImpl }) as { hit: string };
    expect(urls[0]).toContain('raw.githubusercontent.com');
    expect(got.hit).toContain('jsdelivr');
  });

  it('配了 indexBase 时它排最前,且候选里不重复出现', async () => {
    const urls: string[] = [];
    const base = 'https://mirror.example/gh/Pal-AI-Lab/cortico-extensions@main';
    const fetchImpl = vi.fn(async (url: string | URL) => { urls.push(String(url)); return ok({ schema: 1 }); }) as unknown as typeof fetch;
    await fetchIndexFile('index.json', { base, fetch: fetchImpl });
    expect(urls[0]).toBe(`${base}/index.json`);
    expect(urls.filter((u) => u.startsWith(base))).toHaveLength(1);
    expect(INDEX_BASES.length).toBeGreaterThanOrEqual(3);
  });

  it('镜像也没有这个文件(404)时回 null,不再往下问', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch;
    await expect(fetchIndexFile('missing.json', { fetch: fetchImpl })).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('全部失败时把每一处的主机与证书原因都写出来', async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('self signed certificate in certificate chain'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' }) });
    }) as unknown as typeof fetch;
    await expect(fetchIndexFile('catalog.json', { fetch: fetchImpl })).rejects.toThrow(/本机替换[\s\S]*raw.githubusercontent\.com|raw.githubusercontent\.com[\s\S]*本机替换/);
  });
});
