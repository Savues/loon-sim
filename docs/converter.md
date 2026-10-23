# Loon Script 语法转换器 (官方工具)

## 概览
官方提供的在线转换工具：https://nsloon.app/script-converter

## 功能
- 粘贴旧版配置，转换为新版语法
- 迁移 Trigger、脚本路径、$argument、指令属性
- 保留注释与无法识别的内容
- 所有转换在浏览器本地完成，不上传配置

## 转换规则要点

### 1. Trigger 迁移
| 旧版 | 新版 |
|------|------|
| `http-request ^regex` | `request if ${url} ~= /regex/i` |
| `http-response ^regex` | `response if ${url} ~= /regex/i` |
| `cron "..." script-path=...` | `cron "..." then script("...")` |
| `network-changed script-path=...` | `network-changed then script(...)` |
| `generic script-path=...` | `generic then script(...)` |

### 2. 参数迁移
| 旧参数 | 新版写法 |
|--------|----------|
| `argument="name=loon"` | `script("path", "name=loon")` |
| `argument="name=loon"` | `script("path", {${name}})` (插件参数) |
| `enable=true` | `with enable=true` |
| `tag=xxx` | `with tag="xxx"` |
| `requires-body=true` | `with requires_body=true` |
| `script-path=...` | `script("path")` |

### 3. 参数格式变化
| 旧版 | 新版 |
|------|------|
| `argument="name=loon"` | `script("path", "name=loon")` 字符串 |
| `argument={${region}}` | `script("path", {${region}})` 插件对象 |

### 4. 保留行为
- 注释保留
- 无法识别的行保留原文
- 无 `[Script]` 段落时自动添加

### 转换器限制
- 只负责语法迁移，不执行 Script
- 复制后需在 Loon 中加载配置并检查日志
- 未识别或无法安全迁移的行会保留原文，并在下方显示原因


---

# 官方转换器审计报告（2026-10-24，6 轮 60+ 边界用例）

> 背景：plugin-converter 为纯浏览器本地实现，已提取为 `tools/loon-sim/converter.js`。
> 本审计用系统性边界用例轰炸官方实现，确认其可靠性边界。

## ✅ 验证正确的部分（约 50 项）

- 大小写容错（触发词/旧 action 均不区分大小写）
- Script 全参数转换（enable/enabled 旧拼写、requires-body=1 数字、timeout 科学计数法、debug=1）
- 空值/畸形报错（空 script-path、cron 缺表达式、argument={}/重复、timeout≤0、json path 双点、mock 未知类型、参数数量不匹配）
- Rewrite 全 action 族（批量 header → 数组语法、$1 捕获 → as urlMatch、\x20 空格还原、mock 全参数名两种历史拼写）
- 参数类型推断（[Argument] 段自动推断 number/boolean/string；类型不符正确报 plugin-type）
- 段保护（[Rule] 段与注释行不被误转）、CRLF 兼容

## ❌ 确认的问题（6 个）

| # | 问题 | 严重性 | 详情 |
|---|------|--------|------|
| 1 | **[URL Rewrite] 段被完全跳过** | 🔴 高 | 页面宣称支持 [URL Rewrite]，但 convertText 段过滤只认 `rewrite`/`script`（小写精确匹配）。**本仓库 2 个插件受影响**（Douban-Dedup / Douban-SearchAd 的 [URL Rewrite] 规则转换后被静默遗留在旧语法）。convertLine 单行转换正常 — 是段过滤 bug 非转换逻辑 bug |
| 2 | **缺 URL 正则的 Script 把参数当正则** | 🟠 中 | `http-request script-path=a.js` → URL 正则变成 `script-path=a.js` 整串，语义完全错误且不报错 |
| 3 | **捕获组越界引用不检查** | 🟠 中 | `^u header https://x/$1`（正则无捕获组）→ `${urlMatch.1}` 越界；官方新文档明确"捕获下标不能超过捕获组数量"→ 真机加载必拒 |
| 4 | **enable={未声明参数} 静默放行** | 🟡 低 | argument 位置严格检查未声明参数，enable 位置不检查 → 产出真机必无效的规则且零警告 |
| 5 | **argument 内转义引号双重转义** | 🟡 低 | 旧语法 `\"` 转换后变 `\\\"`（多一层转义）|
| 6 | **旧裸 reject（断连）→ reject(404)（404响应）** | 🟡 低 | 新旧文档语义有差异（断开连接 vs 状态码响应），无诊断提示；新语法无 100% 等价动作 |

## 使用建议

用 `cli.js convert` 迁移插件后，**必须**：
1. 检查产物中是否残留 `[URL Rewrite]` 段（问题1）— 手动改为 `[Rewrite]` 再转一次，或单行处理
2. 跑 `cli.js check`（loon-sim 的检查比官方转换器严格，能兜住问题 3/4）
3. 跑 `convert-parity.js` 确认解析一致性
