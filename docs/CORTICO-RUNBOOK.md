# Cortico 运行手册（小鱼）

## 进程与地址
- OFM 代理：`127.0.0.1:18910`（转发 OpenCode Go，Responses API）
- Cortico WebUI：`http://127.0.0.1:7799/`
- 一键启动：`start-cortico.cmd`（已注册 HKCU Run：WhaleCortico）
- 部署：`E:\WorkSpace_Qoder\Cortico\deployments\mybot`

## Provider
- 端点：`opencode-go` → `http://127.0.0.1:18910/v1`
- 模型：`deepseek-flash`
- 密钥：`deployments/providers/opencode-go/.env`（`OFM_API_KEY`，勿提交）
- 必须字段：`spec.thinking` 为布尔值

## World：bili-account
工具：`bili_traffic / bili_feed / bili_debrief / bili_diary_read / bili_draft_dynamic`
- 定时：每天 21:40 pushEvent `bili.diary_due`
- 事件：`bili.diary_due`（trigger flush）
- 写操作只入待审队列，工具本身不发送

## 每日流程
- 21:30 Track A 脚本出稿：`D:\AI\养鱼\drafts\<date>.json/md`
- 21:40 Cortico 醒来：预算 → feed → debrief → 读日记 → 确认/生成草稿 → 汇报
- 审批：
  - `node scripts/dynamic-approve.mjs list`
  - `node scripts/dynamic-approve.mjs approve <id>`（dry）
  - `node scripts/dynamic-approve.mjs approve <id> --go`（真发）

## 纪律
- 正文不写 AI 声明；披露在简介与平台标签
- 每天最多 1 条动态；遇 412/-352/-101 立即停
- 21:30 出稿与 21:40 唤醒错开，避免重复；草稿工具幂等拒绝当天重复

## 排障
- WebUI 打不开：看 `start-cortico.cmd` 窗口；确认 7799 未被旧实例占用
- Provider 不可用：确认 18910 在跑、`.env` 有 key、`thinking:false`
- 启动即暂停：`curl -X POST http://127.0.0.1:7799/api/run/resume`
- World 未挂载：看日志 `World 已启动: bili-account`；缺少 `envPromptVars` 或实例 `id` 会失败
