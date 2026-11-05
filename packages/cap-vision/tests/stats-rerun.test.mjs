/**
 * 这一看的统计看得见 + 能重跑（B13g · 批次 15 的前两块）。
 *
 * 缺口长什么样：
 *   · 画面统计（硬切点数 / 重复被丢的帧 / 最强帧分 / 每秒变化）**后端一直在算**，
 *     但运行记录里没存，面板上更看不见——主人只看到"摊成 3 张 / 留 12 帧"，
 *     不知道为什么是 3 张（变化弱？太重复？切得少？）；
 *   · 调完「留多少帧 / 多像算重复」之后，主人想立刻看到**同一条片子**在新参数下
 *     变成什么样，以前只能等她自己再看一遍。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createVisionCapability } from '../src/index.ts'
import { mountPanel, settle } from '../../../tests/helpers/panel-harness.mjs'
import { visionPanel } from '../src/webui/client.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cap-vision-stat-'))

/** 造一个假的视频文件 + 假的 analyze（不真跑 ffmpeg） */
function setup(analyzeResult) {
  const dir = tmp()
  const video = path.join(dir, 'movie.mp4')
  fs.writeFileSync(video, 'FAKE')
  const cap = createVisionCapability({
    dataDir: path.join(dir, 'vision'),
    analyze: async () => analyzeResult,
  })
  return { dir, video, cap, panel: cap.panels().find((p) => p.id === 'vision') }
}

const fakeResult = () => ({
  ok: true,
  source: { file: 'movie.mp4', durationSec: 60 },
  tuning: { width: 800, height: 450, fps: 1, maxFrames: 12, dupMin: 12 },
  stats: {
    frames: 40, kept: 12, cuts: 3, marks: 5, floors: 2, dupSkipped: 7, sheets: 2,
    msDecode: 1000, msPipeline: 500, scoreMax: 12.5, scoreAvg: 3.2, motionPerSec: 3.2, overflow: 0,
  },
  sheets: [
    { file: path.join('sheets', 'a.png'), fromSec: 0, toSec: 5, why: '开场变了', frames: [{ t: 0 }] },
    { file: path.join('sheets', 'b.png'), fromSec: 20, toSec: 25, why: '又变了', frames: [{ t: 20 }] },
  ],
  dropped: 0,
  truncated: false,
})

test('运行记录里要带着画面统计（以前只后端算、面板看不见）', async () => {
  const { cap, video } = setup(fakeResult())
  // 先真跑一遍（走 seeVideo 管道），运行记录才会产生
  const tool = cap.tools().find((t) => t.name === 'see_video')
  await tool.execute({ file: video })
  const panel = cap.panels().find((p) => p.id === 'vision')
  const snap = await panel.methods.getSnapshot.invoke({})
  assert.ok(snap.runs.length >= 1, '要有运行记录')
  const st = snap.runs[0].stats
  assert.ok(st, '运行记录要带 stats')
  assert.equal(st.cuts, 3)
  assert.equal(st.dupSkipped, 7)
  assert.equal(st.scoreMax, 12.5)
  assert.equal(st.motionPerSec, 3.2)
})

test('重跑：确认过才动手，跑完给新的拼图与统计', async () => {
  const { panel, video } = setup(fakeResult())
  // 没确认要**抛错**（与 cleanupSheets 同一种失败口径：写操作必须显式确认）
  await assert.rejects(
    () => panel.methods.rerun.invoke({ file: video }),
    /confirm/,
    '没确认就该抛（不许默默跑）',
  )

  const ok = await panel.methods.rerun.invoke({ file: video, confirm: true })
  assert.equal(ok.ok, true, ok.error)
  assert.equal(ok.sheets.length, 2)
  assert.equal(ok.stats.cuts, 3)
  // 重跑要留下运行记录（被拒的那次不算——它在动手前就抛了）
  const snap = await panel.methods.getSnapshot.invoke({})
  assert.ok(snap.runs.length >= 1, `重跑要记一笔，实得 ${snap.runs.length} 条`)
  assert.equal(snap.runs[0].stats?.cuts, 3, '记录里带着这一遍的画面统计')
})

test('重跑：文件不在了就说清楚，不许瞎跑', async () => {
  const { panel } = setup(fakeResult())
  const res = await panel.methods.rerun.invoke({ file: 'C:/not/here.mp4', confirm: true })
  assert.equal(res.ok, false)
  assert.match(res.error, /不在了/)
})

test('面板：统计摊在表里，且每行有颗「重跑」', async () => {
  const { cap } = setup(fakeResult())
  // 先跑一次，产生一条记录
  const panel = cap.panels().find((p) => p.id === 'vision')
  await panel.methods.rerun.invoke({ file: 'x', confirm: true }).catch(() => {})

  const h = mountPanel({
    getSnapshot: () => ({
      ffmpeg: { available: true, source: '注入', tried: [] },
      config: { targetFrames: 48, dupMin: 12, keepDays: 14 },
      sheets: { count: 2, bytes: 2048, newest: [] },
      runs: [{
        at: new Date().toISOString(),
        file: 'C:/movies/movie.mp4',
        ok: true,
        sheets: 2,
        kept: 12,
        frames: 40,
        ms: 1000,
        truncated: false,
        files: [],
        stats: { cuts: 3, dupSkipped: 7, scoreMax: 12.5, scoreAvg: 3.2, motionPerSec: 3.2, marks: 5, floors: 2 },
      }],
    }),
    rerun: () => ({ ok: true, sheets: [], stats: {} }),
  }, { panelId: 'vision' })
  visionPanel.mount(h.ctx)
  await settle()
  const text = h.root.textContent
  assert.match(text, /画面统计/, '要有这一列')
  assert.match(text, /切 3 · 重复丢 7 · 最强 12\.5 · 每秒 3\.2/, '统计要摊开成能读的数')
  assert.ok(text.includes('↻ 重跑'), '每行要有重跑那颗键')
})
