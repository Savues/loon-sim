# Loon 官方文档本地存档

模拟器实现的权威依据。抓取自 nsloon.app，手工整理为 Markdown。
抓取日期：2026-10-24（对应 Loon 3.5.1 / 文档站当前版本）。

## 已存档

| 文件 | 来源 | 说明 |
|------|------|------|
| `plugin.md` | /docs/Plugin/ | ★ 插件格式：#! 完整字段表 · [Argument] 类型 · [General]/[IP Rewrite] · **插件规则可用策略限制** |
| `script-v2.md` | /docs/Script/script_v2 | ★ 新版 Script 语法（983+）— 完整约束表格 |
| `script-legacy.md` | /docs/Script/ | 旧版 Script 语法（982 及之前） |
| `script-api.md` | /docs/Script/script_api | ★ JS 运行时 API（$done/$httpClient/$persistentStore/$utils/$crypto/$dns…） |
| `rewrite-v2.md` | /docs/Rewrite/rewrite_v2 | ★ 新版 Rewrite 语法（978+）— Action 速查 · as 捕获 · Mock 限制 |
| `rewrite-legacy.md` | /docs/Rewrite/ | 旧版 Rewrite 语法（978 之前） |
| `rule.md` | /docs/Rule/ + /docs/Rule/domain_rule | 规则类型 · 匹配优先级 · 性能 · **[Rule] 无 enable 字段** |
| `converter.md` | /script-converter | 官方旧→新语法转换器规则 |

## 未存档（按需抓取）

- /docs/Rule/ip_rule · http_rule · port_rule · protocol_rule · process_rule · logic_rule · final_rule · sub_rule
- /docs/Node/…（节点）、/docs/General/…（主配置通用项）、/docs/Mitm/（MitM 配置）

> 注意：官方文档随 Loon 版本更新。当模拟器行为与官方文档冲突时，以最新官方文档为准，
> 并应重新抓取存档 + 核对模拟器实现（CHANGELOG 记录核对结论）。
