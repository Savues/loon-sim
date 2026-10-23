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
const { parseLpx } = require('./lpx');
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
  node cli.js run     <plugin.lpx> --url URL [--response-file F] [--status 200] [--phase response] [--arg k=v]
  node cli.js har     <plugin.lpx> <file.har> [--limit N] [--only substr]
  node cli.js rules   <plugin.lpx> [--url URL]`);
  process.exit(1);
}
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

  // 4) [Script] with 字段白名单（官方 7 个）
  const WITH_FIELDS = new Set(['enable', 'tag', 'img_url', 'timeout', 'debug', 'requires_body', 'binary_body_mode']);
  for (const r of p.scriptRules) {
    if (r.invalid && r.invalid !== 'unparsed') { console.log(`❌ [Script] ${r.invalid}: ${r.raw.slice(0, 70)}`); errs++; }
    // 旧语法(script-path / requires-body / argument=[{...}])字段名与新语法不同 → 单独校验
    if (r.legacy) {
      if (!r.scriptPath) { console.log(`❌ [Script-旧语法] 缺 script-path`); errs++; }
      for (const k of (r.argumentKeys || [])) if (!(k in p.args)) { console.log(`❌ [Script-旧语法] 引用未声明参数 \${${k}}`); errs++; }
      continue;
    }
    for (const k of Object.keys(r.options || {})) {
      if (!WITH_FIELDS.has(k)) { console.log(`❌ [Script] with 未知字段 "${k}"（官方：未知字段会使当前规则无效）: ${r.raw.slice(0, 60)}`); errs++; }
    }
    if (r.phase === 'response' && !r.condition.includes('${url}')) { console.log(`❌ Response Script 缺强制 URL Guard`); errs++; }
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

  console.log(`\n结果: ${errs} 错误, ${warns} 警告  |  [Rule] ${p.rules.length} · [Script] ${p.scriptRules.length} · [Rewrite] ${p.rewriteRules.length} · [Mitm] ${p.mitm.length} · [Argument] ${Object.keys(p.args).length}`);
  return errs;
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
  const rewrite = traceRewriteRules(lpx, url, 'request', argValues);   // 请求侧先评估
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
  console.log('');
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
  }
  console.log(`\n扫描 ${n} 条请求: 命中 Script ${matched} · 实际改动 ${changed} · 被 Rewrite 终止 ${blocked}`);
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

if (cmd === 'check') process.exit(cmdCheck() ? 1 : 0);
else if (cmd === 'run' || cmd === 'trace') cmdRun();
else if (cmd === 'har') cmdHar();
else if (cmd === 'rules') cmdRules();
else { console.error('未知命令: ' + cmd); process.exit(1); }
