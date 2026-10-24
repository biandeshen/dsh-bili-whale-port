#!/usr/bin/env bash
# whale 验收剧本（借鉴 AMpath scripts/evaluate.sh 的三深度分级）
#   quick   ≈2min：全量测试 + 语法门 + deps 体检（沙箱）
#   partial ≈5min：quick + panel e2e 已内含 + daemon --once 冒烟 + MCP 握手
#   full    需真人：partial + DSH 装载 + opencode serve 真实一次唤醒（见 docs/CURRENT.md）
set -euo pipefail
cd "$(dirname "$0")/.."
LEVEL="${1:-quick}"

echo "== quick: 全量测试 =="
npm test

echo "== quick: 语法门 =="
for f in core/*.js core/api/*.js core/ports/*.mjs panel/*.js adapters/opencode/*.js; do node --check "$f"; done

if [ "$LEVEL" != "quick" ]; then
  echo "== partial: daemon --once（沙箱 home，窗口外应零投递）=="
  H=$(mktemp -d); mkdir -p "$H/whale" "$H/.bili-ai"
  echo '{"owner":{"mid":"1"},"listen":{},"night":{"windows":[{"start":"03:00","end":"03:30","wakes":1}],"skipChance":0}}' > "$H/whale/bili-whale.config.json"
  echo '{"sessdata":"x","bili_jct":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}' > "$H/.bili-ai/credentials.json"
  HOME="$H" USERPROFILE="$H" WHALE_HOME="$H/whale" BILI_WHALE_CONFIG="$H/whale/bili-whale.config.json" \
    node adapters/opencode/daemon.js --once
  echo "== partial: MCP 握手 =="
  printf '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n' \
    | node adapters/opencode/mcp-stdio.js | head -2
fi

if [ "$LEVEL" = "full" ]; then
  echo "== full 需要真人两件事 =="
  echo " 1) DSH: dsh plugin --profile desktop add link:<本目录> → 设置页保存一次 → /deps 看 ✓"
  echo " 2) OpenCode: opencode serve（设 OPENCODE_SERVER_PASSWORD）→ pm2 start daemon → 等作息窗口，"
  echo "    验收证据：server 会话收到 prompt_async、agent 调 bili MCP、traffic 余量被扣、日记更新"
fi
echo "evaluate($LEVEL) ✓"
