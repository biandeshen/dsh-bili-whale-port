import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseRetryAfter } from '../../../src/providers/transport/errors.ts';

afterEach(() => vi.useRealTimers());

describe('parseRetryAfter', () => {
  it('数字按秒,HTTP 日期按距今,缺失与不成形为 null', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-21T00:00:00Z'));
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('')).toBeNull();
    expect(parseRetryAfter('soon')).toBeNull();
    expect(parseRetryAfter('2')).toBe(2000);
    expect(parseRetryAfter('Wed, 21 Sep 2026 00:00:30 GMT')).toBe(30000);
  });
  it('已过期的日期不等待', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-21T00:00:00Z'));
    expect(parseRetryAfter('Mon, 01 Jan 2024 00:00:00 GMT')).toBe(0);
  });
});

describe('StreamErrorEvent', () => {
  it('带上游自己的失败原因,状态 0 表示流内失败,消息压成一行', async () => {
    const { StreamErrorEvent, LLMError } = await import('../../../src/providers/transport/errors.ts');
    const event = new StreamErrorEvent(JSON.stringify({ error: { message: 'model   overloaded\n try later' } }));
    expect(event).toBeInstanceOf(LLMError);
    expect(event.name).toBe('StreamErrorEvent');
    expect(event.status).toBe(0);
    expect(event.message).toBe('Stream error event: model overloaded try later');
    expect(event.body).toContain('overloaded');
  });

  it('不是 JSON 的正文原样带上;message 顶层字段同样取', async () => {
    const { StreamErrorEvent, upstreamText } = await import('../../../src/providers/transport/errors.ts');
    expect(upstreamText('  plain   text \n here ')).toBe('plain text here');
    expect(new StreamErrorEvent('{"message":"rate limited"}').message).toBe('Stream error event: rate limited');
  });
});
