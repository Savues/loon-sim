#!/usr/bin/env python3
# probe-setup.py — 探针埋入/更新 (v1.7.2)
# 用法: python3 probe-setup.py <plugin.lpx>
# 模板锁定 (loon-sim v1.7.0): 唯一合法形态 = /^https?:\/\/<域名>\/gw\/loon-sim\.probe\.<名>/i then reject(200, "<版本>")
# v1.7.2: 重写幂等逻辑 — 先清所有旧探针痕迹(任意形态/多条), 再插入一条

import re, sys

lpx = sys.argv[1] if len(sys.argv) > 1 else ''
if not lpx.endswith('.lpx'):
    print('用法: python3 probe-setup.py <plugin.lpx>'); sys.exit(1)

s = open(lpx, encoding='utf-8').read()

# 版本: #!version 优先, 否则从 #!name=xxx vY.Z 提取
ver_m = re.search(r'^#!version=(.+)$', s, re.M)
if ver_m:
    ver = ver_m.group(1).strip()
else:
    name_ver = re.search(r'^#!name=.*?v(\d[\w.]*)\s*$', s, re.M)
    if not name_ver:
        print('❌ 无 #!version 且 #!name 无版本号'); sys.exit(1)
    ver = name_ver.group(1)

# 探针名: lpx 文件名去扩展 (下划线)
import os
name = os.path.splitext(os.path.basename(lpx))[0].replace('-', '_').lower()

# 宿主域名: [MitM] hostname 第一个
mitm_m = re.search(r'^hostname\s*=\s*(.+)$', s, re.M | re.I)
if not mitm_m:
    print('❌ 插件无 [MitM] hostname — 探针需借用已 MITM 域名'); sys.exit(1)
host = mitm_m.group(1).split(',')[0].strip()

# v1 .local 探针清理 (历史)
s = re.sub(r'^# 版本探针 \(version-probe\.sh 用, 勿删\)\nrequest if \$\{url\} ~= /probe\.[^\n]*\n', '', s, flags=re.M)

# ★ 幂等核心: 清掉所有旧探针痕迹 — 注释行 + 任何形态的探针规则行 (可多条)
s = re.sub(r'^# 版本探针 v2[^\n]*\n', '', s, flags=re.M)
s = re.sub(r'^[^\n]*loon-sim\\.probe\\.' + re.escape(name) + r'[^\n]*\n', '', s, flags=re.M | re.I)

# 生成 (v1.7.0 模板锁定形态)
host_esc = host.replace('.', '\\.')
probe_url_regex = '/^https?:\\/\\/' + host_esc + '\\/gw\\/loon-sim\\.probe\\.' + name + '/i'
rule = ('# 版本探针 v2 (version-probe.sh 用, 勿删)\n'
        'request if ${url} ~= ' + probe_url_regex + ' then reject(200, "' + ver + '")')

# 插入到 [Rewrite] 段首
s2 = re.sub(r'^\[Rewrite\]$', '[Rewrite]\n' + rule, s, count=1, flags=re.M)
if s2 == s:
    print('❌ 无 [Rewrite] 段'); sys.exit(1)
s = s2

open(lpx, 'w', encoding='utf-8').write(s)
print(f'✅ 探针已埋入 → v{ver} @ {host}')

# 探针 URL 辅助文件 (version-probe.sh 读取)
open(lpx + '.probe', 'w').write(f'https://{host}/gw/loon-sim.probe.{name}\n')
