# OpenCode adapter（whale-daemon + bili MCP）

让 dsh-bili-whale 脱离 DSH，在 [OpenCode](https://opencode.ai) 里养同一条鱼：同一份 `bili-whale.config.json`、同一套风控预算、同一本日记。

## 组成

| 文件 | 角色 |
|---|---|
| `controller.js` | AgentSessionPort 的 OpenCode 实现：`POST /session` / `prompt_async`（零依赖 fetch，可换 @opencode-ai/sdk） |
| `daemon.js` | 常驻生物钟（core/scheduler + 上面的端口）；`--once` 供定时冒烟 |
| `mcp-stdio.js` | 把 40 个 B 站命令包成一个 `bili` MCP 工具；只 spawn `tools/bili.mjs`，风控闸不可绕过 |

## 接入三步

**1. 起 server**（建议设密码，daemon 与 panel 都走 Basic）：
```bash
set OPENCODE_SERVER_PASSWORD=你的密码   # Windows；Termux 用 export
opencode serve --port 4096
```

**2. 注册 MCP**（`~/.config/opencode/opencode.json`）：
```jsonc
{
  "mcp": {
    "bili": {
      "type": "local",
      "command": ["node", "E:/WorkSpace_Qoder/dsh-bili-whale/adapters/opencode/mcp-stdio.js"],
      "enabled": true
    }
  }
}
```
会话里让她跑 `deps --json` 体检、`session` 确认账号，再 `selftest`。

**3. 起时钟**（pm2 示例；WinSW/systemd/Termux 同理）：
```bash
set WHALE_HOME=%USERPROFILE%\.dsh          # 与 DSH 共目录安全：文件按 whale-* 前缀隔离
pm2 start adapters/opencode/daemon.js --name whale-daemon
```

## 行为对齐说明

- **会话**：opencode `POST /session` 自生成 id（同 DSH `create()` 不分新建/复用），因此沿用「重启后首投必带全量人设」策略。
- **isBusy**：优先查 server 会话状态；查不到回落 8 分钟硬冷却（core 原语义）。
- **写操作**：`comment/dm/fav/dynamic/danmaku` 全部要求显式 `--dry`/`--go`；预算、冷却、412 熔断与 DSH 端逐字节同一套（traffic.mjs）。
- **通知**：`notify.type` 可配 `ntfy`/`bark` 推到手机（见 docs/TERMUX.md）。

## 测试

```bash
npm test                        # 全仓 119 项（含 adapters/opencode/test/contract.test.mjs）
node daemon.js --once           # 沙箱冒烟（窗口外应零投递、窗口内应见 prompt_async）
```
