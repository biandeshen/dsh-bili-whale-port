# STOP RUNBOOK —— 判停时到底做什么

> 触发即执行，不讨论、不改判据。执行者：AI；确认者：主人。
> 判停条件见 `DECISION-2026-10-28.md` §3.3 与 `ROADMAP-2026-10-29.md` §5。

## 1. 触发条件（任一）

1. Day 25 判定三条 kill criterion 全部失败。
2. 连续 3 天 `tainted`（改码、`--force`、回填 state、补造草稿、未登记互动）。
3. 出现未审批的真实发布、或风控熔断后仍重试。
4. 主人明确叫停。

## 2. 立即动作（按顺序，5 分钟内）

```bash
# 1. 记录：先写事实，再动手
#    在 ~/.dsh/bili-whale/days/<D>/incident.md 追加：时间 / 触发条件 / 证据文件

# 2. 拉闸（World 工具与审批会在 spawn 前拒绝）
node -e "require('fs').writeFileSync(require('path').join(process.env.USERPROFILE,'.dsh','bili-whale','control','kill'), new Date().toISOString())"

# 3. 封存当天
cd E:/WorkSpace_Qoder/dsh-bili-whale
node scripts/day-snapshot.mjs --end

# 4. 看门狗停止（pid 文件）
#    Windows: taskkill /PID <pid> /F   （pid 在 control/day-watchdog.pid）

# 5. 停止 Cortico（pid 在 control/cortico.pid；不要删数据）
```

⚠ **kill 的覆盖范围（实测）**：`control/kill` 只被 `dynamic-approve.mjs:75` 与 World 的 spawn 守卫检查；**`tools/bili.mjs` 本身不检查 kill**（ISSUES D-22，主人 2026-10-28 决定暂不修）。所以判停后必须**停进程**，不能只靠 kill 文件。

**禁止**：删除状态/日记/草稿、修改历史 `days/`、为了让报告变绿而重跑、在 kill 期间批准任何 pending。

## 3. 待审队列处置

1. `node scripts/dynamic-approve.mjs list` 只读列出；
2. **不批准、不拒绝**（拒绝会写 causal，影响复盘）；
3. 把 `control/pending/*.json` 原样移动到 `control/pending-archive/<YYYY-MM-DD-HHmm>/`；
4. 在 incident.md 记录移动清单（文件名 + token 前 8 位，不写全长）。

## 4. 复盘模板（判停后 24h 内）

```markdown
## 判停复盘 <日期>
- 触发条件：
- 证据：days/<D>/ 下的文件、day-report 输出、cortico.log 片段
- 实际发生了什么（只写事实）：
- 哪个假设被推翻：
- 若重来，最小改动是什么：
- 是否需要换方案（是/否，理由）：
- 主人决定：
```

## 5. 恢复条件（全部满足才解闸）

1. 复盘完成并经主人确认；
2. 触发根因有可复现的修复 + 验证命令输出；
3. 主人书面同意恢复；
4. 删除 `control/kill`，用 `node scripts/day-snapshot.mjs --seed` 建新一天，**不补旧天**。

## 6. 演练（D0 必做一次，用临时 home，不碰生产）

```bash
export WHALE_HOME=C:/Users/Administrator/.qoder/tmp/stop-drill
cd E:/WorkSpace_Qoder/dsh-bili-whale
node scripts/day-snapshot.mjs --seed
node -e "require('fs').writeFileSync(process.env.WHALE_HOME+'/bili-whale/control/kill','1')"
node scripts/day-snapshot.mjs --end
node scripts/day-report.mjs --date $(node -e "console.log(new Date(Date.now()-4*3600e3).toLocaleDateString('sv-SE'))")
# 期望：kill 存在时审批被拒（dynamic-approve 输出 blocked-kill），快照仍可读；
# 不要用 tools/bili.mjs 验证 kill——它不检查（D-22）。
```
记录输出到 `days/<D>/incident.md`（D0 当天）。
