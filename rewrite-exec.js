'use strict';
/**
 * Rewrite v2 Action 执行器 — 按 docs/rewrite-v2.md 官方语义实现
 *
 * 支持: reject 系 / redirect / url.replace / header add|set|del|replace /
 *       body.replace / json add|delete|replace|jq / body.mock
 * Action 管道: a | b 从左到右, 单个失败跳过继续 (官方语义)
 */

/** 解析 action 串: name(arg1, arg2, ...) — 参数支持 "str" / `raw` / /re/flags / number / bool / null */
function parseAction(actionStr) {
  const m = /^([\w.]+)\s*\((.*)\)\s*$/.exec(actionStr.trim());
  if (!m) return { name: actionStr.trim(), args: [], error: '无法解析 Action' };
  const name = m[1];
  const rest = m[2];
  const args = [];
  let cur = '', depth = 0, q = null, re = false;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === '`' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '/' && !re && depth === 0 && /[(,\s]$/.test(cur)) { re = true; cur += ch; continue; }
    if (re) { cur += ch; if (ch === '/') re = false; continue; }
    if (ch === '(' || ch === '[') { depth++; cur += ch; continue; }
    if (ch === ')' || ch === ']') { depth--; cur += ch; continue; }
    if (ch === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) args.push(cur.trim());
  return { name, args };
}

/** 字面量求值: "str"(模板) / `raw` / /re/ / number / bool / null */
function evalArg(raw, vars) {
  const t = raw.trim();
  if (/^`.*`$/s.test(t)) return t.slice(1, -1);                       // 原始字符串
  if (/^".*"$/s.test(t)) {                                            // 双引号: ${} 模板
    let inner = t.slice(1, -1);
    inner = inner.replace(/\\(["nrt${\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t' }[c] || c));
    inner = inner.replace(/\$\{([\w.]+)\}/g, (_, k) => (vars && k in vars ? String(vars[k]) : `\${${k}}`));
    return inner;
  }
  if (/^\/.*\/[ims]*$/s.test(t)) {                                    // 正则字面量
    const lastSlash = t.lastIndexOf('/');
    return new RegExp(t.slice(1, lastSlash), t.slice(lastSlash + 1));
  }
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return t;                                                            // 裸串容忍
}

/** 生成 mock body 按内容类型 */
function mockBody(type, data) {
  if (/(png|gif|jpeg|tiff|svg|mp4)/.test(type)) return Buffer.from(String(data), 'base64');
  return String(data);
}

const MOCK_CT = {
  json: 'application/json', text: 'text/plain', 'text/event-stream': 'text/event-stream',
  css: 'text/css', html: 'text/html', javascript: 'application/javascript',
  plain: 'text/plain', png: 'image/png', gif: 'image/gif', jpeg: 'image/jpeg',
  tiff: 'image/tiff', svg: 'image/svg+xml', mp4: 'video/mp4', 'form-data': 'multipart/form-data',
};

/**
 * 执行一条 Rewrite (condition 已命中) 的 action 管道
 * @param {object} state {url, method, headers, status, respHeaders, body, done}
 * @param {string} actionPipe "a(...) | b(...)"
 * @param {object} vars ${} 变量 (含 as 捕获 ${item.1})
 * @returns {object} {state, terminated, actions: [{name, ok, error}]}
 */
function execRewrite(state, actionPipe, vars) {
  const parts = actionPipe.split('|').map(x => x.trim()).filter(Boolean);
  const log = [];
  let terminated = false;
  for (const part of parts) {
    const { name, args, error } = parseAction(part);
    if (error) { log.push({ name: part, ok: false, error }); continue; }
    const a = args.map(x => evalArg(x, vars));
    const r = apply(state, name, a);
    const isTerm = r === 'TERMINATED' || r === 'MOCKED';
    const soft = r === 'MOCKED';
    log.push({ name, ok: !r || isTerm, error: isTerm ? null : r });
    if (isTerm && !soft) { terminated = true; break; }
    if (isTerm && soft) { terminated = true; }  // response.body.mock: 视为响应已定, 但继续执行后续 header action
  }
  return { state, terminated, actions: log };
}

function apply(state, name, a) {
  try {
    // --- reject 系: 终止请求 (官方: 状态码必须是 100...599 范围内的整数) ---
    const validStatus = (n) => Number.isInteger(n) && n >= 100 && n <= 599;
    if (/^reject$/.test(name)) {
      if (!validStatus(a[0])) return `状态码 ${a[0]} 越界 (100-599)`;
      state.status = a[0]; if (a.length > 1 && typeof a[1] === 'string') { state.body = a[1]; } else state.body = '';
      state.respHeaders = {}; return 'TERMINATED';
    }
    if (/^reject_(dict|array|img|video)$/.test(name)) {
      if (!validStatus(a[0])) return `状态码 ${a[0]} 越界 (100-599)`;
      state.status = a[0];
      state.body = name === 'reject_dict' ? '{}' : name === 'reject_array' ? '[]' : name === 'reject_img' ? Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64') : '';
      state.respHeaders = name === 'reject_dict' || name === 'reject_array' ? { 'Content-Type': 'application/json' } : {};
      return 'TERMINATED';
    }
    // --- url.replace / redirect ---
    if (name === 'url.replace') { state.url = String(a[0]); return; }
    if (name === 'redirect') { state.status = a[0]; state.respHeaders = state.respHeaders || {}; state.respHeaders['Location'] = String(a[1]); state.body = ''; return 'TERMINATED'; }
    // --- header ---
    let m;
    if ((m = /^(request|response)\.header\.(add|set|del|replace)$/.exec(name))) {
      const H = m[1] === 'request' ? (state.headers = state.headers || {}) : (state.respHeaders = state.respHeaders || {});
      if (m[2] === 'del') { for (const k of [].concat(a[0])) delete H[k]; return; }
      if (m[2] === 'replace') {
        // 替换内容支持 $0-$n (Action 正则捕获, 官方语义) — JS 原生 replace 已支持 $1, 补 $0
        const re = a[1], rep = String(a[2]).replace(/\$0/g, '$&');
        H[String(a[0])] = String(H[String(a[0])] ?? '').replace(re, rep); return;
      }
      H[String(a[0])] = String(a[1]); return;  // add/set 同效
    }
    // --- body.replace ---
    if ((m = /^(request|response)\.body\.replace$/.exec(name))) {
      if (state.body == null) return 'body 为空';
      state.body = String(state.body).replace(a[0], String(a[1])); return;
    }
    // --- json ---
    if ((m = /^(request|response)\.json\.(add|delete|replace|jq)$/.exec(name))) {
      if (state.body == null) return 'body 为空';
      let obj; try { obj = JSON.parse(state.body); } catch { return 'body 非 JSON'; }
      const paths = [].concat(a[0]); // 批量数组支持
      for (const p of paths) jsonOp(obj, p, m[3], a[1]);
      state.body = JSON.stringify(obj);
      state.respHeaders = state.respHeaders || {}; return;
    }
    // --- body.mock ---
    if ((m = /^(request|response)\.body\.mock(_file)?$/.exec(name))) {
      const [type, data, status, b64] = a;
      state.body = b64 ? Buffer.from(String(data), 'base64') : mockBody(String(type), data);
      if (m[1] === 'response') {
        state.status = status ?? 200;
        state.respHeaders = { 'Content-Type': MOCK_CT[String(type)] || 'application/octet-stream' };
      }
      return m[1] === 'response' ? 'MOCKED' : undefined;  // MOCKED: 不中断管道 (官方: mock 后仍执行 header action), 但对 Script 视为终止
    }
    return `未知 Action: ${name}`;
  } catch (e) { return e.message; }
}

function jsonOp(obj, keyPath, op, val) {
  const segs = keyPath.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    const k = /^\d+$/.test(segs[i]) ? Number(segs[i]) : segs[i];
    if (cur[k] == null) cur[k] = /^\d+$/.test(segs[i + 1]) ? [] : {};
    cur = cur[k];
  }
  const last = segs[segs.length - 1];
  const lk = /^\d+$/.test(last) ? Number(last) : last;
  if (op === 'delete') delete cur[lk];
  else cur[lk] = val;
}

module.exports = { execRewrite, parseAction, evalArg };
