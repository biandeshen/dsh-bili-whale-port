# 草稿放行入口 · 证据卡（2026-10-31）

> 主人原话（2026-10-31）：“我去哪里放行她的操作？我怎么没看到？”“权限是不是能给高点？”
> 六席此前判过“panel 不做一键发送”（防绕过 token）。主人要的是**入口**，不是绕过——所以实现成：
> **浏览器只发 `{id}`，token 全程在服务端**；这比 CLI（token 进 stdout）更严，红线其余部分全部保留。

## 用法（放行入口在这）

1. 打开鱼缸面板：`http://127.0.0.1:8447/?t=<panel.token>`（token 在 `~/.dsh/panel.token`；面板当前未常驻，启动：`node panel/server.js`）
2. 「信箱与事件」页 → 「待审草稿」卡：动态稿带 **✓ 放行发布 / ✗ 拒掉** 按钮
3. 点 ✓ → 服务端校验（kill / status / 正文绑定）→ 真发 → 弹回 `✓ 已发出 dyn_xxx`

## 实现（全部服务端）

- `scripts/dynamic-approve.mjs` 新导出 `approveFromPanel({id, runner})`：
  - 令牌有效且绑定**当前正文** → 直接用；
  - 令牌缺失/过期/正文入队后被改过 → 用**当前正文**重新入队再发（审批对象=面板显示的正文=实际执行的正文）；
  - `sent/rejected/sending` 拦截、kill、一次性校验全部沿用原 `approve()`；
  - 返回 `{ok,status,error,dynId,outTail}`——**永不含 token**。
- `panel/server.js` 新端点 `POST /api/draft-approve`（`{id, action?}`）：走面板统一 token 门；`action:'reject'` 调原 reject；非 `dyn-` id 明确拒绝（回信稿等 dm 修复后接入）。
- `panel/views/tank.html`：动态稿卡内渲染按钮 + 提示；失败 toast 原因。

## 验证

- 新契约测试 `tests/contract/draft-approve-panel.test.mjs` **4/4**：无令牌自动重入队、有效绑定直接用、sent 拒且不烧令牌、改稿重绑定（展示=执行）、**响应 JSON 不含 token**。
- panel e2e 加 1 用例：无 token → 401/503；未知 id → `ok:false`（不真发）；GET → 405。
- 全量 **249/249**，冻结哈希一致。

## 边界

- CLI 流程不变（`dynamic-approve list/approve` 仍可用，给习惯命令行的入口）。
- 回信稿（`dm-*`）暂不进按钮：她的 `bili_dm_reply` 死循环刚修（见 dm-reply.ts），等有回信草稿再接同款服务端流程。
- 权限放宽（自主点赞/评论/收藏/回复）是另一个决策，见团队评审记录——本卡只解决“主人没有放行入口”。
