'use strict';
/**
 * 规则匹配器 —— 复现 Loon 的匹配语义
 * 官方依据：
 *   · Response Script 必须有强制 URL Guard (${url})
 *   · Request / Response 分别最多选一条，按配置顺序取第一条完整命中
 *   · Request 阶段产生终止响应时，Request/Response Script 均不执行
 *   · Response Body Rewrite 命中时，Response Script 不执行
 */

/** 条件求值：支持 ${url} / ${request.method} / ${response.status} / ${arg}、~= 、==、&&、||、() */
function evalCondition(cond, vars) {
  const orParts = splitAtTop(cond, '||');
  if (orParts.length > 1) return orParts.some(p => evalCondition(p, vars));
  const andParts = splitAtTop(cond, '&&');
  if (andParts.length > 1) return andParts.every(p => evalCondition(p, vars));
  let s = cond.trim();
  if (s.startsWith('(') && s.endsWith(')')) {
    // 去掉最外层括号后必须【递归求值】（否则内部的 && / || 不会被处理）
    const inner = s.slice(1, -1).trim();
    if (balanced(inner)) return evalCondition(inner, vars);
  }

  // A ~= /re/flags [as name] — 命中后捕获组写入 vars (官方: ${name.0}/\${name.n})
  let m = /^(.*?)\s*~=\s*(\/.+?\/[a-z]*)(?:\s+as\s+(\w+))?\s*$/is.exec(s);
  if (m) {
    const left = resolveValue(m[1].trim(), vars);
    const re = parseRegex(m[2].trim());
    if (left == null || !re) return false;
    const hit = re.exec(String(left));
    if (!hit) return false;
    if (m[3]) { for (let i = 0; i < hit.length; i++) vars[m[3] + '.' + i] = hit[i]; }
    return true;
  }
  // A == B
  m = /^(.*?)\s*==\s*(.*)$/s.exec(s);
  if (m) {
    const a = resolveValue(m[1].trim(), vars);
    const b = resolveValue(m[2].trim(), vars);
    return looseEqual(a, b);
  }
  // 单值真假（如 ${enabled}）
  const v = resolveValue(s, vars);
  return v === true || v === 'true';
}

function balanced(s) {
  let d = 0;
  for (const ch of s) { if (ch === '(') d++; else if (ch === ')') { d--; if (d < 0) return false; } }
  return d === 0;
}

function splitAtTop(s, op) {
  const out = []; let depth = 0, q = null, esc = false, cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (esc) { cur += ch; esc = false; continue; }
    if (ch === '\\') { cur += ch; esc = true; continue; }
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; cur += ch; continue; }
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    if (ch === ')' || ch === '}' || ch === ']') depth--;
    if (depth === 0 && s.startsWith(op, i)) { out.push(cur); cur = ''; i += op.length - 1; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function resolveValue(t, vars) {
  t = t.trim();
  let m = /^\$\{([^}]+)\}$/.exec(t);
  if (m) {
    const key = m[1];
    if (key in vars) return vars[key];
    return undefined;
  }
  // 模板字符串 "Bearer ${token}" / `x`
  if (/^["'`]/.test(t)) {
    const inner = t.slice(1, -1);
    return inner.replace(/\$\{([\w.-]+)\}/g, (_, k) => (k in vars ? String(vars[k]) : '')).replace(/\\(.)/g, '$1');
  }
  if (t === 'null') return null;
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;
}

function looseEqual(a, b) {
  // 官方 rewrite-v2/script-v2: == 是「类型一致的精确比较」
  // null 只等于 null; number/string/boolean 跨类型一律不等
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  return false;
}

function parseRegex(t) {
  const m = /^\/(.*)\/([a-z]*)$/s.exec(t);
  if (!m) return null;
  try { return new RegExp(m[1], m[2] || ''); } catch { return null; }
}

/** 提取正则源（用于模拟 Rewrite 的 URL 匹配） */
function extractGuardRegex(cond) {
  const m = /\$\{url\}\s*~=\s*(\/.+?\/[a-z]*)/is.exec(cond);
  return m ? parseRegex(m[1]) : null;
}

/** 判定 Rewrite 动作是否为「终止响应类」 */
function isTerminalAction(action) {
  return /(^|\|\s*)(reject(_dict|_array|_img|_video)?\s*\(|reject\b|reject-(200|dict|array|img|video)\b|redirect\s*\(|302|307)/i.test(action);
}
/** 是否修改响应体 */
function modifiesResponseBody(action) {
  return /response\.(body|json)\.|response-body/i.test(action);
}

/** 构造 $argument（严格按官方三态） */
function buildArgument(rule, argDefs, overrides) {
  if (rule.argumentKeys && rule.argumentKeys.length) {
    const obj = {};
    for (const k of rule.argumentKeys) {
      if (overrides && k in overrides) { obj[k] = overrides[k]; continue; }
      const d = argDefs[k];
      obj[k] = d ? d.default : undefined;
    }
    return obj;
  }
  if (rule.argumentLiteral != null) return rule.argumentLiteral;
  return null;
}

/**
 * 主匹配流程
 * @returns {{scriptRule, argument, blocked, notes[]}}
 */
function matchRequest(lpx, ctx) {
  const notes = [];
  const vars = {
    url: ctx.url,
    'request.method': ctx.method || 'GET',
    'request.header': ctx.headers || {},
    'response.status': ctx.status,
    'response.header': ctx.responseHeaders || {},
  };
  for (const [k, v] of Object.entries(ctx.argValues || {})) vars[k] = v;

  // 1) [Rewrite] 判定 —— 先 request 阶段（会终止整个请求），再 response 阶段
  let terminal = false, respBodyRewrite = false;
  for (const phase of ['request', 'response']) {
    for (const r of lpx.rewriteRules) {
      if (!r.condition || r.phase !== phase) continue;
      if (!evalCondition(r.condition, vars)) continue;
      if (isTerminalAction(r.action)) {
        terminal = true;
        notes.push(`[Rewrite/${phase}] 命中(终止类): ${r.action.slice(0, 70)}`);
        break;
      }
      if (phase === 'response' && modifiesResponseBody(r.action)) {
        respBodyRewrite = true;
        notes.push(`[Rewrite/response] 命中(改响应体): ${r.action.slice(0, 70)}`);
        break;
      }
    }
    if (terminal) break;
  }
  if (terminal) notes.push('[Rewrite] 产生终止响应 → Request/Response Script 均不执行（官方语义）');

  // 2) [Script] 第一条命中（按配置顺序）
  let scriptRule = null;
  if (!terminal) {
    for (const r of lpx.scriptRules) {
      if (r.invalid) continue;
      if (r.phase !== ctx.phase) continue;
      if (!evalCondition(r.condition, vars)) continue;
      if (respBodyRewrite) { notes.push('[Rewrite] 已改响应体 → Response Script 不执行'); break; }
      scriptRule = r; break;
    }
  }
  const argument = scriptRule ? buildArgument(scriptRule, lpx.args, ctx.argOverrides) : null;
  return { scriptRule, argument, blocked: terminal, notes };
}

/** Glob 通配匹配 (官方 domain_rule: * 跨点, ? 恰一字符, [...] 集合, 大小写不敏感) */
function wildcardMatch(pat, host) {
  const p = pat.toLowerCase(), h = host.toLowerCase();
  // 转成正则: * → [^.]* 不对 — 官方 * 可跨点 → .* ; ? → . ; [...] 保留
  let rx = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') rx += '.*';
    else if (c === '?') rx += '.';
    else if (c === '[') {
      const end = p.indexOf(']', i);
      if (end < 0) { rx += '\\['; continue; }
      let cls = p.slice(i + 1, end).replace(/[!^]/, '^');
      rx += '[' + cls + ']';
      i = end;
    }
    else rx += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return new RegExp('^' + rx + '$').test(h);
}

/** [Rule] 域名匹配（DOMAIN / DOMAIN-SUFFIX / DOMAIN-KEYWORD / DOMAIN-WILDCARD） */
function matchRule(lpx, url) {
  let host = '';
  try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  for (const r of lpx.rules) {
    const v = (r.value || '').toLowerCase().replace(/^\*\./, '');
    if (!v) continue;
    if (r.type === 'DOMAIN' && host === v) return r;
    if (r.type === 'DOMAIN-SUFFIX' && (host === v || host.endsWith('.' + v))) return r;
    if (r.type === 'DOMAIN-KEYWORD' && host.includes(v)) return r;
    if (r.type === 'DOMAIN-WILDCARD' && wildcardMatch(v, host)) return r;
  }
  return null;
}

module.exports = { wildcardMatch, evalCondition, balanced, matchRequest, matchRule, buildArgument, parseRegex, extractGuardRegex, splitAtTop };
