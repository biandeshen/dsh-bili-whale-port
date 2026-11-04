# vendor/see-now —— 从 dsh-see-now 原样搬来的部分

| 字段 | 值 |
| --- | --- |
| 上游仓库 | https://github.com/SAOS-3624/dsh-see-now |
| 许可 | **Apache-2.0**（`LICENSE` 全文 + `NOTICE` 一并留着，同目录） |
| 版本 | `0.0.10`（npm registry 实测同版本存在，零 runtime 依赖，peer 依赖 `@deepseek-ai/dsh-tools` 标了 optional） |
| 取的 commit | `a21b62d9fbdaf7144034f8f350fa8a544fbd73b5`（2026-11-04 02:20:35 +08:00） |
| 取的文件 | `cuts.js tiers.js pack.js sheet.js scale.js png.js layout.js pipeline.js`（8 个，一行没改） |

## 为什么是 vendor 而不是 npm 依赖

本仓现在 **一个 node_modules 都没有**：包与包之间用相对路径直连
（`../../cap-memory/src/...`），跑法是 `node --experimental-strip-types`。
装一个 npm 依赖就要引入安装步骤，而 `pnpm-workspace` 里 9 个包全是 `workspace:*`。
上游这 8 个模块的 import 闭包正好自足（只有 `node:` 内置 + 彼此相对引用），
拷进来比装包更省事，也让"能力包宿主无关"这条铁律继续成立。

## 为什么只搬这 8 个

`createPipeline()` 是本包唯一需要的入口，它的传递依赖就是这 8 个文件。
**没搬**的部分以及原因：

- `capture.js` / `window.js` / `region.js`：面向**实时屏幕/摄像头**（ddagrab / gdigrab /
  avfoundation）。我们要的是读一个已经下载好的 mp4，这一路上游没有，自己写在
  `../frame-pipeline.ts` 里（单管道 rawvideo，一趟解码）。
- `runner.js` / `loop.js` / `interject.js` / `chat.js` / `voice.js` / `speech.js` /
  `listen.js` / `timer.js` / `tool-spec.js` / `index.js` / `binaries.js`：DSH 宿主侧的
  会话编排、插话、TTS 自听保护、SenseVoice 转写、工具声明。这些属于"宿主/别的产品"
  的地盘，插进小鱼的架构会撞 `万物皆扩展` 的边界。
- `binaries.js`：它找的是 DSH 桌面版摆法（`$DSH_HOME/tools/ffmpeg/bin`），
  本机这条线是 `~/.dsh/bili-whale/bin` + 剪映兜底，顺序在 `../ffmpeg.ts` 里重写了一份
  （照 `tools/lib/ffmpeg.mjs` 的形状）。

## 上游的设计值得知道的两件事（不是我们的选择，别误改）

1. **`cutAbs` 默认 12 而不是 storyboard 的 25**，`pace:"dense"` 才是 7。这两个数是上游
   拿"每 2 秒硬切一张照片"的素材实测出来的（见 `pipeline.js` DEFAULTS 那张表）。
2. **留帧是三路**：切点（尖峰）+ 积分（攒够多少"中等强度秒"）+ 兜底（太久没出帧补一张）。
   `REF_SCORE = 4` 是"中等强度画面每帧的变化分"标定值，积分阈值 = `REF_SCORE × fps × integralSeconds`。

## 更新办法

sha256（搬来时与上游逐字节核对过，`diff` 为空）：

| 文件 | sha256 |
| --- | --- |
| `cuts.js` | `a2652a4d12c3232a21c898f1ed46b55cde48b2c34e4b67fb74bec0c6f77c0fcc` |
| `tiers.js` | `be7bf28b8227c72f5bc05e0b3b5ee35d3a150bf8120344572822aefdf49ffb55` |
| `pack.js` | `529389a685d7a77a41382f9fe3e19da530783bf38cd1d6cda1034356ae2456d5` |
| `sheet.js` | `b7ea3f4791ccdd54df402a72a5c0ab99f3b5885cea372bd1482cc64b5f3d0647` |
| `scale.js` | `0d82c7e8054a352ebf4a43a804d5b02fdd5512b930ce25f4c9dfce267c5fc16c` |
| `png.js` | `6288760abcf4845c9a64f70b115af2f89073c2be6192409ff9b2b9ec1689cc44` |
| `layout.js` | `054c2e52e1b243b84c3986fac95acada710b5f7cdc7a28ccf99a36ffde33c70a` |
| `pipeline.js` | `bab718bc7d1f835df71a115f7c9b828ffa127dfcae9cb00e0f952b2269447adf` |
| `LICENSE` | `0f4587918026d801…`（与上游同一条，全文见同目录） |

```bash
# 1) 拉上游（GitHub 直连不通时走 gh-proxy）
git -C ../dsh-see-now pull --ff-only
# 2) 重拷这 8 个文件（一行都不要手改）
for f in cuts tiers pack sheet scale png layout pipeline; do cp ../dsh-see-now/src/$f.js src/vendor/see-now/$f.js; done
# 3) 核哈希：对上表的哪几行变了，就只改哪几行的注释与说明
sha256sum src/vendor/see-now/*.js
# 4) 跑本包测试——口径断言会当场抓住"上游偷偷改了阈值"
node --experimental-strip-types --test packages/cap-vision/tests/*.test.mjs
```

搬过来之后**没有改过任何一行**；本包对它做的唯一适配全在 `../frame-pipeline.ts`
（离线选项：`queueDepth:0` 不丢帧、`fps:2`、按片长配平 `integralSeconds/silentFloorSec/maxWaitSec`）。
配平原样回显在结果的 `tuning` 字段里，出问题能对账"为什么只出了 6 张"。
