'use strict';
/**
 * Loon 运行时模拟（Node 版）
 * 目标：忠实复现 Loon Script 的全局对象与 $done 语义，让 bundle.js 能本地跑起来。
 *
 * 官方依据（script_api / script_v2）：
 *   $request / $response / $argument / $done / $notify / $httpClient /
 *   $persistentStore / $prefs / $environment / $utils / $script / $loon
 */

const vm = require('vm');
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

/**
 * @param {object} o
 * @param {object} o.request  {url, method, headers, body}
 * @param {object} o.response {status, headers, body}
 * @param {*}      o.argument  $argument（Object / String / null）
 * @param {string} o.scriptName
 * @param {object} o.store     持久存储（读写用）
 * @param {boolean} o.debug
 */
function createRuntime(o = {}) {
  const logs = [];
  let done = null;
  let doneCalled = false;

  const request = {
    url: o.request?.url || '',
    method: (o.request?.method || 'GET').toUpperCase(),
    headers: o.request?.headers || {},
    body: o.request?.body,
  };

  const respBody = o.response?.body;
  const response = {
    status: o.response?.status ?? 200,
    headers: o.response?.headers || {},
    body: respBody,
    get bodyBytes() { return toBytes(respBody); },
    set bodyBytes(v) { /* 只读场景下忽略，脚本一般不写 */ },
  };

  const store = o.store || {};
  const storeApi = {
    read: (k) => (k in store ? store[k] : null),
    write: (v, k) => { store[k] = v; return true; },
    remove: (k) => { delete store[k]; return true; },
  };
  const prefsApi = {
    valueForKey: (k) => (k in store ? store[k] : null),
    setValueForKey: (v, k) => { store[k] = v; return true; },
    removeValueForKey: (k) => { delete store[k]; return true; },
  };

  const sandbox = {
    console: {
      log: (...a) => { const s = a.map(stringify).join(' '); logs.push(s); if (o.debug) process.stderr.write(s + '\n'); },
      error: (...a) => { const s = a.map(stringify).join(' '); logs.push(s); if (o.debug) process.stderr.write(s + '\n'); },
      warn: (...a) => { const s = a.map(stringify).join(' '); logs.push(s); if (o.debug) process.stderr.write(s + '\n'); },
    },
    $request: request,
    $response: response,
    $argument: o.argument === undefined ? null : o.argument,
    $done: (v) => { doneCalled = true; done = normalizeDone(v); },
    $notify: (...a) => { logs.push('[notify] ' + a.map(stringify).join(' | ')); },
    $notification: { post: (...a) => { logs.push('[notification] ' + a.map(stringify).join(' | ')); } },
    $persistentStore: storeApi,
    $prefs: prefsApi,
    $environment: Object.assign({
      'loon-version': 'Loon 3.5.1 (983)',
      'device-model': 'iPhone',
      'system-version': 'iOS 18.0',
      'language': 'zh-Hans',
    }, o.environment || {}),
    $loon: 'Loon 3.5.1 (983)',
    $script: { name: o.scriptName || 'sim', startTime: Date.now() / 1000, type: 'response' },
    $utils: {
      ungzip: (b) => { try { return zlib.gunzipSync(toBuffer(b)); } catch (e) { try { return zlib.inflateSync(toBuffer(b)); } catch (e2) { return b; } } },
      gzip: (b) => zlib.gzipSync(toBuffer(b)),
      geohistoricaldata: () => ({}),
    },
    $httpClient: {
      get: (a, cb) => httpReq('GET', a, cb, logs),
      post: (a, cb) => httpReq('POST', a, cb, logs),
      put: (a, cb) => httpReq('PUT', a, cb, logs),
      delete: (a, cb) => httpReq('DELETE', a, cb, logs),
    },
    setTimeout,
    setInterval,
    clearTimeout,
    clearInterval,
    Buffer,
    TextDecoder,
    TextEncoder,
    URL,
    URLSearchParams,
    Date, Math, JSON, RegExp, Promise, Array, Object, String, Number, Boolean, Error, Map, Set,
  };
  sandbox.globalThis = sandbox;

  return {
    sandbox,
    run(scriptPath) {
      const code = fs.readFileSync(scriptPath, 'utf8');
      const ctx = vm.createContext(sandbox);
      try {
        // Loon 把脚本包在函数作用域内执行（故允许顶层 return）
        const wrapped = '(function () {\n' + code + '\n})();';
        vm.runInContext(wrapped, ctx, { filename: scriptPath, timeout: 20000 });
      } catch (e) {
        return { ok: false, error: e.message, logs, done, doneCalled };
      }
      return { ok: true, logs, done, doneCalled };
    },
  };
}

function normalizeDone(v) {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object') return v;
  if (Buffer.isBuffer(v) || v instanceof Uint8Array) return v;
  // 把 vm 跨 realm 的对象转成主 realm 的普通对象，便于比较与序列化
  const out = {};
  for (const k of Object.keys(v)) out[k] = v[k];
  return out;
}

function httpReq(method, args, cb, logs) {
  // 本地模拟：不真的发请求，避免副作用；返回空响应
  logs.push(`[httpClient] ${method} ${typeof args === 'string' ? args : args?.url || ''} (simulated, not sent)`);
  if (typeof cb === 'function') setImmediate(() => cb(null, { status: 200, headers: {}, body: '' }, ''));
}

function toBuffer(b) {
  if (!b) return Buffer.alloc(0);
  if (Buffer.isBuffer(b)) return b;
  if (b instanceof Uint8Array) return Buffer.from(b);
  if (typeof b === 'string') return Buffer.from(b, 'binary');
  return Buffer.from(String(b));
}
function toBytes(b) {
  if (b == null) return null;
  const buf = toBuffer(b);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}
function stringify(v) {
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v); } catch { return String(v); }
}

module.exports = { createRuntime, toBuffer };
