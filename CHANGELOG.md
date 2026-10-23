# 更新记录

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---
## [1.4.1] - 2026-10-24

### P0 收口：官方转换器审计问题的自动化兜底

- **`convert` 命令升级为完整迁移流水线**：① 检测 `[URL Rewrite]` 段并改写为 `[Rewrite]` 重转（兜住审计问题1，Douban 两插件实测从 1→2 条转换）② 产物自动跑 check（兜住捕获越界/未声明 enable）③ 自动跑 parity 一致性
- **check 新增 3 项校验**（对照官方文档）：
  - 插件 [Rule] 策略严格白名单（DIRECT/PROXY/REJECT 系，官方 plugin.md 限制；超出即错误而非警告）
  - Rewrite `as` 捕获越界引用（官方"捕获下标不能超过捕获组数量"，兜住审计问题3/5）
  - `with enable=${未声明参数}` 报错（官方"参数未声明→当前 Script 无效"，兜住审计问题4）
- **selftest 扩容 49→56**：httpClient mock / $utils md5+b64 / 持久化落盘+跨实例读取 / 官方转换器冒烟 / 点号参数名回归 / URL Rewrite 段兜底

### 验证
- 内核自测 56/56 · 历史回溯 3/3
- 全量插件 check：新校验**零误报**（AntiRevoke 17 / Dataoke 1 均为已知死开关问题，非新检查引入）

## [1.4.0] - 2026-10-24

### ★ 官方转换器本地集成（调查结论：plugin-converter 是纯浏览器本地实现）

从 nsloon.app 页面 chunk 中提取官方转换器完整实现（14KB UMD），改写为 CJS 集成：

- **`converter.js`** — 官方 `LoonLegacyConverter`（convertLine/convertText/argumentTypes），
  支持全部旧→新转换：Script 五种触发 / Rewrite 全部 31 种旧 Action / 插件参数类型推断 / 逐条错误诊断
- **`cli.js convert`** — `node cli.js convert <plugin.lpx> [-o out.lpx]` 转换并显示明细
- **`convert-parity.js`** — ★ 转换一致性测试：官方转换后，模拟器对新旧两版本的解析决策必须等价
  （Script 规则数/phase/trigger/scriptPath/argumentKeys + Rewrite 规则数 + Argument keys）

### 修复（一致性测试抓到的真实 bug）

- **新语法对象参数成员不匹配带点号参数名**：`{${Home.Switch}}` 因正则 `[\w-]+` 不含 `.` 而解析为空
  → 修复为 `[\w.-]+`（Bilibili-UI 全部 20 个带点参数名此前在新语法下丢失）

### 验证

- 官方转换器冒烟：Script/Rewrite/cron/对象参数 转换输出正确
- **全量插件一致性：38/38 通过**（PinDuoDuo 12 条 · Bilibili-Dedup 20 条 · Bilibili-UI · AgentRouter · QuarkCheckIn 等）
- 内核自测 49/49

## [1.3.1] - 2026-10-24


### 依据官方文档审查补齐（docs/script-v2.md 完整存档本地化）

### 新增校验

- **Response URL Guard 必要性**：顶层 `||` 使 URL 条件可被绕过 → 报错（官方明确无效样例）
- **插件对象参数约束**：不能为空 `{}` / 同一变量不能重复 / 只能引用已声明 [Argument] 参数 / 不能引用保留变量 `${url}`
- **with 字段 snake_case 校验**：字段名区分大小写，非全小写报错
- **旧语法字段白名单**：`img-url`/`requires-body`/`binary-body-mode` 在 legacy 规则中合法（新语法才要求 snake_case）
- **cron/网络变化/通用旧语法** 正确标记 legacy（修复 AgentRouter/QuarkCheckIn 误报）

### 修复

- **`splitTopLevel` 多字符分隔符**：`||`/`&&` 此前逐字符比较永远不切分 → 重写为多字符匹配 + **正则字面量感知**（`/a||b/` 内的 `||` 不误切）+ 引号/转义/括号状态机

### 验证

- 官方文档全部无效样例检出（7/7），有效样例零误报
- 内核自测 49/49 · 历史回溯 3/3
- 全量插件 44 目录 0 错误（AntiRevoke/Dataoke 为已知 [Rule] 死开关真实问题；Bilibili-UI 4 个 test- 调试文件不计）

## [1.3.0] - 2026-10-24

### 新增

- **`$httpClient` mock 响应**：`--mock substr:{...}`（可重复）或 `--mock file.json`，命中即返回自定义 status/headers/body —— 签到类脚本可全流程离线跑通（`runtime.js`）
- **`$persistentStore` 跨 run 持久化**：`--persist <file>` 指定存储文件，可测「第二次运行」逻辑
- **`$utils` 补全**：`base64.encode/decode`、`md5`、`sha1`、`sha256`（Node crypto 真实实现）
- **`trigger` 子命令**：`node cli.js trigger <lpx> cron [--arg k=v]` 直接执行 cron/network-changed/generic 触发的脚本
- **`--mitm-matrix`**：check 输出「规则域名 × MITM 覆盖」汇总矩阵（含 `(?:a|b)` 分组展开）
- **cron 表达式校验**：5/6 位格式与字符集检查
- **[Rule] 策略校验**：非内置策略且非插件参数时告警（对应 "Can not find policy" 事故模式）
- **退出码语义化**：check 0/2（通过/错误），run 0/3/4（命中/未命中/脚本异常），trigger 3/4 —— 可接 CI
- **`--timeout`**：尊重规则 `timeout=` 参数（原先硬编码 20s）
- **`img-url` 加入 with 字段白名单**（官方合法字段，AgentRouter 实际在用）

### 验证

- 内核自测 49/49 · 历史回溯 3/3 · 全量插件 44/47 零错误
- httpClient mock：`status=201 + body.ok=true` 正确到达回调
- 持久化：二次运行读取上次写入值

## [1.2.1] - 2026-10-23

### 修复

- **旧版 cron 规则解析**：支持 `cron "0 9 * * *" script-path=...` 旧版语法（此前 AgentRouter / QuarkCheckIn 等签到类插件的 cron 规则无法解析）
- **Rewrite 规则响应 `--phase` 参数**：此前 `traceRewriteRules` 硬编码在 `request` 阶段评估，忽略 `--phase response`，导致 Forward 等插件的 response 阶段 header 重写被错误跳过；现改为按 `--phase` 参数评估（request/response）
- **注释语法修复**：`#` 注释导致 JS 语法错误

### 验证

- 内核自测：49/49 通过
- 历史回溯：3/3 通过（v3.4.0 / v3.38.0 / v3.9.21）
- 端到端：Alibaba popcdn `sc{}: 118→0` / cdnId 清零 683 处 · PinDuoDuo 旧语法 $argument 正确注入 5 个 stub

---


---

## [1.2.0] - 2026-10-23

### 新增功能

- **select + type=number 支持**：`select` 类型参数现在支持 `type=number`，首个选项正确转换为 Number 类型
- **select + type=boolean 支持**：首个选项正确转换为 Boolean 类型
- **Argument 解析全面增强**：完整支持 Loon 官方 Argument 语法
  - `switch` 三态（true/false/空->false）
  - `select` 多选项取首个默认，支持 type=number/boolean 转换
  - `input` + `type=number` -> Number
  - `select` 多选项取首个默认
  - `type=number` 转 Number
  - `object` 类型保留类型信息
- **parseArguments 全面重写**：完整支持 Loon 官方 Argument 语法（switch/select/input/object/type=number/tag/desc）
- **parseArguments**：三态 switch（true/false/空->false）
- **parseArguments**：select 多选项取首个默认，支持 type=number/boolean 转换
- **parseArguments**：input + type=number -> Number
- **parseArguments**：select 多选项取首个默认
- **parseArguments**：type=number 转 Number
- **object** 类型保留类型信息
- **switch** 三态（true/false/空->false）
- **select** 多选项取首个默认，支持 type=number/boolean 转换

### 修复

- **parseArgKeys 逗号分割修复**：pushKV 现在正确处理 argument=[{a},{b}] 这种多 {} 块格式（支持 [] 括号）
- **旧语法 cron 支持**：cron "..." script-path=... 语法现已支持
- **双形态 $argument 检测**：自动用对象/数组各跑一次，结果不同即报警
- **命中但未修改诊断**：规则命中但 $done 无改动 -> 提示检查清洗函数是否真被调用
- **指纹输出优化**：只收集"顶层+一层对象"、数组只记长度、祖先去重

### 文档

- 新增 loon-sim 使用章节到 PLUGIN-DEV-GUIDE.md
- README 增加模拟器索引链接
- 根 README 增加模拟器索引

### 验证

- 内核自测：49/49 通过（新增 3 个指纹单测）
- 历史回溯：3/3 通过
- 端到端：popcdn 350595B->337848B, sc{}: 118->0 键
- 双形态检测：对象/数组各跑一次，结果不同即报警






## [1.1.1] — 2026-10-23

### 原则确立
用故障插件测试模拟器时，**只修模拟器自身，不为故障插件打补丁**。
发现的问题必须回修到模拟器核心，确保任何同类故障插件都能如期工作。

### 修复：结构指纹完全通用化
**原实现**（领域特例）：硬编码关键词表（`__TANX`/`adType`/`mst_roll`/`hotwords`）统计出现次数。
**新实现**（完全通用）：递归收集 JSON 结构形状（数组长度 / 对象键数），脚本执行前后对比，按变化幅度排序输出。

通用化的同时解决三个噪音来源：
- **只收集「顶层 + 一层对象」** — 不再递归深入 `sc` 内海量子项（原会列出 `sc.TBPSResultViewController_aa2371[]` 等 100+ 条）
- **数组只记长度，不深入元素** — 同构数组（如 `dataList`）深入只会产生噪音
- **祖先去重** — 父级路径已报变化时，跳过其子级（避免"父清空后列 100+ 孙项"）

**效果**：popcdn 端到端从「100+ 噪音」收敛为「单条 `sc{}: 118 → 0`」。

可选观察：`--watch <词1,词2>` 显式传参可统计特定字段出现次数（默认无）。

### 验证
- 内核自测 49/49（新增 3 个指纹单测：数组长度 / 不深入元素 / 祖先去重）
- 历史回溯 3/3
- 干净克隆开箱可用



## [1.1.0] — 2026-10-23

本次更新聚焦一件事：**让模拟器能"检出静默失效"**。

背景：Loon 插件最容易出的问题不是报错，而是**规则看起来生效、实际什么都没做**——
没有异常、没有日志、`check` 也看不出问题，只有真机跑起来才发现广告还在。
本次针对这一类型补了两项诊断，并用「历史事故版本」反向验证了检出的有效性。

### 新增

- **「命中但未修改」诊断** — 规则命中且脚本执行成功，但 `$done` 未改动任何内容时给出提示。
  - *原由*：历史事故 v3.9.21 —— 清洗函数**定义了但没被调用**，逻辑整段失效，
    但规则有 `tag`、有命中、无报错，肉眼与 `check` 均无法发现。
  - *实现*：`done.unchanged && script.effective` → 诊断区提示「检查清洗函数是否真的被调用」。
  - *验证*：用 `1f66bf9`(v3.9.21) 的 lpx + bundle 回放 popcdn → ✅ 检出。

- **双形态 `$argument` 自动检测** — 自动用「对象」与「数组 `[{...}]`」各执行一次脚本，
  两种形态结果不同即报警。
  - *原由*：历史事故 v3.37.3 —— 脚本用 `$argument[key]` 取值，而 Loon 在真机上传的是
    数组形态 `[{...}]`，导致取值恒为 `undefined`、**全部 Script 规则静默失效**。
  - *实现*：`run` 默认以两种形态各跑一遍，比较 `$done` 结果；
    可用 `--arg-form object|array` 强制单一形态。
  - *验证*：故意写只处理对象形态的脚本 → ✅ 检出并列出两种形态的差异。

- **`regression-history.sh`** — 从 git 历史提取「曾出问题」的版本做回溯验证。
  - *原由*：诊断能力的有效性需要可复现的「故障样本」，否则无法证明它真的有用。
  - *用法*：`sh tools/loon-sim/regression-history.sh`（需在插件仓库内运行）。

### 修复

- **`relevance.js` host 提取过宽** —— 原先无法解析的规则一律视为「相关」，
  导致输出刷屏且给出误导（如 `example.com` 被判为与阿里系规则相关）。
  现改为：从 `${url} ~= /.../` 中提取 host 段，提取失败即视为不相关；同时兼容
  `${url} ~= /.../i` 的包装写法。
- **`check` 对旧语法 / 无法解析规则抛 `TypeError`** —— `argumentKeys`、`options`
  未初始化。现统一归一化，并为旧语法提供独立校验分支。
- **`$done` 跨 vm realm 对象比较失败** —— 现统一归一化为主 realm 的普通对象。
- **脚本顶层 `return` 报 `Illegal return statement`** —— 与 Loon 一致，
  改为包在函数作用域内执行。
- **`report.js` 输出噪音** —— body 指纹原先会列出 118 个 `sc` 子键，
  现只显示顶层区块规模（`sc{}: 118 键 → 0 键`）与关键特征（`cdnId 清零 683 处`）。
- **`[Rule]` 命中时的诊断措辞** —— 改为「由 [Rule] 段处理(REJECT)，域名级拦截无需 MITM」
  而非误报「不在 MITM 列表」。

### 变更

- **同步脚本改为保留仓库历史** —— 原先 `git init` + `git push -f`，
  每次同步后独立仓库只剩 1 个提交。现改为 clone → 覆盖 → 增量提交。
- **支持旧版 Script 语法** —— 解析 `http-response ^RE script-path=f.js,
  requires-body=1, argument=[{a},{b}], enable={k}`。
  *原因*：本仓库 20+ 插件使用旧语法，仅 3 个使用新语法，两者都必须支持。

### 验证

| 项目 | 结果 |
|------|------|
| 内核自测 | **46 / 46 通过** |
| 规则判定 vs 终端实测基准 | AntiRevoke **17/17** · Alibaba-AdBlock **16/16** 一致 |
| 历史事故回溯 | **3 / 3 检出**（v3.4.0 / v3.38.0 / v3.9.21） |
| 双形态检测 | ✅ 检出只处理对象形态的脚本 |
| 端到端 | popcdn `350595B → 337848B`，`sc{}: 118 → 0 键`，`cdnId 清零 683 处` |
| 干净克隆开箱 | ✅ 自测通过 · 示例 `check` 0 错误 |

### 顺带发现

- **Alibaba-AdBlock 一处畸形配置** —— `liveRemoveAds` 的 `desc` 被拆到独立行
  （成为孤立条目），模拟器 `check` 时暴露，已修复。



## [1.0.0] — 2026-10-23

首次发布。

### 功能

- `check` — 静态校验：段位、开关引用、官方字段白名单、URL Guard
- `rules` — 参数与规则概览
- `run` / `trace` — 逐条决策追踪（相关规则过滤 → 命中/未命中原因 → `$argument` →
  脚本日志 → `$done` 字段级 diff → 诊断建议）
- `har` — 批量回放抓包，只看落地的改动
- `verify-rules` — 规则判定 vs 插件声明对照
- `selftest` — 内核自测（46 项）

### 对齐 Loon 的行为

- 第一条命中规则生效
- `[Rewrite]` 产生终止响应 → `[Script]` 不执行
- `with enable=${k}` 为 false → 跳过该规则，继续匹配下一条
- `$done({})` = 原样返回

### 已知差异（不替代真机）

| 项 | 差异 |
|----|------|
| JS 引擎 | Node `vm` ≠ JavaScriptCore |
| `$argument` 形态 | 默认归一化为对象（v1.1.0 起会双形态检测） |
| 旧语法多规则 | 一律「第一条命中」（Loon 未官方明确） |
| `cron` / `network-changed` | 仅解析，不执行 |
| TLS / MITM / 真实网络 | 不涉及，需真机 |
| `$httpClient` | 默认禁用（`--allow-net` 可开） |
