// dislike 真的生效（2026-10-31 修）：feed 曾把 config.dislike 读进变量后从不使用——
// 她报「词表未生效」的字面根因。现在按与偏好同样的切分做硬拦。
import test from 'node:test'
import assert from 'node:assert/strict'
import { dislikeHit } from '../tools/lib/feed-quality.mjs'

const DISLIKE = ['带货', '擦边', '标题党', '纯搬运', '角色演示', '下载地址', '广告', '手书']

test('门类否定词命中：原神角色演示（含「冥想」宽词）被拦', () => {
  assert.equal(dislikeHit('《原神》角色演示-「阿贝多：白皑中的冥想」', DISLIKE), '角色演示')
  assert.equal(dislikeHit('三分钟带你看完下载地址大放送', DISLIKE), '下载地址')
})

test('正常助眠标题不误伤', () => {
  assert.equal(dislikeHit('39分钟纯雨声｜白噪音助眠，放下焦虑快速入眠', DISLIKE), null)
  assert.equal(dislikeHit('深夜电台：冥想轻音乐与海浪', DISLIKE), null)
})

test('切分与偏好一致：连接符不产生误词；<2 字词不参与', () => {
  assert.equal(dislikeHit('广告位招租', ['广告 与 弹窗']), '广告')
  assert.equal(dislikeHit('A的B', ['的']), null, '「的」单字被过滤，不拦')
})
