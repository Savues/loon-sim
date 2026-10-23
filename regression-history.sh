#!/bin/sh
# 历史问题版本回溯验证 —— 证明模拟器能检出已知事故
# 用法: sh tools/loon-sim/regression-history.sh   (需在 git 仓库内运行)
set -e
SIM=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
git -C "$(dirname "$SIM")/.." rev-parse --git-dir >/dev/null 2>&1 || { echo "需在 git 仓库内运行"; exit 1; }
REPO=$(cd "$SIM/../.." && pwd)
cd "$REPO"

extract() {
  out="$3"; case "$out" in /*) : ;; *) out="$TMP/$out" ;; esac
  git show "$1:plugins/Alibaba-AdBlock/$2" > "$out" 2>/dev/null || true
}

echo "════ 历史问题版本回溯验证 ════"
PASS=0; FAIL=0
chk() { # <描述> <期望检出数> <实际检出数>
  if [ "$3" -ge "$2" ] && [ "$2" -gt 0 ]; then printf "  ✅ %-38s 检出 %s\n" "$1" "$3"; PASS=$((PASS+1));
  else printf "  ❌ %-38s 检出 %s (期望 >=%s)\n" "$1" "$3" "$2"; FAIL=$((FAIL+1)); fi
}

# 1. v3.5.0 之前: reject_dict + enable 失效
P=$(git rev-parse a532dfc^ 2>/dev/null) && extract "$P" Alibaba-AdBlock.lpx pre350.lpx
N=$(node "$SIM/cli.js" check "$TMP/pre350.lpx" 2>&1 | grep -c "含 enable" || true)
chk "v3.4.0 [Rewrite]+enable 失效" 1 "$N"

# 2. v3.38.0: 4 条规则误放 [Script] 段
extract 2171262 Alibaba-AdBlock.lpx v3380.lpx
N=$(node "$SIM/cli.js" check "$TMP/v3380.lpx" 2>&1 | grep -c "规则无法解析" || true)
chk "v3.38.0 段位置错误" 1 "$N"

# 3. v3.9.21: 清洗函数定义但未调用 → 命中但未修改
extract 1f66bf9 Alibaba-AdBlock.lpx v3921.lpx
mkdir -p "$TMP/src" && extract 1f66bf9 src/bundle.js "$TMP/src/bundle.js"
if [ -s "$TMP/src/bundle.js" ]; then
  echo '{"sc":{"a":1},"ac":{"b":2},"version":1}' > "$TMP/pop.json"
  N=$(node "$SIM/cli.js" run "$TMP/v3921.lpx" \
      --url "https://poplayer.template.alibaba.com/popcdn/2/config.json" \
      --response-file "$TMP/pop.json" 2>&1 | grep -c "未修改任何内容" || true)
  chk "v3.9.21 函数未调用(命中未修改)" 1 "$N"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
rm -rf "$TMP"
[ "$FAIL" = "0" ]
