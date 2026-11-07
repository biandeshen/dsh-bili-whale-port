# 夜间交接 · 更新 2026-10-30 01:10

> 给明早接手的人/AI。只列事实、命令和判据；不要补数据。

## 已排好的自动动作

| 时间 | 谁 | 做什么 | 看哪里 |
|---|---|---|---|
| 10-30 **01:09（实际）** | 主人打断导致 wait 计时器死亡，**01:07:59 首次手动 stop 后被误起的 start 计时器立即拉起（43 秒窗，作废）**；**01:09:24 重新 stop 生效** | `control/c2-window.log` 末段 `offline window armed`；c2.json armedAt=2026-10-29T17:09:24Z |
| 10-30 **09:12（保证空窗 ≥8h）** | `c2-start-at.cjs`（pid 21696，Temp 目录） | 睡到 09:12 后执行 `c2-window.mjs start`：收尾 + 起服务 | 日志 `starting now` → `online` |
| 10-30 **09:17** | `c2-postcheck-at.cjs`（pid 23232，Temp） | 写 `control/c2-poststart.json`（health、end、10-29 cf）——排在恢复之后 | `healthExit`、`end.derivedReason`、`cf.ok/diffChars/realMood` |
| 10-31 04:15 | `verify-at`（pid 17960） | 跑 `c2-offline verify` | `control/c2-result.json` + `control/canary.json` 的 C2 |
| 持续 | `action-watch`（pid 207048，到 10-30 15:06） | 命中下一次 `kind:'action'` 后 10 分钟留证 | `control/action-watch-result.json`、`days/<D>/wake-*.json` |

## 09:05 的判据

```bash
cat ~/.dsh/bili-whale/control/c2-poststart.json
```

期望：
- `healthExit: 0`
- `end.derivedReason: "c2-offline-window"`
- `cf.ok: true`、`cf.diffChars >= 4`、`cf.realMood` 非「宁静」（10-29 预演是 `灵感/32`）
- `check.draftValid: true`（10-30 当天稿；09:05 通常还没出，false 不算故障）

若 `cf` 为 null / ok=false：手动重跑

```bash
cd E:/WorkSpace_Qoder/Cortico
node --import tsx ../dsh-bili-whale/scripts/counterfactual.mjs --date 2026-10-29 --json
```

## 如果 C2 被跳过

`control/c2-window-skipped.json` 存在 = 01:00 时当天没有带 `diaryHash` 的稿，窗口没停。
- 这是保护行为，不是故障；看 `control/c2-window.log` 的 `skip:` 原因。
- 10-30 有稿后重排：先 `taskkill /PID 204908 /F`（旧 verify），再用新的 stop/start/verify 时间起 `c2-window.mjs wait` / `verify-at`。
- 不要把 skipped marker 留在下一次窗口里。

## 10-31 verify 的判据

- `c2-result.json.ok=true`，`offlineGapHours >= 8`，`crossed=true`
- `canary.json.C2.status=pass`
- 若 10-30 没有草稿：verify 会 FAIL（day-report 需要稿），换窗口重来，不补。

## 取消

```bash
taskkill /PID 21696 /F   # start-at（sleep 包装）
taskkill /PID 17960 /F   # verify
taskkill /PID 1704 /F   # postcheck
taskkill /PID 207048 /F   # action-watch
```
只杀需要停的那个；Cortico/看门狗是另一套。

## 当前事实

- 10-29：1 次自然 action（16:43），草稿 `dyn-20261029-8e3377`，`day-report` 齐全。
- 10-29 cf：预演 diff=32、realMood=灵感（start 快照预演是 21/宁静，不作数）。
- 三天窗口目标：10-29/30/31；G3b 最早 11-01 04:05 后。
- 观测开窗：G3b 全绿后 `node scripts/observation-start.mjs`；每日用 `npm run observe:day -- --date <D>`。
