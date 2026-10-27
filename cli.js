#!/usr/bin/env node
'use strict';
/**
 * loon-sim CLI —— 本地验证 Loon 插件的规则匹配与脚本行为
 *
 * 用法:
 *   node cli.js check  <plugin.lpx>                       配置静态校验
 *   node cli.js run    <plugin.lpx> --url U [--response-file F] [--arg k=v ...]
 *   node cli.js har    <plugin.lpx> <file.har> [--limit N] [--only host]
 *   node cli.js rules  <plugin.lpx> [--url U]
 */

const fs = require('fs');
const path = require('path');
const { parseLpx, splitTopLevel } = require('./lpx');
const { matchRequest, matchRule, evalCondition } = require('./matcher');
const { createRuntime, toBuffer } = require('./runtime');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
function flag(name) { return process.argv.includes('--' + name); }

const cmd = process.argv[2];
const lpxPath = process.argv[3];
if (!cmd || !lpxPath) {
  console.log(`用法:
  node cli.js check   <plugin.lpx>
  node cli.js init    <name> [dir]                # 生成插件骨架\n  node cli.js convert <plugin.lpx> [-o out.lpx]  # 旧→新语法转换 (官方实现)\n  node cli.js run     <plugin.lpx> --url URL [--response-file F] [--status 200] [--phase response] [--arg k=v]
  node cli.js har     <plugin.lpx> <file.har> [--limit N] [--only substr]
  node cli.js rules   <plugin.lpx> [--url URL]`);
  process.exit(1);
}
if (cmd === 'init') { require('./init'); process.exit(0); }
const lpx = parseLpx(lpxPath);

// ---------- check ----------
function cmdCheck() {
  const p = lpx;
  let errs = 0, warns = 0;
  console.log(`插件: ${p.header.name || '(无 #!name)'}  [${p.header.version || p.header.date || '-'}]`);
  console.log(`段位: ${p.sections.join(', ')}`);

  // 1) 文件头
  if (!p.header.name) { console.log('❌ 缺少 #!name'); errs++; }
  if (!p.header.version && !p.header.date) { console.log('⚠️  缺少 #!version / #!date'); warns++; }
  if (p.header.version && !p.header.date) console.log('ℹ️  使用了 #!version（官方字段表只有 #!date，可能不显示）');

  const knownHeader = new Set(['name', 'desc', 'author', 'homepage', 'icon', 'system', 'system_version', 'loon_version', 'date', 'tag', 'type', 'version']);
  for (const k of Object.keys(p.header)) if (!knownHeader.has(k)) console.log(`⚠️  未知 #! 字段: #!${k}`);

  // 1b) [Argument] 定义合法性 (A1~A6)
  for (const w of (p.argWarnings || [])) { console.log(`⚠️ ${w.msg}`); warns++; }

  // 1c) 引用一致性 (B组) + 死参数 (B4/B5)
  const allScriptCode = [];   // 收集所有脚本文本(无法取到远端脚本, 只做静态标注)
  const definedKeys = Object.keys(p.args);
  const usedInRules = new Set();
  const usedInEnable = new Set();
  for (const r of p.scriptRules) {
    for (const k of (r.argumentKeys || [])) usedInRules.add(k);
    // 旧语法: enable={k} 在 options.enable 或 raw 中
    let en = r.options && r.options.enable;
    if (en) { const m = /^\{?([a-zA-Z][a-zA-Z0-9_]*)\}?$/.exec(String(en).trim().replace(/^\$\{/,'').replace(/\}$/,'')); if (m) usedInEnable.add(m[1]); }
    else if (r.raw) { const m = /enable=\{?(\$\{)?([a-zA-Z][a-zA-Z0-9_]*)\}(\})?/.exec(r.raw); if (m) usedInEnable.add(m[2]); }
  }
  for (const r of p.rewriteRules) {
    if (r.action && r.action.includes('enable')) {
      const m = /enable=\$\{([a-zA-Z]+)\}/.exec(r.action);
      if (m) { if (!definedKeys.includes(m[1])) console.log(`❌ [Rewrite] 引用未声明参数 \${${m[1]}}`), errs++; else usedInRules.add(m[1]); }
      const m2 = /\$\{([a-zA-Z]+)}\s*==\s*true/.exec(r.condition || '');
      if (m2) { if (!definedKeys.includes(m2[1])) console.log(`❌ [Rewrite] 条件引用未声明参数 \${${m2[1]}}`), errs++; else usedInRules.add(m2[1]); }
    }
  }
  for (const r of p.rules) {
    if (r.extra) for (const e of r.extra) {
      const m = /^enable=\$\{([a-zA-Z]+)\}/.exec(e);
      if (m) { if (!definedKeys.includes(m[1])) console.log(`❌ [Rule] 引用未声明参数 \${${m[1]}}`), errs++; else usedInRules.add(m[1]); }
    }
  }
  for (const k of definedKeys) {
    if (!usedInRules.has(k) && !usedInEnable.has(k)) console.log(`⚠️ [Argument] "${k}" 未被任何规则引用(死参数)`), warns++;
  }
  // 1d) C1: 脚本 isEnabled 读取的 key 未声明为 switch
  //   (仅能静态提示; 无法取远端脚本则跳过)
  //   注: 若规则引用了参数但脚本未读取, 属"死传参", 同样只能靠运行双形态发现

  // 2) [Rule] 是否误挂开关（官方 Rule 无 enable 字段）
  for (const r of p.rules) {
    for (const e of r.extra) if (/^enable=/i.test(e)) { console.log(`❌ [Rule] 含 enable= （该段无此字段 → 死开关）: ${r.raw.slice(0, 70)}`); errs++; }
  }

  // 3) [Rewrite] 是否误挂 enable=
  for (const r of p.rewriteRules) {
    if (r.legacy) continue;
    if (/,?\s*enable\s*=\s*\{/.test(r.action)) { console.log(`❌ [Rewrite] 含 enable={} （非官方语法 → 规则无效）: ${r.raw.slice(0, 70)}`); errs++; }
    if (/\|\s*enable\s*=/.test(r.action)) { console.log(`❌ [Rewrite] 含 enable= : ${r.raw.slice(0, 70)}`); errs++; }
  }

  // 3b) [Rewrite] json.replace 值类型校验 (v1.7.7)
  //     真实 Loon 对空容器值解析失败且静默跳过 —— 模拟器 evalArg 会正确解析，故必须静态拦
  for (const r of p.rewriteRules) {
    if (r.legacy) continue;
    const act = r.action || '';
    if (!/json\.replace\(/.test(act)) continue;
    // 单条形态: json.replace("path", []) / {} / null
    const m1 = /json\.replace\(\s*(?:"[^"]*"|'[^']*')\s*,\s*(\[\]|\{\}|null)\s*\)/.exec(act);
    if (m1) {
      console.log(`⚠️  json.replace 值参数传空容器 "${m1[1]}" — 真实 Loon 会静默失败，建议改用 delete: ${r.raw.slice(0, 70)}`);
      warns++;
      continue;
    }
    // 批量形态: json.replace(["a","b"], ["[]","{}"]) — 值是字符串而非容器
    // 注意: 值列表里含 "[]" 字面量, 不能用 [^\]]* 匹配(会在首个 ] 处截断)
    const m2 = /json\.replace\(\s*\[[^\]]*\]\s*,\s*\[((?:"[^"]*"|'[^']*'|`[^`]*`|\s|,)*)\]/.exec(act);
    if (m2) {
      const vals = m2[1].split(',').map(s => s.trim()).filter(Boolean);
      const strEmpty = vals.filter(v => /^["'`]\s*(\[\]|\{\}|null)\s*["'`]$/.test(v));
      if (strEmpty.length) {
        console.log(`❌ json.replace 批量值传字符串空容器 ${JSON.stringify(strEmpty)} — 会写入字符串而非数组/对象: ${r.raw.slice(0, 70)}`);
        errs++;
      }
    }
  }

  // 3c) [Rewrite] reject_* 与目标资源类型匹配校验 (v1.7.7)
  //     拦截二进制资源时占位类型必须与目标一致, 否则 App 解析失败 → 用户可见报错
  //     事故: reject_img(200) 拦 .zip 模板包 → [DslJsRuntime] downloadJs failed, cannot open zip file
  const REJECT_MISMATCH = {
    // 目标后缀 → 不能用的 reject 类型（占位内容类型与目标不符）
    'zip':   ['reject_img', 'reject_video'],
    'mp4':   ['reject_img', 'reject_dict', 'reject_array'],
    'm3u8':  ['reject_img', 'reject_dict', 'reject_array'],
    'png':   ['reject_video', 'reject_dict', 'reject_array'],
    'jpg':   ['reject_video', 'reject_dict', 'reject_array'],
    'jpeg':  ['reject_video', 'reject_dict', 'reject_array'],
    'webp':  ['reject_video', 'reject_dict', 'reject_array'],
    'gif':   ['reject_video', 'reject_dict', 'reject_array'],
  };
  // 路径特征 → 推测目标类型（URL 无后缀但路径能判断的场景）
  const PATH_TYPE_HINT = [
    { re: /xhs-dsl|\/dsl\/|template|\.zip/i, type: 'zip' },
    { re: /\/hera\/|\/stream\/|\.mp4|video\//i, type: 'mp4' },
  ];
  for (const r of p.rewriteRules) {
    if (r.legacy) continue;
    const act = r.action || '';
    const mk = /(reject_(?:img|video|dict|array))/.exec(act);
    if (!mk) continue;
    const kind = mk[1];
    const cond = r.condition || '';
    let matched = false;
    // a) 条件里显式带后缀
    for (const [ext, badKinds] of Object.entries(REJECT_MISMATCH)) {
      if (!badKinds.includes(kind)) continue;
      if (!new RegExp('\\\\*\\\\.?' + ext + '(?![a-z0-9])', 'i').test(cond)) continue;
      console.log(`❌ ${kind} 用于 .${ext} 资源 — 占位内容类型不匹配会导致 App 解析失败: ${r.raw.slice(0, 70)}`);
      errs++; matched = true; break;
    }
    if (matched) continue;
    // b) 无后缀但路径特征可判断（如模板目录 /xhs-dsl/xxx/ 下载的是 zip）
    for (const h of PATH_TYPE_HINT) {
      if (!h.re.test(cond)) continue;
      if (!REJECT_MISMATCH[h.type].includes(kind)) continue;
      console.log(`❌ ${kind} 用于疑似 .${h.type} 资源（路径特征 "${h.re.source.slice(0, 20)}…"）— 占位类型不匹配会导致解析失败: ${r.raw.slice(0, 70)}`);
      errs++; break;
    }
  }

  // 4) [Script] with 字段白名单（官方 7 个）
  const WITH_FIELDS = new Set(['enable', 'tag', 'img_url', 'timeout', 'debug', 'requires_body', 'binary_body_mode']);
  const LEGACY_WITH = new Set(['img-url', 'requires-body', 'binary-body-mode']); // 旧语法字段, legacy 规则专用
  for (const r of p.scriptRules) {
    if (r.invalid && r.invalid !== 'unparsed') { console.log(`❌ [Script] ${r.invalid}: ${r.raw.slice(0, 70)}`); errs++; }
    // 旧语法(script-path / requires-body / argument=[{...}])字段名与新语法不同 → 单独校验
    if (r.legacy) {
      if (!r.scriptPath) { console.log(`❌ [Script-旧语法] 缺 script-path`); errs++; }
      for (const k of (r.argumentKeys || [])) if (!(k in p.args)) { console.log(`❌ [Script-旧语法] 引用未声明参数 \${${k}}`); errs++; }
      for (const k of Object.keys(r.options || {})) {
        if (!LEGACY_WITH.has(k) && k !== 'enable' && k !== 'enabled' && k !== 'tag' && k !== 'timeout' && k !== 'argument' && k !== 'debug') {
          console.log(`❌ [Script-旧语法] 未知字段 "${k}": ${r.raw.slice(0, 60)}`); errs++;
        }
      }
      continue;
    }
    for (const k of Object.keys(r.options || {})) {
      if (!WITH_FIELDS.has(k)) {
        const hint = LEGACY_WITH.has(k) || LEGACY_WITH.has(k.replace(/_/g, '-')) ? '（旧语法字段名 — 新语法用 snake_case）' : '（官方：未知字段会使当前规则无效）';
        console.log(`❌ [Script] with 未知字段 "${k}" ${hint}: ${r.raw.slice(0, 60)}`);
        errs++;
      } else if (k !== k.toLowerCase()) {
        console.log(`❌ [Script] with 字段 "${k}" 必须全小写 snake_case（官方：字段名区分大小写）`);
        errs++;
      }
    }
    if (r.phase === 'response' && r.condition) {
      const cond = r.condition;
      if (!cond.includes('${url}')) {
        console.log(`❌ Response Script 缺强制 URL Guard: ${r.raw?.slice(0, 70) || ''}`);
        errs++;
      } else {
        // 顶层 || 会拆散必要性: 提取顶层 (无括号包裹) 的 || 分支检查
        const parts = splitTopLevel(cond, '||');
        const urlGuarded = parts.length === 1 || parts.every(pt => pt.includes('${url}'));
        if (!urlGuarded) {
          console.log(`❌ Response Script 的 URL Guard 非必要条件（顶层 || 使 URL 可被绕过）: ${r.raw?.slice(0, 70) || ''}`);
          errs++;
        }
      }
    }
    // 引用的参数必须在 [Argument] 中声明
    if (r.invalid) { console.log(`❌ [Script] 规则无法解析: ${String(r.raw).slice(0, 90)}`); errs++; continue; }
    for (const k of (r.argumentKeys || [])) if (!(k in p.args)) { console.log(`❌ [Script] 引用了未声明的参数 \${${k}}`); errs++; }
    if (r.legacy) continue;   // 旧语法字段名不同（script-path/requires-body 等），跳过新语法校验
  }

  // 5) 同一接口 [Script]+[Rewrite] 重叠

  const overlaps = [];
  for (const s of p.scriptRules) {
    const g = /\$\{url\}\s*~=\s*\/(.+?)\/[a-z]*/i.exec(s.condition);
    if (!g) continue;
    let re; try { re = new RegExp(g[1]); } catch { continue; }
    for (const w of p.rewriteRules) {
      if (!w.condition) continue;
      const g2 = /\$\{url\}\s*~=\s*\/(.+?)\/[a-z]*/i.exec(w.condition);
      if (!g2) continue;
      let re2; try { re2 = new RegExp(g2[1]); } catch { continue; }
      const probe = 'https://x.example.com/';
      for (const u of [probe]) { /* 需要真实 URL 才能判定，见 rules 命令 */ }
      overlaps.push({ s: s.raw.slice(0, 50), w: w.raw.slice(0, 50), re, re2 });
    }
  }
  if (overlaps.length) console.log(`ℹ️  [Script]×[Rewrite] 组合数: ${overlaps.length}（用 rules 命令按真实 URL 检测冲突）`);

  // 6) MITM 覆盖（仅提示带路径规则）
  const mitmSet = new Set(p.mitm);
  const needs = new Set();
  for (const r of p.scriptRules) {
    const g = /\$\{url\}\s*~=\s*\/\^?https?:\\?\/\\?\/([a-z0-9.*?()|+\\-]+)/i.exec(r.condition);
    if (g) needs.add(g[1].replace(/\\/g, '').replace(/[()?+:]/g, '').split('|')[0].replace(/^\*\./, ''));
  }
  for (const h of needs) {
    if (!h || h.includes('*')) continue;
    if (!mitmSet.has(h) && !p.rules.some(r => r.value === h)) console.log(`⚠️  规则引用 ${h} 但不在 [Mitm] 也不在 [Rule]（路径规则将失效）`);
  }

  // 探针一致性检查 (2026-10-24 探针事故三连驱动: 缺尾斜杠/版本不同步/订阅延迟误判)
  // 2026-10-26 甲: 开关从 `有 #!version` 改为 `存在探针规则` — 否则没写 #!version 的插件整段跳过校验
  //   (Allinone v8.0.1 的探针语法错误 `${{url}}` 就是这样逃过所有自动化的)
  const ver = lpx.header?.version;
  {
    const probeRules = [...p.scriptRules, ...p.rewriteRules].filter(r => /loon-sim.{0,3}probe/.test(String(r.condition || r.raw || '')));
    if (probeRules.length === 0) {
      if (ver) {
        console.log(`⚠️ 有 #!version=${ver} 但未埋版本探针 — version-probe.sh 无法验证设备版本 (跑 probe-setup.py 埋入)`);
        warns++;
      }
    } else {
      // ⑤ 探针变量形态: ${{...}} 是 f-string 转义残留, Loon 不认 → 探针永不匹配 (2026-10-26 实证)
      for (const r of probeRules) {
        const raw0 = String(r.raw || '');
        if (/\$\{\{/.test(raw0)) {
          console.log(`❌ 探针变量写成 \${{...}}（双花括号）—— Loon 只认 \${...}；该探针永不匹配 (f-string 转义残留): ${raw0.slice(0, 70)}`);
          errs++;
        }
      }
      const mainProbes = [];
      for (const r of probeRules) {
        const raw = String(r.raw || '');
        const cond = String(r.condition || '');
        const isABProbe = /(probe[._]?(bare|ab|bare2)|_bare)/i.test(cond + raw);
        if (isABProbe) continue;  // A/B 对照探针 (bare/ab) 豁免 — 与主探针合法共存
        mainProbes.push(r);
      }
      if (mainProbes.length > 1) {
        console.log(`❌ 主探针有 ${mainProbes.length} 条 (应恰好 1 条) — 重复埋入, 重跑 probe-setup.py`);
        errs++;
      }
      for (const r of mainProbes) {
        const raw = String(r.raw || '');
        const cond = String(r.condition || '');
        // ① 模板形态: 必须完整锚定 ^https?://.../i (lpx解析后是 \/ 转义文本, 用包含检测)
        if (!cond.includes('^https?:')) {
          console.log(`❌ 探针必须用完整锚定形态 ^https?://域名/.../i (模板锁定): ${cond.slice(0, 70)}`);
          errs++;
        }
        // ② reject(200, "版本") 双参
        const m = /reject\(200, "([^"]+)"\)/.exec(raw);
        if (!m) {
          console.log(`❌ 探针必须用 reject(200, "版本号") 双参形态: ${raw.slice(-50)}`);
          errs++;
        } else if (ver && m[1] !== ver) {
          console.log(`❌ 探针版本 "${m[1]}" ≠ #!version ${ver} — 版本未同步 (重跑 probe-setup.py)`);
          errs++;
        }
        // ④ 探针域名必须在 [MitM] 列表
        const dm = /\^https\?:\\\/\\\/([^\\/ ]+?)\\\//.exec(cond);
        const hostRe = dm ? dm[1] : null;
        if (hostRe && !hostRe.includes('^[')) {  // 简单域名形态才校验 (字符族跳过)
          const host = hostRe.replace(/\\\./g, '.').replace(/\(\?:/g, '(');
          const mitmOk = (lpx.mitm || []).some(h => host.includes(h.replace(/^\*\./, '')) || h.replace(/^\*\./, '').includes(host.replace(/[()^$]/g, '')));
          if (!mitmOk && (lpx.mitm || []).length) {
            console.log(`⚠️ 探针域名 "${host}" 不在 [MitM] 列表 — 探针可能因不解密而穿透`);
            warns++;
          }
        }
      }
      // 辅助文件
      const fsx = require('fs');
      const probeFile = lpxPath + '.probe';
      if (!fsx.existsSync(probeFile)) {
        console.log(`⚠️ 缺 ${require('path').basename(probeFile)} — version-probe.sh 读不到探针 URL`);
        warns++;
      }
    }
  }

  // 脚本 $done 调用检查 (残废脚本防线: 2026-10-25 horn_clean 事故 — 数组被截只剩定义, check过但真机死)
  for (const r of p.scriptRules) {
    const src = String(r.raw || '');
    const m = /script\(["']([^"']+)["']/.exec(src);
    if (!m) continue;
    let local = m[1];
    if (local.includes('githubusercontent.com')) {
      local = local.replace(/^https?:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/main\//, '').replace(/^https?:\/\/[^/]+\//, '');
      for (const base of [lpxPath + '/../../..', lpxPath + '/..', '.']) {
        const cand = require('path').resolve(base, local);
        if (require('fs').existsSync(cand)) { local = cand; break; }
      }
    }
    if (!require('fs').existsSync(local)) continue;
    const js = require('fs').readFileSync(local, 'utf8');
    if (!js.includes('$done')) {
      console.log(`❌ 脚本无 $done 调用 (真机将等待超时): ${require('path').basename(local)}`);
      errs++;
    }
  }

  // 正则字面量闭合校验 (~= /re/ 必须以 / 或 /flags 结束 — 不闭合则规则永不匹配)
  // 2026-10-24 探针穿透事故驱动: probe-setup 曾生成无尾斜杠正则
  for (const r of [...p.scriptRules, ...p.rewriteRules]) {
    const cond = String(r.condition || '');
    const m = /~=\s*([^&()]+?)(?:\s+as\s+\w+)?\s*$/.exec(cond.trim());
    if (!m) continue;
    const rhs = m[1].trim();
    if (!rhs.startsWith('/')) continue;
    // 提取最后一个 '/' 之后的部分: 若无尾斜杠则不闭合
    const lastSlash = rhs.lastIndexOf('/');
    if (lastSlash <= 0) { console.log(`❌ 正则字面量未闭合 (缺尾 / 或 flag): ${rhs.slice(0, 60)} —— 规则永不匹配`); errs++; continue; }
    const flags = rhs.slice(lastSlash + 1);
    if (!/^[a-z]*$/.test(flags)) { console.log(`❌ 正则字面量未闭合 (尾段非 flag): ${rhs.slice(0, 60)}`); errs++; continue; }
    // 与 parseRegex 复核: 能否解析
    const { parseRegex } = require('./matcher');
    if (!parseRegex(rhs)) { console.log(`❌ 正则无法解析: ${rhs.slice(0, 60)}`); errs++; }
  }

  // with 字段不能重复 (官方: 字段重复→规则无效)
  for (const r of p.scriptRules) {
    if (r.legacy) continue;
    const seen = new Set();
    const dup = [];
    for (const m of String(r.raw || '').matchAll(/(?:^|with\s|,\s)([a-z_]+)=/g)) {
      if (seen.has(m[1])) dup.push(m[1]); else seen.add(m[1]);
    }
    if (dup.length) { console.log(`❌ [Script] with 字段重复: ${[...new Set(dup)].join(',')}（官方: 规则无效）`); errs++; }
    // cron/network-changed/generic 不能设 requires_body / binary_body_mode (无 HTTP Body)
    const trig = String(r.trigger || '').split(' ')[0];
    if (['cron', 'network-changed', 'generic'].includes(trig)) {
      if (/requires_body\s*=\s*true/.test(r.raw || '')) { console.log(`❌ [Script] ${trig} 类规则不能设置 requires_body（无 HTTP Body）`); errs++; }
      if (/binary_body_mode\s*=\s*true/.test(r.raw || '')) { console.log(`❌ [Script] ${trig} 类规则不能设置 binary_body_mode`); errs++; }
    }
  }

  // with timeout 必须为正有限数 (官方: 大于 0 的有限 Number)
  for (const r of p.scriptRules) {
    if (r.legacy) continue;
    for (const m of String(r.raw || '').matchAll(/timeout\s*=\s*(?!\$\{|\{)([^,\s]+)/g)) {
      const n = Number(m[1]);
      if (!Number.isFinite(n) || n <= 0) { console.log(`❌ [Script] with timeout=${m[1]} 非法（官方: 大于 0 的有限数值）`); errs++; }
    }
  }
  // script() 路径必须非空固定字符串 (官方: 不能用变量/模板)
  for (const r of p.scriptRules) {
    if (r.legacy) continue;
    const pm = /script\(\s*([^,)]+?)\s*[,)]/.exec(String(r.raw || ''));
    if (pm) {
      const pathArg = pm[1].trim();
      if (/^\$\{/.test(pathArg)) { console.log(`❌ [Script] 脚本路径不能用变量: ${pathArg}`); errs++; }
      else if (pathArg === '""' || pathArg === "''" || pathArg === '``') { console.log(`❌ [Script] 脚本路径为空字符串`); errs++; }
    } else if (!/script\(/.test(String(r.raw || '')) && r.scriptPath === undefined && r.invalid) {
      // 无 script( 且无 scriptPath → 已由 invalid 报
    }
  }
  // tag/img_url/requires_body/binary_body_mode 不接受变量或模板 (官方)
  for (const r of p.scriptRules) {
    if (r.legacy) continue;
    for (const f of ['tag', 'img_url', 'requires_body', 'binary_body_mode']) {
      const re = new RegExp(f + '\\s*=\\s*\\$\\{');
      if (re.test(String(r.raw || ''))) { console.log(`❌ [Script] with ${f}= 不接受变量（官方: 固定值）`); errs++; }
    }
  }

  // 插件对象参数约束: {${a},${b}} 不能空/重复/未声明 (官方: 违反→当前规则无效)
  for (const r of p.scriptRules) {
    if (r.invalid) continue; // 解析失败的规则已由上面报过, 不重复
    // 判断是否对象参数: 新语法 {${a},${b}} → argumentKeys 非空; 旧语法 argumentLiteral 形如 {a,b} 或 [{a},{b}]
    const raw = r.raw || '';
    const isObjArg = /script\([^)]*,\s*\{/.test(raw) || /script\([^)]*,\s*\[\{/.test(raw) || /argument=\{[^\[]/.test(raw);
    const names = r.argumentKeys || [];
    if (isObjArg || (names.length && !/script\([^)]*,\s*["\`]/.test(raw))) {
      if (isObjArg && !names.length) { console.log(`❌ [Script] 对象参数为空 {}（官方: 无效）: ${r.raw?.slice(0, 60)}`); errs++; continue; }
      if (!names.length) continue;
      const dup = names.find((n, i) => names.indexOf(n) !== i);
      if (dup) { console.log(`❌ [Script] 对象参数重复引用 ${dup}（官方: 无效）`); errs++; }
      const undeclared = names.filter(n => !(n in (p.args || {})));
      for (const n of undeclared) { console.log(`❌ [Script] 对象参数引用未声明参数 "${n}"（官方: 只能引用本插件 [Argument]）`); errs++; }
      if (names.some(n => n === 'url')) { console.log(`❌ [Script] 对象参数不能引用 \${url}（保留变量）`); errs++; }
    }
  }

  // cron 表达式格式校验 (官方支持 5 位「分时日月周」与 6 位「秒分时日月周」)
  for (const r of p.scriptRules) {
    if (r.trigger === 'cron' && r.cronExpr) {
      const ce = r.cronExpr.trim();
      const parts = ce.split(/\s+/);
      const okLen = parts.length === 5 || parts.length === 6;
      const okVal = parts.every(x => /^[*\/,-\d]+$/.test(x));
      if (!okLen || !okVal) {
        console.log(`❌ [Script] cron 表达式非法 "${ce}"（应为 5 位或 6 位，字段仅允许 * / , - 数字）`);
        errs++;
      }
    }
  }

  // [Rule] 策略合法性 — 官方 plugin.md: 插件规则只能 DIRECT / REJECT 系 / PROXY
  // (PROXY=用户选择策略组; 不能引用任意策略组名; 未指定策略默认 DIRECT)
  const VALID_POLICY = /^(DIRECT|PROXY|REJECT|REJECT-DROP|REJECT-NO-DROP|REJECT-DICT|REJECT-ARRAY|REJECT-IMG|REJECT-VIDEO|REJECT-NO-DROP)$/i;
  for (const r of p.rules) {
    if (r.policy && !VALID_POLICY.test(r.policy)) {
      console.log(`❌ [Rule] 策略 "${r.policy}" 超出插件可用范围（官方: 仅 DIRECT/PROXY/REJECT 系）: ${r.raw?.slice(0, 60) || ''}`);
      errs++;
    } else if (!r.policy) {
      console.log(`ℹ️ [Rule] 未指定策略 → 默认 DIRECT: ${r.raw?.slice(0, 60) || ''}`);
    }
  }

  // Rewrite as 捕获越界 (官方: 捕获下标不能超过正则中的捕获组数量; 审计问题5)
  for (const r of p.rewriteRules) {
    const cond = String(r.condition || r.raw || '');
    const asM = /~=\s+\/((?:[^\/]\\.|[^\/])+)\/\w*\s+as\s+(\w+)/.exec(cond.replace(/\\\//g, '/'));
    if (!asM) continue;
    const [pat, name] = [asM[1], asM[2]];
    // 统计捕获组数 (排除 (?: 和 \\()
    const groups = (pat.replace(/\\\(/g, '').match(/((?!\?)[(])/g) || []).length;
    for (const m of String(r.raw || r.action || '').matchAll(new RegExp('\\$\\{' + name + '\\.(\\d+)\\}', 'g'))) {
      if (Number(m[1]) > groups) {
        console.log(`❌ [Rewrite] 捕获引用 \${${name}.${m[1]}} 越界（正则仅 ${groups} 个捕获组）: ${String(r.raw || '').slice(0, 70)}`);
        errs++;
      }
    }
  }

  // enable=${未声明参数} (官方: 参数未声明→当前 Script 无效; 审计问题4 官方转换器放行)
  for (const r of p.scriptRules) {
    if (r.legacy) continue; // 旧语法单独处理
    for (const m of String(r.raw || '').matchAll(/enable=\$\{([\w.-]+)\}/g)) {
      if (!(m[1] in (p.args || {}))) {
        console.log(`❌ [Script] with enable=\${${m[1]}} 引用未声明参数（官方: 当前 Script 无效）`);
        errs++;
      }
    }
  }

  // MITM 覆盖矩阵: 汇总所有带路径规则的域名 vs [Mitm] 列表
  if (flag('mitm-matrix')) {
    const { extractHosts } = require('./hosts');
    const hosts = new Map();
    const add = (h, src) => { if (!hosts.has(h)) hosts.set(h, []); hosts.get(h).push(src); };
    for (const r of p.scriptRules) for (const h of extractHosts(r.condition)) add(h, 'script');
    for (const r of p.rewriteRules) for (const h of extractHosts(r.condition || r.raw)) add(h, 'rewrite');
    if (hosts.size) {
      console.log('\n▸ MITM 覆盖矩阵');
      for (const [h, srcs] of hosts) {
        const covered = p.mitm.some(m => m === h || h.endsWith(m.replace(/^\*\./, '.')) || (m.startsWith('*.') && h.endsWith(m.slice(1))));
        console.log(`  ${covered ? '✅' : '❌ 未覆盖'} ${h}  ← ${[...new Set(srcs)].join('/')}`);
        if (!covered) warns++;
      }
    }
  }

  console.log(`\n结果: ${errs} 错误, ${warns} 警告  |  [Rule] ${p.rules.length} · [Script] ${p.scriptRules.length} · [Rewrite] ${p.rewriteRules.length} · [Mitm] ${p.mitm.length} · [Argument] ${Object.keys(p.args).length}`);
  return errs;
}

// ---------- helpers ----------
function buildArgument(r) {
  const out = {};
  const vals = {};
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--arg') {
      const kv = process.argv[i + 1] || '';
      const [k, ...rest] = kv.split('=');
      let v = rest.join('=');
      if (v === 'true') v = true; else if (v === 'false') v = false;
      else if (/^-?\d+$/.test(v)) v = Number(v);
      vals[k] = v;
    }
  }
  for (const k of (r.argumentKeys || [])) out[k] = (k in vals) ? vals[k] : (lpx.args[k]?.default ?? null);
  return out;
}

function loadAllowNet() {
  const i = process.argv.indexOf('--allow-net');
  if (i < 0) return null;
  const val = process.argv[i + 1];
  // v1.7.8：不带值时【显式报错】而不是静默降级为 simulated。
  // 旧行为让 `--allow-net`（当成布尔开关用）悄悄退回 mock 模式，
  // 表现为「明明加了 allow-net 却报 未开启 --allow-net」，极易误判成模拟器不支持真实网络。
  if (!val || val.startsWith('--')) {
    console.error('\n❌ --allow-net 需要一个域名列表（逗号分隔），例如：');
    console.error('     --allow-net api.example.com');
    console.error('     --allow-net api.example.com,cdn.example.com\n');
    process.exit(2);
  }
  return val.split(',').map(x => x.trim()).filter(Boolean);
}

function loadMocks() {
  const specs = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--mock') specs.push(process.argv[i + 1] || '');
  }
  if (!specs.length) return null;
  const mocks = {};
  for (const sp of specs) {
    if (sp.endsWith('.json') && fs.existsSync(sp)) {
      Object.assign(mocks, JSON.parse(fs.readFileSync(sp, 'utf8')));
    } else {
      const idx = sp.indexOf(':');
      if (idx > 0) {
        try { mocks[sp.slice(0, idx)] = JSON.parse(sp.slice(idx + 1)); } catch { /* 忽略非法 */ }
      }
    }
  }
  return mocks;
}

// ---------- trigger ----------
function cmdTrigger() {
  const kind = arg('_', 'cron'); // cron | network-changed | generic
  const rules = (lpx.scriptRules || []).filter(r => String(r.trigger || '').split(' ')[0] === kind);
  if (!rules.length) { console.log(`无 ${kind} 触发的脚本规则`); process.exit(3); }
  console.log(`找到 ${rules.length} 条 ${kind} 规则:`);
  let code = 0;
  let idx = -1;
  const start = Date.now();
  const nextRule = () => { idx++; if (idx < rules.length) runRule(rules[idx], idx); };
  function runRule(r, idx) {
    const sim = resolveSimPath(r.script || r.scriptPath);
    console.log(`\n▸ ${r.cronExpr || kind} → ${path.basename(sim)}`);
    if (!fs.existsSync(sim)) { console.log('  ❌ 本地找不到脚本'); code = 4; return nextRule(); }
    const rt = createRuntime({
      request: { url: '' }, argument: buildArgument(r),
      scriptName: path.basename(sim), debug: flag('verbose'),
      httpMocks: loadMocks(),
          allowNet: loadAllowNet(), storeFile: arg('persist') || null,
      timeout: Number(r.options?.timeout || arg('timeout', 20000)),
    });
    const res = rt.run(sim);
    const printResult = () => {
      (res.logs || []).forEach(l => console.log('  | ' + l));
      if (!res.ok) { console.log('  ❌ ' + res.error); code = 4; }
      else if (res.doneCalled && res.done && Object.keys(res.done).length) console.log('  $done → ' + JSON.stringify(res.done).slice(0, 200));
      else console.log('  ✓ 执行完成');
    };
    if (res.ok && !res.doneCalled) {
      // 异步脚本: 等待最多 timeout (官方语义: $done 前不释放)
      const wait = setInterval(() => {
        if (res.doneCalled || Date.now() - start > Number(r.options?.timeout || 30) * 1000) {
          clearInterval(wait); printResult();
          if (idx === rules.length - 1) process.exit(code); else nextRule();
        }
      }, 100);
    } else { printResult(); if (idx === rules.length - 1) process.exit(code); else nextRule(); }
    return;
  }
  nextRule(); // 启动 (异步脚本驱动; 完成时 process.exit)
}

// ---------- run ----------
function cmdRun() {
  const url = arg('url');
  if (!url) { console.error('需要 --url'); process.exit(1); }
  const phase = arg('phase', 'response');
  const status = Number(arg('status', 200));
  const rf = arg('response-file');
  let body = rf ? fs.readFileSync(rf, 'utf8') : null;

  const argOverrides = {};
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === '--arg') {
      const kv = process.argv[i + 1] || '';
      const [k, ...rest] = kv.split('=');
      let v = rest.join('=');
      if (v === 'true') v = true; else if (v === 'false') v = false;
      else if (/^-?\d+$/.test(v)) v = Number(v);
      argOverrides[k] = v;
    }
  }
  const argValues = {};
  for (const [k, d] of Object.entries(lpx.args)) argValues[k] = (k in argOverrides) ? argOverrides[k] : d.default;

  // MITM 判定
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  const mitmMatched = (lpx.mitm || []).find(h => {
    const p = h.replace(/^\*\./, '.');
    return h === host || host === h || host.endsWith(p) || (h.startsWith('*.') && host.endsWith(h.slice(1)));
  });
  const mitm = { inList: !!mitmMatched, matched: mitmMatched || '' };

  // 逐条追踪
  const { traceRewriteRules, traceScriptRules } = require('./trace');
  const { renderTrace } = require('./report');
  const rewrite = traceRewriteRules(lpx, url, phase, argValues, body);   // 根据 --phase 参数评估 (v1.6.6: 传 body 供 json.* Action)
  const blockedBy = rewrite.find(r => r.result === 'match' && r.terminating);
  const scriptRes = blockedBy ? { rules: [], effective: null } : traceScriptRules(lpx, url, phase, argValues);

  const hr = matchRule(lpx, url);

  let done = null, logs = [], argFormMismatch = null;
  const eff = scriptRes.effective;
  if (eff) {
    const sim = resolveSimPath(eff.script);
    if (!sim) {
      done = { error: '本地找不到脚本文件: ' + eff.script };
    } else {
      // ★ 双形态 $argument 检测：Loon 可能在真机上传对象，也可能传数组 [{...}]
      const formPref = arg('arg-form', 'both');   // object | array | both
      const forms = formPref === 'both' ? ['object', 'array'] : [formPref];
      const runs = {};
      for (const f of forms) {
        const rt = createRuntime({
          request: { url, method: 'GET' },
          response: { status, headers: {}, body },
          argument: f === 'array' ? [eff.argument] : eff.argument,
          scriptName: path.basename(sim),
          debug: flag('verbose'),
          httpMocks: loadMocks(),
          allowNet: loadAllowNet(),
          storeFile: arg('persist') || null,
          timeout: Number(arg('timeout', 20000)),
        });
        runs[f] = rt.run(sim);
      }
      const res = runs[forms[0]];
      logs = res.logs || [];
      // 两形态结果不一致 → 脚本不兼容
      if (forms.length === 2) {
        const norm = (r) => (r.ok && r.doneCalled && r.done && r.done.body)
          ? (typeof r.done.body === 'string' ? r.done.body : JSON.stringify(r.done.body))
          : (r.ok ? '' : 'ERR:' + r.error);
        const a = norm(runs.object), b = norm(runs.array);
        if (a !== b) {
          argFormMismatch = {
            object: a ? a.slice(0, 80) : '(未修改)',
            array: b ? b.slice(0, 80) : '(未修改)',
          };
        }
      }
      if (!res.ok) done = { error: res.error };
      else if (!res.doneCalled) done = { error: '$done 未被调用（Loon 将等待超时）' };
      else {
        const out = res.done.body;
        const outStr = typeof out === 'string' ? out : (out ? JSON.stringify(out) : '');
        if (!outStr || (body && outStr === body)) done = { unchanged: true };
        else {
          const fields = {};
          if (body) {
            fields['长度'] = { from: body.length + 'B', to: outStr.length + 'B' };
            const { diffFingerprint } = require('./trace');
            for (const d of diffFingerprint(body, outStr)) fields[d.key] = { from: String(d.from), to: String(d.to) };
          } else {
            fields['长度'] = { from: '—', to: outStr.length + 'B' };
          }
          done = { summary: body ? `body ${body.length}B → ${outStr.length}B` : `${outStr.length}B`, fields };
        }
        done.preview = outStr.slice(0, 200);
        if (flag('diff-full') && body) {
          done.fullDiff = fullDiff(body, outStr);
        }
      }
    }
  }

  const out = renderTrace({
    url, phase, status, argValues, rewrite, script: scriptRes, mitm, done, logs, ruleHit: hr,
    bodyBefore: body ? body.length : null,
    bodyAfter: (done && done.fields && done.fields['长度']) ? Number(String(done.fields['长度'].to).replace('B', '')) : null,
    argFormMismatch,
  });
  console.log(out);
  if (hr) console.log(`  ${'[Rule] 命中: ' + hr.raw}`);
  if (done && done.preview) console.log('  ' + '前 200 字符: ' + done.preview);
  if (done && done.fullDiff && done.fullDiff.length) {
    console.log('  ▸ 完整 diff (--diff-full)');
    for (const l of done.fullDiff) console.log('    ' + l);
  }
  console.log('');
  // 退出码: 0=命中且成功 / 3=无规则命中 / 4=脚本异常
  if (eff && done && done.error) process.exit(4);
  if (!eff && !blockedBy && !hr) process.exit(3);
}

/** 把插件里的远程脚本 URL 映射为本地文件 */
function resolveSimPath(scriptPath) {
  const name = scriptPath.split('/').pop().split('?')[0];
  const dir = path.dirname(lpxPath);              // plugins/<Name>/
  const cands = [
    path.join(dir, scriptPath),                   // 相对 lpx 的直接路径
    path.join(dir, 'src', name),                  // plugins/<Name>/src/x.js  ← 主用
    path.join(dir, name),                         // plugins/<Name>/x.js
    path.join(dir, 'upstream', name),
    path.join(dir, '..', '..', 'tools', 'loon-sim', 'vendor', name),
    global.__simVendor ? path.join(global.__simVendor, name) : null,
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;
}

// ---------- har ----------
function cmdHar() {
  let reportLines = flag('report') ? [] : null;
  const reportPath = arg('report');
  const harPath = process.argv[4];
  if (!harPath) { console.error('需要 HAR 路径'); process.exit(1); }
  const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
  const limit = Number(arg('limit', 0));
  const only = arg('only');
  const showAll = flag('all');
  let n = 0, matched = 0, changed = 0, blocked = 0;
  const entries = har.log.entries;
  for (const e of entries) {
    const url = e.request.url;
    if (only && !url.includes(only)) continue;
    if (limit && n >= limit) break;
    n++;
    const argValues = {};
    for (const [k, d] of Object.entries(lpx.args)) argValues[k] = d.default;
    const m = matchRequest(lpx, { url, phase: 'response', status: e.response.status, argValues, headers: {} });
    if (m.blocked) blocked++;
    if (!m.scriptRule) { if (showAll) console.log(`  —  ${url.slice(0, 100)}`); continue; }
    matched++;
    const sim = resolveSimPath(m.scriptRule.scriptPath);
    let before = e.response.content.text || '';
    try { if (e.response.content.encoding === 'base64') before = Buffer.from(before, 'base64').toString('utf8'); } catch {}
    const rt = createRuntime({ request: { url }, response: { status: e.response.status, body: before }, argument: m.argument, scriptName: 'sim' });
    const res = rt.run(sim);
    const out = res.done && res.done.body ? (typeof res.done.body === 'string' ? res.done.body : JSON.stringify(res.done.body)) : null;
    const isChanged = out && out !== before;
    if (isChanged) changed++;
    if (isChanged || showAll) {
      console.log(`  ${isChanged ? '✏️ ' : '  '} ${String(before.length).padStart(8)}B → ${String(out ? out.length : 0).padStart(8)}B  ${url.split('/gw/')[1]?.split('?')[0] || url.slice(0, 70)}`);
    }
    if (reportLines) reportLines.push({ url, before: before.length, after: out ? out.length : before.length, changed: isChanged, matched: true, script: m.scriptRule.scriptPath.split('/').pop() });
  }
  console.log(`\n扫描 ${n} 条请求: 命中 Script ${matched} · 实际改动 ${changed} · 被 Rewrite 终止 ${blocked}`);
  if (reportLines) {
    const md = ['# loon-sim HAR 回放报表', '',
      `插件: ${lpxPath} · 扫描 ${n} · 命中 ${matched} · 改动 ${changed} · 终止 ${blocked} · ${new Date().toISOString()}`, '',
      '| 接口 | 脚本 | 大小变化 | 改动 |', '|------|------|---------|------|'];
    for (const r of reportLines) {
      const api = r.url.split('/gw/')[1]?.split('?')[0] || r.url.slice(0, 60);
      md.push(`| ${api} | ${r.script} | ${r.before}B → ${r.after}B | ${r.changed ? '✏️' : '—'} |`);
    }
    fs.writeFileSync(reportPath, md.join('\n'));
    console.log(`✅ 报表已写出: ${reportPath}`);
  }
}

// ---------- rules ----------
function cmdRules() {
  const url = arg('url');
  if (url) {
    const argValues = {};
    for (const [k, d] of Object.entries(lpx.args)) argValues[k] = d.default;
    const m = matchRequest(lpx, { url, phase: 'response', status: 200, argValues, headers: {} });
    console.log(`URL: ${url}`);
    console.log(`  [Rule]    : ${matchRule(lpx, url)?.raw || '无'}`);
    console.log(`  [Rewrite] : ${m.notes.find(n => n.includes('Rewrite')) || '无'}`);
    console.log(`  [Script]  : ${m.scriptRule ? m.scriptRule.raw.slice(0, 110) : '无'}`);
    // 参数默认值
    if (m.argument) console.log(`  $argument : ${JSON.stringify(m.argument)}`);
    console.log('\n  [Argument] 默认值:');
    for (const [k, d] of Object.entries(lpx.args)) console.log(`    ${k.padEnd(24)} ${d.kind.padEnd(8)} = ${JSON.stringify(d.default)}`);
    return;
  }
  console.log('[Argument]');
  for (const [k, d] of Object.entries(lpx.args)) console.log(`  ${k.padEnd(24)} ${d.kind.padEnd(8)} = ${JSON.stringify(d.default)}`);
  console.log(`\n[Rule] ${lpx.rules.length} 条 · [Script] ${lpx.scriptRules.length} 条 · [Rewrite] ${lpx.rewriteRules.length} 条 · [Mitm] ${lpx.mitm.length}`);
}


/** --diff-full: 结构化 before/after 树状 diff (顶层 + 一层对象) */
function fullDiff(before, after) {
  let a, b;
  try { a = JSON.parse(before); b = JSON.parse(after); } catch { return null; }
  const lines = [];
  const keys = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])];
  for (const k of keys) {
    const va = a?.[k], vb = b?.[k];
    const sa = JSON.stringify(va), sb = JSON.stringify(vb);
    if (sa === sb) continue;
    if (va && vb && typeof va === 'object' && typeof vb === 'object' && !Array.isArray(va) && !Array.isArray(vb)) {
      lines.push(`◈ ${k}:`);
      const sub = [...new Set([...Object.keys(va), ...Object.keys(vb)])];
      for (const sk of sub) {
        const ssa = JSON.stringify(va[sk]), ssb = JSON.stringify(vb[sk]);
        if (ssa !== ssb) lines.push(`   ${sk}: ${shortVal(ssa)} → ${shortVal(ssb)}`);
      }
    } else {
      lines.push(`◇ ${k}: ${shortVal(sa)} → ${shortVal(sb)}`);
    }
  }
  return lines;
}
function shortVal(v) { v = String(v); return v.length > 60 ? v.slice(0, 57) + '…' : v; }

if (cmd === 'check') { const e = cmdCheck(); process.exit(e ? 2 : 0); }
else if (cmd === 'trigger') cmdTrigger();
else if (cmd === 'run' || cmd === 'trace') cmdRun();
else if (cmd === 'har') cmdHar();
else if (cmd === 'rules') cmdRules();
else if (cmd === 'convert') { require('./convert'); }
else if (cmd === 'init') { require('./init'); }
else { console.error('未知命令: ' + cmd); process.exit(1); }
