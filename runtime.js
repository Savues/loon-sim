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
const crypto = require('crypto');
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
  const $scriptStartTime = Date.now();
  let done = null;
  let doneCalled = false;
  // v1.7.9：异步支持。$done 由回调触发时，runAsync() 需要能等到它。
  let httpCalls = 0;                       // $httpClient 调用次数（决定是否值得等）
  let timerCalls = 0;                      // setTimeout 调用次数（脚本可能靠它延后 $done）
  let doneResolve = null;
  const donePromise = new Promise((res) => { doneResolve = res; });

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

  let store = o.store || {};
  const storeFile = o.storeFile || null;
  if (storeFile && fs.existsSync(storeFile)) {
    try { store = JSON.parse(fs.readFileSync(storeFile, 'utf8')); } catch { /* 损坏则重置 */ }
  }
  const saveStore = () => { if (storeFile) { try { fs.writeFileSync(storeFile, JSON.stringify(store, null, 1)); } catch { /* 忽略写失败 */ } } };
  // 官方 script-api: 存储值以字符串形式保存; 省略 Key 用 $script.name; remove() 无参=清空全部
  const storeKey = (k) => (k === undefined ? (o.scriptName || 'sim') : k);
  const storeApi = {
    read: (k) => { const key = storeKey(k); return key in store ? store[key] : null; },
    write: (v, k) => { store[storeKey(k)] = String(v); saveStore(); return true; },
    remove: (k) => {
      if (k === undefined) { for (const key of Object.keys(store)) delete store[key]; }
      else delete store[k];
      saveStore(); return true;
    },
  };
  const prefsApi = {
    valueForKey: (k) => storeApi.read(k),
    setValueForKey: (v, k) => storeApi.write(v, k),
    removeValueForKey: (k) => storeApi.remove(k),
  };

  // httpClient mock: { 'url子串或正则': {status, headers, body} } 命中即返回
  const httpMocks = o.httpMocks || null;
  const allowNet = o.allowNet || null;   // 域名白名单数组, 如 ['api.github.com']

  const sandbox = {
    console: {
      log: (...a) => { const s = a.map(stringify).join(' '); logs.push(s); if (o.debug) process.stderr.write(s + '\n'); },
      error: (...a) => { const s = a.map(stringify).join(' '); logs.push(s); if (o.debug) process.stderr.write(s + '\n'); },
      warn: (...a) => { const s = a.map(stringify).join(' '); logs.push(s); if (o.debug) process.stderr.write(s + '\n'); },
    },
    $request: request,
    $response: response,
    $argument: o.argument === undefined ? null : o.argument,
    $done: (v) => { doneCalled = true; done = normalizeDone(v); if (doneResolve) doneResolve(); },
    $notify: (...a) => { logs.push('[notify] ' + a.map(stringify).join(' | ')); },
    $notification: { post: (...a) => { logs.push('[notification] ' + a.map(stringify).join(' | ')); } },
    $persistentStore: storeApi,
    $prefs: prefsApi,
    $environment: Object.assign({
      'loon-version': 'Loon 3.5.1 (983)',
      'device-model': 'iPhone',
      'system-version': 'iOS 18.0',
      'language': 'zh-Hans',
      // 官方 script-api: params=参数快照, elapsedMs=运行毫秒
      params: o.argument && typeof o.argument === 'object' ? { ...o.argument } : {},
      get elapsedMs() { return Date.now() - ($scriptStartTime || Date.now()); },
      sandbox: { type: 'plugin' },
    }, o.environment || {}),
    $loon: 'Loon 3.5.1 (983)',
    $script: { name: o.scriptName || 'sim', startTime: new Date(), type: o.scriptType || 'response' },
    $utils: {
      ungzip: (b) => { try { return zlib.gunzipSync(toBuffer(b)); } catch (e) { try { return zlib.inflateSync(toBuffer(b)); } catch (e2) { return b; } } },
      gzip: (b) => zlib.gzipSync(toBuffer(b)),
      base64: {
        encode: (b) => toBuffer(b).toString('base64'),
        decode: (b) => toBuffer(String(b), 'base64'),
      },
      md5: (b) => crypto.createHash('md5').update(toBuffer(b)).digest('hex'),
      sha1: (b) => crypto.createHash('sha1').update(toBuffer(b)).digest('hex'),
      sha256: (b) => crypto.createHash('sha256').update(toBuffer(b)).digest('hex'),
      geohistoricaldata: () => ({}),
    },
    $crypto: {
      aes: {
        encrypt: (data, options) => aesCrypt(true, data, options),
        decrypt: (data, options) => aesCrypt(false, data, options),
      },
    },
    $dns: {
      query: (options, cb) => {
        // Build>=988 API — 模拟实现 (真实 DNS 由 Loon 层做)
        const host = typeof options === 'string' ? options : (options?.domain || options?.host || '');
        require('dns').lookup(host || '', (err, addr) => {
          if (typeof cb === 'function') cb(err ? { error: err.message } : { domain: host, addrs: [addr] });
        });
      },
    },
    $config: {
      getConfig: () => ({ all_policy_groups: [], all_nodes: [], running_model: 'filter' }),
      setSelectPolicy: () => true,
      getSelectedPolicy: () => null,
      getSubPolicies: (name, cb) => { if (typeof cb === 'function') cb(null, []); },
      setRunningModel: () => true,
    },
    $httpClient: {
      get: (a, cb) => { httpCalls++; return httpReq('GET', a, cb, logs, httpMocks, allowNet); },
      post: (a, cb) => { httpCalls++; return httpReq('POST', a, cb, logs, httpMocks, allowNet); },
      put: (a, cb) => { httpCalls++; return httpReq('PUT', a, cb, logs, httpMocks, allowNet); },
      head: (a, cb) => { httpCalls++; return httpReq('HEAD', a, cb, logs, httpMocks, allowNet); },
      delete: (a, cb) => { httpCalls++; return httpReq('DELETE', a, cb, logs, httpMocks, allowNet); },
      // 兜底: 未定义方法也走 httpReq (官方支持 options/p TRACE 等冷门方法; 与其静默无回调, 不如统一处理)
      options: (a, cb) => { httpCalls++; return httpReq('OPTIONS', a, cb, logs, httpMocks, allowNet); },
    },
    setTimeout: (fn, ms, ...a) => { timerCalls++; return setTimeout(fn, ms, ...a); },
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
        vm.runInContext(wrapped, ctx, { filename: scriptPath, timeout: o.timeout || 20000 });
      } catch (e) {
        return { ok: false, error: e.message, logs, done, doneCalled };
      }
      return { ok: true, logs, done, doneCalled };
    },

    // v1.7.9：异步版本。$done 常由 $httpClient 回调触发，run() 同步返回时
    // doneCalled 必然还是 false（表现为「$done 未被调用」）。本方法会等。
    //
    // 等待策略：只有调用过 $httpClient 才等 —— 纯同步脚本（绝大多数去广告脚本）
    // 走原路径零开销，不会拖慢全量 CI。
    // 超时默认 3s（mock 走 setImmediate，毫秒级）；开了 --allow-net 提到 20s
    // （runtime 内部 httpReq 自身 timeout 是 15s）。
    async runAsync(scriptPath) {
      let thrown = null;
      try {
        const code = fs.readFileSync(scriptPath, 'utf8');
        const ctx = vm.createContext(sandbox);
        const wrapped = '(function () {\n' + code + '\n})();';
        vm.runInContext(wrapped, ctx, { filename: scriptPath, timeout: o.timeout || 20000 });
      } catch (e) {
        thrown = e;
      }

      if (!doneCalled && (httpCalls > 0 || timerCalls > 0)) {
        const ms = o.asyncTimeout || (allowNet ? 20000 : 3000);
        let timer = null;
        await Promise.race([
          donePromise,
          new Promise((res) => { timer = setTimeout(res, ms); }),
        ]);
        if (timer) clearTimeout(timer);
      }

      if (thrown) return { ok: false, error: thrown.message, logs, done, doneCalled };
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

// P3-A: httpReq 真连版本 (allowNet 白名单 + mock 优先)

/** $crypto.aes — Node crypto 实现 (options: {key, iv, mode='cbc'} 均为字符串) */
function aesCrypt(enc, data, options) {
  const crypto2 = require('crypto');
  const key = Buffer.from(String(options?.key ?? ''), 'utf8');
  const iv = Buffer.from(String(options?.iv ?? ''), 'utf8');
  const algo = 'aes-' + (key.length * 8) + '-' + (options?.mode || 'cbc');
  if (enc) {
    const c = crypto2.createCipheriv(algo, key, iv);
    return Buffer.concat([c.update(toBuffer(data)), c.final()]).toString('base64');
  }
  const d = crypto2.createDecipheriv(algo, key, iv);
  return Buffer.concat([d.update(Buffer.from(String(data), 'base64')), d.final()]).toString('utf8');
}

function httpReq(method, args, cb, logs, mocks, allowNet) {
  const url = typeof args === 'string' ? args : (args?.url || '');
  const body = typeof args === 'object' && args?.body !== undefined ? args.body : undefined;
  const headers = typeof args === 'object' && args?.headers ? args.headers : {};

  const mock = mocks && matchMock(url, mocks);
  if (mock) {
    logs.push(`[httpClient] ${method} ${url} (mocked)`);
    const resp = { status: mock.status ?? 200, headers: mock.headers || {}, body: mock.body ?? '' };
    if (typeof cb === 'function') setImmediate(() => cb(null, resp, resp.body));
    return;
  }

  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
  const allowed = allowNet && allowNet.some(h => host === h || host.endsWith('.' + h));

  if (allowed) {
    logs.push(`[httpClient] ${method} ${url} (REAL — 白名单 ${host})`);
    // 真实请求: Loon 根证书已在系统信任库, 严格 TLS
    const u = new URL(url);
    const req = require(u.protocol === 'https:' ? 'https' : 'http').request(
      { hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: u.pathname + u.search, method,
        headers, timeout: 15000, rejectUnauthorized: true },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          let b = Buffer.concat(chunks);
          // gzip 自动解压
          const enc = String(res.headers['content-encoding'] || '');
          try {
            if (enc.includes('gzip')) b = require('zlib').gunzipSync(b);
            else if (enc.includes('deflate')) b = require('zlib').inflateSync(b);
            else if (enc.includes('br')) b = require('zlib').brotliDecompressSync(b);
          } catch {}
          const resp = { status: res.statusCode, headers: res.headers, body: b.toString('utf8') };
          if (typeof cb === 'function') cb(null, resp, resp.body);
        });
      });
    req.on('timeout', () => { req.destroy(); if (typeof cb === 'function') cb(new Error('timeout'), null, ''); });
    req.on('error', e => { if (typeof cb === 'function') cb(e, null, ''); });
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
    return;
  }

  logs.push(`[httpClient] ${method} ${url} (simulated${allowNet ? `, 不在白名单` : ', 未开启 --allow-net'})`);
  const resp = { status: 200, headers: {}, body: '' };
  if (typeof cb === 'function') setImmediate(() => cb(null, resp, resp.body));
}

function matchMock(url, mocks) {
  for (const k of Object.keys(mocks)) {
    if (k.startsWith('/') && k.endsWith('/') && new RegExp(k.slice(1, -1)).test(url)) return mocks[k];
    if (url.includes(k)) return mocks[k];
  }
  return null;
}

function toBuffer(b) {
  if (!b) return Buffer.alloc(0);
  if (Buffer.isBuffer(b)) return b;
  if (b instanceof Uint8Array) return Buffer.from(b);
  if (typeof b === 'string') return typeof enc === 'string' ? Buffer.from(b, enc) : Buffer.from(b, 'binary');
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
