# V1 视频切片 smoke —— 证据卡（2026-10-30）

> 只记跑过的命令与产物，不写"应该"。状态：**渲染通路通过**；TTS 音轨与封面未接，V1 门未全过。

## 输入

| 项 | 值 |
|---|---|
| 立绘 | `D:/AI/养鱼/assets/daily/daily-01-night-a.png`（1080×1920） |
| 文案 | `今晚听雨。` / `三十九分钟，没有人说话。` / `晚安。` |
| 时长/画幅 | 12s，1080×1920，30fps |
| 工具 | `tools/video-build.mjs` + `vendor/dsh-video-studio`（MIT） |
| 二进制 | `~/.dsh/bili-whale/bin/ffmpeg.exe`（2020 build）+ `ffprobe.exe`（9.0.2，本次从 essentials zip 提取） |

## 命令

```bash
node tools/video-build.mjs --image "D:/AI/养鱼/assets/daily/daily-01-night-a.png" \
  --text $'今晚听雨。\n三十九分钟，没有人说话。\n晚安。' --duration 12 --plan
node tools/video-build.mjs --image "D:/AI/养鱼/assets/daily/daily-01-night-a.png" \
  --text $'今晚听雨。\n三十九分钟，没有人说话。\n晚安。' --duration 12
```

## 结果

| 项 | 结果 |
|---|---|
| plan | `ok:true`，`warnings:[]` |
| 成片 | `C:/Users/Administrator/.dsh/bili-whale/media/_smoke/smoke-20261030044134.mp4` |
| 容器 | 12.000s，804,247 B（0.77MB），h264 1080×1920@30 + aac |
| sha256 | `65c27c22c92bab88243e22df5f659ca80c835c7fa1e41342d07cdb0229990035` |
| 字幕 | 2s 顶部标题「今晚听雨。」；6s/10s 底部正文；4s 空档（行间切换） |

抽帧（同目录）：`frame-2s.png` `frame-4s.png` `frame-6s.png` `frame-8s.png` `frame-10s.png`。

## 踩到的坑（已修）

1. `resolveBinaries({})` 不扫 `~/.dsh/bili-whale/bin/`，原先只靠 PATH/常见目录 → 显式传 `ffmpegPath`/`ffprobePath`。
2. 基础片段无音轨，vendor 的 `[i:a]` 链报 `matches no streams` → 合成时加 `anullsrc` 静音轨（aac 128k）。
3. planOnly 原先用 1s 占位片段，导致"正文时间窗不足"误报 → plan 也按真实时长建片段。

## 未过 / 下一步

- **无 TTS**：成片是静音。S1 语音（Edge-TTS）未接，V1 门要求"一段 TTS 音轨"。
- **无封面**：`cover.js` 未跑，16:9/9:16 封面未出。
- 观测期（11-01 起）禁改码：以上留给观测后第一个开发窗口，不在观测期接线。
