# BASELINE —— 移植前行为冻结（阶段 0）

基线版本：upstream main `3e11454`（0.4.6），本机测试快照：`npm test` **110/110 绿**（node v24.16.0, win32）。

## 路由清单（lib/index.js，9 条，全部 exact）

| 路径 | 方法 | 职责 |
|---|---|---|
| /dsh-bili/api/settings | GET/POST | 读写 ~/.dsh/bili-whale.config.json（KNOWN 白名单过滤） |
| /dsh-bili/api/cookie | POST | 单独写 ~/.bili-ai/credentials.json，永不回显 |
| /dsh-bili/api/persona | GET/POST | 人设文本 |
| /dsh-bili/api/deps | GET | 依赖体检 + scheduler {ok,reason,at} + node/self/selftestPassed |
| /dsh-bili/api/pending | GET | 待审草稿队列（~/.bili-ai/pending-replies.json） |
| /dsh-bili/api/pending/reject | POST | 拒绝草稿 |
| /dsh-bili/api/pending/approve | POST | 放行草稿（reply-draft take → comment --go；失败回队） |
| /dsh-bili/api/notify-test | POST | 推送试发 |
| /dsh-bili/api/status | GET | today/shares/sharesMax/commentsToday/repliedPeople/plan |

panel 移植时另加两条只读：/api/diary（含 private）、/api/timeline（whale-log.jsonl 分页）。

## 配置写白名单（KNOWN，index.js:231）

persona, preferences, notify, aliases, owner, self, quota, share, listen, diary, night, toolsPath, home, risk, publish, sessionRotateDays, personaOncePerSession

服务端强校验：sessionRotateDays 0–365 · personaOncePerSession 必须布尔 · night.windows 非空 · maxWakesPerDay ≤12 · skipChance 0–0.95 · minGapMin ≥1 · maxVideos 1–20。

## 已知上游缺口（panel 端规避，不改 DSH adapter）

1. /api/status 的 plan.windows 因 night-plan v2 改名 usedCount 恒为 []（index.js:511）。
2. traffic status 不输出剩余额度，账号键为 sha256(SESSDATA)——面板自算 settings−used。
3. whale-diary-private.md 与时间线无 HTTP 端点。

## 本机环境修复（非上游缺陷，开发机泄漏）

tests/integration.test.mjs 'missing runtime' 用例假设机器无 DSH/node：装有 DSH 的开发机上 resolveRuntime 会经 os.homedir() 兜底扫到真实 ~/.dsh/dsh-runtimes/node.exe 导致沙箱失效。修复：lib/node-runtime.js 在 TEST_NO_NODE=1 时短路抛错（生产行为零变化）+ sandbox(t,cfg,{noNode}) 显式置空 DSH_NODE/DSH_DESKTOP_NODE_EXECUTABLE。

## 行为快照回归（借鉴 AMpath validation/snapshot-compare）

tests/scheduler-snapshot.test.mjs：确定性 PRNG × 10 种子 × 100 tick 走 makePlan/completePlan 状态机，决策序列固化在 tests/fixtures/night-plan-snapshot.json。任何调度行为变化必须显式更新 fixture 并在 PR 说明。
