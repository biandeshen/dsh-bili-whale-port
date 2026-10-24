# TERMUX —— 把鱼养在备用安卓机里

一台闲置安卓 + Termux = 24 小时在线的鱼缸（PC 可关机）。她醒着刷 B 站、写日记，
有事通过 ntfy 推到你主力手机，点开面板审批草稿。

## 1. 装机（Termux 用 F-Droid 版，Play 版已停更）

```bash
pkg update && pkg install nodejs-lts git
git clone <本仓库> && cd dsh-bili-whale && npm ci --omit=dev   # core 零运行时依赖，装的是个寂寞但 pm2 要
npm i -g pm2
```

## 2. 环境与凭据

```bash
mkdir -p ~/.whale
cp ~/.dsh/bili-whale.config.json ~/.whale/        # 从 PC 拷同一份配置（或重配）
cp -r ~/.bili-ai ~/.whale-bili-ai && ln -s ~/.whale-bili-ai ~/.bili-ai   # cookie/persona/日记
export WHALE_HOME=~/.whale
export WHALE_NODE=$PREFIX/bin/node                 # Termux 里就是系统 node，显式写上更稳
export BILI_WHALE_CONFIG=~/.whale/bili-whale.config.json
export OPENCODE_BASE_URL=http://127.0.0.1:4096     # 如果同时跑 opencode serve（手机也能跑）
```

## 3. 起时钟 + 面板

```bash
pm2 start adapters/opencode/daemon.js --name whale
pm2 start panel/server.js --name panel -- --port 8447   # 面板默认不自带时钟（时钟归 whale，避免双调度）
pm2 save && pm2 startup hostname -u    # Termux 无 systemd，用 boot 脚本：
echo 'pm2 resurrect' >> ~/.bashrc      # 或 Termux:Boot + 自启脚本
termux-wake-lock                       # 防休眠杀进程
```

- 通知：`notify.type=ntfy`，url 填自建服务器（本机 `ntfy serve` 也行，`http://127.0.0.1:8080/whale`）
  或公共 `https://ntfy.sh/<topic>`；主力手机装 ntfy 订阅同 topic。
- 面板：本机浏览器 `http://127.0.0.1:8447/?t=<token>`（加到主屏幕即"伪 App"）；
  远程访问走 **Tailscale**，绝不把 8447 暴露公网（panel 有 loopback 硬校验，远程直连会 403）。

## 4. 手机形态的独有关怀

- **tick-catchup**：安卓待机/杀进程后重启，错过的唤醒会补投递并标注"补觉醒来"——她不会撒谎说自己是准点醒的。
- **风控照旧**：读 3000/天、写 30/天、412 熔断全部生效；手机 24h 在线更像真实用户，但也别调大预算。
- **省电**：监听间隔（私信 60s）是流量大头，备用机流量卡小的话把 `listen.dmIntervalSec` 调到 300。

## 5. CodeBuddy 预留口（二期）

AgentSessionPort 再加一个实现即可：`create → query()`、`prompt → resume 会话投递`、
`isBusy → 会话状态`；调度器/风控/工具零改动。参考 docs/CURRENT.md「未完成」。
