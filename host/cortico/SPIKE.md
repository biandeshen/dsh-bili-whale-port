# Cortico Track B Spike

- 版本：PASS。fork HEAD commit `2c13db3e`，v0.2.7（tarball 经 gh api 取得）。
- 安装：PASS。Node 24.16.0 + corepack pnpm 11.28.6，`install exit 0`（370 包，1m08s），canvas 3.2.3 有预编译 `canvas.node`，无原生构建失败。
- World 注册：PASS。`src/worlds/index.ts:12-39` 按 id 动态导入 `definition.ts`，`src/launcher.ts:170-178` 用 `withWorlds()` 合并扩展；bot 的 `declares` 决定默认启用。实测 console 挂载，其余（含 bilibili）未激活。
- Bot 加载：PASS。`deployment.json` 的 `bot` 字段指向 `bots/<id>/index.ts` 或扩展包（`src/launcher.ts:29-47`）；启动命令 `node bin/cortico.mjs <部署名>`。
- Provider：FAIL（未证实）。字段 `kind/baseUrl/secret/spec/multimodal/serviceTier/pricing/options` + `activeProvider`（`docs/providers.md:11-24`）；协议要求 `POST <baseUrl>/responses`（`:66-88`）。OFH `proxy.mjs:38` 会透传 `/v1/responses`，但无有效 key 实测只回 400“Model is unavailable”，未见一次成功 Responses。
- WebUI：PASS。`build:web` exit 0；`node bin/cortico.mjs mybot --port=7799` 后 `GET / = 200`，日志“web面板已启动 / http://127.0.0.1:7799/”。
- CORTICO_START_PAUSED：PASS。`src/boot.ts:27-29`；实测日志“总线已暂停”“已暂停”。
- 工具回执：待验证。契约 `ToolOutcome{text,blobs?,failed?}`（`docs/worlds.md:63-65`）；无可用 provider，未实跑工具调用。

G1：World 注册 PASS / WebUI PASS / Provider FAIL / 工具回执 待验证 → **不通过**。下一步：接可用 Responses 端点后复测工具回执。
