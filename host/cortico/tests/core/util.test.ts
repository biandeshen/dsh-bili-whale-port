/**
 * 手写的文本文件按 BOM 解码:Windows 的 shell 重定向写出的是 UTF-16 LE 或带 BOM 的 UTF-8,
 * 两者按 UTF-8 读都读不出原文。
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { nowIso, parseTimeIn, readTextFile } from '../../src/core/util.ts';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cortico-text-file-'));
  dirs.push(dir);
  return dir;
}

/** PowerShell 5.1 的 `>` 写出的字节:UTF-16 LE,带 BOM。 */
function writeUtf16le(file: string, text: string): void {
  writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]));
}

/** `Out-File -Encoding utf8` 写出的字节:UTF-8,带 BOM。 */
function writeUtf8Bom(file: string, text: string): void {
  writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')]));
}

describe('readTextFile', () => {
  it('UTF-8 无 BOM 原样读出', () => {
    const file = join(tempDir(), 'a.txt');
    writeFileSync(file, '你好 hello\n', 'utf8');
    expect(readTextFile(file)).toBe('你好 hello\n');
  });

  it('UTF-16 LE 按 UTF-16 解码,BOM 不进返回值', () => {
    const file = join(tempDir(), 'b.txt');
    writeUtf16le(file, '你好 hello\n');
    expect(readTextFile(file)).toBe('你好 hello\n');
  });

  it('UTF-8 BOM 不进返回值', () => {
    const file = join(tempDir(), 'c.txt');
    writeUtf8Bom(file, '{ "bot": "cormini" }');
    expect(readTextFile(file)).toBe('{ "bot": "cormini" }');
  });

  it('仓里读文本文件都走 readTextFile,只有 Core 按字节偏移截断或分段读的两份追加日志例外', () => {
    const repo = join(import.meta.dirname, '../..');
    const offenders: string[] = [];
    for (const top of ['src', 'bin', 'bots', 'scripts', 'templates']) {
      for (const rel of readdirSync(join(repo, top), { recursive: true }) as string[]) {
        const path = `${top}/${rel.split(sep).join('/')}`;
        if (!/\.(ts|tsx|mjs)$/.test(path) || /(^|\/)(node_modules|tests)\//.test(path) || path.endsWith('.test.ts')) continue;
        if (/readFile(Sync)?\([^;]*?['"]utf-?8['"]/.test(readFileSync(join(repo, path), 'utf8'))) offenders.push(path);
      }
    }
    // 允许直读的两类：
    //   ① 追加型日志（event-store、context-log）：按字节偏移截断或分段读，不走整份文本；
    //   ② World 侧的状态文件（bili-account 的若干份）：World 不依赖 core 的 util，
    //      给了它 readTextFile 反而把 Core 的内部工具变成 World 的依赖（边界反了）。
    // 第二类是现状而非理想；真要收，办法是给 World 一个宿主级文件接口，
    // 那是解耦方案 C 的事，不该在这条测试里假装已经做完。
    // 名单随文件拆分而增长是预期内的：拆出去的文件仍在同一层边界里，规则不变。
    expect(offenders.sort()).toEqual([
      'src/core/event-store.ts',
      'src/core/transcript.ts',
      'src/protocol/open-responses/context-log.ts',
      'legacy/bili-account-retired/causal-io.ts',
      'legacy/bili-account-retired/definition.ts',
      'legacy/bili-account-retired/paths.ts',
      'legacy/bili-account-retired/personaAdapter.ts',
      'legacy/bili-account-retired/prompts.ts',
      'legacy/bili-account-retired/tank.ts',
      'legacy/bili-account-retired/task-queue.ts',
    ]);
  });
});

describe('nowIso / parseTimeIn', () => {
  const processTz = process.env.TZ;
  afterEach(() => {
    if (processTz === undefined) delete process.env.TZ;
    else process.env.TZ = processTz;
  });

  it('偏移与进程所在时区无关,夏令时切换前后也对', () => {
    // 进程处在有夏令时的时区时,UTC 墙钟落进它跳过或重复的那一小时
    process.env.TZ = 'America/Chicago';
    expect(nowIso('Asia/Shanghai', new Date('2026-03-08T02:30:00Z'))).toBe('2026-03-08T10:30:00.000+08:00');
    expect(nowIso('America/Chicago', new Date('2026-03-08T07:30:00Z'))).toBe('2026-03-08T01:30:00.000-06:00');
    expect(nowIso('America/Chicago', new Date('2026-11-01T06:30:00Z'))).toBe('2026-11-01T01:30:00.000-05:00');
  });

  it('不带偏移的时刻按给定时区的墙钟读', () => {
    expect(parseTimeIn('Asia/Shanghai', '2026-07-16T12:10')).toBe(Date.parse('2026-07-16T12:10:00+08:00'));
    expect(parseTimeIn('America/Chicago', '2026-03-08T03:30')).toBe(Date.parse('2026-03-08T03:30:00-05:00'));
    expect(parseTimeIn('Asia/Shanghai', '2026-07-16T12:10:00Z')).toBe(Date.parse('2026-07-16T12:10:00Z'));
    expect(parseTimeIn('Asia/Shanghai', 'yesterday')).toBeNaN();
  });
});
