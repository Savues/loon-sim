# Loon Rewrite 旧版语法（官方存档）

> 来源: https://nsloon.app/docs/Rewrite/ · 抓取 2026-10-24
> Loon 3.5.1 (978) 之前。仅维护用，新配置用 rewrite-v2.md。

## 匹配顺序

- 本地配置 > 插件；同一文件从上到下
- 请求侧和响应侧可作用于同一请求
- 3.2.3 (749) 起同侧同 URL 正则的 Rewrite **依次执行**（前者输出是后者输入）

## 语法速查

```
# URL 替换
^http://www\.google\.cn header http://www.google.com

# 重定向
^http://example.com 302 https://example.com
^http://example.com 307 https://example.com

# Reject
^http://example.com reject           # 直接断开
^http://example.com reject-200       # 200 空 Body
^http://example.com reject-img       # 200 1×1 图片
^http://example.com reject-dict      # 200 {}
^http://example.com reject-array     # 200 []
```

## 请求 Header（730+ 支持一条多个）

```
^http://example.com header-add Connection keep-alive Proxy-Connection keep-alive
^http://example.com header-del Cookie Connection
^http://example.com header-replace User-Agent Unknown Content-Length 1999
^http://example.com header-replace-regex User-Agent regex replace-value Cookie UUID=123 UUID=456
```

## 请求/响应 Body（Build 729+）

```
^http://example.com request-body-replace-regex regex1 replace-value1 regex2 replace-value2
^http://example.com request-body-json-add data.apps[0] {"appName":"loon"} data.category tool
^http://example.com request-body-json-replace data.ad {}
^http://example.com request-body-json-del data.ad
^http://example.com request-body-json-jq 'del(.data.ad)'
# response-body-* 同构
```
JSON Action 仅在 Body 是有效 JSON 时生效；Key Path 点分 + `[n]`。

## Mock（Build 729+）

```
^http://example.com mock-request-body data-type=text data=""
^http://example.com mock-response-body data-type=json data-path=response_body.json status-code=200
^http://example.com mock-response-body data-type=svg data-path=response_body.raw mock-data-is-base64=true status-code=200
```

| 参数 | 说明 |
|------|------|
| data-type | json/text/text-event-stream/css/html/javascript/plain/png/gif/jpeg/tiff/svg/mp4/form-data |
| data | 双引号内联 Body |
| data-path | URL 或 iCloud/Mock 目录文件 |
| mock-data-is-base64 | 是否 Base64 |
| status-code | 仅响应 Mock |

## ⚠️ 空格

旧语法按**空格**分隔参数。正则/替换内容含空格需用 `\x20`，否则解析失败。
