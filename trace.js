'use strict';
/**
 * Loon 式详细反馈 —— 逐条规则的决策追踪
 *
 * 目标: 让插件开发者一眼看出
 *   · 每条规则是否被评估、是否命中
 *   · 未命中时给出【原因】(域名不匹配/路径不匹配/开关关闭/被前一条抢占)
 *   · $argument 实际传入了什么
 *   · 最终 $done 改了什么
 *
 * 用法（由 cli.js trace 子命令调用）:
 *   tracePlugin(lpx, { url, phase, status, requestBody, responseBody, argOverrides })
 */

const { matchRule } = require('./matcher');
const { isRelevant } = require('./relevance');
const { createLoonRuntime } = require('./runtime');

// ---- 条件求值（供 trace 展示每条条件的结果）----
function evalCondSafe(cond, vars) {
  try {
    const { evalCondition } = require('./matcher');
    return evalCondition(cond, vars);
  } catch (e) {
    return { __err: e.message };
  }
}

// ---- 逐条 Rewrite 规则的判定 ----
function traceRewriteRules(lpx, url, phase, argValues) {
  const out = [];
  for (const r of lpx.rewriteRules || []) {
    const rec = { raw: r.raw, phase: r.phase, cond: r.condition, action: r.action };
    rec.relevant = isRelevant(r.condition, url);
    // 阶段不符
    if (r.phase !== phase) { rec.result = 'skip'; rec.reason = `阶段不符（规则=${r.phase}，当前=${phase}）`; out.push(rec); continue; }
    // 条件求值
    const v = evalCondSafe(r.condition, { url });
    if (v === true) { rec.result = 'match'; }
    else { rec.result = 'no'; rec.reason = '条件不成立'; }
    // 动作类型
    rec.terminating = /reject/i.test(r.action || '');
    out.push(rec);
    if (v === true && rec.terminating) {
      rec.note = '★ 终止类动作 → 不发起请求；Request/Response Script 均不执行';
      break; // 官方语义：第一条命中即终止
    }
  }
  return out;
}

// ---- 逐条 Script 规则的判定 ----
function traceScriptRules(lpx, url, phase, argValues) {
  const out = [];
  const first = [];
  for (const r of lpx.scriptRules || []) {
    const rec = { raw: r.raw, phase: r.phase, cond: r.condition, script: r.scriptPath };
    rec.relevant = isRelevant(r.condition, url);
    if (r.phase === 'other') { rec.result = 'skip'; rec.reason = `触发类型=${r.trigger}（非 HTTP）`; out.push(rec); continue; }
    if (r.phase !== phase) { rec.result = 'skip'; rec.reason = `阶段不符（规则=${r.phase}，当前=${phase}）`; out.push(rec); continue; }
    const v = evalCondSafe(r.condition, { url });
    if (v !== true) { rec.result = 'no'; rec.reason = 'URL Guard / 条件不成立'; out.push(rec); continue; }
    // 命中 → 检查 with enable
    const en = r.options && r.options.enable;
    rec.result = 'match';
    if (en) {
      const m = /\$\{(\w+)\}/.exec(en) || /(\w+)/.exec(en);
      const key = m ? m[1] : null;
      const val = key ? argValues[key] : undefined;
      rec.enable = { expr: en, key, value: val };
      if (val === false) { rec.result = 'blocked'; rec.reason = `with enable=${en} → ${key} = false → 规则不生效`; }
    }
    // $argument 展开
    rec.argument = {};
    for (const k of r.argumentKeys || []) rec.argument[k] = argValues[k];
    out.push(rec);
    if (rec.result === 'match') {
      first.push(rec);
      break; // 第一条命中规则生效
    }
  }
  return { rules: out, effective: first[0] || null };
}

// ---- body 指纹（用于展示"改了什么"而无需打印全文）----
function fingerprint(body) {
  if (typeof body !== 'string') return null;
  const fp = { '长度': body.length + 'B' };
  try {
    const d = JSON.parse(body);
    // 只统计【顶层区块规模】，不列出每个子键（避免噪音）
    for (const k of ['sc', 'ac', 'data', 'dataList', 'resources', 'caches', 'result']) {
      const v = d[k];
      if (Array.isArray(v)) fp[`${k}[]`] = v.length + ' 项';
      else if (v && typeof v === 'object') fp[`${k}{}`] = Object.keys(v).length + ' 键';
    }
    if (d.data && typeof d.data === 'object' && !Array.isArray(d.data)) {
      for (const k of ['duration', 'dataList', 'result', 'tabs', 'keywords', 'hotwords', 'result']) {
        const v = d.data[k];
        if (Array.isArray(v)) fp[`data.${k}[]`] = v.length + ' 项';
        else if (v !== undefined && typeof v !== 'object') fp[`data.${k}`] = String(v).slice(0, 24);
        else if (v && typeof v === 'object') fp[`data.${k}{}`] = Object.keys(v).length + ' 键';
      }
    }
  } catch (e) { /* 非 JSON：只给长度 */ }
  // 通用特征
  const feats = [
    ['cdnId 清零', /"cdnId":"0{32}"/g],
    ['reject 空对象', /^\{\}$/],
  ];
  for (const [name, re] of feats) {
    const n = (body.match(re) || []).length;
    if (n) fp[name] = n + ' 处';
  }
  for (const kw of ['__TANX', 'adType', 'mst_roll', 'hotwords']) {
    const n = (body.match(new RegExp(kw, 'g')) || []).length;
    if (n) fp[kw] = n + ' 处';
  }
  return fp;
}

/** 比较两个 body 的指纹，返回差异列表 */
function diffFingerprint(before, after) {
  const a = fingerprint(before) || {}, b = fingerprint(after) || {};
  const out = [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (k === '长度') continue;
    if (a[k] !== b[k]) out.push({ key: k, from: a[k] ?? '—', to: b[k] ?? '—' });
  }
  return out;
}

module.exports = { traceRewriteRules, traceScriptRules, evalCondSafe, fingerprint, diffFingerprint };
