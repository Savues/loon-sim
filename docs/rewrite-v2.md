# Loon Rewrite v2 官方语法（完整存档）

> 来源: https://nsloon.app/docs/Rewrite/rewrite_v2 · 抓取 2026-10-24
> Loon 3.5.1 (978) 起生效。模拟器实现以此为准。

## 基本格式

```
<phase> if <condition> then <action> [| <action> ...]
```

- Rewrite 仅对 HTTP 和经 MitM 解密的 HTTPS 生效，**在规则匹配前执行**
- 一条 Rewrite 不能同时含请求和响应 Action（`response.body.mock` 例外）

## 执行阶段

| 阶段 | 时机 | 可用数据 |
|------|------|---------|
| request | 请求发出前 | URL、方法、请求 Header |
| response | 收到响应 Header 后 | 请求数据、响应状态码、响应 Header |

## 条件表达式

- 操作符：`==`（精确）· `~=（正则查找，全匹配需 ^ $）` · `&&` · `||` · `()`
- 优先级：比较 > && > ||
- 变量：`${url}` · `${request.method}` · `${request.header['name']}` · `${response.status}` · `${response.header['name']}` · 插件参数
- Header 名不区分大小写；存在=String（空是 `""`），不存在=`null`
- `==` 右值：String / null / `${var}` / `"Bearer ${token}"` 模板 / `` `raw` ``
- `~=` 右值必须是 Regex；Number/Boolean 不能与 Header 比较
- **不支持** if 条件读 Body（`${request.body}` 等）

### 条件正则捕获（Rewrite 独有，Script 不支持）
```
request if ${url} ~= /^https:\/\/api\.shop\.com\/item\/(\d+)/ as item then request.header.set("X-Item-ID", "${item.1}")
```
- `${item.0}` 完整匹配 · `${item.1..n}` 捕获组
- as 只能用于 `~=`；名称唯一、不能与插件参数重名
- **被 Action 引用的捕获条件必须经过所有成功路径，不能在 `||` 可选分支**
- 条件捕获 `${name.n}` 与 Action 正则捕获 `$n` 是两套语法，`$n` 不能跨 Action

## 值与字符串

- 字面量：`"str"` / Number / Boolean / null / `/regex/flags`
- 正则 flags 仅 i / m / s；正则内不展开 `${...}`
- 双引号字符串支持 `${...}` 模板 + 转义 `\" \\ \n \r \t \${`
- 反引号原始字符串：不转义、不展开变量、`` `` `` = 字面反引号

## Action 速查（位置参数，不能写参数名）

```
url.replace(String)
redirect(Number, String)                    # 302 / 307
reject(Number[, String])                    # 状态码 + 可选 UTF-8 文本
reject_img(Number)                          # 1×1 GIF
reject_dict(Number)                         # {}
reject_array(Number)                        # []
reject_video(Number)                        # 空白视频

request.header.add/set/del(String, String)
request.header.replace(String, Regex, Repl) # 替换内容支持 $0-$n 和 ${...}
response.header.add/set/del(String, String)
response.header.replace(String, Regex, Repl)

request.body.replace(Regex, Repl)
response.body.replace(Regex, Repl)

request.json.add(String, Any) / delete(String) / replace(String, Any)
request.json.jq(String) / jq_file(String)
response.json.add/delete/replace/jq/jq_file(...)   # 同上

request.body.mock(String, String[, Boolean])       # 类型, 内联, 可选Base64
request.body.mock_file(String, String[, Boolean])
response.body.mock(String, String[, Number[, Boolean]])  # +状态码
response.body.mock_file(String, String|URL[, Number[, Boolean]])
```

- reject 状态码必须 100-599 整数
- `reject(200, "{}")` 是普通文本；要 JSON Content-Type 用 `reject_dict/array`
- url.replace / redirect：if 必须有且只有一个全路径必经的 `${url} ~= /.../`，不能在 `||` 可选分支；参数中不能用 `$n`

### JSON Action
- 只在 Body 是有效 JSON 时生效
- Key Path 点分 + `[n]` 数组下标：`data.apps[0].appName`

### Mock 限制
- 一条 Rewrite 只能一个 `response.body.mock(_file)`
- Mock 之外只能组合 `response.header.*`
- 条件与参数不能引用 `${response.status}` / `${response.header[...]}`（响应未生成）
- 类型：json/text/text-event-stream/css/html/javascript/plain/png/gif/jpeg/tiff/svg/mp4/form-data

## 执行规则

- **同一阶段所有匹配的 Rewrite 按配置顺序全部执行**（与 Script 第一条命中不同！）
- 同条 Rewrite 的 Action 按 `|` 从左到右；单个 Action 失败：保留已完成修改、跳过、继续
- 参数/类型/正则错误在**加载时**拒绝整条
- 来源优先级：本地配置 > 插件；同来源按文件顺序

## 新旧迁移

| 旧 | 新 |
|----|-----|
| header / 302 / 307 | url.replace(...) / redirect(...) |
| reject / reject-200 | reject(...) |
| reject-img / -dict / -array / -video | reject_img/dict/array/video(...) |
| header-add / header-replace / header-del | request.header.* |
| response-header-* | response.header.* |
| request/response-body-replace-regex | *.body.replace(...) |
| request/response-body-json-* | *.json.* |
| mock-request/response-body | *.body.mock(...) |

新旧可混用，同一执行序列按文件顺序，语法新旧不改变优先级。
