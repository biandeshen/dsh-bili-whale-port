# OBSERVATION PROTOCOL —— 14 天观测期操作卡

> 只有 `g3b-check` 全绿并跑过 `npm run observe:start` 后才进入本阶段。
> 观测期的唯一目标：拿到「她过完一天」的真实证据。**证据优先于产出。**

## 1. 开始前（一次性）

```bash
cd E:/WorkSpace_Qoder/dsh-bili-whale
node scripts/g3b-check.mjs          # 必须 ready
node scripts/observation-start.mjs  # 写 control/observation.json
node scripts/observation-status.mjs # 确认 startDay / 天数
```

未 ready 时 `observation-start` 会拒绝，并列出 pending 项——不要绕过。

## 2. 每天（20–30 分钟）

1. **先看事实**
   ```bash
   node scripts/cortico-health.mjs
   node scripts/observation-status.mjs
   node scripts/day-report.mjs --date <昨天>      # 昨天的完整日
   ```
2. **记录当天 incident**（即使没有也要写"无"）
   `~/.dsh/bili-whale/days/<今天>/incident.md`：时间 / 发生了什么 / 证据文件。
3. **只读检查**
   - `days/<今天>/ticks.jsonl` 最后一行时间是否在推进（3–7 分钟）；
   - `control/life.json` 的 `lastCheckAt` 是否前进；
   - 草稿是否带 `voiceHash` / `diaryHash`。
4. **不做事**：不改代码、不重启、不 `--force`、不手动触发、不补写日记。

## 3. 什么算污染（`tainted`）

任一条出现，当天标 `tainted` 并写入原因：

- 改代码（含 persona-core、World、脚本）；
- 用 `--force` 重出稿；
- 回填/手写 `days/` 或 `fields.json`；
- 补造草稿、补写日记；
- 主人互动但未提前登记（见 §4）。

`tainted + missing > 3` → K1 直接失败，不允许用"后面多跑几天"补。

## 4. 主人互动

若要和她互动，**提前一天**写 `days/<当天>/planned-interaction.md`（时间、方式、内容摘要）。
未登记按"无互动"计——否则 K3 会变成考主人是否在线。

## 5. 允许的运维

- 看门狗挂了：重启 `start-day-watchdog.vbs`（记录 incident）；
- Cortico 挂了：`start-cortico.cmd` 重启（记录 incident，当天可能标 `late`）；
- 机器关机/睡眠：次日开机后跑 `node scripts/day-watchdog.mjs --once`，缺失日由 audit 标 `missed`。

以上都**不算**改码，但必须在 incident 里留痕。

## 6. 每周复盘（第 7、14 天）

```bash
node scripts/observation-status.mjs --json
node scripts/g3b-check.mjs
```
对照 K1（≥11/14 有稿）、K2（≥9/14 文本不同）、K3（≥3 天 mood≠平静）。
**不满足就继续观测，不许改判据。**

## 7. 停止条件（任一）

- Day 14 三条 kill criterion 全部失败 → 按 `STOP-RUNBOOK.md` 停；
- 连续 3 天 `tainted`；
- 未审批的真实发布 / 风控熔断后仍重试。
- `tainted + missing > 3` → K1 失败，停。

停止后不删数据、不改历史；按 STOP-RUNBOOK 复盘。

## 8. 证据在哪

```
~/.dsh/bili-whale/days/<D>/
  state.start.json  state.end.json  ticks.jsonl  day.json
  counterfactual.json   incident.md   expected.json（仅离线日）
D:/AI/养鱼/drafts/<D>.json + audit.jsonl
docs/evidence/   评审与 canary 记录
```
