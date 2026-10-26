# loon-sim · Loon 插件本地模拟器

在**不依赖 Loon App / 真机**的前提下，离线运行并调试 Loon 插件的规则与脚本，
给出**与 Loon 请求记录相当**的逐条决策反馈。

> 用途：插件开发 / 规则排查 / 回归验证。
> **注意**：它验证「规则与脚本逻辑」，不能替代真机（真实网络、MITM、App 行为仍需实机确认）。

---

> 🆕 **新环境部署**：见 [DEPLOY.md](DEPLOY.md)（iSH 从零安装 60 秒自测）。

## 快速开始

```bash
cd tools/loon-sim

# 1. 静态校验（语法 / 段位 / 开关引用 / 官方字段白名单）
node cli.js check ../../plugins/Alibaba-AdBlock/Alibaba-AdBlock.lpx

# 2. 查看参数与规则概览
node cli.js rules ../../plugins/Alibaba-AdBlock/Alibaba-AdBlock.lpx

# 3. 完整决策追踪（核心功能）—— 模拟一次请求
node cli.js run <plugin.lpx> --url "https://.../path?x=1" [--response-file body.json]

# 4. 批量回放 HAR
node cli.js har <plugin.lpx> <capture.har>

# 5. 规则判定 vs 插件声明 对照（回归用）
node verify-rules.js <plugin.lpx> --from-rule

# 6. 旧→新语法转换（官方转换器本地实现）+ 自动兜底（check + parity + [URL Rewrite] 修复）
node cli.js convert <plugin.lpx> [-o out.lpx]

# 7. 新旧解析一致性（官方转换后两版本决策必须等价）
node convert-parity.js <plugin.lpx>

# 8. 直接执行 cron / network-changed / generic 脚本（支持 --mock / --persist）
node cli.js trigger <plugin.lpx> cron --arg k=v

# 9. 生成插件骨架
node cli.js init my-plugin [dir]

# 10. HAR 回放 + Markdown 报表
node cli.js har <plugin.lpx> <capture.har> --report out.md

# 11. httpClient 白名单真连（严格 TLS；mock 优先 > 白名单 > simulated）
node cli.js run <plugin.lpx> --url "..." --allow-net api.example.com --mock mock.json

# 12. 内核自测（65 项）
node selftest.js

# 13. 全套 CI（自测 → 历史回溯 → 全量插件 check → parity）
sh ci.sh
```

### ★ 终端实测前必跑 — 版本探针

终端 curl 测的是**设备已加载配置**，不是仓库最新提交。实测前：

```bash
sh version-probe.sh <plugin.lpx>          # ✅ 转 0=可测; 🔴 2=设备旧版结论作废
sh version-probe.sh <plugin.lpx> setup    # 埋/更新探针（改版本号后重跑）

> 探针模板、check 六项校验、穿透排障表、历史事故复盘 → **[docs/version-probe.md](docs/version-probe.md)**
```

---

## 输出示例

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
◇ 请求  https://poplayer.template.alibaba.com/popcdn/2/config.json
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  阶段 response   状态 200   MITM 命中(poplayer.template.alibaba.com)
  响应体 350595B

▸ [Rewrite]  共 105 条，与本次请求相关 6 条
  ✗ reject_dict(200)   (条件不成立)      ← 域名相关但 URL 不匹配
  ...

▸ [Script]  插件共 58 条 · 相关 1 条
  ✓ response → .../Alibaba-AdBlock/src/bundle.js
      URL Guard 匹配

  ▶ 生效规则: .../bundle.js
  $argument = {"removePopWindow":true}   ← 实际传入脚本的参数

▸ 脚本输出 (console.log)
  | [Alibaba-AdBlock] popcdn scrub enter, len: 350595
  | [Alibaba-AdBlock] popcdn scrub: cdnId=683 url=100 scCleared=true

▸ $done 结果
  ✓ 已修改
      长度:      350595B → 337848B
      sc{}:      118 键 → 0 键        ← 关键字段变化
      cdnId 清零: — → 683 处

▸ 诊断                                  ← 未命中时给出原因
  ! 该域名【不在 MITM 列表】→ 带路径的 [Rewrite]/[Script] 规则永远无法命中
```

---

## 设计要点

| 模块 | 职责 |
|------|------|
| `lpx.js` | 解析 lpx：`[Argument]` / `[Rule]` / `[Mitm]` / `[Script]` / `[Rewrite]`，**新旧语法都支持** |
| `matcher.js` | 条件求值（`~=`、`&&`、`\|\|`、`==`、`!=`、`()`）、`[Rule]` 匹配、URL Guard |
| `runtime.js` | 模拟 Loon JS 运行时（`$request`/`$response`/`$argument`/`$done`/`$persistentStore`/`$httpClient`/`$utils`/`$notification`） |
| `relevance.js` | 判定规则与目标 URL 的**相关性**（用于过滤输出噪音） |
| `trace.js` | 逐条规则的决策追踪 + body 指纹对比 |
| `report.js` | Loon 风格报告渲染 + 诊断建议 |
| `cli.js` | 命令行入口（check / rules / run / har） |

### 关键行为对齐 Loon

- **第一条命中规则生效**（官方语义）
- **`[Rewrite]` 产生终止响应 → `[Script]` 不执行**（官方明确）
- **`with enable=${key}` 为 false → 该规则不生效，继续匹配下一条**
- **`$done({})` = 原样返回**；`$done({body})` = 替换 body
- 脚本**包在函数作用域内执行**（因此允许顶层 `return`）

---

## 支持的 Loon API

$request / $response / $argument / $done / $notification / $notify / $httpClient（mock/白名单真连/存根三态）/
$persistentStore / $prefs（字符串语义+文件持久化 --persist）/
$environment（params/elapsedMs/sandbox） / $script（startTime 为 Date）/
$utils（gzip/ungzip/base64/md5/sha1/sha256）/ $crypto.aes（真实加解密）/ $dns.query / $config / $loon

---

## 已知差异（与真实 Loon）

- Node vm ≠ JavaScriptCore（极少数语法/精度差异）
- MITM/TLS/真实网络栈不可模拟 — 带 HTTPS 路径的规则真机需域名在 [Mitm]
- cron 调度不模拟（trigger 命令可手动执行）
- Rewrite v2 的 jq / mock_file(文件) 未实现（json.add/delete/replace 已实现）
- 真机语义已实证项见 docs/（裸路径正则可用 · 双参 reject 可用 · [Rule] 无 enable）

### ⚠️ 模拟器比真实 Loon 宽容的两处（v1.7.7 已加静态检查拦截）

| 写法 | 模拟器 | 真实 Loon | 检查 |
|---|---|---|---|
| `json.replace("k", [])` / `{}` / `null` | 正确解析为容器 | **静默失败**（不报错、不写日志） | ⚠️ 警告 |
| `json.replace(["a"], ["[]"])` | 写入字符串 | 写入字符串（同） | ❌ 错误 |
| `reject_img` 拦 `.zip` 资源 | 规则命中 | App 解压失败 → 用户可见报错 | ❌ 错误 |

**这意味着：这两类写法模拟器全绿也可能真机无效。**
`check` 已内置拦截，但**真机验证仍是最终判据** —— 看响应字节数是否变化。

背景事故见 CHANGELOG [1.7.7]。

---

## 可靠性验证

模拟器自身的正确性由**六重防线**保障（v1.6.4）：

### ① 内核自测（75 项）
```bash
node selftest.js        # → 75 通过, 0 失败
```
覆盖：`[Argument]` 解析 / 新旧 Script 语法 / 条件求值（优先级·括号·正则内 `&&`/`||`·严格类型 `==`）/ `$argument` 三态 / `[Rule]` 匹配（含 DOMAIN-WILDCARD）/ 运行时（httpClient mock/白名单/$crypto/store 持久化）/ 官方转换器回归 / 三轮语义审计用例。

### ② 三轮语义审计（对照官方文档存档，累计修复 11 处偏差）

| 轮次 | 修复 |
|------|------|
| v1.6.2 | `==` 严格类型 · Script 条件传插件参数 · Rewrite 共享 state · check 漏检 · 裸正则被 relevance 隐藏 |
| v1.6.3 | matcher 正则感知（双实现漂移）· reject 状态码范围 · mock 软终止 · check 再漏检 3 项 |
| v1.6.4 | `$httpClient.head` · Rewrite 批量数组参数（官方转换器产物形态）|

### ③ 官方转换器一致性（parity）
```bash
node convert-parity.js <plugin.lpx>   # 官方转换后新旧解析决策必须等价
```
全仓库 **38/38 通过**。另附「官方转换→模拟器解析」批量往返（30 插件 0 失败）—— 官方转换器当 fuzzer 用。

### ④ 仓库插件批量可靠性实测
```bash
node reliability-test.js    # 从插件真实规则自动提取 URL 全量决策追踪
```
38 插件 × 60 规则 URL：**0 崩溃 · 0 JS 错误**，规则全部可正确命中。

### ⑤ 规则判定 vs 终端实测（基准真值）
终端经 Loon MITM，可直接判断某域名是否被拦（`getent hosts` → `127.0.0.1` 或 `curl` → `000`）。
```bash
node verify-rules.js <plugin> --from-rule
# → AntiRevoke 17/17 一致 · Alibaba-AdBlock 16/16 一致
```

### ⑥ 端到端回归（真实抓包数据）+ 历史回溯
```bash
node cli.js run <plugin> --url <URL> --response-file <真实响应>
sh regression-history.sh   # 历史 3 个事故版本全部检出
```

一键全跑：`sh ci.sh`（自测 → 回溯 → 全量插件 check → parity）。

### 2. 规则判定 vs 终端实测（基准真值）
终端经 Loon MITM，可直接判断某域名是否被拦（`getent hosts` → `127.0.0.1` 或 `curl` → `000`）。
```bash
node verify-rules.js ../AntiRevoke/AntiRevoke.lpx --from-rule
# → 17 条, 一致 17, 不一致 0     （与终端实测 17/17 全部 000 一致）
node verify-rules.js ../Alibaba-AdBlock/Alibaba-AdBlock.lpx --from-rule
# → 16 条, 一致 16, 不一致 0
```

### 3. 端到端回归（真实抓包数据）
```bash
node cli.js run <plugin> --url <URL> --response-file <真实响应>
```
对照真机 HAR 中的实际响应大小与关键字段变化（如 `sc{}: 118 → 0`、`cdnId 清零 683 处`）。

---

## 历史问题回溯验证

`regression-history.sh` 会从 git 历史提取**曾出问题的版本**，验证模拟器能否检出：

```bash
# 需在 loon-plugin-patches 插件仓库内运行（依赖其 git 历史）
sh tools/loon-sim/regression-history.sh
```

实测结果（3/3 通过）：

| 历史版本 | 当时的真实事故 | 模拟器检出 |
|---------|--------------|-----------|
| v3.4.0（v3.5.0 前） | `[Rewrite]` 段写 `enable={}` → 整条规则无效 | ✅ 38 处 |
| v3.38.0 | 4 条 request 规则误放 `[Script]` 段 → 静默忽略 | ✅ 4 处 |
| v3.9.21 | 清洗函数**定义了但没调用** → 功能静默失效 | ✅ 「命中但未修改」 |

另有一类问题通过**双形态检测**发现（无需历史 fixture）：

| 问题 | 检测方式 |
|------|---------|
| `$argument` 只处理对象形态、不兼容数组 `[{...}]`（v3.37.3 事故） | `run` 自动用对象/数组各跑一次，结果不同即报警 |

---

## 工作流建议

```
写规则/脚本
   ↓
node cli.js check      ← 静态校验（段位、开关引用、官方字段）
   ↓
node cli.js run        ← 逐条决策追踪，确认命中与改动符合预期
   ↓
node cli.js har <旧抓包> ← 批量回归，确认无副作用
   ↓
git push → 告知用户更新订阅 → 真机确认一次
```

> ★ 真机确认前请记住：**终端/模拟器验证的都是"配置逻辑"**，
> Loon App 实际加载的是订阅快照 —— 改动后必须让用户**更新订阅**才生效。

---

## 更新记录

见 [CHANGELOG.md](CHANGELOG.md)。

---

## 目录

```
tools/loon-sim/
├── cli.js            # 入口：check/rules/run/har/convert/init/trigger
├── lpx.js            # lpx 解析（新旧语法 · splitTopLevel 正则感知）
├── matcher.js        # 条件求值 / [Rule] 匹配 / DOMAIN-WILDCARD / as 捕获
├── runtime.js        # Loon JS 运行时（$crypto/$dns/$config/httpClient 三态）
├── rewrite-exec.js   # Rewrite v2 Action 执行器（30+ Action · 管道语义）
├── converter.js      # ★ 官方旧→新转换器（从 nsloon.app 提取的本地实现）
├── convert.js        # convert 命令（转换 + check/parity 兜底 + URL Rewrite 修复）
├── convert-parity.js # 新旧解析一致性测试
├── init.js           # 插件脚手架
├── hosts.js          # 规则域名提取（MITM 矩阵用）
├── version-probe.sh  # ★ 终端实测前置守护（设备版本 = 仓库版本才可测）
├── probe-setup.py    # 探针埋入/更新
├── ci.sh             # 全套 CI（自测→回溯→check→parity）
├── selftest.js       # 内核自测（65 项）
├── verify-rules.js   # 规则判定 vs 声明对照
├── regression-history.sh  # 历史问题版本回溯
├── docs/             # ★ 官方文档本地存档（8 份 + 转换器审计报告）
└── examples/         # demo + cron-checkin（trigger+mock+persist 全流程）
```
