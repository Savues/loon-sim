# Loon Script v2 官方语法（完整存档）

> 来源: https://nsloon.app/docs/Script/script_v2 · 抓取日期 2026-10-24
> Loon 3.5.1 (983) 起生效。模拟器实现以此为准。

## 快速开始

```
HTTP              <request|response> if <condition> then script(<path> [, <argument>]) [with <options>]
Cron              cron <cron-expression> then script(<path> [, <argument>]) [with <options>]
Network Changed   network-changed then script(<path> [, <argument>]) [with <options>]
Generic           generic then script(<path> [, <argument>]) [with <options>]
```

完整 HTTP 示例：
```
request if ${url} ~= /^https:\/\/api\.example\.com/i && ${request.method} == "POST" then script("request.js", "source=profile") with tag="Request Script", timeout=20, requires_body=true
```

## Script 类型

- **Request**: 请求发出前。`requires_body=false`（默认）在 Header 阶段执行；`true` 等 Body。同一请求最多一条，第一条完整命中生效。
- **Response**: 必须含 **Response URL Guard**（URL 条件必须是整个条件成立的**必要条件**）。同一响应最多一条。
- **Cron**: 5 段（分时日月周）或 6 段（秒分时日月周）。支持动态 Cron：`cron ${cron} then ...`。不走「第一条命中」。
- **Network Changed**: 同一次事件执行**所有**已启用规则（与 HTTP 不同！）。
- **Generic**: 手动触发，独立操作。

## script(...) Action

`script(String[, String|RawString|PluginObject])`

- 一条规则只能一个 script(...)，不支持 Rewrite 的 | Action 管道
- 路径必须是非空固定字符串（本地/相对/远程URL），**不能**用变量或模板

### $argument 类型

| 配置 | $argument 类型 |
|------|---------------|
| 省略第二参数 | null |
| String / Raw String `` `...` `` | String（不自动解析） |
| 插件对象 `{${region}, ${level}}` | Object |

对象参数约束：不能为空 `{}`；同一变量不能重复；只能引用本插件 [Argument] 已声明参数；Key=参数名，Value 保留 String/Number/Boolean 类型；input/无默认 select 只用于 Object 时值为 null；字符串与对象参数互斥，不支持第三参数。

## with 字段（全小写 snake_case，未知字段→当前规则无效）

| 字段 | 类型 | 默认值 | 适用 |
|------|------|--------|------|
| enable | Boolean / 插件 Boolean | true | 全部 |
| tag | String | 从脚本路径派生 | 全部 |
| img_url | String | 无 | 全部 |
| timeout | Number / 插件 Number 或数字 String | Request/Response=20，其他=300 | 全部 |
| debug | Boolean / 插件 Boolean | false | 全部 |
| requires_body | Boolean | false | 仅 Request/Response |
| binary_body_mode | Boolean | false | 仅 Request/Response |

- binary_body_mode **不会**自动开启 requires_body
- Cron/NetworkChanged/Generic 不能设置 requires_body / binary_body_mode
- 字段不能重复；tag/img_url/requires_body/binary_body_mode **不接受变量或模板**
- 动态 enable/timeout/debug 可引用插件参数（类型必须匹配）

### 动态 Option 缺值回退
- `enable=${name}` 缺值 → true
- `timeout=${name}` 缺值 → 20（HTTP）/ 300（其他）
- `debug=${name}` 缺值 → false
- 条件表达式和动态 Cron 中的插件参数**必须**有实际值，缺值 → 当前 Script 无效（跳过，不影响后续）
- 每个用默认值的动态 Option 会输出一条 Warn

## 条件表达式

操作符：`==`（类型一致精确比较）· `~=（正则查找）` · `&&` · `||` · `()` 分组
优先级：比较 > && > ||；短路求值

### 可用变量
| 变量 | Request | Response |
|------|---------|----------|
| ${url} | ✓ | ✓ |
| ${request.method} | ✓ | ✓ |
| ${request.header['name']} | ✓ | ✓ |
| ${response.status} | — | ✓ |
| ${response.header['name']} | — | ✓ |
| ${插件参数} | 插件 | 插件 |

- Header 名不区分大小写；存在=String（空值是 ""），不存在=null
- == 右值可以是 String / null / ${var} / "Bearer ${token}" 模板 / `` `raw` ``
- ~= 右值必须是 Regex
- Number/Boolean 不能直接与 Header 比较

### 正则 flags
仅 i / m / s。`~=` 是查找匹配，全匹配需显式 ^ $。
**URL 正则不支持捕获变量**（无 as 命名捕获）——需要捕获在 JS 里 `$request.url.match(...)`。

### Response URL Guard（强制）
URL 条件必须是整个条件成立的**必要条件**：
```
✓ response if ${url} ~= /\/api\// && ${response.status} == 200 then ...
✓ response if (${url} ~= /\/v1\// || ${url} ~= /\/v2\//) && (...) then ...
✗ response if ${response.status} == 500 then ...            （无 URL Guard）
✗ response if ${url} ~= /\/api\// || ${response.status} == 500 then ...  （|| 使 URL 非必要）
```

### 暂不支持
Body 内容条件 · as 命名捕获/捕获变量 · `!=` `!~` 逻辑非 · 大小比较 · 集合操作符

## 匹配与执行

- Request/Response 各自第一条命中，互不占用
- Rewrite 禁用关系：
  - Request 阶段终止响应 → Request/Response Script 均不执行
  - Request Body Rewrite/Mock 命中 → Request Script 不执行
  - Response Body Rewrite 命中 → Response Script 不执行
  - 只改 Request Header 的 Rewrite 不新增禁用
- Request 条件读 Request Rewrite 处理后的 URL/Method/Header；Response 最终条件读**原始** Status/Header

## 新旧转换

| 旧 | 新 |
|----|-----|
| `http-request ^RE script-path=f.js, requires-body=true, argument="hi", timeout=20, tag=T` | `request if ${url} ~= /^RE/i then script("f.js", "hi") with tag="T", timeout=20, requires_body=true` |
| `argument={region,level}, enabled={enabled}` | `script("f.js", {${region}, ${level}}) with enable=${enabled}` |
| `cron "0 8 * * *" script-path=cron.js, argument="daily"` | `cron "0 8 * * *" then script("cron.js", "daily") with ...` |
| `network-changed script-path=network.js` | `network-changed then script("network.js", {${region}}) with ...` |
| `img-url=tool.system` | `img_url="tool.system"` |

旧 HTTP URL 正则默认忽略大小写 → 转换保留 i flag。
