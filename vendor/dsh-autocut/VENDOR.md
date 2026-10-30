# vendored: dsh-autocut 0.3.0（lib 核心）

- 来源：GitHub `lolistlisa/dsh-autocut`（https://github.com/lolistlisa/dsh-autocut），版本 `0.3.0`
- 许可：MIT（见 `LICENSE`）
- 取用范围：`lib/` 全部 15 个文件（assets/deepseek/export/import-research/mapping/online/pipeline/project/render/review/selections/sound/timeline/util/voice）
- 未取：`index.js`（唯一 `@deepseek-ai/dsh-tools` 宿主入口）、`scripts/`、`requirements*.txt`（Python 侧音源/音乐生成依赖，另装）
- 依赖：lib 只 import `node:*` 与同目录文件，**零 DSH 宿主依赖、零 npm 依赖**
- 用途：V3「文案/口播/素材 → 多轨时间线 → 剪映草稿」；产物默认本地，不自动发布

## 约定

1. 不改上游文件；适配逻辑放 `tools/`。
2. 升级整目录替换 + 更新 `SHA256SUMS` 与本文件。
3. 依赖本机 ffmpeg/ffprobe；剪映草稿导出路径必须显式配置。
4. MIT 保留版权声明。

## 状态

- 2026-10-30：已 vendor，**未接线**（观测期禁改码）。V3 在 14 天观测结束后评估。
