#!/bin/sh
# verify.sh — 单插件定向验证（SKILL.md「验证分层」里"纯插件改动"那一行的可执行版）
#
# 为什么存在：定向验证原本是 6 条手拼命令、5 个不同路径，漏一条就是假绿。
# 本脚本只是把那套既定政策固化成一条命令，不新增检查项、不改变任何判定标准。
#
# 用法:
#   sh tools/loon-sim/verify.sh plugins/PinDuoDuo
#   sh tools/loon-sim/verify.sh PinDuoDuo          （省略 plugins/ 前缀亦可）
#
# 覆盖: check / dead-fn / parity / 该插件自己的 test.mjs / audit
# 不覆盖: cli.js run（需要真实 URL + 真实 body，无法自动化，仍需手动跑）
#
# 退出码: 0 全绿 / 1 有失败
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)

target="${1:-}"
[ -n "$target" ] || { echo "用法: sh tools/loon-sim/verify.sh <插件目录或名字>"; exit 2; }

case "$target" in
  /*) DIR="$target" ;;
  plugins/*) DIR="$ROOT/$target" ;;
  *) DIR="$ROOT/plugins/$target" ;;
esac
[ -d "$DIR" ] || { echo "❌ 目录不存在: $DIR"; exit 2; }
NAME=$(basename "$DIR")

# 待查清单：排除 upstream-* 原件与 test-* 夹具（与 ci.sh 同一排除规则）
LPXS=""
for f in "$DIR"/*.lpx; do
  [ -f "$f" ] || continue
  case "$(basename "$f")" in test-*|upstream-*|*jsdelivr*) continue;; esac
  LPXS="$LPXS $f"
done
[ -n "$LPXS" ] || { echo "❌ $NAME 下没有可验证的 lpx"; exit 2; }

fail=0
say() { printf '%s\n' "$*"; }
ok()  { say "  ✓ $*"; }
ng()  { say "  ❌ $*"; fail=$((fail+1)); }

say "════ 定向验证: $NAME ════"

# ── ① 清单解析 check ──
say ""; say "── check（清单能否被 Loon 正确解析）"
for f in $LPXS; do
  out=$(node "$HERE/cli.js" check "$f" 2>&1 | tail -1)
  case "$out" in *" 0 错误"*) ok "$(basename "$f"): $out" ;; *) ng "$(basename "$f"): $out" ;; esac
done

# ── ② 死代码（仅本插件 src/*.js，一次 node 启动扫完全部文件）──
say ""; say "── dead-fn（本插件脚本中的孤儿函数）"
JS_LIST=""
n_js=0
for f in "$DIR"/src/*.js; do
  [ -f "$f" ] || continue
  n_js=$((n_js+1)); JS_LIST="$JS_LIST $f"
done
if [ "$n_js" -eq 0 ]; then
  say "  （无 src/*.js，跳过）"
else
  out=$(node "$HERE/dead-fn.js" $JS_LIST 2>&1)
  if echo "$out" | grep -q "死代码: [1-9]"; then
    ng "检出死代码"
    echo "$out" | grep -E "L[0-9]+ |死代码: [1-9]" | head -8 | sed 's/^/       /'
  else
    ok "已扫 $n_js 个脚本，无死代码"
  fi
fi

# ── ③ 转换一致性 parity ──
say ""; say "── parity（Loon ↔ QuanX 转换一致性）"
for f in $LPXS; do
  out=$(node "$HERE/convert-parity.js" "$f" 2>&1 | tail -1)
  case "$out" in *"✅"*|*"跳过"*) ok "$(basename "$f"): $out" ;; *) ng "$(basename "$f"): $out" ;; esac
done

# ── ④ 本插件自己的单测 ──
say ""; say "── test.mjs（本插件回归用例）"
n_t=0
for f in "$DIR"/test/*.test.mjs "$DIR"/*.test.mjs; do
  [ -f "$f" ] || continue
  n_t=$((n_t+1))
  if timeout 120 node "$f" >/tmp/verify_test.out 2>&1; then
    ok "$(basename "$f"): $(tail -1 /tmp/verify_test.out)"
  else
    ng "$(basename "$f"): $(tail -1 /tmp/verify_test.out)"
    grep -E "✗|✘|❌|Error" /tmp/verify_test.out | head -5 | sed 's/^/       /'
  fi
done
[ "$n_t" -eq 0 ] && say "  （无单测文件，跳过）"

# ── ⑤ 物流审计（资源 URL / 多副本 / 缓存戳 / Git 身份 / README 元数据）──
say ""; say "── audit（清单之外的物流）"
if python3 "$HERE/audit.py" $LPXS > /tmp/verify_audit.out 2>&1; then
  ok "audit 全过"
else
  ng "audit 有问题"
  grep -E "^❌|^  ❌" /tmp/verify_audit.out | head -8 | sed 's/^/       /'
fi

# ── 结论 ──
say ""
if [ "$fail" -eq 0 ]; then
  say "✅ $NAME 定向验证全绿"
  say "   ⚠ 仍需手动: node cli.js run <lpx> --url ... --response-file ...（真实抓包体）"
  exit 0
else
  say "❌ $NAME 有 $fail 项失败"
  exit 1
fi
