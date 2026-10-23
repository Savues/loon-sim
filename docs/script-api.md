# Loon Script API 官方参考（完整存档）

> 来源: https://nsloon.app/docs/Script/script_api · 抓取 2026-10-24
> JS 运行时全局对象与方法的权威定义。模拟器 runtime.js 以此为准。

## 1. 基本约定

- **每次执行只应调用一次 `$done()`**；调用后释放资源。异步任务未回调前不要提前 $done()
- 二进制数据：字符串/Base64/十六进制/密码**不会自动转 Uint8Array**，脚本需自行编解码
- 错误处理：`$httpClient` / `$dns.query` 错误经 callback 返回；gzip / AES 是同步 API，失败**抛异常**（try/catch）

### 版本要求（Build ≥ 988）
`$utils.gzip` · `$crypto.aes.encrypt/decrypt` · `$dns.query`

## 2. 基础

- `console.log(value)`
- `setTimeout(callback, delay, ...args)` / `setInterval(...)` / clearTimeout/clearInterval

## 3. 运行上下文

| 对象 | 说明 |
|------|------|
| `$loon` | 版本串，如 `iPhone15,2 18.0 3.2.0(1000)` |
| `$script` | 含 `startTime`（Date）、name、type 等 |
| `$argument` | 规则配置的参数（null / String / Object）|
| `$environment` | 环境信息 + `params`（参数快照）、`elapsedMs` 等 |
| `$request` | Request/Response Script 可读：url/method/headers/body/h2_trailers |
| `$response` | 仅 Response Script：status/headers/body/h2_trailers |

## 4. $config

`getConfig()` · `setSelectPolicy(policyName, selectName)` · `getSubPolicies(policyName, callback)` · `getSelectedPolicy(policyName)` · `setRunningModel(model)` + 兼容别名

## 5. 本地存储

- **存储值以字符串形式保存**
- 省略 Key 时用 `$script.name` 作为默认 Key
- `$persistentStore.write(value, [key])` / `.read([key])` / `.remove()`（remove 可无参清空）

## 6. 通知

`$notification.post(title, subtitle, content, [attach], [delay])`

## 7. $httpClient

- 请求方法：get/post/put/delete/head 等
- 请求参数：url/headers/body 等
- 回调参数：`(error, response, body)`

## 8. $utils

| 方法 | 说明 |
|------|------|
| `geoip(ip)` | GeoIP 查询 |
| `ipasn(ip)` / `ipaso(ip)` | ASN 查询 |
| `gzip(data)` (988+) | gzip 压缩 |
| `ungzip(data)` | gunzip/inflate 解压 |

## 9. $crypto

`$crypto.aes.encrypt(data, options)` / `.decrypt(data, options)`（988+，模式参数见官方页）

## 10. $dns

`$dns.query(options, callback)`（988+）— DNS 服务器格式/返回值/错误见官方页

## 11. $done 语义

| 场景 | 写法 |
|------|------|
| 结束普通/Cron/Generic 脚本 | `$done()` |
| 放行原请求/响应 | `$done({})` |
| 修改请求 | `$done({ url, headers, h2_trailers, node })` |
| Request 直接返回响应 | `$done({ response: { status, headers, body } })` |
| 修改响应 | `$done({ status, headers, h2_trailers, body })` |

未提供的字段保留原值；传空值（`headers: {}` / `body: ""`）清除对应内容。
