# A2 第二批收口施工表（2026-11-04 冻结现场）

停摆定性：**不是架构卡住，是模型断供**。该会话绑的自带密钥模型 `zcode/GLM-5.3-Flash` 额度已用尽，
每个 turn 重试满 11 次后以 `Internal server error` 收场，`input_tokens:0 output_tokens:0`，
所以表现为「空回复、正文为空」。日志证据：

```
~/.qoder/logs/sessions/D--workSoftWare-Qoder--qoder-versions-0-5-3/
  2bb66064-7c1f-82ec-90c6-2435a8168117/segments/2026-11-03T23-39-28-080+08-00-os7esk-p13996.jsonl
level:error model.request.attempt_failed attempt:11/11 status:200
  zcode: 账号在模型 "GLM-5.3-Flash" 上的额度已用尽或没有可用权益（上游返回 200 但没有任何内容，请求未送达模型）
level:error turn.finished reason:"error" input_tokens:0 output_tokens:0
```

该 segment 内「额度已用尽」出现 166 次；本地 10:39 起 `turn.finished` 全部 `0/0`，10:39 之前的 turn 均正常完成。
**额度不恢复或模型不换，对该会话发「继续」是无效的**（每次只会再烧约 6.5 分钟重试）。

## 现场快照（截至本文写出，未动过）

- 仓库 `E:\WorkSpace_Qoder\dsh-bili-whale`，分支 `private/port/core-opencode-panel`，**ahead 21 未推**
- 最后有效提交 `5fa4bc0`（B6 读侧函数化第一批）
- 未提交：`packages/cap-bilibili/src/client/bili-debrief.ts`（untracked）、
  `packages/cap-bilibili/tests/bili-debrief.test.mjs`（untracked）、`packages/cap-bilibili/src/index.ts`（M）
- 红测试：`node --experimental-strip-types --test packages/cap-bilibili/tests/bili-debrief.test.mjs`
  → `assert.equal(r.subtitles.count, 3, '官方字幕 3 行')` 实际 0，`hasTrack:false`

## 根因（已定位到行，别再从头试）

`src/client/bili-debrief.ts:129`

```ts
const r = await fetch(url, { headers: { ... } })
if (r.ok) {          // ← 这里
  try { lines = (JSON.parse(await r.text()).body ?? []).map(...) } catch {}
}
```

`bili-debrief.ts` 全文只有这一处依赖 Response 形状（grep `.ok|.status|.headers` 只命中 129 行）。
测试替身里六个分支全部是 `{ status: 200, json()/text()/arrayBuffer() }`，**没有一条给 `ok`**，
于是 `r.ok === undefined` → 假 → 字幕静默为空 → `hasTrack:false`。
元信息和弹幕两路不受影响：`jget` 只调 `.json()`，弹幕走 `arrayBuffer()`，都没判 `ok`。

顺带把上一版施工表里那个悬着的问题结掉：**代码里没有按时长过滤字幕的逻辑**，
`duration:600` 与第三条 `from:600,to:610` 不构成冲突，断言期望 3 行是对的，不要改松断言。

## 改法（二选一，推荐 A）

A. 实现侧兼容最小 Response 形状（保住「可注入替身」这个设计意图，不改测试期望）：

```ts
if (r.ok ?? r.status === 200) {
```

并在 `DebriefContext.fetch` 的注释里把替身契约写死：注入方**只需**提供
`json() / text() / arrayBuffer()`，`ok` 与 `status` 二者至少给一个。

B. 只补测试替身，六个分支都加 `ok: true`。生产代码不动，但下次别人写替身还会再踩。

## 收口步骤

1. 按 A 改 `bili-debrief.ts:129` + 补 fetch 契约注释
2. 单测跑绿：`node --experimental-strip-types --test packages/cap-bilibili/tests/bili-debrief.test.mjs`
   （第二个用例是「无字幕轨」分支，替身给 `subtitles: []`，改后应保持绿）
3. 全量回归（别把红带进基线）：基线为 100 文件 / 551 项 / fail 0
4. 提交 A2 第二批，三个文件一起收：`bili-debrief.ts` + 测试 + `index.ts` 接线
5. **本轮不要 push**：GitHub 443 不通（代理端口 7890/7897/10809 实测 000，仅 gh-proxy 取 raw 返回 200），
   等主人开 Clash 后一次性把 21+1 个提交推掉

## 接着排的两件

- **V-Now**：接 `dsh-see-now`（Apache-2.0，`SAOS-3624`）当她的实时视觉。它的 `capture/pipeline/png`
  是独立导出的纯模块，不经 DSH plugin 机制即可 import；用它按变化分的 rawvideo 管道替掉
  `bili_debrief` 第⑥路那个 `bili-watch.mjs` spawn 子进程方案（25 分钟片 ETIMEDOUT 的老根因就在这）。
- **A5 / V5 呈现层**：需要主人先拍板形象路线 A/B/C，**只出材料，不开工**。

## 主人这边要做的一件事

明天 zcode 免费额度按自然日重置后，在那个会话里直接发「继续」即可（它会读这份表）；
或者现在就把那个会话的模型从 `zcode/GLM-5.3-Flash` 换成有额度的（MiMo / 平台模型），换完立刻能接着跑。

## 收口回执（同日，另一个会话接手后实测）

按上文「改法 A」落地，断言没有改松：

- `src/client/bili-debrief.ts` 字幕分支改为 `r.ok !== false && (r.status ?? 200) < 400`，
  并把替身契约写进 `DebriefContext.fetch` 的注释（只需 json/text/arrayBuffer + ok 或 status 之一）。
- 同时写明**时长策略**：字幕行不按 `meta.durationSec` 裁剪——AI 字幕末行常越过片长
  （本例 `duration:600` 对 `from:600,to:610`），裁掉会把结尾话丢了。上文那条悬着的问题就此结掉。
- 单测：`node --experimental-strip-types --test packages/cap-bilibili/tests/bili-debrief.test.mjs` → 2/2 绿。
- 全量回归：`node scripts/run-mjs-tests.mjs` → **101 文件 / 553 项 / fail 0**
  （基线 100/551 之上多出本批新增的 1 文件 2 项，无回归）。
- 冻结哈希：`node scripts/check-hashes.mjs` → 一致。
- 未 push：GitHub 443 仍不通，本地 ahead 22，等 Clash 起来一次推掉。

**遗留（另立 A2 第三批，不夹带在本提交里）**：`bili_subtitles`、`bili_comments`、`bili_thread`、
`bili_whoami`、`bili_dynamic_recent` 五个读侧工具仍是占位实现——`bili_subtitles` 现在会返回
`subtitles: ''`，那是「看起来成功其实没取数」的形状，下一批必须换成真实现；
顺带合并包内两份 `MIXIN_TAB`（`bili-read.ts` 与 `bili-debrief.ts` 各一份）为单一 WBI 模块。
