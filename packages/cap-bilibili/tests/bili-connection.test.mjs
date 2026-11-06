import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createBilibiliCapability } from '../src/index.ts'
import { loadCredentials, parseCredentials } from '../src/client/bili-read.ts'
import { loadCredentials as writeLoad } from '../src/client/bili-write.ts'

/**
 * 「连接与凭据」这块的契约（2026-11-05，设计交接 story-4 的「换号只能手改文件」那一办）。
 *
 * 三条不可让的规矩，逐条钉住：
 *   ① **先验后写**：验不过一个字节都不落。写了坏凭据，她下次撞的是 -101，
 *      而页面看起来像"被风控"——本仓刚为这个误诊烧过一整轮。
 *   ② 值永不回显、不进返回值（只有有无 + 指纹）。
 *   ③ 写文件要保住 .env 里**别的键**，并且留一份带时间戳的备份。
 *
 * 顺带钉住两条这次一起修的旧伤：
 *   · 写侧与读侧必须同一个解析（以前写侧只认 JSON，`.env` 读出来是三个空串）；
 *   · 凭据要现读（以前是 create() 时取快照，换完 cookie 不重启就用不到新的）。
 */

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cap-bili-conn-'))

/** 假 B 站：nav 按 calls 里预置的身份回话，并记下每次带来的 cookie */
function fakeBili(nav) {
  const seen = []
  return {
    seen,
    fetch: async (url, init) => {
      const headers = (init && init.headers) || {}
      seen.push({ url: String(url), cookie: String(headers.Cookie ?? headers.cookie ?? '') })
      const j = String(url).includes('/nav') ? nav : { code: 0, data: {} }
      return { ok: true, status: 200, json: async () => j }
    },
  }
}

function setup(over = {}) {
  const dir = tmp()
  const dataDir = path.join(dir, 'data')
  const credFile = path.join(dir, '.env')
  fs.writeFileSync(credFile, [
    '# 她的部署 .env：还有别的键，绑定不能把它们冲掉',
    'SOME_OTHER_KEY=keep-me',
    'BILI_SESSDATA=OLD',
    'BILI_JCT=OLJ',
    'BILI_BUVID3=OLB',
    '',
  ].join('\n'))
  const bili = fakeBili(over.nav ?? { code: 0, data: { isLogin: true, mid: 497080562, uname: '恐怖深海鱼' } })
  const cap = createBilibiliCapability({
    dataDir,
    credentialsFile: credFile,
    fetch: bili.fetch,
    // 这一组钉的是「连接」页那几个方法的网络纪律（先验后写、值不回显、缺 SESSDATA 不动手），
    // 所以把监听那条后台链路关掉：不然启动时的 mid 补齐会多敲一次 nav，
    // 下面那些"一次都不该发请求"的计数就不知道在量谁了。耳朵的规矩另有测试（inbox-listener.test.mjs）。
    listenAutoStart: false,
  })
  // 挂一个假宿主：能力包里的 warn 日志得有地方落，否则"写失败被吞掉"这类事在测试里看不见
  const logs = []
  cap.start({
    homeDir: dir,
    dataDir,
    workspaceDir: dir,
    pushEvent: () => {},
    log: (level, msg, meta) => logs.push(`${level} ${msg} ${meta ? JSON.stringify(meta) : ''}`.trim()),
  })
  const panel = cap.panels().find((p) => p.id === 'connection')
  return { dir, dataDir, credFile, cap, panel, bili, logs, call: (m, p) => panel.methods[m].invoke(p) }
}

const method = (s) => (m, p) => s.panel.methods[m].invoke(p)

test('凭据解析只有一份：读写两侧对同一个 .env 得出同样的结果', async () => {
  const { credFile } = setup()
  assert.deepEqual(loadCredentials(credFile), writeLoad(credFile),
    '写侧原来是 JSON-only 的第二份实现，`.env` 在它手里读出来是三个空串')

  const cookie = 'buvid3=ABC; SESSDATA=XYZ; bili_jct=JZT; other=1'
  assert.deepEqual(parseCredentials(cookie), { sessdata: 'XYZ', bili_jct: 'JZT', buvid3: 'ABC' },
    '浏览器 DevTools 复制的 Cookie 头要能直接粘')
})

test('没 confirm 不许动她的登录身份', async () => {
  const s = setup()
  const r = await method(s)('bindCookie', { cookie: 'SESSDATA=NEW; bili_jct=NJ' })
  assert.equal(r.ok, false)
  assert.match(r.error, /confirm/)
  assert.match(fs.readFileSync(s.credFile, 'utf8'), /BILI_SESSDATA=OLD/, '没确认就一个字节都不该写')
  assert.equal(s.bili.seen.length, 0, '连校验请求都不该发（确认在请求之前）')
})

test('先验后写：B 站说没登录就什么都不落', async () => {
  const s = setup({ nav: { code: 0, data: { isLogin: false } } })
  const before = fs.readFileSync(s.credFile, 'utf8')
  const r = await method(s)('bindCookie', { cookie: 'SESSDATA=BAD; bili_jct=BADJ', confirm: true })
  assert.equal(r.ok, false)
  assert.match(r.error, /校验没通过.*什么都没写/s)
  assert.equal(fs.readFileSync(s.credFile, 'utf8'), before, '验不过就不许改文件')
  assert.equal(s.bili.seen.length, 1, '只发了一次校验请求')
  assert.match(s.bili.seen[0].cookie, /SESSDATA=BAD/, '校验要拿**新**凭据去问，不是现在这套')
})

test('校验通过才写：保住别的键、留备份、只回身份不回值', async () => {
  const s = setup()
  const r = await method(s)('bindCookie', { cookie: 'SESSDATA=NEW1; bili_jct=NEWJ; buvid3=NEWB', confirm: true })
  assert.equal(r.ok, true)
  assert.equal(r.identity.uname, '恐怖深海鱼')
  assert.equal(r.verified, true)

  const text = fs.readFileSync(s.credFile, 'utf8')
  assert.match(text, /SOME_OTHER_KEY=keep-me/, '.env 里别的键不能被抹掉')
  assert.match(text, /BILI_SESSDATA=NEW1/)
  assert.doesNotMatch(text, /BILI_SESSDATA=OLD/)
  assert.ok(fs.readdirSync(s.dir).some((f) => f.startsWith('.env.pre-bind-')), '要留一份带时间戳的备份')

  // 值不回显：整份返回值里不许出现任何一段凭据内容
  const dump = JSON.stringify(r)
  for (const secret of ['NEW1', 'NEWJ', 'NEWB']) {
    assert.ok(!dump.includes(secret), `返回值里出现了凭据值 ${secret}`)
  }
  assert.ok(!dump.includes('fp') || !/'NEW1/.test(dump))
})

test('换了号要主动说出来，并留下"上次是谁"这笔账', async () => {
  const s = setup()
  const r1 = await method(s)('bindCookie', { cookie: 'SESSDATA=S1', confirm: true })
  assert.equal(r1.ok, true, `绑定本身失败：${r1.error}`)
  assert.equal(r1.recorded, true, `绑定成功了但"上次是谁"没记上：${s.logs.join(' ｜ ')}`)
  const rec = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'bili-connection.json'), 'utf8'))
  assert.equal(rec.mid, '497080562')
  assert.ok(!JSON.stringify(rec).includes('S1'), '这笔账只记身份与指纹，不记 cookie')

  // 下一次探到的是另一个号
  const bili2 = fakeBili({ code: 0, data: { isLogin: true, mid: 999, uname: '别人的号' } })
  const cap2 = createBilibiliCapability({ dataDir: s.dataDir, credentialsFile: s.credFile, fetch: bili2.fetch })
  const p2 = cap2.panels().find((x) => x.id === 'connection')
  const r2 = await p2.methods.bindCookie.invoke({ cookie: 'SESSDATA=S2', confirm: true })
  assert.equal(r2.changedAccount, true, '换号必须被主动标出来')
  assert.equal(r2.previous.mid, '497080562')
})

test('「没验通也保存」要明说未校验，不假装成功', async () => {
  const s = setup({ nav: { code: -101, message: '未登录' } })
  const r = await method(s)('bindCookie', { cookie: 'SESSDATA=OFFLINE', confirm: true, allowUnverified: true })
  assert.equal(r.ok, true)
  assert.equal(r.verified, false)
  assert.match(fs.readFileSync(s.credFile, 'utf8'), /BILI_SESSDATA=OFFLINE/)
  const rec = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'bili-connection.json'), 'utf8'))
  assert.equal(rec.verified, false, '记录里也要留"当时没验通"')
})

test('缺 SESSDATA 就不动手，也不去问 B 站', async () => {
  const s = setup()
  const r = await method(s)('bindCookie', { cookie: 'DedeUserID=123; bili_jct=J', confirm: true })
  assert.equal(r.ok, false)
  assert.match(r.error, /没解析出 SESSDATA/)
  assert.equal(s.bili.seen.length, 0)
})

test('解绑：去掉那三项，别的键留着', async () => {
  const s = setup()
  const r = await method(s)('unbindCookie', { confirm: true })
  assert.equal(r.ok, true)
  const text = fs.readFileSync(s.credFile, 'utf8')
  assert.match(text, /SOME_OTHER_KEY=keep-me/)
  assert.doesNotMatch(text, /BILI_SESSDATA=/)
  assert.doesNotMatch(text, /BILI_JCT=/)
  assert.doesNotMatch(text, /BILI_BUVID3=/)
  assert.deepEqual(loadCredentials(s.credFile), { sessdata: '', bili_jct: '', buvid3: '' })
})

test('凭据是现读的：换完 cookie 不重启就用新的', async () => {
  const s = setup()
  const first = await method(s)('get', {})
  assert.equal(first.live.uname, '恐怖深海鱼')
  assert.equal(s.bili.seen.at(-1).cookie, 'SESSDATA=OLD; bili_jct=OLJ; buvid3=OLB')

  // 主人在页面外手改了文件（或另一个进程绑过）：下一次取就该看到新值
  fs.writeFileSync(s.credFile, 'BILI_SESSDATA=FRESH\n')
  await method(s)('get', {})
  assert.match(s.bili.seen.at(-1).cookie, /SESSDATA=FRESH/,
    '原来是 create() 时取的快照，换完 cookie 不重启就一直用旧的')
})

test('体检探不到时不空着：给出上一次绑定与"现在不一样"的提醒', async () => {
  const s = setup()
  await method(s)('bindCookie', { cookie: 'SESSDATA=S1', confirm: true })
  const cap2 = createBilibiliCapability({
    dataDir: s.dataDir,
    credentialsFile: s.credFile,
    fetch: async () => { throw new Error('网络不通') },
  })
  const p2 = cap2.panels().find((x) => x.id === 'connection')
  const t = await p2.methods.get.invoke({})
  assert.equal(t.ok, true, '网络不通不是体检失败，而是"探不到"')
  assert.equal(t.live.isLogin, false)
  assert.match(t.live.error, /网络不通/)
  assert.equal(t.stale, true)
  assert.equal(t.lastKnown.uname, '恐怖深海鱼', '要把上一次是谁摆出来，别让页面一片空白')
})
