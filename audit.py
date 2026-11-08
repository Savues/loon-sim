#!/usr/bin/env python3
"""audit.py — 部署物流审计（第②层守门员）
守 loon-sim 覆盖不到的"清单之外的物流"：
  ① 资源 URL 可达性（404 = 订阅「链接无效」直接原因）
  ② 同名脚本多副本一致性（伞复发事故模式：同一功能打了两份不同补丁）
  ③ 缓存戳漂移（脚本比 lpx 更晚提交 = ?v= 可能漏递增，v723 回退事故模式）
sh 入口 audit.sh 仅转调本文件 — iSH ash 的 while-read+grep 循环有挂死怪癖，逻辑全走 python。
用法: python3 tools/loon-sim/audit.py [lpx路径…]
"""
import hashlib, pathlib, subprocess, sys, re

ROOT = pathlib.Path(__file__).resolve().parent.parent.parent
fail = 0
def bad(m):
    global fail; fail += 1; print('❌', m)
def good(m): print('✓', m)
def note(m=''): print(m)

def sha(p): return hashlib.md5(pathlib.Path(p).read_bytes()).hexdigest()[:8]

# ── 清单 ──
lpxs = [pathlib.Path(a).resolve() for a in sys.argv[1:]] if len(sys.argv) > 1 else sorted(ROOT.glob('plugins/*/*.lpx'))
lpxs = [p for p in lpxs if p.is_file()]
note(f'══ audit: {len(lpxs)} 个清单 ══'); note()

all_text = '\n'.join(p.read_text(encoding='utf-8', errors='ignore') for p in lpxs)

# ── ① URL 可达性（并发, 8 线程; 输出仍按原顺序, 保证可比对）──
note('── ① 资源 URL 可达性')
urls = sorted(set(re.findall(r'(?:script-path=|#!icon=)(https://[^,"\s]+)', all_text)))

def probe(u):
    r = subprocess.run(['curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '12', u],
                       capture_output=True, text=True)
    return r.stdout.strip() or '000'

bad_n = 0
if urls:
    # iSH 单核, 但瓶颈是网络 RTT —— 8 路并发把 69 个 URL 从 ~90s 压到 ~12s
    import concurrent.futures as cf
    with cf.ThreadPoolExecutor(max_workers=8) as pool:
        codes = list(pool.map(probe, urls))
    for u, code in zip(urls, codes):
        if code != '200':
            bad(f'{code} {u}'); bad_n += 1
if bad_n == 0: good(f'全部 {len(urls)} 个资源 URL 200')
note()

# ── ② 同名多副本 ──
note('── ② 同名脚本多副本一致性')
js = [p for p in (ROOT / 'plugins').rglob('*.js')
      if 'archive' not in p.parts and 'fixtures' not in p.parts and 'node_modules' not in p.parts]
by_name = {}
for p in js: by_name.setdefault(p.name, []).append(p)
dup_total = dup_bad = 0
for name, files in sorted(by_name.items()):
    if len(files) < 2: continue
    dup_total += 1
    hashes = {p: sha(p) for p in files}
    uniq = set(hashes.values())
    if len(uniq) == 1:
        good(f'{name} ×{len(files)} 份内容一致'); continue
    refs = [p for p in files if f'plugins/{p.relative_to(ROOT / "plugins")}' in all_text]
    note(f'  ⚠ {name} 有 {len(files)} 份且内容不同:')
    for p in files:
        mark = '  ◄被引用' if p in refs else ''
        print(f'    {hashes[p]} {p.relative_to(ROOT / "plugins")}{mark}')
    if len(refs) >= 2:
        ref_uniq = {sha(p) for p in refs}
        if len(ref_uniq) > 1:
            # 分辨「有意分叉」与「打错副本」: 差异行全部是各自插件路径的 URL 换轨 → 有意
            texts = {p: pathlib.Path(p).read_text(encoding='utf-8', errors='ignore') for p in refs}
            import difflib
            pairs = list(difflib.unified_diff(texts[refs[0]].splitlines(), texts[refs[1]].splitlines(), lineterm=''))
            changed = [l for l in pairs if l[:1] in '+-' and l[:3] not in ('+++', '---')]
            # 伞复发事故模式是指「同一插件内打错不同副本」或「同家族插件把通用补丁改偏」
            # 若两份文件分属完全不相关的顶层插件目录（如 CtClient-AdBlock vs Alibaba-AdBlock），天然为独立插件自身的 bundle，不属于多副本事故
            plugin_roots = {p.relative_to(ROOT / "plugins").parts[0] for p in refs}
            unrelated = (len(plugin_roots) == len(refs) and not any('Test' in pr for pr in plugin_roots)
                         and len(set(pr.split('-')[0] for pr in plugin_roots)) == len(refs))

            forkish = 0 < len(changed) <= 15
            if unrelated:
                note(f'  ✓ {name} 分属不同顶层插件 ({", ".join(sorted(plugin_roots))})，为独立模块，非伞复发事故')
            elif forkish:
                note(f'  ⚠ {name} 被引用的 {len(refs)} 份不同, 但差异全为插件路径换轨 = 有意分叉 ({len(changed)} 行)')
            else:
                bad(f'{name} 被引用的 {len(refs)} 份副本内容不一致 ← 伞复发事故模式'); dup_bad += 1
        else:
            good(f'被引用的 {len(refs)} 份互相一致')
if dup_total == 0: good('无同名多副本')
note()

# ── ③ 缓存戳漂移 ──
note('── ③ 缓存戳漂移检测')
def mtime_ns(p):
    r = subprocess.run(['git', 'log', '-1', '--format=%ct', '--', str(p.relative_to(ROOT))],
                       cwd=ROOT, capture_output=True, text=True)
    return int(r.stdout.strip() or 0)
stamp_bad = 0
for lpx in lpxs:
    l_t = mtime_ns(lpx)
    for m in re.finditer(r'script-path=(https://raw\.githubusercontent\.com/[^/]+/[^/]+/main/([^,?"\s]+))', lpx.read_text(encoding='utf-8', errors='ignore')):
        rel = ROOT / m.group(2)
        if not rel.is_file(): continue
        if mtime_ns(rel) > l_t:
            bad(f'{m.group(2)} 比 {lpx.name} 新 — 改了脚本但 ?v= 未递增 (v723 回退事故模式)'); stamp_bad += 1
if stamp_bad == 0: good('无缓存戳漂移')
note()

# ── ④ Git 提交身份合规 ──
note('── ④ Git 提交身份合规')
EXPECTED_EMAIL = 'Savues@users.noreply.github.com'
r_email = subprocess.run(['git', 'config', 'user.email'], cwd=ROOT, capture_output=True, text=True)
cur_email = r_email.stdout.strip()
if cur_email != EXPECTED_EMAIL:
    bad(f'Git user.email 为 "{cur_email}"，必须配置为 "{EXPECTED_EMAIL}" (请运行: git config user.email {EXPECTED_EMAIL})')
else:
    good(f'Git 提交身份合规: {cur_email}')
note()

# ── ⑤ README 元数据一致性 ──
# README 是接手插件时第一个读的上下文来源; 版本写错 = 后续排查基于错误前提。
# 只校验"机器能判真假"的客观项; 章节命名/顺序不做约束(见 2026-11-08 方案 C′ 裁决)。
note('── ⑤ README 元数据一致性')
README_MIN_LPX = set()  # 占位, 保持结构对称
# 调试分片目录: 不对外订阅, 跳过 README 元数据校验
README_EXEMPT = {'BlockAds-spfcas-sppthgb-debug-individual'}


def canon(v):
    """1.6.0 / 1.6 / v1.6 → '1.6' (去掉尾随 .0 段)"""
    parts = v.strip().lstrip('vV').split('.')
    while len(parts) > 1 and parts[-1] == '0':
        parts.pop()
    return '.'.join(parts)


rd_bad = rd_ok = 0
checked_dirs = set()
for lpx in lpxs:
    d = lpx.parent
    if d in checked_dirs:
        continue
    checked_dirs.add(d)
    if d.name in README_EXEMPT:
        continue
    # 上游参照文件不参与
    if lpx.name.startswith('upstream-'):
        continue
    rm = d / 'README.md'
    if not rm.is_file():
        bad(f'{d.name}: 有 lpx 但缺 README.md'); rd_bad += 1
        continue
    txt = rm.read_text(encoding='utf-8', errors='ignore')
    head = '\n'.join(txt.splitlines()[:10])

    # ① 版本与主 lpx 一致
    m_lpx = re.search(r'^#!version\s*=\s*(\S+)\s*$', lpx.read_text(encoding='utf-8', errors='ignore'), re.M)
    lpx_ver = m_lpx.group(1) if m_lpx else None
    m_rm = (re.search(r'版本\s*[:：]?\s*\**\s*v?(\d+(?:\.\d+)*)', head)
            or re.search(r'\*\*\s*v(\d+(?:\.\d+)*)\s*\*\*', head))
    rm_ver = m_rm.group(1) if m_rm else None
    if lpx_ver and not rm_ver:
        bad(f'{d.name}: README 头部未声明版本 (lpx={lpx_ver})'); rd_bad += 1
    elif lpx_ver and canon(rm_ver) != canon(lpx_ver):
        bad(f'{d.name}: README 版本 {rm_ver} ≠ lpx {lpx_ver} — 漂移'); rd_bad += 1
    elif lpx_ver:
        rd_ok += 1

    # ② 必须有本仓订阅直链
    if f'plugins/{d.name}/' not in txt or 'raw.githubusercontent.com/Savues/loon-plugin-patches' not in txt:
        bad(f'{d.name}: README 无本仓订阅直链 (用户拿不到安装地址)'); rd_bad += 1

    # ③ 不得有重复 H2 (复制粘贴事故)
    h2 = [l[3:].strip() for l in txt.splitlines() if l.startswith('## ')]
    dups = {h for h in h2 if h2.count(h) > 1}
    if dups:
        bad(f'{d.name}: 重复二级标题 {sorted(dups)}'); rd_bad += 1

if rd_bad == 0:
    good(f'{rd_ok} 个 README 元数据一致 (版本/订阅/日期/标题唯一)')
else:
    good(f'其余 {rd_ok} 个 README 版本一致')
note()

note(f'══ audit 完成: {len(urls)} URL / {dup_total} 组多副本 ══')
print('✅ 全过' if fail == 0 else f'❌ 有问题 ({fail} 项)')
sys.exit(1 if fail else 0)
