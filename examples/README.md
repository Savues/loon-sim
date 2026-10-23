# 示例

## demo —— 五种段位与开关用法

```bash
cd ..                            # 回到仓库根

# ① 静态校验
node cli.js check examples/demo/demo.lpx

# ② 域名级拦截（[Rule]，无需 MITM）
node cli.js run examples/demo/demo.lpx --url "https://ads.example.com/banner"

# ③ 响应脚本（[Script] + $argument + $done）
echo '{"data":{"list":[{"id":1,"title":"正常"},{"id":2,"isAd":true},{"id":3,"title":"正常2"}]}}' > /tmp/feed.json
node cli.js run examples/demo/demo.lpx --url "https://api.example.com/feed?page=1" --response-file /tmp/feed.json

# ④ 请求侧条件式开关（[Rewrite] + ${blockAds} == true）
node cli.js run examples/demo/demo.lpx --url "https://track.example.com/hit"
node cli.js run examples/demo/demo.lpx --url "https://track.example.com/hit" --arg blockAds=false   # 开关关闭 → 不拦

# ⑤ 规则对照
node verify-rules.js examples/demo/demo.lpx --from-rule
```

### 演示要点

| 段位 | 示例 | 要点 |
|------|------|------|
| `[Argument]` | `blockAds` / `addTag` | 开关默认值与说明 |
| `[Rule]` | `DOMAIN-SUFFIX, ads.example.com, REJECT` | **该段无 `enable` 字段** —— 写了也是死开关，规则无条件生效 |
| `[Mitm]` | `api.example.com` | 带路径的 `[Script]`/`[Rewrite]` 域名必须在此 |
| `[Script]` | `demo.response.js` | 参数经 `{${a}, ${b}}` 传入；`with enable=${blockAds}` 控制整条规则 |
| `[Rewrite]` | `reject_dict(200)` | 无条件写法 + **条件式开关写法**（官方支持） |
