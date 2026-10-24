# 更新记录

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

---
## [1.6.7] - 2026-10-24

### 新增: dead-fn.js 死代码检测器 (+ ci.sh 第⑤段)

- **判定规则**: 顶格 function 定义, 若除定义行外全文零出现 → 死代码（孤儿函数）
- **误报防线**: 被二级分发器(handleMoonResponse 类)调用/当回调传参/入口函数(main)/混淆函数名(a0_0x 格式, 词边界分析不适用) 全部豁免
- **ci.sh 集成**: 全插件 src/*.js 自动检测, 死代码 exit 4
- 源自两次真实事故: v3.50.0 的 6 孤儿函数（handleMoonResponse 内联重写遗留）+ 检测器自身开发的正则转义事故（file_write 的 \\b 坑, 50/51 全误报当场发现）
- 历史版本验证: v3.50.0 检出 6/6 ✅ 当前 bundle 检出 0 ✅ selftest 78 含锁定测试

## [1.6.6] - 2026-10-24

### 修复: 死参数检查正则漏下划线 — 含 `_` 的参数名被误报

- 死参数检查的 `options.enable` / `raw` 两分支正则用 `[a-zA-Z0-9]`（不含下划线）→
  `block_search_ad`、`youtube_enable` 等含下划线的合法 enable 引用解析失败 → 误报「未被任何规则引用(死参数)」
- 发现路径: 26 插件全量体检中 Douban-SearchAd / YouTube-Test 的死参数警告经人工核实为误报
- 修复后: 两插件警告消失 ✅ · selftest 75/75 · CI 全绿
- 注: 与 v1.6.5（另一会话修复的 Rewrite 条件求值漏参）同属参数引用解析缺陷家族

## [1.6.5] - 2026-10-24

### 修复: Rewrite 条件求值漏并插件参数 (v1.6.2 同类第二处)

- `traceRewriteRules` 的求值变量只有 `{url}` → 条件式 Rewrite (`&& ${参数} == true`) 的参数引用恒为 undefined → 永不命中
- v1.6.2 修复 Script 段同款问题时漏了 Rewrite 段 — 双处同源 bug 的第二处
- 修复后经 RedPaper v1.3.0 的 removeDianDian 开关验证: on=1 命中 / off=0 命中 ✅
- **真机交叉验证**: Loon 分目录抓包的 `replace_response_body_raw` 证实条件式 Rewrite 真机生效 (agentspark → {} 2B)

### 新知识: Loon 分目录抓包格式

zip 内每请求一目录: `request_header_raw.txt` (HTTP/2 `:authority`/`:path` 分离, 重组 URL 需拼接) + `response_body_raw` + **`replace_response_body_raw` (插件替换后的响应)** —— replace_* 是插件真机生效的直接证据, 比 HAR 更强 (HAR 记录的处理时点不确定)

### 意义: 条件式 Rewrite 开关路线打通

官方文档"条件表达式支持插件参数" + 模拟器双态验证 + 真机 replace_body 实证 = `[Rewrite]` 段的开关能力确立 (旧语法 `, enable=` 无效的结论不适用于 v2 条件式)

## [1.6.4] - 2026-10-24
## [1.6.7] - 2026-10-24

### 新增: dead-fn.js 死代码检测器 (+ ci.sh 第⑤段)

- **判定规则**: 顶格 function 定义, 若除定义行外全文零出现 → 死代码（孤儿函数）
- **误报防线**: 被二级分发器(handleMoonResponse 类)调用/当回调传参/入口函数(main)/混淆函数名(a0_0x 格式, 词边界分析不适用) 全部豁免
- **ci.sh 集成**: 全插件 src/*.js 自动检测, 死代码 exit 4
- 源自两次真实事故: v3.50.0 的 6 孤儿函数（handleMoonResponse 内联重写遗留）+ 检测器自身开发的正则转义事故（file_write 的 \\b 坑, 50/51 全误报当场发现）
- 历史版本验证: v3.50.0 检出 6/6 ✅ 当前 bundle 检出 0 ✅ selftest 78 含锁定测试

## [1.6.6] - 2026-10-24

### 修复: 死参数检查正则漏下划线 — 含 `_` 的参数名被误报

- 死参数检查的 `options.enable` / `raw` 两分支正则用 `[a-zA-Z0-9]`（不含下划线）→
  `block_search_ad`、`youtube_enable` 等含下划线的合法 enable 引用解析失败 → 误报「未被任何规则引用(死参数)」
- 发现路径: 26 插件全量体检中 Douban-SearchAd / YouTube-Test 的死参数警告经人工核实为误报
- 修复后: 两插件警告消失 ✅ · selftest 75/75 · CI 全绿
- 注: 与 v1.6.5（另一会话修复的 Rewrite 条件求值漏参）同属参数引用解析缺陷家族

## [1.6.5] - 2026-10-24

### 修复: Rewrite 条件求值漏并插件参数 (v1.6.2 同类第二处)

- `traceRewriteRules` 的求值变量只有 `{url}` → 条件式 Rewrite (`&& ${参数} == true`) 的参数引用恒为 undefined → 永不命中
- v1.6.2 修复 Script 段同款问题时漏了 Rewrite 段 — 双处同源 bug 的第二处
- 修复后经 RedPaper v1.3.0 的 removeDianDian 开关验证: on=1 命中 / off=0 命中 ✅
- **真机交叉验证**: Loon 分目录抓包的 `replace_response_body_raw` 证实条件式 Rewrite 真机生效 (agentspark → {} 2B)

### 新知识: Loon 分目录抓包格式

zip 内每请求一目录: `request_header_raw.txt` (HTTP/2 `:authority`/`:path` 分离, 重组 URL 需拼接) + `response_body_raw` + **`replace_response_body_raw` (插件替换后的响应)** —— replace_* 是插件真机生效的直接证据, 比 HAR 更强 (HAR 记录的处理时点不确定)

### 意义: 条件式 Rewrite 开关路线打通

官方文档"条件表达式支持插件参数" + 模拟器双态验证 + 真机 replace_body 实证 = `[Rewrite]` 段的开关能力确立 (旧语法 `, enable=` 无效的结论不适用于 v2 条件式)

## [1.6.4] 附: 仓库插件可靠性批量实测

新增 `reliability-test.js`（从插件真实规则自动提取 URL 全量决策追踪）：

- 38 插件 × 60 规则 URL：**0 崩溃 · 0 JS 错误**，全部规则可正确命中（6 条初始未命中经复核均为测试提取器构造缺陷，非模拟器问题）
- 排查中顺带验证：Script 段规则的命中显示需要对应 phase；前缀正则（`mtop.x.y.` 尾点）语义正确



### ★ 第三轮审计（runtime / 转换器往返 / HAR）— 2 处修复

| # | 问题 | 修复 |
|---|------|------|
| 10 | `$httpClient` 缺 `head` 方法（官方 §7.1），且未知方法静默无回调 | 补 head/options；全部方法走统一 httpReq |
| 11 | **Rewrite 批量数组参数不支持**（`header.add(["A","B"],["1","2"])` 被当成单个 header 名）| evalArg 支持数组字面量；add/set/del 批量展开 —— 这是官方转换器的**标准产物形态**，不支持会导致"转换成功但执行错误" |

### 本轮确认无误

httpClient 回调签名/headers/body · mock 优先级 · $environment.params 快照 · $loon 版本 · console.warn/error 捕获 · **沙箱隔离（require/process 均 undefined）** · HAR base64 解码 / 空内容 / 302 无 body · **全仓库 30 插件「官方转换→模拟器解析」往返回归 0 失败**

### 方法论沉淀

用官方转换器批量转换全仓库插件再做 parse，等于免费的 fuzzer —— 产物解析失败即模拟器解析器覆盖缺口。

selftest 73 → 75 · CI 全绿

## [1.6.3] - 2026-10-24

### ★ 第二轮语义审计 — 4 处偏差修复

| # | 偏差 | 修复 |
|---|------|------|
| 6 | **matcher.js 自带的 splitAtTop 缺正则感知**（v1.3.1 只修了 lpx.js 那份，双实现漂移）→ 正则内 `&&`/`\|\|` 被错误切分 | 与 splitTopLevel 同语义（引号/转义/括号/正则字面量感知）|
| 7 | reject 状态码不校验范围（600 也静默接受）| 100-599 整数校验（官方明确）|
| 8 | `response.body.mock` 命中即中断管道 → 后续 header.set 不执行 | 官方「先 mock 后按序执行全部 Header」→ MOCKED 软终止（继续 header，对 Script 层仍终止）|
| 9 | check 漏检：`timeout=0`/负数 · 脚本路径空串/变量 · `tag=${n}` 模板 | 全部补齐（官方均为"规则无效"级）；`timeout={number参数}` 合法不误报 |

### 第二轮确认无误

条件优先级（比较>\&\&>\|\|）/ 括号分组 / 嵌套括号 / header 双/单引号语法 / json.replace 数值类型 / 嵌套路径自动创建 / reject(200,"{}") 无 CT / header.replace $n / store 三方法返回值 / 双 $done 容忍 / 顶层 return / URL Guard / 动态 timeout

### 教训：双实现漂移

splitTopLevel（lpx.js）与 splitAtTop（matcher.js）是历史双实现 —— v1.3.1 修复只落了一份。
**根因是复制粘贴的第二份实现没被纳入修复范围。** selftest 已加锁定。

selftest 69 → 73 · CI 全绿

## [1.6.2] - 2026-10-24

### ★★ 全面语义审计 — 5 处与官方文档的偏差修复

对照官方文档存档逐层复审（条件求值/命中顺序/禁用关系/Rewrite 执行/runtime 语义/check 校验器），修复：

| # | 偏差 | 官方依据 | 修复 |
|---|------|---------|------|
| 1 | `==` 用宽松比较（`200 == "200"` 为 true）| rewrite/script-v2「类型一致的精确比较」| looseEqual 改严格：null 只等 null，跨类型一律 false |
| 2 | **Script 条件不传插件参数** → `${sw} == true` 类条件永远不成立 | script-v2「条件可引用插件参数」| evalCondSafe 传入 argValues |
| 3 | Rewrite 多规则各自持有 state → 后条不覆盖前条 | rewrite-v2「前条输出是后条输入」| 同阶段共享 state |
| 4 | check 未校验「with 字段重复」「cron 设 requires_body」| script-v2 字段规则 | 两项新增（均官方「规则无效」级）|
| 5 | **裸路径正则规则被 relevance 启发式隐藏**（提取不出 host → 不相关）→ 排查误导 | ~= 查找匹配语义 | 提取不出 host 改为视为相关，交给求值器判定 |

### 审计中确认无误的部分

第一命中顺序（Script）/ 同阶段全执行（Rewrite 非终止）/ 终止后 Script 不执行 / with enable=false 跳过继续匹配 / $done 三态 / store.write(v,k) 顺序 / $argument null / 脚本异常捕获 / bodyBytes / DOMAIN-SUFFIX 不匹配 app-apple.com / Argument 类型保留

### selftest 65 → 69（新修复全部锁定）

## [1.6.1] - 2026-10-24

### ★ 版本探针系统 + 真机语义实证（P3-D 收官）

**version-probe.sh + probe-setup.py**（终端实测的强制前置守护）：

- 原理：插件 `[Rewrite]` 埋专属探针规则（借用已 MITM 域名 + `/gw/loon-sim.probe.<插件名>` 路径），
  `reject(200, "版本号")` 返回版本文本；实测前 curl 探针，设备版本 = 仓库版本才允许下结论
- `setup` 子命令自动埋/更新探针（行首锚定 `[Rewrite]`，`.lpx.probe` 记 URL、`.lpx.probe.meta` 记版本）
- 退出码：0=安全可测 · 2=设备旧版（结论作废）· 3=未埋探针/未更新

### 真机语义实证（A/B 双盲 ×4 复测）

| 项 | 结论 |
|----|------|
| 裸路径正则（无 ^ 锚定，±i flag）| ✅ **命中** — 与官方文档一致（~= 查找匹配）|
| `reject(200, "文本")` 双参 | ✅ 真机支持（返回自定义文本）|
| 探针穿透三连的真因 | **Loon 订阅更新存在“已点更新但未生效”窗口** — 非语法问题 |

> 教训沉淀：探针不转绿时第一怀疑对象是「更新没生效」而非规则语法；A/B 同批对照是唯一可靠排除法。

### 修复

- `version-probe` v1（自造 .local 域名）不进 MITM 永远失效 → v2 借用插件已 MITM 域名
- `trigger` 命令：异步脚本（httpClient 回调类）此前同步退出丢结果 → 按官方语义等待 $done（v1.6.0 内）

### 验证

- selftest 65/65 · CI 全绿 · Alibaba-AdBlock 探针真机转绿（返回 3.39.2 文本）

## [1.6.0] - 2026-10-24

### P3-A: $httpClient 白名单真连

- `--allow-net domain1,domain2`：白名单内域名**真实发起请求**（严格 TLS — Loon 根证书已装入 ISH 系统信任库，实测 mtop 接口 200 + `SSL verify ok`）
- **三重防护**：mock 优先 > 白名单真连 > 白名单外保持 simulated（防脚本误打生产接口）
- gzip/deflate/br 自动解压；子域匹配（`example.com` 覆盖 `cdn.example.com`）

### P3-B: 运行时 API 对齐官方 script-api.md

- `$persistentStore`：值字符串化（官方"以字符串保存"）· 省略 Key 用脚本名 · `remove()` 无参=清空
- `$script.startTime` → Date 对象 · `$script.type`
- `$environment.params`（参数快照）/ `elapsedMs` / `sandbox.type`
- **`$crypto.aes` 真实实现**（Node crypto，encrypt/decrypt 往返验证）
- `$dns.query`（Node dns 模拟）· `$config.*` API 面补齐

### trigger 命令修复 + 示例

- **异步脚本等待**：httpClient 回调类脚本此前同步退出导致结果丢失 → 现按官方语义"等待 $done"
- 新增 `examples/cron-checkin/`：签到类插件全流程演示（trigger + mock + persist + notification，二次运行读到上次签到记录 ✅）

### P2 尾巴

- `.github/workflows/loon-sim.yml`：push/PR 自动跑 `ci.sh`（GitHub Actions）

### 验证
- selftest 65/65（新增 ⑩ 白名单防护 3 项 + ⑪ API 对齐 6 项）· CI 全绿 · 全量插件 check 0 新问题

## [1.5.0] - 2026-10-24

### P1: 语法覆盖补全（对照官方文档存档）

- **★ Rewrite v2 Action 执行器**（`rewrite-exec.js`）：reject 系 / redirect / url.replace / header add·set·del·replace（$0-$n 捕获）/ body.replace / json add·delete·replace / body.mock（16 种内容类型）。Action 管道从左到右、单个失败跳过继续（官方语义）。trace 的 Rewrite 命中行现在展示**真实改写效果**
- **`as` 命名捕获求值**：`~= /re/ as item` 命中后 `${item.0..n}` 写入变量，供 Action 引用（官方 rewrite-v2 语义）
- **DOMAIN-WILDCARD 规则类型**（1008+）：Glob 通配 `*`(跨点) `?`(恰一字符) `[...]`/`[!...]`，大小写不敏感
- 条件变量增强：`as` 捕获 + 已有 `${response.status}` / `${request.header['x']}` 求值

### P2: 体验与生态

- **`init` 脚手架**：`node cli.js init <name> [dir]` 生成 lpx + src 脚本 + README（生成物开箱 check 0 错误）
- **`har --report out.md`**：Markdown 回放报表（接口×脚本×大小变化×改动汇总）
- **`--diff-full`**：结构化 before/after 树状 diff（顶层+一层对象值级对比）
- **`ci.sh`**：全套 CI（自测 56 → 回溯 3 → 全量 check（已知问题白名单区分新问题）→ parity 38），退出码 0/2/3 可接自动化

### 验证
- CI 全绿：自测 56/56 · 回溯 3/3 · check 新问题 0 · parity 38/38

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
