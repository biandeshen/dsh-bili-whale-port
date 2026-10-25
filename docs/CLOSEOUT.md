# 收尾说明（2026-10-25）

## 为什么停

用户评估后认为：Coopanion（Electron 桌宠，自带 DeepSeek 鲸鱼娘、语音、computer use、npm World 扩展）已经覆盖“陪伴/形象/桌面宠物”需求；本项目剩余价值只有 **B 站自主浏览 + 风控 + 写前审批 + 日记**，不足以继续投入。遂冻结，不做 UI 集成、不做手机端。

## 已完成的真机验证（不是 Demo）

- DSH 插件装好（UI 安装），会话「bili-whale」跑通：
  - 生物钟投递 → agent 真实执行 `deps` / `feed` / `debrief` / `fav` / `comment-digest`
  - 两本日记已生成：`~/.dsh/whale-diary.md`（5688B）、`whale-diary-private.md`（3561B）
  - 收藏草稿进待审队列（`pending-replies.json`），分享因 11/20 < 13 分被评分闸拦下
  - 读预算 265 次、写 0 次（未点放行）
- 现有测试：**133/133**（含调度器快照、路由/OpenCode/panel 契约、go-gate、DOM 冒烟、测试注册表）

## 停止状态（当前）

- 独立面板进程已停、桌面快捷方式已删
- DSH 插件仍安装，但 `night.windows[].wakes=0` → **不再自动唤醒**
- 今日计划已清空
- 私有仓库保留：`biandeshen/dsh-bili-whale-port`（默认分支 `port/core-opencode-panel`）

## 想恢复时

1. 打开 `~/.dsh/bili-whale.config.json`，把 `night.windows` 的 `wakes` 改回 `1`（或 DSH 设置 → 养鱼 里调）
2. 想用外挂面板：双击仓库 `start.cmd`
3. 彻底卸载：DSH 插件管理里移除 `dsh-bili-whale`

## 可复用资产（万一以后要接 Coopanion）

- `tools/`：40 个 B 站 CLI + 风控（与宿主无关）
- `core/api/`：9 条路由 + timeline/diary/vitals
- `tools/lib/go-gate.mjs`：非分享写操作待审闸
- `adapters/opencode/`：MCP stdio 包装（可挂到任何支持 MCP 的宿主）

## 许可

代码 MIT（上游）；鲸鱼娘序列帧 CC BY-NC-SA 4.0（署名 ZipZipPipe / 上善无形，仅个人非商用）；详见 `docs/CREDITS.md`。
