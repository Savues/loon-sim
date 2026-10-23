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
    // 条件求值 (as 捕获写入 vars)
    const vars = { url };
    const v = evalCondSafe(r.condition, vars);
    if (v === true) { rec.result = 'match'; }
    else { rec.result = 'no'; rec.reason = '条件不成立'; }
    // 真实执行 Action (rewrite-exec): 同阶段所有命中的规则都执行 (官方语义)
    if (v === true && r.action) {
      try {
        const { execRewrite } = require('./rewrite-exec');
        const st = r.sharedState || (r.sharedState = { url, headers: {}, respHeaders: {}, status: 200, body: null });
        const exec = execRewrite(st, r.action, vars);
        rec.exec = exec.actions.map(a => ({ name: a.name, ok: a.ok, error: a.error }));
        rec.terminated = exec.terminated;
      } catch (e) { rec.exec = [{ name: r.action, ok: false, error: e.message }]; }
    }
    // 动作类型
    rec.terminating = /reject|redirect|mock/i.test(r.action || '') || rec.terminated;
    out.push(rec);
    if (v === true && rec.terminating) {
      rec.note = '★ 终止类动作 → 不发起请求；Request/Response Script 均不执行';
      break;
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
/**
 * body 结构指纹 —— 完全通用, 不依赖任何领域词汇
 *
 * 思路: 把 JSON body 的「结构形状」抽出来(数组长度 / 对象键数),
 * 脚本执行前后各取一次, 按变化幅度排序输出。
 * 这样任何插件、任何接口都用同一套机制看到"脚本到底改了什么",
 * 无需为特定 App 维护关键词表。
 *
 * 需要观察特定字段出现次数时, 用 --watch <词1,词2> 显式传入(默认无)。
 */

const MAX_DEPTH = 6;
const MAX_REPORT = 12;

/** 递归收集结构形状 */
function collectShape(node, path, out, depth) {
  // 只收集「顶层 + 一层对象」的结构规模。
  // 再深的结构(如 sc 内每个 key 下的数组)在脚本清理时通常只是"父级键数归零"的后果,
  // 若全递归会输出海量噪音, 掩盖真正的问题。
  if (depth > 1) return;
  if (Array.isArray(node)) {
    out.push({ path: path + '[]', size: node.length });
    return;
  }
  if (node && typeof node === 'object') {
    out.push({ path: path + '{}', size: Object.keys(node).length });
    if (depth < 1) {
      for (const k of Object.keys(node)) {
        const v = node[k];
        if (v && typeof v === 'object') collectShape(v, path + '.' + k, out, depth + 1);
      }
    }
  }
}

/** 结构形状 → Map */
function shapeMap(body) {
  try {
    const d = JSON.parse(body);
    const arr = [];
    collectShape(d, '', arr, 0);
    const m = new Map();
    for (const it of arr) if (!m.has(it.path)) m.set(it.path, it.size);
    return m;
  } catch (e) {
    return null;
  }
}

/** 通用指纹: 长度 + 结构规模 + 可选 watch 词频 */
function fingerprint(body, opts) {
  if (typeof body !== 'string') return null;
  const fp = { '长度': body.length + 'B' };
  const shape = shapeMap(body);
  if (shape) {
    for (const [k, v] of shape) fp['shape' + k] = v;
  } else {
    fp['(非 JSON)'] = '-';
  }
  const watch = (opts && opts.watch) || [];
  for (const w of watch) {
    if (!w) continue;
    const n = body.split(w).length - 1;
    fp['watch:' + w] = n + ' 处';
  }
  return fp;
}

/** 比较两个 body 的指纹, 返回【按变化幅度排序】的差异(最多 MAX_REPORT 条) */
function diffFingerprint(before, after, opts) {
  const a = fingerprint(before, opts) || {};
  const b = fingerprint(after, opts) || {};
  const items = [];
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (k === '长度') continue;
    const av = a[k], bv = b[k];
    if (av === bv) continue;
    let weight;
    if (k.startsWith('shape') && typeof av === 'number' && typeof bv === 'number') {
      weight = Math.abs(av - bv);
    } else if (k.startsWith('watch:')) {
      weight = 1000;
    } else {
      weight = 500;
    }
    const label = k.replace(/^shape/, '').replace(/^\./, '') || '(根)';
    items.push({ key: label, from: av === undefined ? '-' : av, to: bv === undefined ? '-' : bv, weight });
  }
  items.sort((x, y) => y.weight - x.weight);

  // ★ 祖先去重: 若父级路径已被选中, 其子级变化只是父级变化的后果 → 跳过
  const norm = p => p.replace(/\{\}$/, '').replace(/\[\]$/, '');
  const isDesc = (child, parent) => {
    const c = norm(child), p = norm(parent);
    return c !== p && (c.startsWith(p + '.') || c.startsWith(p + '['));
  };
  const sel = [];
  for (const it of items) {
    if (sel.some(s => isDesc(it.key, s.key))) continue;
    sel.push(it);
    if (sel.length >= MAX_REPORT) break;
  }
  return sel;
}

module.exports = { traceRewriteRules, traceScriptRules, evalCondSafe, fingerprint, diffFingerprint, shapeMap };
