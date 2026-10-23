'use strict';
/**
 * .lpx 解析器 —— 按 Loon 的配置模型拆解插件
 * 参考官方文档: Plugin / Rule / Script(script_v2) / Rewrite(rewrite_v2)
 */

const fs = require('fs');

/** 解析 `#!key = value` 头部 */
function parseHeader(text) {
  const h = {};
  for (const line of text.split('\n')) {
    const m = /^#!\s*(\w+)\s*=\s*(.*)$/.exec(line.trim());
    if (m) h[m[1]] = m[2].trim();
  }
  return h;
}

/** 拆分为 { sectionName: [lines] }（段名不区分大小写，统一小写存储） */
function splitSections(text) {
  const out = {};
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const m = /^\s*\[([A-Za-z][\w\s-]*)\]\s*$/.exec(line);
    if (m) { cur = m[1].trim().toLowerCase(); out[cur] = out[cur] || []; continue; }
    if (cur && line.trim() && !line.trim().startsWith('#')) out[cur].push(line.trim());
  }
  return out;
}

/** 解析 [Argument]：`名 = 控件,默认值[,type=x][,tag=..][,desc=..]` */
function parseArguments(lines) {
  const args = {};
  for (const line of lines || []) {
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const rest = line.slice(eq + 1);
    const parts = splitTopLevel(rest, ',');
    const kind = (parts[0] || '').trim();
    let def = (parts[1] || '').trim();
    let type = null;
    for (const p of parts.slice(2)) {
      const t = p.trim();
      const m = /^type\s*=\s*(\w+)/i.exec(t);
      if (m) type = m[1].toLowerCase();
    }
    // 去引号
    if (/^".*"$/.test(def) || /^'.*'$/.test(def)) def = def.slice(1, -1);
    let value;
    if (kind === 'switch') {
      value = String(def).toLowerCase() === 'true';
      type = type || 'boolean';
    } else if (type === 'number') {
      value = def === '' ? null : Number(def);
    } else {
      value = def;
    }
    args[key] = { kind, type: type || 'string', default: value, raw: line };
  }
  return args;
}

/** 按顶层分隔符切分（不进入引号/正则/括号内部） */
function splitTopLevel(s, sep) {
  const out = []; let depth = 0, q = null, esc = false, cur = '';
  for (const ch of s) {
    if (esc) { cur += ch; esc = false; continue; }
    if (ch === '\\') { cur += ch; esc = true; continue; }
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { q = ch; cur += ch; continue; }
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    if (ch === ')' || ch === '}' || ch === ']') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * 解析 [Script] 规则（新语法）
 * `request|response if <cond> then script("path"[, {${a},${b}}]) with k=v, ...`
 */
function parseArgKeys(raw) {
  if (!raw) return [];
  let t = String(raw).trim();
  if (t.startsWith('[') && t.endsWith(']')) t = t.slice(1, -1);
  const out = [];
  let depth = 0, cur = '';
  for (const ch of t) {
    if (ch === '{') { depth++; if (depth === 1) cur = ''; continue; }
    if (ch === '}') { depth--; if (depth === 0) { out.push(cur); cur = ''; } continue; }
    if (depth > 0) cur += ch;
  }
  // {a,b,c} 单括号多 key / 或已分离的多个片段
  const keys = [];
  for (const seg of out) for (const k of seg.split(',')) keys.push(k);
  if (!out.length && t.trim()) { /* 无花括号：直接当 key */ for (const k of t.split(',')) keys.push(k); }
  return keys.map(k => String(k).replace(/^\s*\$?\{?/, '').replace(/\}?\s*$/, '').trim()).filter(Boolean);
}

function pushKV(obj, seg) {
  const i = seg.indexOf('=');
  if (i < 0) return;
  obj[seg.slice(0, i).trim()] = seg.slice(i + 1).trim();
}

function parseScriptRules(lines) {
  const rules = [];
  for (const line of lines || []) {
    // 支持全部触发类型: request/response if ... / cron "..." / network-changed / generic
    let m = /^(request|response)\s+if\s+(.+?)\s+then\s+script\s*\(\s*(?:"([^"]*)"|'([^']*)')\s*(?:,\s*(.+?)\s*)?\)\s*(?:with\s+(.+))?$/is.exec(line);
    let phase, cond, p1, p2, argRaw, withRaw;
    if (m) { [, phase, cond, p1, p2, argRaw, withRaw] = m; }
    else {
      m = /^(cron\s+"[^"]*"|network-changed|generic)\s+then\s+script\s*\(\s*(?:"([^"]*)"|'([^']*)')\s*(?:,\s*(.+?)\s*)?\)\s*(?:with\s+(.+))?$/is.exec(line);
      if (!m) {
      // ---- 旧版语法: http-request / http-response ^regex script-path=x, requires-body=true, argument={a, b} ----
      const lm = /^(http-request|http-response)\s+(\S+)\s+(.*)$/is.exec(line);
      if (lm) {
        const ph = lm[1] === 'http-request' ? 'request' : 'response';
        let rx = lm[2];
        // 旧语法用 ^ 表示 URL 匹配；正则本身不含 /.../  包裹
        const cond = `\${url} ~= /${rx}/i`;
        const rest = lm[3];
        const kv = {};
        // 按逗号切分（跳过 argument={...} 里的逗号）
        let depth = 0, cur = '';
        for (const ch of rest) {
          if (ch === '{') depth++;
          if (ch === '}') depth--;
          if (ch === ',' && depth === 0) { if (cur.trim()) pushKV(kv, cur.trim()); cur = ''; }
          else cur += ch;
        }
        if (cur.trim()) pushKV(kv, cur.trim());
        const argRaw = kv['argument'] || null;
        const keys = parseArgKeys(argRaw);
        const opts = {};
        for (const k of Object.keys(kv)) if (k !== 'script-path' && k !== 'argument') opts[k] = kv[k];
        rules.push({
          raw: line, phase: ph, trigger: null, condition: cond,
          scriptPath: kv['script-path'] || '',
          argumentKeys: keys, argumentLiteral: argRaw,
          options: opts, invalid: kv['script-path'] ? null : '缺少 script-path',
          legacy: true,
        });
        continue;
      }
      rules.push({ raw: line, invalid: 'unparsed', trigger: null, argumentKeys: [], options: {} });
      continue;
    }
      phase = 'other'; cond = m[1]; p1 = m[2]; p2 = m[3]; argRaw = m[4]; withRaw = m[5];
    }
    const rule = {
      raw: line, phase, trigger: null, condition: cond.trim(),
      scriptPath: p1 || p2,
      argumentKeys: [], argumentLiteral: null,
      options: {}, invalid: null,
    };
    // 第二参数：插件对象 {${a}, ${b}} 或字符串
    if (argRaw) {
      const a = argRaw.trim();
      const obj = /^\{(.*)\}$/s.exec(a);
      if (obj) {
        const keys = [];
        for (const part of splitTopLevel(obj[1], ',')) {
          const t = part.trim();
          const km = /^\$\{([\w-]+)\}$/.exec(t);
          if (!km) { rule.invalid = `对象参数非法成员: ${t}`; break; }
          keys.push(km[1]);
        }
        if (keys.length === 0) rule.invalid = '对象参数不能为空';
        rule.argumentKeys = keys;
      } else if (/^\$/.test(a)) {
        rule.invalid = '第二参数不能是运行变量';
      } else {
        rule.argumentLiteral = a.replace(/^["'`]|["'`]$/g, '');
      }
    }
    // with 选项
    if (withRaw) {
      for (const p of splitTopLevel(withRaw, ',')) {
        const km = /^\s*([\w-]+)\s*=\s*(.*?)\s*$/s.exec(p);
        if (km) rule.options[km[1]] = km[2];
      }
    }
    // 强制 URL Guard：条件中必须含 ${url}
    if (phase !== 'other' && !rule.condition.includes('${url}')) rule.invalid = '缺少强制 URL Guard (${url})';
    if (phase === 'other') rule.trigger = cond;
    rules.push(rule);
  }
  return rules;
}

/** 解析 [Rewrite] 规则（新语法），旧语法（`^re ... action`）保留原文 */
function parseRewriteRules(lines) {
  const out = [];
  for (const line of lines || []) {
    const m = /^(request|response)\s+if\s+(.+?)\s+then\s+(.+)$/is.exec(line);
    if (m) out.push({ raw: line, phase: m[1], condition: m[2].trim(), action: m[3].trim(), legacy: false });
    else out.push({ raw: line, phase: null, condition: null, action: line, legacy: true });
  }
  return out;
}

/** 解析 [Rule] */
function parseRules(lines) {
  const out = [];
  for (const line of lines || []) {
    const parts = splitTopLevel(line, ',');
    const type = (parts[0] || '').trim();
    const value = (parts[1] || '').trim();
    const policy = (parts[2] || '').trim();
    const extra = parts.slice(3).map(s => s.trim()).filter(Boolean);
    out.push({ raw: line, type, value, policy, extra });
  }
  return out;
}

/** 解析 [Mitm] hostname */
function parseMitm(lines) {
  const hosts = [];
  for (const line of lines || []) {
    const m = /^hostname\s*=\s*(.*)$/i.exec(line);
    if (!m) continue;
    for (let h of m[1].split(',')) {
      h = h.trim().replace(/^%APPEND%\s*/i, '');
      if (h) hosts.push(h.toLowerCase());
    }
  }
  return hosts;
}

function parseLpx(path) {
  const text = fs.readFileSync(path, 'utf8');
  const sec = splitSections(text);
  return {
    path,
    header: parseHeader(text),
    sections: Object.keys(sec),
    args: parseArguments(sec['argument']),
    scriptRules: parseScriptRules(sec['script']),
    rewriteRules: parseRewriteRules(sec['rewrite']),
    rules: parseRules(sec['rule']),
    mitm: parseMitm(sec['mitm']),
    raw: { argument: sec['argument'] || [], script: sec['script'] || [], rewrite: sec['rewrite'] || [], rule: sec['rule'] || [] },
  };
}

module.exports = { parseLpx, parseArguments, parseScriptRules, parseRewriteRules, parseRules, parseMitm, splitTopLevel, splitSections };
