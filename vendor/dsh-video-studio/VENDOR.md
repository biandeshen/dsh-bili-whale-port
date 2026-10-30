# vendored: dsh-video-studio 0.4.3（核心 6 文件）

- 来源：npm `dsh-video-studio@0.4.3`（https://github.com/litao36253/dsh-video-studio）
- 许可：MIT（见 `LICENSE`，Copyright (c) 2026 litao）
- 上游 tarball sha256：`588e760da61081139a85c80b0705d0edc837f55773b9897de89b3c62f7a361dd`（`dsh-video-studio-0.4.3.tgz`）
- 取用范围：`dsh/{render,media,cover,ffmpeg,fonts,subtitles}.js` —— 均为纯 Node（fs/path/os/child_process），**零 DSH 依赖、零 npm 依赖**
- 未取：`dsh/index.js`、`panel.js`、`viewer.js`、`workspace.js`、`diagnostic.js`、`skills/`、`cordis.patch.yml`（宿主/面板耦合部分）
- 文件哈希见 `SHA256SUMS`

## 使用约定

1. **不直接 import 上游包的内部路径**（`exports` 只有 `"."`，E-13 实测会 `ERR_PACKAGE_PATH_NOT_EXPORTED`）；只从本目录相对导入。
2. 不改上游文件；需要修补时在 `tools/video-build.mjs` 适配层做，vendor 保持原样，便于升级对照。
3. 升级版本时整目录替换 + 更新本文件与 `SHA256SUMS`，不局部覆盖。
4. 产物默认落 `~/.dsh/bili-whale/media/<date>/`，**不接自动投稿**；发布仍走审批门。
5. MIT 允许商用与再分发；保留 LICENSE 与版权声明。

## 状态

- 2026-10-30：已 vendor，**尚未接线**（观测期前不引入行为变更）。V1 视频切片在 14 天观测结束后开始。
- 依赖外部 ffmpeg/ffprobe（`ffmpeg.js` 会解析 PATH/常见安装目录）；本机已有 ffmpeg（preflight 检查过）。
