# NOTICE · 第三方与免责

本项目（`dsh-bili-whale`）自身代码以 **MIT** 许可发布（见 `LICENSE`）。

## 它依赖/参考了这些第三方

| 名称 | 用途 | 许可 / 说明 |
|---|---|---|
| **Bilibili API** | 全部功能都调 B 站公开接口 | 非官方；本项目**不包含** B 站任何代码或数据 |
| **bilibili-API-collect** | `tools/docs/` 里的接口文档整理自该项目（社区维护的 B 站接口文档） | 遵循其原项目许可；仅作接口说明用，**不随本项目分发**时请以原仓库为准 |
| **ffmpeg** | 抽帧 / 看画面（`tools/lib/ffmpeg.mjs` 只是**定位并调用**它） | **LGPL v2.1+**（若用 GPL 构建则为 GPL）。本项目**不打包** ffmpeg：请自行安装，或使用发布页附带的 LGPL 构建（附其 LICENSE 与源码链接：https://ffmpeg.org）|
| **Node.js** | 运行环境 | MIT |
| **鲸鱼娘序列帧**（原 `panel/assets/whale-girl/`，**2026-11-12 已随旧面板删除**） | 曾是鱼缸页的角色立绘（15 状态）；现在的鱼缸界面不用这套素材 | **CC BY-NC-SA 4.0** · 署名 ZipZipPipe / 上善无形 · **仅个人非商用**。来源 [vlln/whale-girl](https://github.com/vlln/whale-girl)（`lib/assets/characters/whale-girl/`）。本仓已不含该素材，此条留档以便将来重新引入时把义务一并带回 |
| **AMpath**（本仓 `packages/kernel/persona-core/`，宿主侧同源副本在 `Cortico-up/persona-core/`） | 人格内核（场值、因果链、记忆衰减）的移植来源 | 移植自其 `codex/ampath-unified-candidate` 分支（2026-10-26）；`types/effect-bus/causal-chain/memory/npc-state-machine` 五份为原样搬或抽符号。**AMpath 为私有仓库、无 LICENSE：仅供本地自用，对外发布前必须重写或取得授权。** 逐文件对照表目前只在宿主侧 `Cortico-up/persona-core/README.md:5-44`；本仓 `packages/kernel/persona-core/README.md` 只有模块职责表、**没有那张对照表**（2026-11-12 实测，待补的署名缺口）。另有一份纯函数借用件曾落在 `core/ports/`，已随该树于 2026-11-12 删除 |

## 免责

- 本项目是**个人自用工具的公开版**：它用**你自己的账号**在 B 站做评论/回复/发动态等动作，**后果由使用者自负**。
- 不要用于批量刷量、水军、骚扰、绕过风控或任何违反 B 站用户协议的行为。
- 遵循平台规则，撞到风控（验证码 / 限流 / 判刷屏）就该停手，本项目内置了"撞到就停"的护栏。
- 本项目与 B 站、DeepSeek 官方均无隶属关系。
