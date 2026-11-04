# 旧面板缺失功能逐项核对（2026-11-04）

对照对象：**旧 DSH 插件面板**（`panel/views/tank.html` + `core/api/routes.js` + `core/client.js`）
对 **新架构**（6 个能力包 + 4 个 persona 面板 + 2 个 world 面板）。

每一项都核到代码与线上状态，不是凭印象。判定口径：

- **在** = 有等价能力且**主人在页面上点得到**
- **半** = 后端有数据/能力，**页面上看不到或不能用**
- **缺** = 确实没有

---

## 0. 总账

旧面板共 **8 个功能区块 + 17 个 API 端点**。逐项核对结果：

| 判定 | 数量 | 项 |
|---|---|---|
| ✅ 在 | 8 | 两本日记 / 待审草稿 / 意见箱 / 待放行 / 场值 / 配额 / 风控熔断 / 偏好过滤 |
| ⚠️ 半 | 5 | 事件流 / 读配额余量 / 人设编辑 / 依赖体检 / 今日概览 |
| ❌ 缺 | 4 | cookie 写入 / 通知测试 / 头像 / 设置总表（25 项） |
| — 已升级 | 2 | 请求预算（新版更细）/ 账号收件箱（新版更强） |

**结论：干的活基本都在，缺的是"能改能看能清"的旋钮。**
新版在"防误触、留痕、可回读"上比旧版强（配额档位、急刹、熔断解除、作废可查），
但在**自举入口**（cookie、依赖体检、通知测试）和**历史可视**（事件流、人设编辑）上有真缺口。

---

## 1. 旧面板功能区块逐项

### 1.1 「她的一天」页签

| # | 旧区块 | 旧 API | 新落点 | 判定 |
|---|---|---|---|---|
| 1 | 请求预算（读/写每小时、每天余量） | `/api/vitals` | 「安全闸、配额与风控」面板 | ⚠️ **半** |
| 2 | 今日 / 风控（今日分享数、评论数、调度状态、412 暂停） | `/api/vitals` | 同上 + `quota.json` | ⚠️ **半** |
| 3 | 她的一天 · 事件流（whale-log.jsonl） | `/api/timeline` | **无页面落点** | ⚠️ **半** |

**#1 请求预算 —— 读侧配额被砍了**

旧版 `panel/data.js:59-64` 算四个余量：`readHour / readDay / writeHour / writeDay`，
数据源是 `tools/lib/traffic.mjs` 的 `RISK`（readHourly / readDaily / writeHourly / writeDaily）。

新版 `packages/cap-bilibili/src/webui/client.ts` 的 statgrid 只有四项：
```
今日自主 / 今日分享 / 写冷却 / 412 熔断
```
**读配额（readHourly / readDaily）整个没了。**
佐证：`grep readHourly|readDaily packages/` → **零命中**；
线上 `data/bilibili/traffic-state.json` 只有 `writeGapSec / pausedUntil / lastWriteAt / seenFingerprints`，
**没有任何读计数**。

> 为什么要紧：读配额是她"看片"的节流阀。旧版余量可见，超了能看出来；
> 新版看不到读频次，只有事后才知道自己被限流了。

**#2 今日概览 —— 丢了调度状态与今日计数**

旧版 `vitals` 返回 `scheduler`（调度器状态）、`shares`（今日分享数）、`commentsToday`、`plan`（今晚计划）。
新版面板没有这几项；心跳的 `nextCheckAt` 在「下次状态评估」里能看到（`cortico-health`），
但**页面上的今日分享/评论数、调度器状态没有落点**。

**#3 事件流 —— 后端有，前端不渲染**

新架构 `cap-state-rhythm/src/index.ts:320` 的 `getSnapshot` 已经返回
`recentChain: [...state.chain].reverse().slice(0, 20)`（最近 20 条场值因果）。
但 `packages/cap-state-rhythm/src/webui/client.ts` **完全没有引用 `recentChain`** ——
数据在后端接口里躺着，页面上一个字都看不到。

旧版是 `whale-log.jsonl` 完整时间线（`/api/timeline?limit=60`，60 条）。
新版是场值变更 20 条 + `causal.jsonl`（行动账）。

---

### 1.2 「信箱与事件」页签

| # | 旧区块 | 旧 API | 新落点 | 判定 |
|---|---|---|---|---|
| 4 | 💌 给主人的信（whale-diary.md） | `/api/diary` | 「日记、判断卡与意见箱」→ 公开本 | ✅ 在 |
| 5 | 🌑 给她自己的（whale-diary-private.md） | `/api/diary` | 同上 → 私人本 | ✅ 在 |
| 6 | 待审草稿（发前审核） | `/api/pending` | 「统一待放行与改稿台」 | ✅ 在 |
| 7 | 动态草稿放行（✓放行 / ✗拒掉 + 理由） | `/api/draft-approve` | 同上，改字后续签令牌 | ✅ 在（**新版更强**） |
| 8 | 她的意见箱（本地，不联网） | `/api/feedback` + `/api/feedback/resolve` | 同上 | ✅ 在 |

> 注：#7 新版还多了"改完自动续签令牌"，旧版没有。这是**升级**不是缺失。

---

### 1.3 「养鱼设置」页签

| # | 旧区块 | 旧 API | 新落点 | 判定 |
|---|---|---|---|---|
| 9 | 养鱼设置（整份 JSON textarea） | `/api/settings` | **散在多个面板，且不是标准配置页** | ❌ **缺** |
| 10 | 🐋 她的人设（persona.md 编辑） | `/api/persona` | 宿主「系统提示词」页（只读/部分） | ⚠️ **半** |
| 11 | 发条测试推送 | `/api/notify-test` | **无** | ❌ **缺** |
| 12 | 依赖体检（B站 cookie 状态、self mid 自动回填） | `/api/deps` | **无** | ⚠️ **半** |
| 13 | 头像（avatar.png） | `/api/avatar` | 宿主顶栏「更换 bot 头像」 | ✅ 在（宿主更强） |

**#9 设置总表 —— 这是主人说"设置不了"的正身**

旧版 `core/client.js:53-72` 的 **25 个字段**（会话轮换天数 / 每会话减少重复人设 /
疑似 AI 评论检查 / 最小唤醒间隔 / 今晚不看的概率 / 单次观看视频数 / 口味爱看不爱看 /
推送日记摘要 / 工具目录 / 专用会话目录 / 角色名 / 称呼 / 自称 / 主人 mid / 主人昵称 /
她的 mid / 她的昵称 …）。

新版现状：
- **她的 persona 页面连「配置」页签都没有** —— 线上 `/api/webui/manifest` 实测
  `persona:xiaoyu` 的 `configGroups` 是 `[]`（宿主 cormini bot 有 4 项，
  `world:minecraft` 有 4 项，我们三个 provider 全是 `[]`）。
- 剩下的旋钮散落成**各自面板里的一个按钮**（如「偏好」面板能改口味），
  没有一处能"看全所有参数"。

**#10 人设编辑 —— 半**

旧版能直接编辑 `persona.md`（她的身份正本）并保存。
新版：宿主有「系统提示词」页（`src/web/client/features/prompts/`），
但那是**框架提示词**；她的人设正本在 `prompts/` 目录（部署侧），
`drift` 门禁只做**一致性校验**（`check-live-drift.mjs` 查 CONSTITUTION.md / ORIENTATION.md），
**没有编辑入口**。

**#12 依赖体检 —— 半**

旧版 `/api/deps` 做三件事：
1. 跑 `bili.mjs deps --json` 列出依赖体检项；
2. 从 cookie 反解 `self.mid / self.name` **自动回填配置**；
3. 检查 `selftest-passed.json` 自测标记。

新版：
- 依赖体检 → `cap-vision` 有 `resolveFfmpeg()` 给出 ffmpeg 路径与来源，
  `cap-media-studio` 面板有 `toolchain.ffmpegReady`，**但只覆盖 ffmpeg，不覆盖 B站 cookie / node 版本等**；
- self mid 回填 → `cap-bilibili/src/client/bili-profile.ts` 的 `whois` 能读，
  但**没有"自动回填到配置"这一步**；
- selftest 标记 → 无。

---

## 2. 旧插件 17 个 API 端点逐项

| 旧端点 | 用途 | 新落点 | 判定 |
|---|---|---|---|
| `/api/settings` GET/POST | 读写整份配置 | 散落各面板 | ❌ 缺总表 |
| `/api/cookie` | 写入 B站 cookie | 无 | ❌ **缺** |
| `/api/persona` GET/POST | 读改人设正文 | 宿主 prompts 页（不同物） | ⚠️ 半 |
| `/api/deps` | 依赖体检 + self 回填 | 只有 ffmpeg 一项 | ⚠️ 半 |
| `/api/pending` | 待审回信列表 | 「统一待放行」 | ✅ 在 |
| `/api/pending/reject` | 拒稿 | 同上 | ✅ 在 |
| `/api/pending/approve` | 放行 | 同上 | ✅ 在 |
| `/api/notify-test` | 测试推送 | 无 | ❌ 缺 |
| `/api/status` | 运行时状态 | 无独立落点 | ⚠️ 半 |
| `/api/timeline` | 事件流 60 条 | recentChain（后端有，前端无） | ⚠️ 半 |
| `/api/diary` | 两本日记 | 日记面板 | ✅ 在 |
| `/api/drafts` | 动态/回信草稿列表 | 待放行面板 | ✅ 在 |
| `/api/feedback` | 意见箱列表 | 意见箱 | ✅ 在 |
| `/api/feedback/resolve` | 批复意见 | 意见箱 | ✅ 在 |
| `/api/draft-approve` | 动态草稿放行/拒 | 待放行面板 | ✅ 在 |
| `/api/avatar` | 头像 | 宿主顶栏 | ✅ 在 |
| `/api/vitals` | 今日/预算/风控 | 部分（缺读配额） | ⚠️ 半 |

---

## 3. 真缺口清单（按主人关心的程度排序）

### P0 —— 直接影响"她能不能正常跑"

| 缺口 | 后果 | 修法 | 工作量 |
|---|---|---|---|
| **cookie 写入入口** | 主人换号/过期时，无处可写；只能手改文件 | 「安全闸」面板加一块：粘贴 cookie → 校验 `whoami` → 落盘 | 小 |
| **依赖体检（cookie/自测）** | 登录态坏了没人知道，直到她连不上 | 复用 `bili-profile.ts` 的 `whois`，加一块"登录状态体检" | 小 |
| **读配额余量不可见** | 看片节流失控，事后才知被限流 | 恢复 readHourly/readDaily 计数与余量显示 | 中 |

### P1 —— 主人明确点名

| 缺口 | 后果 | 修法 | 工作量 |
|---|---|---|---|
| **配置总表 / configGroups** | "设置不了上下文长度"等所有旋钮问题 | 给 persona 声明 `configGroups`（形状照宿主 cormini） | 中 |
| **事件流不显示** | 她的生活轨迹看不见，出问题无法回溯 | 鱼缸面板加"最近发生"区块，渲染 `recentChain` | 小 |
| **人设编辑入口** | 改她是谁要改文件 | 宿主 prompts 页 或 persona 面板加"人设正本"编辑 | 中 |

### P2 —— 自举与运维

| 缺口 | 后果 | 修法 | 工作量 |
|---|---|---|---|
| 通知测试 | 改完推送设置不知道通没通 | 加"发条测试推送"按钮 | 小 |
| 今日概览（今日分享/评论数、调度状态） | 面板看不到"今天怎么样" | 「安全闸」面板加今日计数；调度状态接心跳 | 小 |
| 设置总表（25 项归位） | 参数散落各处 | 见 `CONTROL-SURFACE-2026-11-04.md` §4 逐条销账 | 大 |

---

## 4. 三条需要注意的判断

1. **不要把旧面板整块搬回来。** 旧面板是"JSON textarea + 一堆 API"，
   新架构是"标准配置页 + 面板按钮"，形态更好。缺的是**旋钮本身**，不是旧界面。
2. **cookie 与依赖体检是"自举"能力，优先级容易被低估。** 她第一次上线、
   cookie 过期、换号，都卡在这里，而这两项在新架构里**完全没有入口**。
3. **读配额不是新功能，是被砍掉的旧功能。** 旧版有 `readHourly/readDaily`，
   新版 grep 零命中。要恢复的话得在 traffic 层加计数，不能只加显示。

---

## 5. 取证方式（可复现）

```bash
# 新架构面板清单 + 配置组
curl -s http://127.0.0.1:7799/api/webui/manifest | node -e "..."   # configGroups 全是 []
# 读配额是否还在
grep -rn "readHourly\|readDaily" packages/     # 零命中
# 事件流数据在后端但没渲染
grep -rn "recentChain" packages/cap-state-rhythm/src/  # index.ts 有，webui/client.ts 无
# 旧面板功能清单
grep -n "card.*<h2>" panel/views/tank.html       # 8 个区块
grep -n "routes\['" core/api/routes.js          # 17 个端点
```

---

## 6. 状态

- 核对：**完成**（本文件 §1–§2 逐项有代码/线上取证）。
- 施工：**未开工**。优先级见 §3。
- 关联文档：`docs/CONTROL-SURFACE-2026-11-04.md`（控制面回补总方案）。
