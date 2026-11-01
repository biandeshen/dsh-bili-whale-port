# 落线对照实跑（2026-11-02 01:41–01:46）

目的：验证 `Cortico-up`（reanchor/replay）能不能真的顶上来跑，而不是只看测试绿。

## 怎么跑的

| 项 | 值 |
|---|---|
| 检出 | `E:/WorkSpace_Qoder/Cortico-up` @ `394beaf` |
| 部署 | 临时复制一份 live 的 `deployments/mybot` → `deployments/upbot` |
| 状态 | **副本** `~/.dsh-up`（fields / causal / control / feed / bili-ai 各拷一份），不碰 live |
| 端口 | 7800（live 的 7799 全程未动） |
| 起法 | `CORTICO_HOME=.../deployments WHALE_HOME=~/.dsh-up node --import tsx src/launcher.ts upbot --port=7800` |

## 结果

**启动**：成功。`bili-account ready`，life loop 起，主模型 `deepseek-v4.1-flash`。

**状态在推进**（约 4 分钟）：

| 指标 | 跑之前 | 跑之后 |
|---|---|---|
| `fields.json` 的 `lastAppliedAt` | 15:26:05Z（live 的旧时间） | **17:42:41Z** |
| `memories` 条数 | 51 | **53** |
| `causal.jsonl` 行数 | 186 | **193** |

**actor 归因真的生效** —— 新写的 7 条全带署名（样本见 `causal-sample-2026-11-02.jsonl`）：

```
17:41:48  watched        actor=host
17:41:57  dm-read-failed actor=host
17:42:09  diary          actor=host
17:42:41  watchedVideo   actor=host
17:42:51  feedback       actor=host
```

**debrief 契约没断**：`node tools/bili.mjs debrief BV1ji4y1Y77p` 六节齐全，
弹幕采样写了「7200/42455 · 1/6」，刷屏波剔除写了「同步 6490 条 / 90%」。

**live 没被污染**：跑完 live 的 `causal.jsonl` 仍是 186 行，`fields.json` 由 live 自己在写。

## 两个观察（不是结论）

1. **`dm-read-failed: home is not defined` 是历史遗留**。live 里那条在 10:00:14，现在直接跑
   `dm-await --json --peek` 返回正常（命中一条私信）。不要把旧账当成现在的 bug。
2. **7800 那份的 `dm-read-failed: 配置里 owner.mid 为空` 是副本造成的**：副本
   `~/.dsh-up` 里没有 `bili-whale.config.json`（我没拷），所以读不到 owner。不是缺陷。

## 没验到的

- **没有真的发东西**：只读了 state、写了日记/因果，没有点赞/评论/私信。写路径的验收仍在测试里。
- **tick 容器**：`~/.dsh-up` 下没有 `days/<今天>/ticks.jsonl`（那份副本没拷 `days/`）。
  life loop 的输出走的是 causal + fields，这两处都在动，所以「循环在跑」成立；
  但**按 §7 第 9 条的字面要求**这一项还缺，下次切 live 时要在真实 home 上补验。
