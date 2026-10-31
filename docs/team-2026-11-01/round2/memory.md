# 第二轮研究 · 记忆与连续性席（小鱼 / bili-whale）

日期：2026-11-01 · 席位：记忆与连续性 · 只研究不改代码

## 0. 摘要（结论先说）

四步链路「写入 → 衰减 → 召回 → 落到产物」的**代码都在，前两步已修好，第三步只读不写，第四步真接上但产出的是假连续性**。
2026-10-28 红队的两条老问题（记忆永不衰减 / describeState 永远最早三条）**都已修复**，修复处留有决策注释（`applyEffects` 的小数天衰减 `personaAdapter.ts:213-216`、`recallMemories` 的四信号打分 `retrieval.ts:144`）。
真正的断点四处：① 召回不回写——`recallMemory`（`memory.ts:95-106`）在生产路径**零调用点**，37 条记忆 `accessCount` 全为 0，"越常用越牢"名存实亡；② 没有任何重要度信号进强度/衰减——被放行/被拒/风控/主人回话只改场值（`definition.ts:197-215` 结算时不碰 memories），`pinned` 与 `milestone` 两条通道无人写入，唯一通道 flashbulb 被刺激量劫持成 **54% 通胀**；③ `source` 缺省 `user_said` 把她自己的 note 错标（实测 **17/37** 条），"按来源分级"被污染；④ **产物里的回扣全是当天记忆**——3 份带 voice 的草稿里被引用的 3 条记忆 `days` 全部为 0，正文开头已是"今晚看的是《A》"，再补一句"我今天记下的《B》还在"，B 也是今天看的；10-31 更因 `snippetOf` 不处理嵌套书名号 + `!text.includes(snippet)` 的字符串包含式去重，把唯一的回扣整个吞掉。

---

## 1. 四步链路的真实实现与证据

### 1.1 写入：三个真实入口，全在 `Cortico/src/worlds/bili-account/definition.ts`

| 入口 | 触发 | 内容 | sender / intensity / source | 证据 |
|---|---|---|---|---|
| 看完一条视频 | debrief 回执解析出标题+UP | `看过《标题》（UP） —— BV…` | `npc` / `clamp(stimulation,0.1,1)` / `npc_self` | `definition.ts:147-156`（`rememberWatch`） |
| 自己写一句话 | `bili_mood_apply` 带 `note` | 原句 | `npc` / `clamp(after.fields.stimulation)` / **缺省 `user_said`** | `definition.ts:658-663` → `personaAdapter.ts:260-279` |
| 主人私信 | `bili_dm_read` 收到信 | 正文前 500 字 | `player` / 固定 `0.7` / 缺省 `user_said`，tags `['dm']` | `definition.ts:775` |

`remember()` 本体（`personaAdapter.ts:260-279`）：`vividness` 固定 0.9 起步、`accessCount` 0、`emotion.valence` 取当下 `s.fields.mood`、`encodingStrength = calculateEncodingStrength(intensity)`（Yerkes-Dodson，峰在 0.6，`memory.ts:62-65`）、`flashbulb = tags 含 milestone 或 intensity > 0.8`（`personaAdapter.ts:263`，规则源头 `memory.ts:73-86`）。

写入侧的两个真实缺陷：
- **`source` 缺省即 `user_said`**（`personaAdapter.ts:277`）。`bili_mood_apply` 的 note 与 dm 都没传 `source`，于是「她自己想的话」和「主人说的话」在衰减率上被同一套 `user_said: 0.9`（最慢）优待（`memory.ts:8`），本应是 `npc_self: 1.0`。这不影响可读性，但污染了「按来源分级」这条设计意图（D 表里的 F26）。
- **`intensity` 只有一个来源：刺激量**。写入时刻的 `fields.stimulation` 高 ≠ 这件事重要，见 §3。

### 1.2 衰减：老 bug（D-02）已修，实测数据可证

`personaAdapter.ts:211-216`：

```
const elapsedMs = Math.max(0, now - Date.parse(s.lastAppliedAt))
const days = elapsedMs / 86400_000
const memories = days > 0 ? s.memories.map((m) => decayMemory(m, days)) : s.memories
```

注释直接点名旧问题（"旧实现要求距上次 ≥1 天才衰减，而 lastAppliedAt 每 tick 重置 → 记忆永远不淡（D-02）"）。现在每 tick 结算真实毫秒折成的小数天，3–7 分钟的生活循环每轮贡献 `days ≈ 0.002–0.005`，累计到日 ≈ `0.02 × sourceRate`，与 `decayMemory` 的 `BASE_DECAY_RATE = 0.02`（`memory.ts:16-38`）一致。
`decayMemory` 里 pinned 免疫（`memory.ts:29`）、flashbulb 0.2 倍（`memory.ts:4`、`memory.ts:32`）、来源倍率（`memory.ts:7-14`）三条分支都真实生效——**只要上面两个入参被正确赋值**，而 §1.1 说明它们没有。

实测（只读 `C:/Users/Administrator/.dsh/bili-whale/fields.json`）：37 条记忆 `vividness` 落在 **0.842–0.900**，最老 3.9 天的那条是 0.8416（0.9 − 0.0584 ≈ 0.015/天，量级与 0.02×来源率吻合，缺的部分是没被结算到的间隙）。**没有一条归零、没有一条 pinned**。结论：衰减路径通了，但速率仍然慢到「4 天看不出差别」。

### 1.3 召回：只读，且不回写 —— 链路真正断在这里

召回有两个消费口，都走同一个纯函数 `recallMemories`（`persona-core/src/retrieval.ts:101-169`）：
- 提示词侧：`describeState`（`personaAdapter.ts:305-324`），情境 = `queryText`（日记尾部，见 `definition.ts:615/639/685` 的 `diaryTail()`）+ 本轮非 decay 因果；`k=3, surprises=1`，输出带 `记得/忽然想起｜主人/我：…（刻在心里）`。
- 产物侧：`buildVoiceBrief`（`persona-core/src/voice-brief.ts:58-77`），`k` 默认 3、`surprises` 默认 1，`query.text` = 当天公开日记尾 2000 字（`definition.ts:702-705`）。

**老问题（D-03，"按 vividness 取 top3 → 永远最早三条"）已修**：`recallMemories` 用的是 `0.40 关键词(idf) + 0.30 鲜活 + 0.15 情绪相近 + 0.15 新鲜` 的加权和（`retrieval.ts:144`），并且 `memorySalience`（`memory.ts:45-50`）与之一致；意外槽要求 `days>=7 && accessCount===0 && !flashbulb`（`retrieval.ts:157-161`）。

**但断链未修**：`recallMemory()`（`memory.ts:95-106`，"被想起就变清晰 + accessCount+1"）**在生产代码里没有任何调用点**。全仓 grep 只有 `persona-core/src/memory.ts:95` 定义处与 `persona-core/tests/core.test.mjs:6,83` 测试。`describeState` / `buildVoiceBrief` / `recallMemories` 全部是纯函数读，不写回 state。运行时数据坐实：fields.json 37 条记忆的 `accessCount` **全部为 0**。
连带两个后果：
1. 「越常用越牢」这条人设机制名存实亡；
2. 意外槽的 `accessCount === 0` 判据永真，"一直没被想起"退化成了"凡是 7 天以上的普通记忆都能当惊喜"，等记忆池年龄超过 7 天后会开始重复引用同一批旧事。

### 1.4 落到产物：真接上了，但门槛形同虚设

`definition.ts:696-717`（第 6 步出稿）→ `buildVoiceBrief` → 落 `control/voice-<day>.json` → `scripts/draft-dynamic.mjs --voice`（`draft-dynamic.mjs:50-66`，缺 voice 直接拒稿，`--no-voice` 才算降级）→ `tools/drafts/compose.mjs:composeDraft`（`compose.mjs:149-182`）。

回扣句本体（`compose.mjs:164-173`）：

```
const m = (voice.memories || []).find((x) => x.slot !== 'surprise' && x.score > 0.5)
...
`你${when}说的「${snippet}」我还记着。`   // from === 'player'
`我${when}记下的《${snippet}》还在。`     // from === 'npc'
```

`when` 来自 `VoiceMemory.days`（`voice-brief.ts:75`），确实带出处（今天/昨天/N 天前）。这满足了「能在产物里回扣出处」。
问题在挑选判据：`score > 0.5` 在**零关键词命中**时也能过——`0.30×0.9（鲜活）+ 0.15×1（情绪相近）+ 0.15×recency ≈ 0.57`。也就是说，只要今天心情和记忆形成时的情绪差距不大、记忆不满 30 天，一条与正文毫无关系的记忆也能被写进草稿。真正的相关性（`kw`，权重 0.40）被"基线分"吃掉了。这是"看起来有记忆"的来源之一，见 §5 的反面风险。

另一处已存在的防重复机制：`findDuplicateText` 只拦"一字不差"的跨日草稿（`compose.mjs:185-187`，`draft-dynamic.mjs:76-80`），拦不住"每天同一句式换个片名"。

第四步实测出来的两个具体缺陷（详见 §2.2）：
- **`snippetOf` 不处理嵌套书名号**：`compose.mjs:135` 的 `/看过《([^》]+)》/` 对 `看过《《原神》角色演示-…》` 只取到 `《原神`（半句），既污染了引用，又触发了下一条的抑制。
- **抑制条件是字符串包含**：`compose.mjs:167` 的 `!text.includes(snippet)` 本意是"别把刚说过的话再说一遍"，实际效果是**正文里一旦出现片名，那条记忆就永远不会被回扣**——10-31 就是这样丢掉唯一一次跨源回扣的（那天被选中的记忆 `days` 仍是 0）。
- **回扣的"连续性价值"没有被约束**：`composeDraft` 只看 `score`，不看 `days`。当记忆池最老 4 天时，`score>0.5` 的候选几乎全是当天写的（实测 3/3 都是 `days: 0`），产出的是"今天还看了另一条"这种冗余信息。

### 1.5 出产物之后的回流：只学词，不学记忆

`tools/lib/feed-feedback.mjs:32-39` 把「被赞事件 + 收藏 + `status==='sent'` 的草稿正文」抽成主题词，喂回馈（选片偏好）。**这条回流里没有 memory id**，所以"哪条记忆被引用后带来了正反馈"这件事没有任何记录点，重要度信号也无法反哺 §1.1 的强度或 §1.2 的衰减。

---

## 2. 她的真实数据（只读复核）

### 2.1 记忆池

`C:/Users/Administrator/.dsh/bili-whale/fields.json`（schemaVersion 5，`lastAppliedAt` 2026-10-31T15:45:58Z）：

- 记忆 **37 条**；`chain` 56 条；`emotionHistory` 24（上限 24，`personaAdapter.ts:132`）。
- source：`user_said` 20、`npc_self` 17。其中 **`user_said` 且 `sender=npc` 的有 17 条**（实测计数）——全是 `bili_mood_apply` 的 note 走缺省值误标（§1.1），样本如「今天把『弹幕密度』这把尺子磨了一道：打卡集中在开…」。主人真正留下的话只有 3 条（sender=player，全部来自 `inbound`）。
- 年龄：**>1 天的有 15 条，最老 3.9 天；没有一条 ≥7 天**（意外槽的硬门槛 `retrieval.ts:158`）。
- vividness：**0.842–0.900**，最老那条 0.8416（0.9 − 0.0584 ≈ 0.015/天，与 `BASE_DECAY_RATE 0.02 × sourceRate` 量级一致）；pinned **0 条**；`accessCount` **37 条全部为 0**。
- flashbulb：20/37 = **54% 为真，且 20 条全部是 sender=npc**（player 0 条）、其中 11 条还是被误标的 note。tags 只有 `dm`，没有任何 `milestone` → 这 20 条全部由「写入瞬间 `stimulation > 0.8`」造成（§3）。
- `encodingStrength` 落在 0.666–0.960，同样只是刺激量的映射，无重要度含义。

### 2.2 产物回扣实况（`D:/AI/养鱼/drafts/`，6 个日档，3 个带 voice）

`drafts/*.json` 里 `voice` 字段就是当轮 `control/voice-<day>.json` 的副本，可以直接对照正文：

| 日期 | status | voice | 被引用记忆 | 该记忆几天前 | 正文里的回扣句（原文） |
|---|---|---|---|---|---|
| 10-26 | sent | ❌（无 voice，早期/降级） | — | — | 无回扣句 |
| 10-27 | dry-run | ❌ | — | — | 无 |
| 10-28 | failed | ❌ | — | — | 无 |
| 10-29 | cooldown | ✅ 3 条 | `mem-mvtjl1qi-vouc` | **0 天（当天）** | 「今晚看的是《世界公认最佳解压、432Hz疗愈雨声（39:55…》。…**我今天记下的《8D全景声音环绕，432hz更舒缓更助眠》还在。** 脑子里冒出个小点子。」 |
| 10-30 | sent | ✅ 3 条 | `mem-mvtssrp3-z1de` | **0 天（当天）** | 「…**六千人给这句话点了赞。 我今天记下的《【失眠不怕】40min瑜伽休息术，高效补》还在。** 有点坐不住，想做点什么。」 |
| 10-31 | failed | ✅ 3 条 | `mem-mvvaekr8-t4jn` | **0 天（当天）** | **本轮没有回扣句**（正文 102 字，无「还在。」） |

三个硬结论：
1. **回扣率 100%，但连续性证据 0%**：三条被引用的记忆 `days` 全是 0，都是"今天另外看过的一条视频"。正文开头已经是「今晚看的是《A》」，再补一句「我今天记下的《B》还在」——B 与 A 同属今天，读者看到的只是今天看了两条，不是她有过去。
2. **句式已经模板化**：10-29 与 10-30 一字之差同构（`我今天记下的《…》还在。`）。`findDuplicateText` 只拦全文相等（`compose.mjs:185-187`），拦不住这种句式重复。
3. **10-31 为什么没引用**——真实缺陷，两条叠加：
   - 首选记忆正文是 `看过《《原神》角色演示-「阿贝多：白皑中的冥想」…》`，`snippetOf` 的正则 `/看过《([^》]+)》/`（`compose.mjs:135`）在第一个 `》` 处截断 → 片段变成半句 **`《原神`**（双重书名号未处理）；
   - 抑制条件 `!text.includes(snippet)`（`compose.mjs:167`）因此命中了正文里「今天 feed 给了我一整部《原神》角色演示」→ **本该出现的回扣被判定为"已说过"而消失**。
   即：正文越需要回扣（当天看的就是那条），越会被这个字符串包含式去重吞掉。
4. **意外槽从未触发**：三个 voice 文件的 `memories` 全是 `slot: 'core'`、`score` 0.96–0.97、`why` 全是「和眼下的事有关（100%） · 刻在心里 · 鲜活 0.90 · 当时的心情和现在接近 · 0 天前」。分数区间只有 0.006，四信号打分目前退化成"当天写的都是满分"——因为 `kw` 与 `recency` 与 `emo` 在同一批当天记忆里同时取到上限。
5. `why` 里恒定出现「刻在心里」（flashbulb），与 §2.1 的 54% 通胀互为印证：提示词里几乎每条记忆都被标成"刻骨铭心"，这个标签没有信息量。

---

## 3. 「重要记得牢」目前有没有重要度信号？

**明确回答：没有任何重要度信号参与记忆强度或衰减。** 逐项核对：

| 信号 | 是否影响 vividness / 衰减 | 证据 |
|---|---|---|
| 草稿被主人放行 `draftApproved` | ❌ 只加 `mood +0.05 / creativity +0.03`，与 memories 无关。审批结果**确实由代码结算**（不指望模型自觉调 `mood_apply`），但结算只走场值效果 | `personaAdapter.ts:76-82`、`definition.ts:197-215`（`consumeDraftResults` → `applyEffects(PRESETS[...].effects)`） |
| 草稿被拒 `draftRejected` | ❌ 只改 `mood −0.04 / creativity −0.02`；同批多条只取最近一条（避免灌爆场值），同样不碰记忆 | `personaAdapter.ts:83-89`、`definition.ts:205-213` |
| 平台风控 `trafficPaused` | ❌ 只改 `energy / mood` | `personaAdapter.ts:90-96` |
| 主人回话 `masterReplied` / `inbound` | ❌ 改 `connection / mood / social`；只有"信的内容"作为**新**记忆写入（固定 intensity 0.7），不强化被回扣的旧记忆 | `personaAdapter.ts:53-68`、`definition.ts:775` |
| 被赞 / 收藏 | ❌ 只进主题词表 | `tools/lib/feed-feedback.mjs:32-39` |
| 被召回 / 被引用 | ❌ 机制存在但无调用点（`recallMemory` 死代码，全仓只有 `persona-core/tests/core.test.mjs:6,83` 引用） | `memory.ts:95-106` |
| 唯一实际的"记得牢"通道 | `intensity > 0.8` → flashbulb（0.2× 衰减）+ `milestone` tag + `pinned` | `memory.ts:4,29,32,73-86`、`personaAdapter.ts:263` |

三条通道里两条**在生产代码里没有任何写入点**：`pinned` 只在 `memory.ts:29` 被读、`persona-core/src/types.ts:98` 被声明，无人赋值；三个 `remember()` 调用方传的 tags 是 `[]`、`[]`、`['dm']`，不含 `milestone`（`definition.ts:150-155`、`658-663`、`775`）。剩下 flashbulb 被刺激量劫持成 **54% 通胀**（§2.1）。

---

## 4. 可证伪的记忆闭环设计（改哪些函数 / 加什么字段 / 跑几天看什么数）

设计原则：所有指标必须能从 `fields.json` + `drafts/*.json` + `causal.jsonl` 直接算出来，且默认值不改变现有文案分布（只有真的发生事件才变）。

### 4.1 加字段（`Memory`，向后兼容：缺省即旧行为）
- `importance: number`（0..1，写入时 = `0.5 + 0.5 × 事件权重`，之后**只被外部反馈上调**）
- `lastRecalledAt: string | null`、`recallCount: number`（`accessCount` 保留做兼容，但语义交给 `recallCount`）
- `citedIn: Array<{ draftId: string; date: string; sent: boolean }>`（回扣历史，用于去重与统计）
- `source: 'npc_note'` 新枚举（把 note 类从 `user_said` 分出来）
- `milestone` 只由显式事件写入，不再由 `intensity` 推定

### 4.2 改函数（4 处，均为纯函数改签名不变或加可选参）
1. `personaAdapter.ts:remember()` — `source` 由调用方显式传；`flashbulb` 改为 `milestone tag || (intensity > 0.8 && importance 事件白名单)`；初始 `vividness = 0.5 + 0.4 × importance`（不再恒 0.9）。
2. `personaAdapter.ts:applyEffects()` — 在现有小数天衰减之后加一行：`vividness` 的有效率乘 `decayMemory(m, days, { importanceScale: 1 - 0.5 × importance })`；`memory.ts:decayMemory` 增加第三参 `opts.importanceScale = 1`（默认值保证老测试不变）。
3. `retrieval.ts:recallMemories()` 之后新增 `commitRecall(state, recalled, now)`（放 `personaAdapter.ts`），把 `recallMemory` 的增益真正写回：`vividness += boost`、`recallCount += 1`、`lastRecalledAt = now`。调用点：`definition.ts` 的 `describeState` 之后（第 501/615/639/685 行）、`buildVoiceBrief` 之后（第 702 行，写出 voice 文件时一并 `saveState`）。
4. `compose.mjs:composeDraft()` — 三个具体改动：
   - **挑选门槛**：`x.score > 0.5` 改成双门槛 `x.score > 0.5 && x.kw > 0.15`（`VoiceMemory` 需要新增 `kw`，由 `voice-brief.ts:69-77` 从 `RecalledMemory` 拆出，`retrieval.ts:145` 已经算好了），加一条**连续性优先**：先取 `days >= 1` 的候选，只有整池都没有 >1 天的相关记忆时才允许 `days === 0`（此时宁可不写回扣句——今天看过两条不是记忆）。
   - **去重换成 id**：把 `!text.includes(snippet)`（`compose.mjs:167`）换成 `!m.citedIn.some(c => c.date === date) && !citedToday`，`citedToday` 判定用 `tokensOf(m.content)` 与 `tokensOf(text)` 的重叠率 ≥0.35，而不是子串包含（修掉 §1.4 的《原神》误吞）。
   - **`snippetOf` 修书名号**：`compose.mjs:135` 的正则改成先剥掉记忆里的成对 `《》` 再取片名（或直接用 `clipTitle`），保证片段永远是完整片名，不出现 `《原神` 这种半句。

### 4.3 反馈写入（新事件 → `importance`，只在已有回执处加，不新增网络调用）
- `dynamic-approve.mjs` 放行 / 发送成功 → 对 `draft.voice.memories[cited].id` 执行 `importance += 0.1`、`vividness = min(1, vividness + 0.05)`。
- 被拒 → `importance += 0.05`（被拒也是重要——她不该忘掉挨骂的那次），但 `vividness` 不涨。
- 主人私信引用了某条记忆（`dm-reply` 或 `inbound` 文本与某条 `user_said` 记忆关键词重叠 >0.2）→ `importance += 0.15`。
- 风控 `trafficPaused` → 不写 importance（是环境不是事件）。
- 落点：`definition.ts` 已有的 `latestDraftFeedback` / `draftApproved` 分支，加 `memoryId` 参数走一次 `applyEffects` 之后的 `boostMemory()`。

### 4.4 跑 7–14 天后应当看到的数字（可证伪判据）
| 指标 | 算法（全部只读现有文件） | 期望 |
|---|---|---|
| 召回回写率 | `fields.json` 里 `recallCount > 0` 的记忆条数 | 当前 **0/37** → 应 >0，且随天递增 |
| vividness 分布 | `min / max / 标准差` | 现在 0.842–0.900（std ≈0.02）→ 14 天后 std ≥ 0.15，出现 <0.6 的"变淡"群体 |
| 30 天前记忆被回扣率 | 草稿里 `days ≥ 30` 的回扣句 / 总回扣句 | 现在恒为 0（没有 30 天以上的记忆）→ 建立基线后应 >0（证明久远仍可忆起，但仅限 flashbulb/importance 高的） |
| 同条重复引用率 | 同一 `memoryId` 在 30 天内被引用 ≥2 次的比例 | 现在无法计算（无 `citedIn`）→ 加了之后应 **<10%**（高于此说明她在背模板） |
| 跨天引用天数分布 | 各草稿的 `m.days` 直方图 | 现在只有 0/1/2；闭环后应出现长尾（3–14 天档），且 `days≥7` 的主要来自 surprise 槽 |
| flashbulb 通胀 | `flashbulb / total` | 现在 **54%** → 应降到 <15%，且每一条都能对应到 `causal.jsonl` 里的一个 milestone/被拒/被赞事件 |
| 反事实可分性 | `scripts/counterfactual.mjs` 空状态 vs 真实状态的草稿 diff | 记忆段应贡献可测差异（当前 mood 与 memory 混在一起，去掉 memories 后 diff 只来自情绪尾句） |
| **当天回扣率**（本席新增的关键指标） | 草稿回扣句中 `voice.memories[].days === 0` 的占比（`drafts/*.json` 里 voice 是内联的，直接算） | **现在 3/3 = 100%**（10-29/10-30 有句、10-31 被误吞）→ 14 天后应 **<30%**，且出现 `days ≥ 7` 的回扣句；这一项不降就说明"连续性"仍是假的 |
| 跨天引用首次出现日 | 第一条 `days >= 7` 回扣句的草稿日期（相对 §4.2 上线日） | 池子最老 4 天，理论上最早在第 3–4 天出现；一直不出现 → `kw>0.15` 门槛过严或记忆池被 `HISTORY_LIMIT=200` 截断掉了老条目 |
| 意外槽出槽率 | voice 文件里 `slot==='surprise'` 的条数 / 有 voice 的草稿数 | 现在 0/3（池内无 ≥7 天记忆）→ 应 >0，且 `why` 里出现"一直没被想起" |
| 引用句式多样性 | 回扣句去重后的句式数 / 回扣句总数 | 现在 1/2（两句同构）→ 应 ≥0.5；持续为 0 说明模板化，触发 §5.1 的风险 |

补一条实现约束：`kw` 与相关性判定用的分词在 `persona-core`（`retrieval.ts:61` 的 `tokensOf`），**不要把分词逻辑复制到 `compose.mjs`**——跨仓 import 的脆弱性已在 `definition.ts:158-161` 记过一次。正确做法是 `VoiceMemory` 多带两个字段（`kw: number`、`overlap: number`），`compose.mjs` 只读布尔/数值门槛。

任何一项在 14 天后仍是 0 或仍是恒定值，就说明这一环没接通——这是本设计"可证伪"的部分。

---

## 5. 不该做的事

1. **不要为了"显得有记忆"而强行插模板句。** 现在 `compose.mjs:164-173` 的 `你${when}说的「…」我还记着。` 句式在 `kw` 为 0 时也会触发（基线分 0.57 > 0.5 门槛，§1.4）。把它放宽（例如"没有相关记忆就编一句模糊印象"）会：
   - 污染她的文风（每天一句同构句，`findDuplicateText` 只拦全等，拦不住句式重复）；
   - **毁掉反事实判据**——`scripts/counterfactual.mjs` 的对照要求"真实状态 vs 中性状态"有可测差异，模板句在两边都会出现，差异被抹平，"活过来"的验收就变成自证。
2. **不要用 embedding/向量做召回。** `retrieval.ts:1-13` 的取舍是对的：不可复现、要外部依赖、解释不了"为什么想起这条"。加了向量之后 §4.4 的表无法用只读文件复核。
3. **不要把 `stimulation` 当重要度。** §3 已经证明这条路只会造成 54% flashbulb 通胀；改成 `importance` 走事件反馈，而不是改阈值。
4. **不要让 pinned 变成"每日精选"之类的自动写入。** pinned 是免疫项（`memory.ts:29`），自动写 pinned 等于关闭衰减，直接回到 D-02。
5. **不要在文案里写死"我记得…"的开头，也不要给记忆编号/时间戳原样出现在正文。** 出处只在 `voice.memories[].days/from` 一层存在即可；正文出现 ISO 时间戳会被读者认成机器。
6. **不要在没有 ≥7 天数据前调 `days>=7`、30 天归零这些窗口。** 现在最老记忆 4 天，任何调参都是在拟合噪声。

---

## 6. 复核方法与文件清单

只读输入：
- 代码：`E:/WorkSpace_Qoder/Cortico/persona-core/src/{memory.ts,retrieval.ts,voice-brief.ts}`、`E:/WorkSpace_Qoder/Cortico/src/worlds/bili-account/{personaAdapter.ts,definition.ts}`、`E:/WorkSpace_Qoder/dsh-bili-whale/{scripts/draft-dynamic.mjs,tools/drafts/compose.mjs,tools/lib/feed-feedback.mjs}`
- 数据：`C:/Users/Administrator/.dsh/bili-whale/fields.json`
- 任务书给的 `Cortico/persona-core/src/worlds/bili-account/personaAdapter.ts` 路径不存在，实际在 `Cortico/src/worlds/bili-account/personaAdapter.ts`（persona-core 里没有 worlds 目录）。
未跑测试、未构建、未改代码。
