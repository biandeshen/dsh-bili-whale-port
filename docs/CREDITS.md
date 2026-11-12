# 素材与代码来源（CREDITS）

## 鲸鱼娘序列帧（已于 2026-11-12 随旧面板退役，本仓不再包含）

原位置 `panel/assets/whale-girl/`（16 png + manifest.json）。旧面板整棵树删除时一并移除，
现在的鱼缸界面在宿主能力包里，不用这套序列帧。**署名与许可义务照旧留档**：若将来重新引入这套素材，
下面这些条件必须一起带回来，不能因为文件删了就把出处抹掉。

- 来源：[vlln/whale-girl](https://github.com/vlln/whale-girl) · `lib/assets/characters/whale-girl/`（15 状态帧条 + manifest）
- 角色原型：画师 **上善无形** 的「溟月」（DeepSeek 社区二创鲸鱼娘）
- 图形许可：**CC BY-NC-SA 4.0** —— 仅个人非商用；必须署名；衍生作品须以同协议共享
- 代码许可：MIT
- 署名：**ZipZipPipe**（原图）；如使用 Live2D 版本另需署名 **氵六青**（本项目未包含 Live2D）
- 本仓库仅作个人自用；若对外分发，请保留本文件并遵守同协议。

## 未包含

- Live2D：需要专有 Cubism Core，禁止再分发，未采用。
- 无 license 的图包、Booth/Pixiv 限定模型：未采用。

## 代码

- 上游 [Alterssss/dsh-bili-whale](https://github.com/Alterssss/dsh-bili-whale)（MIT）
- 时间线分页契约参考内部经验（自实现）。
- **AMpath（人格内核移植来源）**：私有仓库、**无 LICENSE**。本仓 `packages/persona-core/` 移植自其
  `codex/ampath-unified-candidate` 分支（2026-10-26），其中 `types.ts`、`effect-bus.ts`、`causal-chain.ts`、
  `memory.ts`、`npc-state-machine.ts` 五份是原样搬或只抽依赖符号（2026-11-12 实测五份都在）。
  **仅供本地自用，对外发布前必须重写或取得授权**——这条义务**没有**随下面那次删除而消失。
  逐文件「来源与取舍」对照表在宿主侧 `Cortico-up/persona-core/README.md:5-44`，
  本仓 `packages/persona-core/README.md` 只有模块职责表、缺那张对照表（待补的署名缺口）。
- **AMpath 纯函数借用件**：曾是一份 `temporal.mjs`，落在旧 `core/ports/` 下（时间线分页契约思路；原文 `git show 7bf9198:core/ports/temporal.mjs`），
  **2026-11-12 随 `core/` 整棵树删除**。删掉的只是这一份借用件，不是上面那条移植义务。
