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
