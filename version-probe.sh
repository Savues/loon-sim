#!/bin/sh
# version-probe — 终端实测前的「设备已加载版本」探针
#
# 问题: 终端测的是设备上已加载的 Loon 配置, 不是仓库最新提交。
#      若模型/开发者改完仓库立刻终端复测 → 测的是旧版 → 得出错误结论(真实事故: 2026-10-23 多次)
#
# 原理: 在插件里埋一条「版本指纹规则」— 对专属探针 URL 返回版本号。
#      curl 探针 URL, 设备返回的版本 == 仓库版本 → 安全; 不等 → 先去更新订阅!
#
# 用法: sh tools/loon-sim/version-probe.sh <plugin.lpx>
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
LPX="$1"
ACTION="${2:-check}"
[ -f "$LPX" ] || { echo "用法: sh $0 <plugin.lpx> [setup|check]"; exit 1; }

# ---- setup: 埋/更新探针规则 ----
if [ "${2:-check}" = "setup" ]; then
  python3 "$(dirname "$0")/probe-setup.py" "$LPX"
  exit $?
fi



# 1. 仓库侧版本
VER=$(grep -m1 '^#!version=' "$LPX" | cut -d= -f2)
[ -n "$VER" ] || VER="(无#!version)"

# 2. 探针域名: 从插件名派生 (每个插件在 [Rewrite] 里埋一条探针规则)
NAME=$(basename "$LPX" .lpx | tr '[:upper:]' '[:lower:]')
PROBE_URL="$(cat "$LPX.probe" 2>/dev/null | tr -d '
')"
[ -n "$PROBE_URL" ] || PROBE_URL="https://probe.${NAME}.loon-sim.local/version"

# 3. 探针: 该域名若已在插件 [Rewrite] 中埋了 reject(200, "$VER") → 返回版本号
GOT=$(curl -s --max-time 5 "$PROBE_URL" 2>/dev/null || true)

echo "仓库版本 : $VER"
echo "设备探针 : ${GOT:-无响应}"

if [ -z "$GOT" ]; then
  echo ""
  echo "⚠️  探针无响应 — 插件里还没有埋版本探针规则, 或未更新到设备。"
  echo "   埋法: 在 [Rewrite] 段加一行 (version-probe setup 可自动加):"
  echo "   request if \${url} ~= /probe\.$NAME\.loon-sim\.local/ then reject(200, \"$VER\")"
  exit 3
fi

# reject_dict 探针返回 {} — 版本从 .probe.meta 读
if [ "$GOT" = "{}" ]; then
  META=$(cat "$LPX.probe.meta" 2>/dev/null || echo "?")
  if [ "$META" = "$VER" ]; then
    echo "✅ 设备已加载最新版本 (reject_dict 探针 v$VER) — 可以安全地进行终端实测"
    exit 0
  else
    echo "🔴 设备探针为旧版 (meta=$META ≠ $VER) — 先更新订阅"; exit 2
  fi
fi

if [ "$GOT" = "$VER" ]; then
  echo "✅ 设备已加载最新版本 — 可以安全地进行终端实测"
  exit 0
else
  echo ""
  echo "🔴 设备加载的是旧版 ($GOT ≠ $VER)!"
  echo "   终端实测将测到【旧配置】, 任何「已修复/已生效」的结论都无效。"
  echo "   → 请先在 Loon 中更新订阅并重启, 再复测。"
  exit 2
fi

