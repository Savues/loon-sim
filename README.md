# loon-sim · Loon 插件本地模拟器

在**不依赖 Loon App / 真机**的前提下，离线运行并调试 Loon 插件的规则与脚本，
给出**与 Loon 请求记录相当**的逐条决策反馈。

> 用途：插件开发 / 规则排查 / 回归验证。
> **注意**：它验证「规则与脚本逻辑」，不能替代真机（真实网络、MITM、App 行为仍需实机确认）。

---

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

# 6. 内核自测
node selftest.js
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

| API | 状态 | 说明 |
|-----|------|------|
| `$request` / `$response` | ✅ | 含 `url`/`method`/`headers`/`body`/`status` |
| `$argument` | ✅ | 三态还原：无参数 `null` / 字符串 / 对象 `{...}` |
| `$done(obj)` | ✅ | `{}` 原样、`{body}` 替换、`{response}` 构造响应 |
| `$persistentStore.read/write` | ✅ | 文件持久化到 `.loon-sim-store.json`（可 `--no-persist` 关闭） |
| `$utils.ungzip` / `gzip` / `md5` / `base64` / `uuid` | ✅ | 纯计算，已实现 |
| `$notification.post` | ⚠️ | 打印到输出（不真发通知） |
| `$httpClient.get/post/...` | ⚠️ | **默认禁用**（`--allow-net` 开启，走真实网络） |
| `$environment` | ⚠️ | 模拟值（`Loon`/版本/设备），非真机 |
| `$config` | ⚠️ | 简化实现 |
| `$script` / `$prefs` | ⚠️ | 部分实现 |

---

## 已知差异（与真实 Loon）

| 项 | 差异 | 影响 |
|----|------|------|
| **JS 引擎** | Node `vm` ≠ JavaScriptCore | 极少数 JSC 特有行为可能不同（本项目脚本未发现） |
| **`$argument` 形态** | 模拟器统一归一化为**对象** | 真机在未配置参数时可能为 `null`，脚本需自行兼容（本项目 `isEnabled` 已做） |
| **旧语法多规则** | 一律「第一条命中」 | Loon 旧语法是否全部执行未经官方明确；如需多条生效请实测确认 |
| **`cron` / `network-changed`** | 仅解析，不执行 | 定时/网络事件类脚本需真机验证 |
| **TLS / MITM** | 不涉及 | 证书、真实解密、App 网络行为需真机 |
| **`$httpClient`** | 默认禁用 | 防误发真实请求；`--allow-net` 可开 |

**结论**：模拟器用于**快速迭代与静态回归**；**发布前仍需真机确认一次**。

---

## 可靠性验证

模拟器自身的正确性由三层保障：

### 1. 内核自测（46 项）
```bash
node selftest.js        # → 46 通过, 0 失败
```
覆盖：`[Argument]` 解析 / 新旧 Script 语法 / 条件求值（含括号优先级）/ `$argument` 三态 / `[Rule]` 匹配 / `[Mitm]` / 运行时 / 段切分。

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

## 目录

```
tools/loon-sim/
├── cli.js          # 入口：check / rules / run / har
├── lpx.js          # lpx 解析（新旧语法）
├── matcher.js      # 条件求值 / [Rule] 匹配
├── runtime.js      # Loon JS 运行时模拟
├── relevance.js    # 规则相关性判定（过滤输出）
├── trace.js        # 逐条决策追踪 + body 指纹
├── report.js       # Loon 风格渲染 + 诊断
├── verify-rules.js # 规则判定 vs 声明 对照
└── selftest.js     # 内核自测（46 项）
```
