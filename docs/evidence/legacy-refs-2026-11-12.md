# 旧代码引用表（只读分析，施工依据）

候选 168 文件（core/panel/adapters/tools/vendor）；引用方文本 682 份；根 188 pkg + 7 entry + 24 script。

分层：T1=6 · T2a=5 · T2b=127 · T3=4 · T4=13 · T0=13

**注释里提一句不算引用**；**path.join 片段按整组解析**，猜不准的进「待人工确认」不参与分层；**LICENSE/SHA256SUMS 这类无扩展名文件也算**。

## T1 —— 6 文件

> 被 packages 源码引 —— 运行时真在用，不许删

| 文件 | packages 源码 | 活脚本(npm/gates) | 入口 | 其余脚本 | 测试 | 文档/注释 | 待人工确认 |
|---|---|---|---|---|---|---|---|
| `vendor/dsh-video-studio/cover.js` | packages/capabilities/cap-media-studio/src/vendor/video/studio.mjs | — | — | vendor/dsh-video-studio/render.js | — | — | tests/vendor-video-studio.test.mjs |
| `vendor/dsh-video-studio/ffmpeg.js` | packages/capabilities/cap-media-studio/src/vendor/video/studio.mjs | — | — | vendor/dsh-video-studio/cover.js<br>vendor/dsh-video-studio/media.js<br>vendor/dsh-video-studio/render.js | — | docs/specs/09-media-output.md<br>vendor/dsh-video-studio/VENDOR.md | tests/vendor-video-studio.test.mjs |
| `vendor/dsh-video-studio/fonts.js` | — | — | — | vendor/dsh-video-studio/cover.js<br>vendor/dsh-video-studio/render.js | — | docs/specs/09-media-output.md | tests/vendor-video-studio.test.mjs |
| `vendor/dsh-video-studio/media.js` | — | — | — | vendor/dsh-video-studio/cover.js<br>vendor/dsh-video-studio/render.js | — | — | tests/vendor-video-studio.test.mjs |
| `vendor/dsh-video-studio/render.js` | packages/capabilities/cap-media-studio/src/vendor/video/studio.mjs | — | — | — | — | — | tests/vendor-video-studio.test.mjs |
| `vendor/dsh-video-studio/subtitles.js` | — | — | — | vendor/dsh-video-studio/render.js | — | vendor/dsh-video-studio/render.js | tests/vendor-video-studio.test.mjs |

## T2a —— 5 文件

> 被活脚本引（npm scripts 往下可达，含 gates 链）—— 删了门禁或运维就断

| 文件 | packages 源码 | 活脚本(npm/gates) | 入口 | 其余脚本 | 测试 | 文档/注释 | 待人工确认 |
|---|---|---|---|---|---|---|---|
| `tools/lib/causal.mjs` | — | scripts/ops-day.mjs | — | scripts/ops-day.mjs<br>tools/commands/feed.mjs<br>tools/drafts/store.mjs<br>tools/lib/dm-send-core.mjs<br>…另 1 | tests/contract/state-roots.test.mjs | — | — |
| `tools/lib/kill.mjs` | — | scripts/ops-day.mjs | — | scripts/ops-day.mjs | tests/contract/kill-unified.test.mjs<br>tests/helpers/home-probe.mjs | docs/attic/2026-10/ISSUES.md<br>docs/attic/2026-10/MODULARITY-2026-10-30.md<br>…另 4 | — |
| `tools/lib/offline-gap.mjs` | — | scripts/c2-offline.mjs | — | scripts/c2-offline.mjs | tests/offline-gap.test.mjs | docs/attic/2026-10/ISSUES.md<br>docs/evidence/C2-DECISION-2026-10-29.md | — |
| `tools/lib/paths.mjs` | — | scripts/action-watch.mjs<br>scripts/c2-offline.mjs<br>scripts/c2-window.mjs<br>scripts/check-state-roots.mjs<br>…另 13 | — | adapters/opencode/daemon.js<br>core/api/routes.js<br>core/api/support.js<br>core/index.js<br>…另 83 | tests/contract/go-gate.test.mjs<br>tests/contract/kill-unified.test.mjs<br>tests/contract/m1a-observability.test.mjs<br>tests/contract/pending-queue.test.mjs<br>…另 3 | CHANGELOG.md<br>docs/attic/2026-10/TEAM-GAP-ANALYSIS-2026-10-30.md<br>…另 11 | — |
| `tools/lib/state-roots.mjs` | — | scripts/check-state-roots.mjs | — | scripts/audit-state-locations.mjs<br>scripts/check-state-roots.mjs<br>scripts/migrate-state-roots.mjs | tests/contract/state-roots.test.mjs | CHANGELOG.md<br>docs/attic/2026-11/ARCHITECTURE-DECOUPLING-2026-11-01.md<br>…另 2 | — |

## T2b —— 127 文件

> 只被退役入口（package.json main/exports、仓根 .cmd/.vbs）或死脚本引 —— 可删，但必须连带处理那些入口/脚本

| 文件 | packages 源码 | 活脚本(npm/gates) | 入口 | 其余脚本 | 测试 | 文档/注释 | 待人工确认 |
|---|---|---|---|---|---|---|---|
| `adapters/opencode/controller.js` | — | — | — | adapters/opencode/daemon.js<br>panel/server.js | adapters/opencode/test/contract.test.mjs | adapters/opencode/README.md | — |
| `adapters/opencode/daemon.js` | — | — | — | adapters/opencode/package.json<br>scripts/setup.mjs | — | adapters/opencode/README.md<br>docs/CURRENT.md<br>…另 3 | — |
| `adapters/opencode/mcp-stdio.js` | — | — | — | adapters/opencode/package.json<br>scripts/setup.mjs | adapters/opencode/test/contract.test.mjs | adapters/opencode/README.md<br>docs/attic/2026-11/team-2026-11-03/02-capability-matrix.md | — |
| `adapters/opencode/test/contract.test.mjs` (测试) | — | — | — | adapters/opencode/package.json | — | docs/attic/2026-11/team-2026-11-03/05-red-team.md<br>docs/evidence/gates-2026-11-02.json<br>…另 5 | — |
| `core/api/routes.js` | — | — | — | core/index.js<br>panel/server.js | tests/contract/routes.test.mjs | core/index.js<br>docs/attic/2026-10/PR-port-core-opencode-panel.md<br>…另 8 | — |
| `core/api/support.js` | — | — | — | core/api/routes.js<br>core/index.js<br>panel/server.js<br>scripts/setup.mjs | tests/contract/routes.test.mjs | — | — |
| `core/mention-summary.js` | — | — | — | core/scheduler.js | — | — | — |
| `core/node-runtime.js` | — | — | — | core/api/support.js<br>core/index.js<br>core/scheduler.js<br>panel/server.js | — | — | — |
| `core/scheduler.js` | — | — | — | adapters/opencode/daemon.js<br>core/index.js<br>panel/server.js | tests/contract/injection.test.mjs<br>tests/helpers/dm-delivery.mjs<br>tests/helpers/dm-exit-integration.mjs<br>tests/helpers/listener-polling.mjs<br>…另 2 | docs/attic/2026-11/ARCHITECTURE-TARGET-2026-11-03.md<br>docs/attic/2026-11/team-2026-11-01/security.md<br>…另 5 | — |
| `core/session-delivery.js` | — | — | — | core/scheduler.js | adapters/opencode/test/contract.test.mjs | — | — |
| `core/work-dir.js` | — | — | — | core/index.js | — | — | — |
| `panel/assets/whale-girl/celebrate.png` | — | — | — | panel/assets/whale-girl/manifest.json | — | — | — |
| `panel/assets/whale-girl/disappointed.png` | — | — | — | panel/assets/whale-girl/manifest.json | — | — | — |
| `panel/assets/whale-girl/drag.png` | — | — | — | panel/assets/whale-girl/manifest.json | — | — | — |
| `panel/assets/whale-girl/eat.png` | — | — | — | panel/assets/whale-girl/manifest.json | — | — | — |
| `panel/assets/whale-girl/error.png` | — | — | — | panel/assets/whale-girl/manifest.json | — | — | — |
| `panel/assets/whale-girl/idle.png` | — | — | — | panel/assets/whale-girl/manifest.json | — | — | — |
| `panel/assets/whale-girl/joy.png` | — | — | — | panel/assets/whale-girl/manifest.json | — | — | — |
| `panel/assets/whale-girl/play.png` | — | — | — | panel/assets/whale-girl/manifest.json | — | — | — |
| `panel/assets/whale-girl/sleep.png` | — | — | — | panel/assets/whale-girl/manifest.json | — | — | — |
| `panel/assets/whale-girl/think.png` | — | — | — | panel/assets/whale-girl/manifest.json | — | — | — |
| `panel/assets/whale-girl/wait.png` | — | — | — | panel/assets/whale-girl/manifest.json | — | — | — |
| `panel/assets/whale-girl/wake.png` | — | — | — | panel/assets/whale-girl/manifest.json | — | — | — |
| `panel/assets/whale-girl/walk.png` | — | — | — | panel/assets/whale-girl/manifest.json | — | — | — |
| `panel/assets/whale-girl/welcome.png` | — | — | — | panel/assets/whale-girl/manifest.json | — | — | — |
| `panel/assets/whale-girl/working.png` | — | — | — | panel/assets/whale-girl/manifest.json | — | — | — |
| `panel/auth.js` | — | — | — | panel/server.js | — | — | — |
| `panel/causal.mjs` | — | — | — | panel/data.js | — | docs/attic/2026-10/MODULARITY-2026-10-30.md<br>docs/attic/2026-10/TEAM-GAP-ANALYSIS-2026-10-30.md<br>…另 1 | — |
| `panel/data.js` | — | — | — | panel/server.js | — | docs/attic/2026-11/ARCHITECTURE-DECOUPLING-2026-11-01.md<br>docs/attic/2026-11/EXECUTION-2026-11-01.md<br>…另 4 | — |
| `panel/drafts.mjs` | — | — | — | panel/data.js<br>panel/server.js | — | docs/attic/2026-10/MODULARITY-2026-10-30.md<br>docs/attic/2026-10/TEAM-GAP-ANALYSIS-2026-10-30.md<br>…另 2 | — |
| `panel/feedback.mjs` | — | — | — | panel/server.js | — | docs/attic/2026-11/team-2026-11-01/architecture.md<br>docs/attic/2026-11/team-2026-11-01/round2/judgment-loop-design.md<br>…另 2 | tests/contract/feedback.test.mjs |
| `panel/server.js` | — | — | — | scripts/launch-panel.mjs | tests/contract/injection.test.mjs<br>tests/contract/panel.test.mjs | docs/attic/2026-11/ARCHITECTURE-2026-11.md<br>docs/attic/2026-11/ARCHITECTURE-TARGET-2026-11-03.md<br>…另 9 | — |
| `panel/views/tank.html` | — | — | — | panel/server.js | tests/dom/tank-smoke.test.mjs | docs/attic/2026-11/PANEL-GAP-AUDIT-2026-11-04.md<br>docs/attic/2026-11/team-2026-11-01/round3/config-surface.md<br>…另 3 | — |
| `tools/bili.mjs` | — | — | — | adapters/opencode/daemon.js<br>adapters/opencode/mcp-stdio.js<br>core/api/routes.js<br>core/index.js<br>…另 6 | adapters/opencode/test/contract.test.mjs<br>tests/contract/comment-tier.test.mjs<br>tests/contract/outbound-plain.test.mjs<br>tests/helpers/dm-delivery.mjs<br>…另 4 | adapters/opencode/mcp-stdio.js<br>adapters/opencode/README.md<br>…另 29 | core/mention-summary.js<br>core/scheduler.js<br>tests/contract/feedback.test.mjs<br>…另 10 |
| `tools/commands/ai-share.mjs` | — | — | — | tools/bili.mjs | — | — | — |
| `tools/commands/bili-watch.mjs` | — | — | — | tools/bili.mjs<br>tools/commands/debrief.mjs | — | docs/attic/2026-11/DEEP-AUDIT-2026-11-05.md<br>docs/attic/2026-11/V-NOW-2026-11-04.md<br>…另 3 | — |
| `tools/commands/comment-await.mjs` | — | — | — | tools/bili.mjs | — | docs/attic/2026-11/team-2026-11-01/round3/config-surface.md | — |
| `tools/commands/comment-del.mjs` | — | — | — | tools/bili.mjs | tests/traffic.test.mjs | — | — |
| `tools/commands/comment-digest.mjs` | — | — | — | tools/bili.mjs<br>tools/commands/quota.mjs | tests/integration.test.mjs | docs/attic/2026-11/team-2026-11-03/02-capability-matrix.md | — |
| `tools/commands/comment.mjs` | — | — | — | tools/bili.mjs | tests/contract/go-gate.test.mjs<br>tests/integration.test.mjs | docs/attic/2026-11/team-2026-11-03/02-capability-matrix.md<br>docs/evidence/PERM-TIER-2026-10-31.md<br>…另 1 | — |
| `tools/commands/comments.mjs` | — | — | — | tools/bili.mjs<br>tools/commands/ai-share.mjs | — | — | — |
| `tools/commands/danmaku-await.mjs` | — | — | — | tools/bili.mjs | — | — | core/scheduler.js |
| `tools/commands/danmaku.mjs` | — | — | — | tools/bili.mjs | tests/contract/go-gate.test.mjs | docs/evidence/PERM-TIER-2026-10-31.md | — |
| `tools/commands/debrief.mjs` | — | — | — | tools/bili.mjs | tests/debrief-capability.test.mjs<br>tests/debrief-sampling.test.mjs | docs/attic/2026-11/team-2026-11-01/security.md<br>packages/capabilities/cap-bilibili/src/client/bili-debrief.ts | — |
| `tools/commands/deps.mjs` | — | — | — | tools/bili.mjs | tests/integration.test.mjs | docs/RUNBOOK.md | — |
| `tools/commands/diary.mjs` | — | — | — | tools/bili.mjs | — | docs/attic/2026-11/team-2026-11-01/round3/config-surface.md | — |
| `tools/commands/dm-await.mjs` | — | — | — | tools/bili.mjs | tests/dm-history.test.mjs | docs/attic/2026-11/team-2026-11-03/02-capability-matrix.md | — |
| `tools/commands/dm-draft.mjs` | — | — | — | tools/bili.mjs | — | docs/evidence/M3-DM-REPLY-2026-10-29.md | — |
| `tools/commands/dm.mjs` | — | — | — | tools/bili.mjs<br>tools/commands/notify.mjs | tests/dm-out-causal.test.mjs<br>tests/integration.test.mjs | tests/dm-out-causal.test.mjs | — |
| `tools/commands/dynamic-image.mjs` | — | — | — | tools/bili.mjs | — | docs/attic/2026-11/team-2026-11-01/round3/config-surface.md | — |
| `tools/commands/dynamic.mjs` | — | — | — | tools/bili.mjs | tests/dynamic-recent.test.mjs | docs/attic/2026-10/ARCHITECTURE.md<br>packages/capabilities/cap-bilibili/src/platform/wbi.ts | — |
| `tools/commands/edit-dynamic.mjs` | — | — | — | tools/bili.mjs | tests/edit-dynamic.test.mjs | docs/attic/2026-11/team-2026-11-03/02-capability-matrix.md<br>packages/capabilities/cap-bilibili/src/client/bili-write-extra.ts | — |
| `tools/commands/fav.mjs` | — | — | — | tools/bili.mjs | tests/contract/go-gate.test.mjs | docs/attic/2026-11/team-2026-11-01/round3/config-surface.md<br>docs/attic/2026-11/team-2026-11-01/security.md<br>…另 1 | — |
| `tools/commands/feed.mjs` | — | — | — | tools/bili.mjs | tests/feed-seen.test.mjs | docs/attic/2026-10/ISSUES.md<br>docs/attic/2026-11/team-2026-11-01/round2/content.md<br>…另 5 | — |
| `tools/commands/feedback.mjs` | — | — | — | panel/feedback.mjs<br>tools/bili.mjs | tests/contract/feedback.test.mjs | docs/attic/2026-11/ARCHITECTURE-2026-11.md<br>docs/attic/2026-11/team-2026-11-01/round2/judgment-loop-design.md<br>…另 1 | — |
| `tools/commands/judgment.mjs` | — | — | — | tools/bili.mjs | — | — | — |
| `tools/commands/like.mjs` | — | — | — | tools/bili.mjs | tests/perm-tier-cli.test.mjs | docs/attic/2026-11/team-2026-11-01/devils-advocate.md<br>docs/attic/2026-11/team-2026-11-01/product.md<br>…另 3 | — |
| `tools/commands/likes.mjs` | — | — | — | tools/bili.mjs<br>tools/commands/quota.mjs | — | docs/attic/2026-11/team-2026-11-03/01-arch-arbiter.md<br>docs/attic/2026-11/team-2026-11-03/02-capability-matrix.md | — |
| `tools/commands/notify.mjs` | — | — | — | tools/bili.mjs<br>tools/commands/ai-share.mjs<br>tools/commands/comment.mjs<br>tools/commands/reply-draft.mjs | tests/integration.test.mjs | docs/attic/2026-11/team-2026-11-01/architecture.md<br>docs/attic/2026-11/team-2026-11-01/round2/operations.md | core/api/routes.js<br>tools/lib/report.mjs |
| `tools/commands/quota.mjs` | — | — | — | tools/bili.mjs<br>tools/commands/comment.mjs | tests/integration.test.mjs | docs/attic/2026-11/ARCHITECTURE-2026-11.md<br>docs/attic/2026-11/team-2026-11-01/round3/config-surface.md<br>…另 1 | tools/lib/quota-gate.mjs |
| `tools/commands/rename.mjs` | — | — | — | tools/bili.mjs | — | — | — |
| `tools/commands/reply-draft.mjs` | — | — | — | tools/bili.mjs | — | docs/attic/2026-11/team-2026-11-01/security.md | — |
| `tools/commands/search.mjs` | — | — | — | tools/bili.mjs | — | — | — |
| `tools/commands/selftest.mjs` | — | — | — | tools/bili.mjs | — | docs/attic/2026-11/DECOUPLING-STATUS-2026-11-02.md | — |
| `tools/commands/subtitles.mjs` | — | — | — | tools/bili.mjs | — | tools/commands/comments.mjs | — |
| `tools/commands/traffic.mjs` | — | — | — | tools/bili.mjs | tests/traffic-pause-expiry.test.mjs | docs/attic/2026-11/team-2026-11-01/round2/self-correction.md | — |
| `tools/commands/video-content.mjs` | — | — | — | tools/bili.mjs | — | tools/commands/subtitles.mjs | — |
| `tools/commands/whale-night.mjs` | — | — | — | tools/bili.mjs | tests/integration.test.mjs | docs/attic/2026-11/team-2026-11-01/round3/config-surface.md<br>docs/DEPLOY.md<br>…另 1 | — |
| `tools/diagnostics/fetch-covers.mjs` | — | — | — | tools/bili.mjs | — | — | — |
| `tools/diagnostics/whois.mjs` | — | — | — | tools/bili.mjs | — | packages/capabilities/cap-bilibili/src/platform/wbi.ts | — |
| `tools/drafts/compose.mjs` | — | — | — | scripts/draft-dynamic.mjs | tests/contract/outbound-plain.test.mjs | docs/attic/2026-11/DECOUPLING-STATUS-2026-11-02.md | — |
| `tools/drafts/publishers/bilibili-dynamic.mjs` | — | — | — | scripts/dynamic-approve.mjs<br>tools/commands/dynamic-image.mjs<br>tools/commands/dynamic.mjs | tests/drafts-publisher.test.mjs | docs/attic/2026-10/MODULARITY-2026-10-30.md<br>docs/attic/2026-11/team-2026-11-01/platform.md<br>…另 1 | — |
| `tools/drafts/store.mjs` | — | — | — | scripts/draft-dynamic.mjs<br>scripts/dynamic-approve.mjs | tests/contract/state-roots.test.mjs | — | — |
| `tools/drafts/voice.schema.json` | — | — | — | tools/drafts/compose.mjs | tests/contract/voice.test.mjs | docs/attic/2026-11/ARCHITECTURE-2026-11.md<br>docs/attic/2026-11/ARCHITECTURE-DECOUPLING-2026-11-01.md<br>…另 1 | — |
| `tools/lib/ai-share.mjs` | — | — | — | tools/commands/ai-share.mjs<br>tools/commands/comment.mjs<br>tools/commands/comments.mjs | tests/ai-share.test.mjs | docs/attic/2026-11/team-2026-11-01/round3/config-surface.md<br>docs/attic/2026-11/team-2026-11-03/02-capability-matrix.md<br>…另 1 | — |
| `tools/lib/bili-api.mjs` | — | — | — | tools/commands/bili-watch.mjs<br>tools/commands/comments.mjs<br>tools/commands/debrief.mjs<br>tools/commands/deps.mjs<br>…另 6 | tests/review.test.mjs<br>tests/supplement.test.mjs | CHANGELOG.md<br>docs/attic/2026-11/DECOUPLING-STATUS-2026-11-02.md<br>…另 2 | adapters/opencode/test/contract.test.mjs |
| `tools/lib/capture.mjs` | — | — | — | tools/commands/ai-share.mjs<br>tools/commands/bili-watch.mjs<br>tools/commands/comment.mjs<br>tools/commands/debrief.mjs<br>…另 5 | tests/updates.test.mjs | CHANGELOG.md | — |
| `tools/lib/cli-args.mjs` | — | — | — | tools/bili.mjs | tests/updates.test.mjs | CHANGELOG.md | — |
| `tools/lib/config.mjs` | — | — | — | tools/commands/ai-share.mjs<br>tools/commands/comment-await.mjs<br>tools/commands/comment-digest.mjs<br>tools/commands/comment.mjs<br>…另 16 | — | core/api/support.js<br>docs/attic/2026-11/ARCHITECTURE-2026-11.md<br>…另 1 | — |
| `tools/lib/cred.mjs` | — | — | — | tools/commands/dm.mjs<br>tools/commands/rename.mjs<br>tools/lib/credentials/bilibili.mjs<br>tools/lib/dm-send-core.mjs | tests/contract/state-home.test.mjs<br>tests/helpers/plugin.mjs | docs/attic/2026-10/MODULARITY-2026-10-30.md<br>docs/attic/2026-11/ARCHITECTURE-2026-11.md<br>…另 1 | — |
| `tools/lib/credentials/bilibili.mjs` | — | — | — | tools/lib/credentials/index.mjs | — | docs/specs/07-account-and-credentials.md | — |
| `tools/lib/credentials/mimo.mjs` | — | — | — | tools/lib/credentials/index.mjs | — | — | — |
| `tools/lib/dm-drafts.mjs` | — | — | — | scripts/dm-approve.mjs<br>tools/commands/dm-draft.mjs | tests/contract/dm-approve.test.mjs<br>tests/contract/outbound-plain.test.mjs<br>tests/dm-drafts.test.mjs | docs/evidence/M3-DM-REPLY-2026-10-29.md | — |
| `tools/lib/dm-history.mjs` | — | — | — | tools/commands/dm-await.mjs | — | docs/attic/2026-11/team-2026-11-03/02-capability-matrix.md | — |
| `tools/lib/dm-send-core.mjs` | — | — | — | scripts/dm-approve.mjs<br>tools/commands/dm.mjs | — | docs/attic/2026-11/team-2026-11-01/TEAM-DIGEST-2026-11-01.md<br>packages/capabilities/cap-bilibili/src/client/bili-write-extra.ts<br>…另 1 | — |
| `tools/lib/feed-feedback.mjs` | — | — | — | scripts/wordlist-hit-check.mjs<br>tools/commands/feed.mjs | tests/contract/feed-feedback.test.mjs | docs/attic/2026-11/team-2026-11-01/round2/devils-advocate-2.md<br>docs/attic/2026-11/team-2026-11-01/round2/self-correction.md<br>…另 1 | — |
| `tools/lib/feed-quality.mjs` | — | — | — | tools/commands/feed.mjs | tests/contract/feed-quality.test.mjs<br>tests/contract/judgment-loop.test.mjs<br>tests/feed-dislike.test.mjs | docs/attic/2026-10/ISSUES.md<br>docs/evidence/D-31-RULING-2026-10-29.md | — |
| `tools/lib/feedback.mjs` | — | — | — | tools/commands/quota.mjs | tests/updates.test.mjs | CHANGELOG.md | tests/contract/feedback.test.mjs |
| `tools/lib/ffmpeg.mjs` | — | — | — | tools/commands/bili-watch.mjs<br>tools/commands/debrief.mjs<br>tools/commands/deps.mjs | — | NOTICE.md<br>packages/capabilities/cap-vision/src/vendor/see-now/VENDORED.md | — |
| `tools/lib/go-gate.mjs` | — | — | — | tools/commands/comment.mjs<br>tools/commands/danmaku.mjs<br>tools/commands/fav.mjs<br>tools/commands/like.mjs | tests/contract/go-gate.test.mjs<br>tests/contract/state-home.test.mjs | docs/attic/2026-10/CLOSEOUT.md<br>docs/attic/2026-11/ARCHITECTURE-2026-11.md<br>…另 3 | tests/perm-tier.test.mjs |
| `tools/lib/go-rebuild.mjs` | — | — | — | core/api/routes.js | tests/contract/m1e-approval.test.mjs | docs/attic/2026-11/ARCHITECTURE-2026-11.md<br>docs/attic/2026-11/team-2026-11-01/security.md<br>…另 1 | — |
| `tools/lib/judgment.mjs` | — | — | — | tools/commands/feed.mjs<br>tools/commands/judgment.mjs | tests/contract/judgment.test.mjs | tools/commands/judgment.mjs | — |
| `tools/lib/msgfeed.mjs` | — | — | — | core/scheduler.js<br>tools/commands/comment-await.mjs<br>tools/commands/comment-digest.mjs | — | docs/attic/2026-11/ARCHITECTURE-TARGET-2026-11-03.md<br>docs/attic/2026-11/team-2026-11-03/01-arch-arbiter.md<br>…另 3 | — |
| `tools/lib/night-config.mjs` | — | — | — | core/scheduler.js<br>tools/commands/whale-night.mjs | — | — | — |
| `tools/lib/night-plan.mjs` | — | — | — | core/scheduler.js<br>tools/commands/whale-night.mjs | adapters/opencode/test/contract.test.mjs<br>tests/helpers/scheduler-timeout.mjs<br>tests/helpers/scheduler.mjs<br>tests/planner.test.mjs<br>…另 3 | docs/attic/2026-11/RESEARCH-EXPANSION-2026-11-04.md | — |
| `tools/lib/nodebin.mjs` | — | — | — | tools/bili.mjs<br>tools/commands/ai-share.mjs<br>tools/commands/comment.mjs<br>tools/commands/debrief.mjs<br>…另 8 | — | — | — |
| `tools/lib/pending-queue.mjs` | — | — | — | tools/commands/reply-draft.mjs | tests/contract/pending-queue.test.mjs | docs/attic/2026-11/DECOUPLING-STATUS-2026-11-02.md<br>docs/attic/2026-11/team-2026-11-03/02-capability-matrix.md | — |
| `tools/lib/pick-image.mjs` | — | — | — | scripts/draft-dynamic.mjs | tests/contract/pick-image.test.mjs | docs/attic/2026-11/ARCHITECTURE-2026-11.md | — |
| `tools/lib/plain-outbound.mjs` | — | — | — | tools/commands/comment.mjs<br>tools/commands/danmaku.mjs<br>tools/drafts/compose.mjs<br>tools/lib/dm-drafts.mjs<br>…另 1 | tests/contract/plain-outbound.test.mjs | CHANGELOG.md<br>docs/attic/2026-11/DECOUPLING-STATUS-2026-11-02.md | — |
| `tools/lib/poll-policy.mjs` | — | — | — | core/scheduler.js | tests/traffic.test.mjs | — | — |
| `tools/lib/publish-policy.mjs` | — | — | — | tools/commands/comment.mjs<br>tools/commands/danmaku.mjs<br>tools/commands/fav.mjs<br>tools/commands/like.mjs | tests/publish-policy.test.mjs | CHANGELOG.md<br>docs/attic/2026-11/ARCHITECTURE-2026-11.md<br>…另 6 | — |
| `tools/lib/quota-gate.mjs` | — | — | — | tools/commands/danmaku.mjs<br>tools/commands/dm.mjs<br>tools/commands/dynamic.mjs<br>tools/commands/edit-dynamic.mjs<br>…另 2 | — | docs/attic/2026-11/team-2026-11-03/02-capability-matrix.md | — |
| `tools/lib/report.mjs` | — | — | — | tools/commands/comment.mjs<br>tools/commands/dm.mjs<br>tools/commands/dynamic-image.mjs<br>tools/commands/fav.mjs<br>…另 1 | tests/contract/report.test.mjs | docs/attic/2026-11/AUDIT-REPLY-2026-11-01.md<br>docs/attic/2026-11/team-2026-11-03/02-capability-matrix.md | — |
| `tools/lib/runtime.mjs` | — | — | — | core/node-runtime.js<br>tools/lib/nodebin.mjs | tests/updates.test.mjs | — | — |
| `tools/lib/share-policy.mjs` | — | — | — | tools/commands/comment.mjs<br>tools/commands/dm.mjs | tests/planner.test.mjs | — | — |
| `tools/lib/traffic.mjs` | — | — | — | core/api/support.js<br>core/index.js<br>core/scheduler.js<br>panel/data.js<br>…另 35 | tests/contract/kill-unified.test.mjs<br>tests/contract/write-refusal.test.mjs<br>tests/helpers/listener-polling.mjs<br>tests/helpers/traffic-worker.mjs<br>…另 2 | CHANGELOG.md<br>docs/attic/2026-11/ARCHITECTURE-2026-11.md<br>…另 12 | — |
| `tools/lib/watch-options.mjs` | — | — | — | tools/commands/bili-watch.mjs | tests/issue27.test.mjs | — | — |
| `tools/lib/write-refusal.mjs` | — | — | — | tools/commands/comment.mjs<br>tools/commands/danmaku.mjs<br>tools/commands/fav.mjs<br>tools/commands/like.mjs | tests/contract/write-refusal.test.mjs | docs/attic/2026-11/DECOUPLING-STATUS-2026-11-02.md<br>docs/attic/2026-11/team-2026-11-03/05-red-team.md | — |
| `tools/media/bgm.mjs` | — | — | — | tools/video-build.mjs | tests/media-bgm.test.mjs | — | — |
| `tools/media/config.mjs` | — | — | — | tools/video-build.mjs | — | — | — |
| `tools/media/tts.mjs` | — | — | — | tools/video-build.mjs | tests/media-tts.test.mjs | docs/attic/2026-11/ARCHITECTURE-2026-11.md | — |
| `tools/media/video/studio.mjs` | — | — | — | tools/video-build.mjs | tests/media-studio.test.mjs | docs/attic/2026-11/ARCHITECTURE-2026-11.md<br>docs/attic/2026-11/team-2026-11-01/round3/form-and-independence.md | — |
| `tools/verify/comment-exists.mjs` | — | — | — | tools/bili.mjs | — | — | — |
| `tools/verify/dryrun.mjs` | — | — | — | tools/bili.mjs | — | — | — |
| `tools/verify/dynamic-inspect.mjs` | — | — | — | tools/bili.mjs | — | — | — |
| `tools/verify/mention-check.mjs` | — | — | — | tools/bili.mjs | — | — | — |
| `tools/verify/session.mjs` | — | — | — | tools/bili.mjs | — | — | — |
| `tools/verify/thread.mjs` | — | — | — | tools/bili.mjs | — | — | — |
| `tools/verify/watch-replies.mjs` | — | — | — | tools/bili.mjs | — | — | — |
| `vendor/dsh-autocut/lib/assets.js` | — | — | — | vendor/dsh-autocut/lib/pipeline.js<br>vendor/dsh-autocut/lib/selections.js | — | — | — |
| `vendor/dsh-autocut/lib/mapping.js` | — | — | — | vendor/dsh-autocut/lib/timeline.js | — | — | — |
| `vendor/dsh-autocut/lib/project.js` | — | — | — | vendor/dsh-autocut/lib/pipeline.js | — | — | — |
| `vendor/dsh-autocut/lib/render.js` | — | — | — | vendor/dsh-autocut/lib/pipeline.js | — | — | tests/vendor-video-studio.test.mjs |
| `vendor/dsh-autocut/lib/sound.js` | — | — | — | vendor/dsh-autocut/lib/pipeline.js | — | — | — |
| `vendor/dsh-autocut/lib/timeline.js` | — | — | — | vendor/dsh-autocut/lib/pipeline.js | — | — | — |
| `vendor/dsh-autocut/lib/util.js` | — | — | — | vendor/dsh-autocut/lib/assets.js<br>vendor/dsh-autocut/lib/export.js<br>vendor/dsh-autocut/lib/import-research.js<br>vendor/dsh-autocut/lib/online.js<br>…另 8 | — | — | — |
| `vendor/dsh-autocut/lib/voice.js` | — | — | — | vendor/dsh-autocut/lib/pipeline.js | — | — | — |

## T3 —— 4 文件

> 只被测试引 —— 删文件必须同时处置那些测试，否则套件红

| 文件 | packages 源码 | 活脚本(npm/gates) | 入口 | 其余脚本 | 测试 | 文档/注释 | 待人工确认 |
|---|---|---|---|---|---|---|---|
| `core/index.js` | — | — | — | — | tests/helpers/plugin.mjs | docs/attic/2026-10/PLUGIN-INTEGRATION-PLAN-2026-10-30.md<br>docs/attic/2026-11/team-2026-11-01/round2/judgment-loop-design.md<br>…另 2 | — |
| `tools/lib/credentials/index.mjs` | — | — | — | — | tests/contract/credentials.test.mjs | — | — |
| `tools/lib/state-lock.mjs` | — | — | — | — | tests/contract/state-roots.test.mjs | — | — |
| `tools/video-build.mjs` | — | — | — | — | tests/media-studio.test.mjs | assets/bgm/README.md<br>CHANGELOG.md<br>…另 12 | — |

## T4 —— 13 文件

> 只被文档或注释提及 —— 可删；attic 里的提及不改写（那是当时的真相）

| 文件 | packages 源码 | 活脚本(npm/gates) | 入口 | 其余脚本 | 测试 | 文档/注释 | 待人工确认 |
|---|---|---|---|---|---|---|---|
| `adapters/opencode/README.md` | — | — | — | — | — | CHANGELOG.md<br>docs/DEPLOY.md<br>…另 1 | — |
| `core/client.js` | — | — | — | — | — | docs/attic/2026-11/CONTROL-SURFACE-2026-11-04.md<br>docs/attic/2026-11/PANEL-GAP-AUDIT-2026-11-04.md<br>…另 3 | — |
| `core/ports/temporal.mjs` | — | — | — | — | — | docs/attic/2026-11/ARCHITECTURE-TARGET-2026-11-03.md<br>docs/attic/2026-11/team-2026-11-01/round3/four-questions-decisions.md<br>…另 3 | — |
| `panel/assets/whale-girl/manifest.json` | — | — | — | — | — | scripts/audit-legacy-refs.mjs | scripts/purge-acceptance-residue.mjs |
| `tools/docs/comment-add.md` | — | — | — | — | — | docs/attic/2026-11/team-2026-11-01/platform.md | — |
| `tools/docs/dynamic-publish.md` | — | — | — | — | — | docs/attic/2026-11/team-2026-11-01/platform.md<br>packages/capabilities/cap-bilibili/src/client/bili-write-extra.ts | — |
| `tools/docs/rich-text-nodes.md` | — | — | — | — | — | docs/attic/2026-11/team-2026-11-01/platform.md | — |
| `tools/templates/config.example.json` | — | — | — | — | — | docs/attic/2026-11/team-2026-11-01/security.md | — |
| `vendor/dsh-autocut/LICENSE` | — | — | — | — | — | vendor/dsh-autocut/VENDOR.md | — |
| `vendor/dsh-autocut/SHA256SUMS` | — | — | — | — | — | vendor/dsh-autocut/VENDOR.md | scripts/audit-legacy-refs.mjs<br>tests/vendor-autocut.test.mjs<br>tests/vendor-video-studio.test.mjs |
| `vendor/dsh-autocut/VENDOR.md` | — | — | — | — | — | docs/attic/2026-11/team-2026-11-01/round3/form-and-independence.md | — |
| `vendor/dsh-video-studio/LICENSE` | — | — | — | — | — | vendor/dsh-video-studio/VENDOR.md | — |
| `vendor/dsh-video-studio/SHA256SUMS` | — | — | — | — | — | vendor/dsh-video-studio/VENDOR.md | scripts/audit-legacy-refs.mjs<br>tests/vendor-autocut.test.mjs<br>tests/vendor-video-studio.test.mjs |

## T0 —— 13 文件

> 无人引用 —— 可删，但许可证/校验清单例外（vendor 的 LICENSE 与 SHA256SUMS 被测试真读，且删 vendored 代码必须留许可证）

| 文件 | packages 源码 | 活脚本(npm/gates) | 入口 | 其余脚本 | 测试 | 文档/注释 | 待人工确认 |
|---|---|---|---|---|---|---|---|
| `adapters/opencode/package.json` | — | — | — | — | — | — | — |
| `tools/docs/dynamic-action.md` | — | — | — | — | — | — | — |
| `tools/docs/live-danmaku.md` | — | — | — | — | — | — | — |
| `tools/docs/live-room-info.md` | — | — | — | — | — | — | — |
| `tools/lib/proc.mjs` | — | — | — | — | — | — | — |
| `vendor/dsh-autocut/lib/deepseek.js` | — | — | — | — | — | — | — |
| `vendor/dsh-autocut/lib/export.js` | — | — | — | — | — | — | — |
| `vendor/dsh-autocut/lib/import-research.js` | — | — | — | — | — | — | — |
| `vendor/dsh-autocut/lib/online.js` | — | — | — | — | — | — | — |
| `vendor/dsh-autocut/lib/pipeline.js` | — | — | — | — | — | — | — |
| `vendor/dsh-autocut/lib/review.js` | — | — | — | — | — | — | — |
| `vendor/dsh-autocut/lib/selections.js` | — | — | — | — | — | — | — |
| `vendor/dsh-video-studio/VENDOR.md` | — | — | — | — | — | — | — |
