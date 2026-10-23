# Loon 插件（Plugin）官方文档存档

> 来源: https://nsloon.app/docs/Plugin/ · 抓取 2026-10-24

## 完整示例

```ini
#!name = 示例插件
#!desc = 展示插件信息和用户参数
#!author = Loon
#!homepage = https://example.com
#!icon = https://example.com/icon.png
#!system = iOS,iPadOS,tvOS,macOS
#!system_version = 15
#!loon_version = 3.5.1(983)
#!date = 2026-10-10
#!tag = 示例,工具
#!type = normal

[Argument]
name = input,"Loon",type=string,tag=名称
region = select,"CN","US","JP",type=string,tag=地区
price = input,9.99,type=number,tag=价格
level = select,1,2,3,type=number,tag=等级
enabled = switch,true,type=boolean,tag=启用

[Mitm]
hostname = example.com
```

## #! 字段表（完整，含 3.5.x 新字段）

| 字段 | 说明 |
|------|------|
| #!name | 插件名称 |
| #!desc | 功能说明 |
| #!author | 作者 |
| #!homepage | 主页地址 |
| #!icon | 图标地址 |
| #!system | 支持系统（不区分大小写；未填=全部支持）|
| #!system_version | 最低系统版本 |
| #!loon_version | **最低 Loon 版本**（如 3.5.1(978)）|
| #!date | 版本日期（原样显示）|
| #!tag | 分类标签 |
| #!type | normal / parser（3.5.0 (969)+；默认 normal）|

> 注：#!version 不在官方字段表（仅 #!date）。

## [General]（插件可声明项）

bypass-tun · include-tun(1007+) · skip-proxy · real-ip · dns-server · doh-server · doq-server · doh3-server · ipv6-vif
全部为**追加合并**（相同条目去重）。include-tun 只接受明确前缀长度的 IPv4 CIDR，不支持参数绑定。

include/bypass 冲突：网络+掩码完全相同 → include 优先；掩码不同 → 更小范围（/32 > /24）优先。

## [IP Rewrite]（Build 1007+，仅插件可声明）

```ini
[IP Rewrite]
10.7.0.1 = reflect   # 交换源目 IP 回注本机
10.7.0.2 = reject    # TCP RST / ICMP Type3 Code13
10.7.0.3 = drop      # 静默丢弃
```
- 只接受单个 IPv4，不支持 CIDR/域名/IPv6/参数绑定
- 同插件同地址取第一条；多插件取靠前的启用插件
- 命中后**不进入**规则/策略/Rewrite/脚本/MitM

## [Argument]（Build 733+）

```
参数名 = 控件类型,默认值或可选值,type=值类型,tag=标题,desc=说明
```

| 控件 | 用途 | 支持 type | 省略 type 时 |
|------|------|-----------|--------------|
| input | 输入；默认值可省略 | string/number | string |
| select | 单选；**第一个候选值为默认值** | string/number | string |
| switch | 开关；true/false | boolean | boolean |

- **input/select 不会自动推断类型**：`input,123` 仍是字符串，数值必须 `type=number`
- 类型名不区分大小写；integer/float/bool 等别名**不能**解析
- 默认值及候选值必须符合声明类型

### 在脚本中使用
- `script("x.js", {${name}, ${region}})` → `$argument.name` 等，**保留声明类型**
- `with enable=${enabled}` 控启停；`cron ${cronExpression}` 动态 cron（无效时不执行）

### 在 Rewrite 中使用
- `${参数名}` 直接引用；`${price}` 写入数值 9.99 而非 "9.99"

## 插件规则可用策略（★ 重要限制）

插件的 [Rule] 只能用：
- **DIRECT**
- **REJECT 系列**
- **PROXY**（用户选择策略组）

**未指定策略时默认 DIRECT**。不能引用任意策略组名。

## 模块清单

插件可包含：General · IP Rewrite · Rule · Rewrite · Host · Script · MitM · Argument
