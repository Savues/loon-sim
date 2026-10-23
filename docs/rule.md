# Loon 规则（Rule）官方文档存档

> 来源: https://nsloon.app/docs/Rule/ 及 /docs/Rule/domain_rule · 抓取 2026-10-24

## 匹配优先级（Loon 3.0.3+）

1. 目标地址为域名 → 先匹配**域名规则**
2. 域名规则未命中 → 解析 DNS 后匹配 **IP 规则**
3. 其他规则按**配置顺序**匹配，越靠前优先级越高
4. 全部未命中 → FINAL 策略

来源优先级：**本地规则 > 插件规则 > 订阅规则**。
LRU 缓存近期结果，命中耗时接近 0ms。

## 域名规则

| 类型 | 语义 | 示例 |
|------|------|------|
| `DOMAIN` | 精确匹配完整域名 | `DOMAIN,google.com,proxy` |
| `DOMAIN-SUFFIX` | 匹配域名后缀（apple.com 匹配 icloud.apple.com，不匹配 app-apple.com）| `DOMAIN-SUFFIX,apple.com,proxy` |
| `DOMAIN-KEYWORD` | 域名包含关键词 | `DOMAIN-KEYWORD,apple,proxy` |
| `DOMAIN-WILDCARD` | Glob 通配（build 1008+，不区分大小写）| `DOMAIN-WILDCARD,*.example.com,proxy` |

### DOMAIN-WILDCARD 通配符
- `*` 匹配零个或多个字符，**可跨 `.`**（`*.example.com` 匹配 `a.b.example.com`，但因 `.` 是普通字符不匹配 `example.com`）
- `?` 恰好一个字符（`api?` 匹配 `api1` 不匹配 `api12`）
- `[abc]` / `[0-9]` 字符集合/范围；`[!abc]` / `[^abc]` 取反

## 性能参考（iPhone 15 Pro / Loon 3.2.0）

| 类型 | 耗时 |
|------|------|
| DOMAIN / DOMAIN-SUFFIX | 1ms 内 @20万条 |
| DOMAIN-WILDCARD (1008+) | 平均 0.031ms · P99 0.110ms @5万条 |
| IP-CIDR | 1ms 内 @10万 |
| IP-CIDR6 | 1-2ms @4千 |
| IP-ASN | 1ms 内 @5千 |

**建议**：DOMAIN-KEYWORD / USER-AGENT / URL-REGEX 随规则数量和复杂度增加耗时，优先用 DOMAIN / DOMAIN-SUFFIX / IP 类。

## ⚠️ 与模拟器相关的关键点

- **[Rule] 无 enable 字段**（官方字段表没有）→ `DOMAIN, x, REJECT, enable={sw}` 是死开关（规则等同无条件生效）
- 策略位可以是：内置策略（REJECT/DIRECT/PROXY/REJECT-DROP 等）、策略组名、订阅策略
- 子页面：domain_rule / ip_rule / http_rule / port_rule / protocol_rule / process_rule / logic_rule / final_rule / sub_rule（按需抓取）
