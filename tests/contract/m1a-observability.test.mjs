// 资产根收口契约：路径唯一来源（env → 旧路径-if-exists → whale home，两个环境变量名都认）。
// 原本还管 causal 投影 / timeline / 三队列合并，那些都在旧 panel 里；旧 panel 退役后
// 这三条的判据一并退场，留下的只有 paths.mjs 这一条仍在生效的路径契约。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { DSH_HOME, draftsDir, imagesDir } from '../../tools/lib/paths.mjs'

test('M1a：draftsDir/imagesDir——env 优先且胜过存在的旧路径；两个旧变量名都认', () => {
  assert.equal(draftsDir({ WHALE_DRAFTS: '/tmp/x-drafts' }), '/tmp/x-drafts')
  assert.equal(draftsDir({ WHALE_DRAFTS: '/tmp/env-wins' }, { legacy: 'D:/AI/养鱼/drafts' }), '/tmp/env-wins')
  assert.equal(imagesDir({ WHALE_IMAGE_DIR: '/tmp/a', WHALE_IMAGES: '/tmp/b' }), '/tmp/a')
  assert.equal(imagesDir({ WHALE_IMAGES: '/tmp/b-only' }), '/tmp/b-only')
  // 无 env：home 兜底（legacy 显式传不存在的路径）
  const noLegacyDrafts = draftsDir({}, { legacy: path.join(os.tmpdir(), 'no-such-legacy-drafts') })
  assert.equal(noLegacyDrafts, path.join(DSH_HOME, 'bili-whale', 'drafts'))
  const noLegacyImages = imagesDir({}, { legacy: path.join(os.tmpdir(), 'no-such-legacy-images') })
  assert.equal(noLegacyImages, path.join(DSH_HOME, 'bili-whale', 'assets', 'daily'))
  // legacy 存在则用 legacy（本机 D:/AI 场景）
  const realLegacy = fs.mkdtempSync(path.join(os.tmpdir(), 'm1a-legacy-'))
  assert.equal(draftsDir({}, { legacy: realLegacy }), realLegacy)
  assert.equal(imagesDir({}, { legacy: realLegacy }), realLegacy)
})
