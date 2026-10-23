# Loon Script 旧版语法（官方存档）

> 来源: https://nsloon.app/docs/Script/ · 抓取 2026-10-24
> 适用于 Loon 3.5.1 (982) 及之前，仅维护用途。官方转换器: https://nsloon.app/script-converter

## http-request（请求发出前）
```
http-request ^https?:\/\/example\.com script-path=request.js,tag=请求脚本,requires-body=true,binary-body-mode=false,timeout=10,argument="name=loon",enable=true
```
可用对象：`$request.url/.method/.headers/.body`（body 需 requires-body=true）、`$request.h2_trailers`(927+)；`$response` = undefined。

$done 语义：
```
$done();        // 中断请求
$done({});      // 不修改
$done({ url, headers, h2_trailers, node });          // 修改请求
$done({ response: { status, headers, body } });      // 直接返回响应
```
未提供 headers/body 保留原值；`headers: {}` / `body: ""` 可清空。

## http-response（收到响应后）
参数同上。可用：`$request` + `$response.status/.headers/.body/.h2_trailers`。
```
$done({});                                    // 不修改
$done({ status, headers, h2_trailers, body }); // 修改；空值可清除
```

## cron
```
cron "0 8 * * *" script-path=cron.js,tag=定时任务,timeout=300,argument="1234",enable=true
```
5 段（分时日月周）或 6 段（秒分时日月周）。

## network-changed
网络变化时执行。**多条只执行第一条**。
```
network-changed script-path=network-changed.js,tag=网络变化,timeout=300,argument="1234",enable=true
```

## generic
App 中手动触发，可传节点/策略组/规则上下文。
```
generic script-path=generic.js,tag=通用脚本,img-url=location.fill.viewfinder.system,timeout=300,argument="1234",enable=true
```

## 参数速查
| 参数 | 说明 |
|------|------|
| requires-body | 是否读取 Body |
| binary-body-mode | 是否以 Uint8Array 读取 |
| argument | 传给脚本的参数（建议双引号）；`{region,level}` = 插件对象 |
| timeout | 默认 10 秒 |
| img-url | SF Symbol 图标 |
| enable / enabled | 开关（旧写法 enabled={x}） |
