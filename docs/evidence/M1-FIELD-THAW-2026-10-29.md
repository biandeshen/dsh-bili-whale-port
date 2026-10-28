# M1-1 场值解冻 —— 证据（2026-10-29）

> 范围：D-07（mood 贴边/耦合单向）、D-09（无醒睡语义）。
> 性质：**开发证据**，不是观测证据；不进 canary/G3b。

## 1. 改动

| 文件 | 改动 |
|---|---|
| `Cortico/persona-core/src/decay.ts` | 删 `COUPLING_CAP_MS=12h`；`MAX_SETTLE_MS=24h` 只封**硬耦合**（衰减按真实时长跑满，靠基线截断）；正向耦合 `social>0.6 → mood +0.01/天`、`connection>0.6 → 恢复 ×1.5`；1h 步长积分 |
| `Cortico/persona-core/src/rhythm.ts` | `REST_RECOVERY_PER_HOUR` 0.003 → 0.005（理由见 §3） |
| `Cortico/src/worlds/bili-account/definition.ts` | `asleep = now - lastActionAt >= 6h`；恢复只在睡着时生效；`life-status.json` 增加 `asleep` |
| `Cortico/persona-core/tests/core.test.mjs` | 12h 封顶测试改为“不再封顶 / 24h settle 上限 / 正向耦合” |
| `Cortico/persona-core/tests/rhythm.test.mjs` | 恢复速率断言 + 10 天模拟改为睡着才恢复 |
| `dsh-bili-whale/scripts/simulate-rhythm.mjs` | 与定义对齐（睡着才恢复；一轮 = actionCost + watchedVideo 增量；打印每日 mood/体力/睡眠） |

## 2. 门禁

```
cd Cortico && node --import tsx --test persona-core/tests/core.test.mjs persona-core/tests/rhythm.test.mjs
# tests 32 / pass 32

cd dsh-bili-whale && node scripts/run-mjs-tests.mjs
# tests 163 / pass 163 / EXECUTED=26

node scripts/check-consumers.mjs   # 全部有生产调用
node scripts/check-hashes.mjs      # 一致
cd Cortico && npx tsc --noEmit      # exit 0
cd Cortico && node --import tsx ../dsh-bili-whale/scripts/drill-gate.mjs
# 34/34 通过
```

## 3. 30 天模拟（无回信场景；`simulate-rhythm.mjs`）

初值 `DEFAULT_ATOMIC_FIELDS`，step 5min，seed 42 / 7。

| 参数 | seed 42 | seed 7 |
|---|---|---|
| 0.003/h 恢复 | 第 19 天起 mood=-1.00，体力 0.15–0.20，`energy<0.2` 耦合把 mood 钉死 | 同左（趋势一致） |
| 0.005/h 恢复（当前） | mood 日均 [-0.10, 0.17]，30 天末 0.04；体力 0.61–0.70 | mood 日均 [-0.01, 0.17]，末 0.03；体力 0.55 |

- `0.003/h` 的失败不是“恢复太快”，而是睡着只算 ~14–18h/天，实际恢复 0.042–0.054/天，追不上 1–2 轮活动（0.07–0.14/天）→ 体力长期停在疲劳门 0.18 附近 → 触发 `energy<0.2` 的 -0.02/h 心情下压 → mood 必然贴底。
- `0.005/h` 下体力稳定在 0.55–0.7，mood 不再贴边；这是对修订案“不改速率”的有证据偏离，**待团队复核**。
- 模拟不含回信（M3 才有入站）、不含 7 类生活活动（M1 后续）；因此 mood 波动区间偏窄（多数在 -0.2..0.2），属于“平静附近的小起伏”，不是最终形态。

## 4. 运行时验证（2026-10-29 01:13）

```
node scripts/start-cortico.mjs
# [start] Cortico 启动中（pid 133936）… 就绪：http://127.0.0.1:7799/
# log: worlds.bili-account: life loop armed（每 3–7 分钟…）
# log: core: World 已启动: bili-account
node scripts/cortico-health.mjs
# OFM 200 / WebUI 200 / kill switch 未触发 / 健康检查通过
cat ~/.dsh/bili-whale/control/life-status.json
# { "asleep": false, ... "lastKind": "restless" }
```

## 5. 未覆盖 / 风险

- `creativity` 仍恒回 0.300 → D-29（生活活动接上后处理）。
- 情绪投影（15 情绪）未做 → D-06 仍 OPEN；当前标签仍来自自写 `readMood`。
- 来源预算 `(source,field)` 未做 → `custom` 仍可无限加；下一增量。
- 30 天模拟是模型而非真实运行；真实一天的证据仍要等观测期。
