# loon-sim 部署指南 · 新 ISH 环境

> 目标：在一台**全新的 iSH（Alpine Linux）**里，从零把模拟器跑起来并通过自测。
> 前置假设：你已能打开 Minis 的终端（ISH），并具备网络。

---

## 0. 依赖清单（先看这个）

| 依赖 | 用途 | 必须? |
|------|------|-------|
| `node` ≥ 18（推荐 22）| 模拟器运行时 | ✅ |
| `git` | 克隆仓库 / 提交 | ✅ |
| `python3` | 探针 setup / 辅助脚本 | ✅ |
| `curl` | 探针检测 / CDN 验证 | ✅ |
| `pip` + `cryptography` | 仅「解 Loon CA P12」场景 | ⬜ 可选 |
| `ripgrep`（rg）| 文档检索方便 | ⬜ 可选 |

模拟器本身**零 npm 依赖**（纯 Node 内置模块：vm/fs/zlib/crypto/dns/http(s)）。

## 1. 安装基础包

```bash
apk update
apk add nodejs git python3 curl
# 可选
apk add ripgrep
```

> ⚠️ iSH 上 apk 源偶发 403/Permission denied。换镜像重试：
> ```bash
> echo "https://mirrors.aliyun.com/alpine/v3.21/main" > /etc/apk/repositories
> echo "https://mirrors.aliyun.com/alpine/v3.21/community" >> /etc/apk/repositories
> apk update
> ```
> 仍失败时：`apk add` 多试几次（缓存刷新），或先 `apk add ca-certificates` 再换源。

## 2. 获取仓库

```bash
# 方式 A：克隆主仓库（含全部插件样本 + 模拟器开发工作区）
git clone https://github.com/Savues/loon-plugin-patches.git ~/loon-plugin-patches
cd ~/loon-plugin-patches/tools/loon-sim

# 方式 B：只要模拟器（独立发布仓库，无插件样本）
git clone https://github.com/Savues/loon-sim.git ~/loon-sim
cd ~/loon-sim
```

两仓库模拟器内容同步（工作区 → `sh sync-standalone.sh` 推送发布仓库）。
开发插件选 A；只借用工具选 B。

## 3. 验证安装（60 秒）

```bash
node selftest.js          # 预期: 结果: 65 通过, 0 失败
node cli.js check ../../plugins/Alibaba-AdBlock/Alibaba-AdBlock.lpx   # 仅方式A
                          # 预期: 结果: 0 错误（或少量已知警告）
sh ci.sh 2>/dev/null | tail -3                    # 仅方式A; 预期 ✅ CI 全部通过
```

三条全过 = 部署成功。

## 4.（可选）Loon 根证书 — 终端实测不带 -k

仅当要在 ISH 里 `curl` 直测真机 MITM 流量时需要。模拟器本身**不依赖**证书。

1. 用户从 Loon 配置/导出获取 **ca-p12 + passphrase**（或 .pem）
2. 解出 PEM：
   ```bash
   pip install cryptography --break-system-packages 2>/dev/null || pip install cryptography
   python3 - <<'EOF'
   from cryptography.hazmat.primitives.serialization import pkcs12, Encoding
   _, cert, _ = pkcs12.load_key_and_certificates(open('ca.p12','rb').read(), b'<passphrase>')
   open('loon-ca.pem','wb').write(cert.public_bytes(Encoding.PEM))
   EOF
   ```
3. 装入系统信任库：
   ```bash
   mkdir -p /usr/local/share/ca-certificates
   cp loon-ca.pem /usr/local/share/ca-certificates/loon-ca.crt
   update-ca-certificates
   curl -s -o /dev/null -w "%{http_code}\n" https://acs.m.taobao.com/gw/mtop.common.getTimestamp/   # 200 = OK
   ```
4. PEM 备份到共享目录防丢：`cp loon-ca.pem /var/minis/shared/certs/`

> ⚠️ 若 `apk add openssl` 可用，第 2 步可换成
> `openssl pkcs12 -in ca.p12 -passin pass:<passphrase> -nokeys -out loon-ca.pem`。

## 5.（可选）推送到远端

向仓库提交需要 GitHub 凭据。推荐 Personal Access Token：

```bash
git remote set-url origin https://<TOKEN>@github.com/Savues/loon-plugin-patches.git
# 模拟器同步到独立仓库还需环境变量 GITHUB_TOKEN（sync-standalone.sh 用）
export GITHUB_TOKEN=<TOKEN>   # 建议放 /var/minis 环境变量配置, 不要写进文件提交
```

## 6. 常见问题

| 症状 | 处置 |
|------|------|
| `apk add` Permission denied / 403 | 见 §1 换镜像；或重试几次 |
| `node: not found` | `apk add nodejs`；iSH 无 nodejs 时用 `apk add nodejs-current` |
| selftest 大面积失败 | node 版本 < 18；`node -v` 确认 |
| `update-ca-certificates` 不存在 | `apk add ca-certificates` |
| curl 到 mtop 返回 000 | 正常 —— 设备端插件 REJECT 生效中（见插件规则），换 `mtop.common.getTimestamp` 测 |
| 探针无响应 | 设备未更新订阅，或插件未埋探针（`version-probe.sh <lpx> setup`），与 ISH 部署无关 |

## 7. 部署完成后的下一步

1. 读仓库根 [AGENTS.md](../../AGENTS.md) → [AI-GUIDE.md](../../AI-GUIDE.md)（开发流程与铁律）
2. 日常三步验证：`check` → `run` → `ci.sh`（命令见 AI-GUIDE §2）
3. 终端实测前必跑版本探针（AI-GUIDE §1）
