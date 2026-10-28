# Cortico 运行手册（小鱼）

## 进程与地址
- OFM 代理：`127.0.0.1:18910`（转发 OpenCode Go，Responses API）
- Cortico WebUI：`http://127.0.0.1:7799/`
- 一键启动：`start-cortico.cmd`（已注册 HKCU Run：WhaleCortico）
- 部署：`E:\WorkSpace_Qoder\Cortico\deployments\mybot`
- **单一调度器**：只由 Cortico World 的生活循环决定她做不做事。DSH 插件时钟已停用（`clock.enabled=false`，`night.windows=[]`），HKCU `WhaleDraft`（21:30 nightly-scheduler）已删除；不要再把它们加回来，否则会抢着出稿。

## Provider
- 端点：`opencode-go` → `http://127.0.0.1:18910/v1`
- 模型：`deepseek-v4.1-flash`（`deepseek-flash` 已被上游 410 弃用）
- 密钥：`deployments/providers/opencode-go/.env`（`OFM_API_KEY`，勿提交）
- 必须字段：`spec.thinking` 为布尔值

## World：bili-account
工具：`bili_traffic / bili_feed / bili_debrief / bili_diary_read / bili_diary_append / bili_mood_read / bili_mood_apply / bili_draft_dynamic / bili_dm_read`
- 节奏：**生活循环，不是定时唤醒**。`persona-core/src/rhythm.ts` 每 3–7 分钟评估一次：无聊(刺激<0.45)/想他(连接<0.45 且不在冷战)/歇够了(距上次行动 12h 起、30h 满) × 体力 × 随机；单日 ≤3 次、两次 ≥2.5h；睡着（距上次行动 ≥6h）时体力按 0.005/h 恢复，醒着不恢复。
- 状态记录：`control/life.json`（今天行动次数/上次时间）；`control/life-status.json`（`mode=state-driven`，给健康检查看）。
- 事件：`bili.action_due`（trigger flush），文本自带她的情绪+成因+最近因果+今天是否已出稿+上一条草稿审批结果。
- 手动验证：`BILI_ACCOUNT_FORCE_ACTION=1` 启动会在 5 秒后投递一轮（计入当天次数、重置 2.5h 间隔），用于不等自然触发。
- 写操作只入待审队列，工具本身不发送。

## 每轮流程（ORIENTATION 已内置）
`mood_read → traffic → feed → debrief（必须）→ diary_read → diary_append（公开"看过/想说" + 私人"本轮留下的判断"）→ draft_dynamic → mood_apply → 汇报`。
出稿三闸：feed 后必须 debrief；公开日记 24h 内更新过；文案不能与其它日期草稿一字不差。

## 审批
- 列表（会打印完整一次性 token）：`node scripts/dynamic-approve.mjs list`
- 试发（不消耗审批）：`node scripts/dynamic-approve.mjs approve <id>`
- 真发：`node scripts/dynamic-approve.mjs approve <id> --token <完整token> --go`
- token 默认 12 小时；只剩 12h 内有效。冷却/风控类失败会退回 token，可原 token 重试；成功后一次性作废。

## 纪律
- 正文不写 AI 声明；披露在简介与平台标签
- 每天最多 1 条动态；遇 412/-352/-101 立即停
- 草稿工具幂等：当天已有草稿会拒绝重复

## 排障
- **重启只用** `node scripts/start-cortico.mjs`（或 `start-cortico.cmd`）：单实例、探活、并自动 resume。直接 `node bin/cortico.mjs` 启动会停在 `⏸ 已暂停`，她的生活循环却照跑（D-33）。
- WebUI 打不开：看 `start-cortico.cmd` 窗口；确认 7799 未被旧实例占用
- Provider 不可用：确认 18910 在跑、`.env` 有 key、`thinking:false`
- 启动即暂停：`curl -X POST http://127.0.0.1:7799/api/run/resume`
- World 未挂载：看日志 `World 已启动: bili-account`；缺少 `envPromptVars` 或实例 `id` 会失败
- 一直不行动：先跑 `node scripts/cortico-health.mjs`；再看 `control/life.json` 的 `lastCheckAt` 是否还在前进（3–7 分钟一次）、`fields.json` 的 `stimulation` 是否在缓慢下降。两者都停了说明 tick 没在跑。
- 电脑睡眠/断电：不用补醒概念——恢复后第一次 tick 会按真实时间结算场值，她想做才做。
