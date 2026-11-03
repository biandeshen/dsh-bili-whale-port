/**
 * 文件式工作区记忆（自 cormini/persona/memory.ts 抄入并去掉 cortico/* 依赖）：
 * 路径检查、文件读写、遍历、检索、二进制附件和 Git 历史。
 * 被 cap-memory 的记忆卡片与 cap-journal 的日记共同使用——每次改动都可回退。
 */
import {
  appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync,
  renameSync, rmdirSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, normalize as pathNormalize, relative, resolve, sep } from 'node:path';
import { WorkspaceGit } from './workspace-git.ts';

export const MEM_SCHEME = 'mem:';

export interface BlobStoreLike {
  put(nameHint: string, bytes: Uint8Array, mime: string): string;
  get(handle: string): { bytes: Uint8Array; mime: string } | null;
  list(prefix?: string): Array<{ handle: string; mime: string; size: number }>;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'audio/wav': '.wav',
  'audio/mpeg': '.mp3',
  'text/plain': '.txt',
  'application/json': '.json',
  'application/zip': '.zip',
};

export function mimeOfHandle(handle: string): string {
  const dot = handle.lastIndexOf('.');
  const ext = dot >= 0 ? handle.slice(dot).toLowerCase() : '';
  for (const [mime, e] of Object.entries(EXT_BY_MIME)) if (e === ext) return mime;
  return 'application/octet-stream';
}

export const SYSTEM_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

function getTimezoneOffsetMinutes(timezone: string, d: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  );
  return (asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000;
}

export function nowIso(timezone: string, d: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = `${fmt.format(d).replace(' ', 'T')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  const offMin = -getTimezoneOffsetMinutes(timezone, d);
  const sign = offMin >= 0 ? '+' : '-';
  const abs = Math.abs(offMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(Math.abs(abs % 60)).padStart(2, '0');
  return `${parts}${sign}${hh}:${mm}`;
}

export function isUtf16Le(bytes: Buffer): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;
}

export function decodeText(bytes: Buffer): string {
  if (isUtf16Le(bytes)) return bytes.subarray(2).toString('utf16le');
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes.subarray(3).toString('utf8');
  }
  return bytes.toString('utf8');
}

export function readTextFile(file: string): string {
  return decodeText(readFileSync(file));
}

/** 工作区层的可预期错误(路径逃逸、文件不存在等),消息可直接作为 tool result */
export class WorkspaceError extends Error {}

export const BLOBS_DIR = 'blobs/';
export const LIST_DIR_CAP = 10;

export function memHandle(rel: string): string {
  return `${MEM_SCHEME}${rel.split(sep).join('/')}`;
}

export function normalizeWorkspacePath(relPath: string): string {
  let raw = String(relPath ?? '').trim().replace(/\\/g, '/');
  const rooted = raw.startsWith('/');
  raw = raw.replace(/\/{2,}/g, '/');
  const normalized = raw
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.')
    .join('/');
  return rooted ? `/${normalized}` : normalized;
}

function insideWorkspace(root: string, rel: string): string {
  const abs = resolve(root, pathNormalize(rel));
  if (abs !== root && !abs.startsWith(root + sep)) throw new Error(`path escapes workspace: ${rel}`);
  return abs;
}

export function globToRegExp(glob: string): RegExp {
  const escape = (s: string): string => s.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const close = glob.indexOf('}', i);
      if (close < 0) {
        re += '\\{';
        continue;
      }
      re += `(?:${glob.slice(i + 1, close).split(',').map(escape).join('|')})`;
      i = close;
    } else re += escape(c);
  }
  return new RegExp(`^${re}$`);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileFacts(size: number, mtimeMs: number): string {
  return `(${formatSize(size)}, ${nowIso(SYSTEM_TIMEZONE, new Date(mtimeMs)).slice(0, 10)})`;
}

function listDirLines(abs: string, prefix: string, full: boolean): string[] {
  const names = readdirSync(abs).sort().filter((name) => !name.startsWith('.'));
  const shown = full ? names : names.slice(0, LIST_DIR_CAP);
  const out: string[] = [];
  for (const name of shown) {
    const child = join(abs, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    const st = statSync(child);
    if (st.isDirectory()) out.push(...listDirLines(child, rel, false));
    else out.push(`${rel} ${fileFacts(st.size, st.mtimeMs)}`);
  }
  if (names.length > shown.length) {
    out.push(`${prefix}/ … 共 ${names.length} 项,以上只列了前 ${shown.length} 项;list_files 指定 dir 为 ${prefix} 可列出全部`);
  }
  return out;
}

function walkFilesAbs(dir: string, prefix: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const abs = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(abs).isDirectory()) out.push(...walkFilesAbs(abs, rel));
    else out.push(rel);
  }
  return out;
}

function dirsFirst(a: { name: string; isDirectory(): boolean }, b: { name: string; isDirectory(): boolean }): number {
  return Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name);
}

function visibleEntry(name: string): boolean {
  return !name.startsWith('.') && !name.includes('.tmp-');
}

export class WorkspaceBlobStore implements BlobStoreLike {
  private readonly root: string
  private readonly dir: string

  constructor(root: string, dir: string = BLOBS_DIR) {
    this.root = root
    this.dir = dir
  }

  put(nameHint: string, bytes: Uint8Array, mime: string): string {
    let rel = pathNormalize(nameHint).split(sep).join('/').replace(/^\.\//, '');
    if (!rel.includes('/')) rel = `${this.dir}${rel}`;
    const abs = insideWorkspace(this.root, rel);
    if (existsSync(abs) && statSync(abs).isDirectory()) throw new Error(`${rel} 是目录`);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, bytes);
    void mime;
    return memHandle(relative(this.root, abs));
  }

  get(handle: string): { bytes: Uint8Array; mime: string } | null {
    const rel = handle.startsWith(MEM_SCHEME) ? handle.slice(MEM_SCHEME.length) : handle;
    if (!rel) return null;
    let abs: string;
    try {
      abs = insideWorkspace(this.root, rel);
    } catch {
      return null;
    }
    if (!existsSync(abs) || statSync(abs).isDirectory()) return null;
    return { bytes: readFileSync(abs), mime: mimeOfHandle(rel) };
  }

  list(prefix: string = this.dir): Array<{ handle: string; mime: string; size: number }> {
    let root: string;
    try {
      root = insideWorkspace(this.root, prefix || '.');
    } catch {
      return [];
    }
    if (!existsSync(root) || !statSync(root).isDirectory()) return [];
    const out: Array<{ handle: string; mime: string; size: number }> = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir).sort()) {
        if (name.startsWith('.')) continue;
        const abs = join(dir, name);
        const st = statSync(abs);
        if (st.isDirectory()) walk(abs);
        else {
          const rel = relative(this.root, abs);
          out.push({ handle: memHandle(rel), mime: mimeOfHandle(rel), size: st.size });
        }
      }
    };
    walk(root);
    return out;
  }
}

export interface GitWorkspaceMemoryOptions {
  memoryDir: string;
  blobsDir?: string;
  warn?: (msg: string, data?: unknown) => void;
}

export interface GrepFileHit {
  path: string;
  lines: string[];
  hits: number[];
}

export class GitWorkspaceMemory {
  readonly memoryDir: string;
  readonly blobs: WorkspaceBlobStore;
  readonly git: WorkspaceGit;

  constructor(opts: GitWorkspaceMemoryOptions) {
    this.memoryDir = resolve(opts.memoryDir);
    if (!existsSync(this.memoryDir)) mkdirSync(this.memoryDir, { recursive: true });
    this.blobs = new WorkspaceBlobStore(this.memoryDir, opts.blobsDir);
    this.git = new WorkspaceGit(this.memoryDir, opts.warn);
  }

  seed(files: ReadonlyArray<readonly [string, string]>): void {
    for (const [rel, body] of files) {
      const abs = this.resolveSafe(rel);
      if (existsSync(abs)) continue;
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body, 'utf8');
    }
  }

  ensureDirs(dirs: readonly string[]): void {
    for (const d of dirs) {
      mkdirSync(join(this.memoryDir, ...d.split('/').filter(Boolean)), { recursive: true });
    }
  }

  normalize(relPath: string): string {
    return normalizeWorkspacePath(relPath);
  }

  resolveSafe(relPath: string): string {
    const s = this.normalize(relPath);
    if (/^[a-zA-Z]:/.test(s) || s.startsWith('/') || isAbsolute(s)) {
      throw new WorkspaceError(`只接受工作区内的相对路径,不接受绝对路径:${s}`);
    }
    if (s.split('/').some((seg) => seg === '..')) {
      throw new WorkspaceError(`路径不能包含"..",不允许离开工作区:${s}`);
    }
    const abs = resolve(this.memoryDir, s);
    const rel = relative(this.memoryDir, abs);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new WorkspaceError(`路径解析后越出了工作区:${s}`);
    }
    return abs;
  }

  insideWorkspace(relPath: string): string {
    return insideWorkspace(this.memoryDir, relPath);
  }

  exists(relPath: string): boolean {
    try {
      return existsSync(this.resolveSafe(relPath));
    } catch {
      return false;
    }
  }

  isDir(relPath: string): boolean {
    try {
      const abs = this.resolveSafe(relPath);
      return existsSync(abs) && statSync(abs).isDirectory();
    } catch {
      return false;
    }
  }

  readFile(relPath: string): string {
    const abs = this.resolveSafe(relPath);
    if (!existsSync(abs)) throw new WorkspaceError(`文件不存在:${this.normalize(relPath)}`);
    if (statSync(abs).isDirectory()) {
      throw new WorkspaceError(`${this.normalize(relPath)} 是目录,用 list_dir 查看它`);
    }
    return readTextFile(abs);
  }

  writeFileAtomic(relPath: string, content: string): void {
    const abs = this.resolveSafe(relPath);
    if (existsSync(abs) && statSync(abs).isDirectory()) {
      throw new WorkspaceError(`${this.normalize(relPath)} 是目录,不能作为文件写入`);
    }
    mkdirSync(dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp-${Math.random().toString(36).slice(2, 8)}`;
    try {
      writeFileSync(tmp, content, 'utf8');
      renameSync(tmp, abs);
    } catch (error) {
      try {
        if (existsSync(tmp)) unlinkSync(tmp);
      } catch {
        // 保留原始写入错误。
      }
      throw error;
    }
  }

  appendFile(relPath: string, content: string): void {
    const abs = this.resolveSafe(relPath);
    if (existsSync(abs) && statSync(abs).isDirectory()) {
      throw new WorkspaceError(`${this.normalize(relPath)} 是目录,不能追加`);
    }
    mkdirSync(dirname(abs), { recursive: true });
    let payload = content;
    if (existsSync(abs)) {
      const bytes = readFileSync(abs);
      const prev = decodeText(bytes);
      if (prev.length > 0 && !prev.endsWith('\n')) payload = '\n' + payload;
      if (isUtf16Le(bytes)) {
        this.writeFileAtomic(relPath, prev + payload);
        return;
      }
    }
    appendFileSync(abs, payload, 'utf8');
  }

  renameFile(fromRel: string, toRel: string): void {
    const from = this.resolveSafe(fromRel);
    const to = this.resolveSafe(toRel);
    if (!existsSync(from)) throw new WorkspaceError(`文件不存在:${this.normalize(fromRel)}`);
    if (statSync(from).isDirectory()) {
      throw new WorkspaceError(`${this.normalize(fromRel)} 是目录,只能移动文件`);
    }
    if (existsSync(to)) {
      throw new WorkspaceError(`目标已存在:${this.normalize(toRel)},换个名字或先删除它`);
    }
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
  }

  deleteFile(relPath: string): void {
    const abs = this.resolveSafe(relPath);
    if (!existsSync(abs)) throw new WorkspaceError(`文件不存在:${this.normalize(relPath)}`);
    if (statSync(abs).isDirectory()) {
      throw new WorkspaceError(`${this.normalize(relPath)} 是目录,只能删除文件`);
    }
    unlinkSync(abs);
  }

  pruneEmptyDirs(relPath: string): void {
    let dir = dirname(this.resolveSafe(relPath));
    while (dir !== this.memoryDir && dir.startsWith(this.memoryDir + sep)) {
      if (!existsSync(dir) || readdirSync(dir).length > 0) return;
      rmdirSync(dir);
      dir = dirname(dir);
    }
  }

  listDir(relPath = ''): string[] {
    const abs = this.resolveSafe(relPath);
    if (!existsSync(abs)) throw new WorkspaceError(`目录不存在:${this.normalize(relPath) || '工作区根'}`);
    if (!statSync(abs).isDirectory()) {
      throw new WorkspaceError(`${this.normalize(relPath)} 是文件,用 read_file 读它`);
    }
    return readdirSync(abs, { withFileTypes: true })
      .filter((e) => visibleEntry(e.name))
      .sort(dirsFirst)
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
  }

  walkFiles(rel = ''): string[] {
    const abs = this.insideWorkspace(rel || '.');
    const prefix = relative(this.memoryDir, abs).split(sep).filter(Boolean).join('/');
    return walkFilesAbs(abs, prefix);
  }

  listing(dir = ''): string {
    const abs = this.insideWorkspace(dir || '.');
    if (!existsSync(abs)) return `[not found] ${dir}`;
    if (!statSync(abs).isDirectory()) return `[not a directory] ${dir}`;
    const rel = relative(this.memoryDir, abs).split(sep).filter((s) => s !== '').join('/');
    const lines = listDirLines(abs, rel, true);
    if (lines.length === 0) return rel ? `${rel}/ is empty.` : 'Your workspace is empty.';
    return `Files in ${rel ? `${rel}/` : 'your workspace'}:\n${lines.map((f) => `- ${f}`).join('\n')}`;
  }

  tree(): string {
    const lines: string[] = ['persona/'];
    const walk = (abs: string, prefix: string): void => {
      const entries = readdirSync(abs, { withFileTypes: true })
        .filter((e) => visibleEntry(e.name))
        .sort(dirsFirst);
      entries.forEach((e, i) => {
        const last = i === entries.length - 1;
        lines.push(prefix + (last ? '└── ' : '├── ') + e.name + (e.isDirectory() ? '/' : ''));
        if (e.isDirectory()) walk(join(abs, e.name), prefix + (last ? '    ' : '│   '));
      });
    };
    walk(this.memoryDir, '');
    return lines.join('\n');
  }

  treeShallow(): string {
    const lines: string[] = ['persona/'];
    for (const e of readdirSync(this.memoryDir, { withFileTypes: true })
      .filter((entry) => visibleEntry(entry.name))
      .sort(dirsFirst)) {
      lines.push(e.isDirectory() ? `${e.name}/` : e.name);
    }
    return lines.join('\n');
  }

  globFiles(pattern: string, dir = ''): string[] {
    const re = globToRegExp(pattern.startsWith('**/') ? pattern : `**/${pattern}`);
    return this.walkFiles(dir)
      .filter((f) => re.test(f))
      .map((f) => ({ f, mtime: statSync(join(this.memoryDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .map((x) => x.f);
  }

  facts(relPath: string): string {
    const st = statSync(join(this.memoryDir, relPath));
    return fileFacts(st.size, st.mtimeMs);
  }

  grep(opts: { match: (line: string) => boolean; path?: string; filter?: RegExp | null }): GrepFileHit[] {
    const where = opts.path ?? '';
    const abs = this.insideWorkspace(where || '.');
    const files = statSync(abs).isDirectory()
      ? this.walkFiles(where)
      : [relative(this.memoryDir, abs).split(sep).join('/')];
    const out: GrepFileHit[] = [];
    for (const f of files) {
      if (opts.filter && !opts.filter.test(f)) continue;
      if (f.split('/').some((seg) => seg.includes('.tmp-'))) continue;
      let buf: Buffer;
      try {
        buf = readFileSync(join(this.memoryDir, f));
      } catch {
        continue;
      }
      const text = decodeText(buf);
      if (text.includes('\0')) continue;
      const lines = text.split(/\r?\n/);
      const hits: number[] = [];
      lines.forEach((l, i) => { if (opts.match(l)) hits.push(i); });
      if (hits.length === 0) continue;
      out.push({ path: f, lines, hits });
    }
    return out;
  }
}
