# Cortico 侧补丁清单（该目录不是 git 仓库，改动以此为准）

根：`E:\WorkSpace_Qoder\Cortico`

## 新增
- `src/worlds/bili-account/definition.ts`：World（7 工具 + 每日 21:40 + catch-up + kill 守卫 + 违规 causal）
- `src/worlds/bili-account/fields.ts`：7 场值 + 衰减 + 预设效果
- `src/worlds/bili-account/mood.ts`：情绪 = 场值 × 成因
- `src/worlds/bili-account/gates.ts`：canDraft / canApplyWatched / violationNotice
- `src/worlds/bili-account/decay.ts`：7 天半衰权重
- `src/worlds/bili-account/runner.ts`：可注入 kill 守卫的 spawn 包装
- `tests/core.test.mjs`：5 条纯函数单测
- `deployments/mybot/prompts/ORIENTATION.md`：小鱼人设与每轮步骤
- `deployments/providers/opencode-go/`：provider 配置（.env 含 key，勿提交）

## 修改（上游文件）
- `src/worlds/index.ts`：注册 `bili-account`
- `bots/cormini/index.ts`：debug 日志已移除（无功能改动）
- `bots/cormini/persona/persona.ts`：心跳文本追加“按 ORIENTATION 执行一轮”
- `tests/core/provider-routing.test.ts`：harness 隔离并恢复 DEEPSEEK_API_KEY
- `tests/env-prompt-contract.test.ts`：git ls-files → fs 遍历（不依赖 git）

## 验证命令
```
# 纯函数单测
cd E:/WorkSpace_Qoder/Cortico && node --import tsx --test tests/core.test.mjs
# 门禁 + ack drill（需从 Cortico 目录跑）
node --import tsx ../dsh-bili-whale/scripts/drill-gate.mjs
# 消费侧测试
npx vitest run tests/env-prompt-contract.test.ts tests/core/provider-routing.test.ts
```
