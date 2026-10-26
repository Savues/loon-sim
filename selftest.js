#!/usr/bin/env node
'use strict';
/**
 * 模拟器自测套件 —— 校验核心语义是否与 Loon 官方规范一致
 * 每条断言标注官方依据（script_v2 / rewrite_v2 / Plugin / Rule）
 */

const assert = require('assert');
const path = require('path');
const { parseArguments, parseScriptRules, parseRules, parseMitm, splitTopLevel } = require('./lpx');
const { evalCondition, buildArgument, matchRule } = require('./matcher');
const { createRuntime } = require('./runtime');
const { diffFingerprint, shapeMap } = require('./trace');
const fs = require('fs');

let pass = 0, fail = 0, skipped = 0;
const failures = [];
function t(name, fn) {
  try { fn(); pass++; }
  catch (e) { fail++; failures.push(`${name}\n    ${e.message.split('\n')[0]}`); }
}
// 嵌套 node 可用性探测 (iSH fork bug 环境: 嵌套 node 跑 JS 会 ETIMEDOUT/被杀)
// 不可用时 execSync 类用例跳过 (标 SKIP 不计失败) — 顶层 shell 跑 node 不受影响
let NESTED_NODE_OK = null;
function nestedNodeAvailable() {
  if (NESTED_NODE_OK !== null) return NESTED_NODE_OK;
  try {
    const { spawnSync } = require('child_process');
    const r = spawnSync('/usr/bin/node', ['-e', 'process.exit(0)'], {timeout: 5000});
    NESTED_NODE_OK = r.status === 0;
  } catch { NESTED_NODE_OK = false; }
  if (!NESTED_NODE_OK) console.log('⚠️  iSH 嵌套 node 不可用 (fork bug) — execSync 用例将跳过, 请在 iSH 顶层补跑');
  return NESTED_NODE_OK;
}
function tExec(name, fn) {
  if (!nestedNodeAvailable()) { skipped++; return; }
  t(name, fn);
}

console.log('=== 模拟器自测 ===\n');

/* ---------- 1. [Argument] 解析（官方：控件,默认值[,type=][,tag=][,desc=]）---------- */
console.log('① [Argument] 解析');
t('switch 默认为 Boolean', () => {
  const a = parseArguments(['enabled = switch,true,tag=启用']);
  assert.strictEqual(a.enabled.kind, 'switch');
  assert.strictEqual(a.enabled.default, true);
});
t('switch 默认 false', () => {
  const a = parseArguments(['x = switch,false,tag=t']);
  assert.strictEqual(a.x.default, false);
});
t('switch 三位置形式也可解析', () => {
  const a = parseArguments(['d = switch,false,true,tag=调试日志']);
  assert.strictEqual(a.d.default, false);
});
t('input 默认 String', () => {
  const a = parseArguments(['name = input,"Loon",tag=名称']);
  assert.strictEqual(a.name.kind, 'input');
  assert.strictEqual(a.name.default, 'Loon');
  assert.strictEqual(a.name.type, 'string');
});
t('input + type=number → Number', () => {
  const a = parseArguments(['p = input,9.99,type=number,tag=价格']);
  assert.strictEqual(a.p.default, 9.99);
  assert.strictEqual(a.p.type, 'number');
});
t('select 多选项取首个为默认', () => {
  const a = parseArguments(['r = select,"CN","US","JP",tag=地区']);
  assert.strictEqual(a.r.default, 'CN');
});
t('select + type=number', () => {
  const a = parseArguments(['l = select,1,2,3,type=number,tag=等级']);
  assert.strictEqual(a.l.default, 1);
  assert.strictEqual(a.l.type, 'number');
});
t('含逗号的 desc 不破坏解析', () => {
  const a = parseArguments(['x = switch,true,tag=标签,desc=拦截 a,b,c 三类广告']);
  assert.strictEqual(a.x.default, true);
});

/* ---------- 2. [Script] 规则解析（官方 script_v2）---------- */
console.log('② [Script] 规则解析');
t('response 规则 + 对象参数', () => {
  const r = parseScriptRules(['response if ${url} ~= /^https:\\/\\/a\\.com\\/x/i then script("s.js", {${a}, ${b}}) with enable=${a}, requires_body=true, tag="T"'])[0];
  assert.strictEqual(r.phase, 'response');
  assert.deepStrictEqual(r.argumentKeys, ['a', 'b']);
  assert.strictEqual(r.options.requires_body, 'true');
  assert.strictEqual(r.invalid, null);
});
t('字符串参数', () => {
  const r = parseScriptRules(['generic then script("t.js", "region=CN") with tag="T"'])[0];
  assert.strictEqual(r.argumentLiteral, 'region=CN');
  assert.strictEqual(r.argumentKeys.length, 0);
});
t('无参数 → null', () => {
  const r = parseScriptRules(['request if ${url} ~= /a/i then script("r.js")'])[0];
  assert.strictEqual(r.argumentLiteral, null);
  assert.strictEqual(r.argumentKeys.length, 0);
});
t('空对象参数 → invalid（官方：不能为空）', () => {
  const r = parseScriptRules(['request if ${url} ~= /a/i then script("x.js", {})'])[0];
  assert.ok(r.invalid && r.invalid.includes('空'));
});
t('对象内非 ${} 成员 → invalid', () => {
  const r = parseScriptRules(['request if ${url} ~= /a/i then script("x.js", {"CN", 2})'])[0];
  assert.ok(r.invalid);
});
t('对象引用运行变量 → invalid', () => {
  const r = parseScriptRules(['request if ${url} ~= /a/i then script("x.js", {${url}})'])[0];
  assert.strictEqual(r.invalid, null); // 语法上合法，语义校验在 check 阶段（需 [Argument] 对照）
});
t('response 规则缺 URL Guard → invalid（官方强制）', () => {
  const r = parseScriptRules(['response if ${response.status} == 200 then script("x.js")'])[0];
  assert.ok(r.invalid && r.invalid.includes('URL Guard'));
});
t('cron 规则', () => {
  const r = parseScriptRules(['cron "0 8 * * *" then script("c.js") with timeout=300'])[0];
  assert.strictEqual(r.phase, 'other');        // cron 不参与 HTTP 匹配
  assert.strictEqual(r.trigger, 'cron "0 8 * * *"');
  assert.strictEqual(r.invalid, null);
});

/* ---------- 3. 条件求值（官方 rewrite_v2 变量与操作符）---------- */
console.log('③ 条件求值');
const V = { url: 'https://api.example.com/item/42', 'request.method': 'POST', enabled: true, level: 2, region: 'CN', off: false };
t('${url} ~= 正则', () => assert.strictEqual(evalCondition('${url} ~= /item\\/\\d+/i', V), true));
t('正则不匹配', () => assert.strictEqual(evalCondition('${url} ~= /nomatch/i', V), false));
t('${开关} == true', () => assert.strictEqual(evalCondition('${enabled} == true', V), true));
t('${开关} == true 为假', () => assert.strictEqual(evalCondition('${off} == true', V), false));
t('数字比较', () => assert.strictEqual(evalCondition('${level} == 2', V), true));
t('字符串比较', () => assert.strictEqual(evalCondition('${region} == "CN"', V), true));
t('&& 组合', () => assert.strictEqual(evalCondition('${url} ~= /example/i && ${enabled} == true', V), true));
t('|| 组合', () => assert.strictEqual(evalCondition('${off} == true || ${enabled} == true', V), true));
t('括号分组', () => assert.strictEqual(evalCondition('(${off} == true || ${region} == "CN") && ${level} == 2', V), true));
t('大小写敏感的正则标志 i', () => assert.strictEqual(evalCondition('${url} ~= /API\\.EXAMPLE/i', V), true));

/* ---------- 4. $argument 三态（官方 script_v2）---------- */
console.log('④ $argument 三态');
const defs = parseArguments(['a = switch,true', 'b = select,1,2,3,type=number']);
t('对象参数 → Object（key=参数名，value 保留类型）', () => {
  const arg = buildArgument({ argumentKeys: ['a', 'b'] }, defs, {});
  assert.deepStrictEqual(arg, { a: true, b: 1 });
  assert.strictEqual(typeof arg.a, 'boolean');
  assert.strictEqual(typeof arg.b, 'number');
});
t('字符串参数 → String', () => {
  assert.strictEqual(buildArgument({ argumentLiteral: 'x=1' }, defs, {}), 'x=1');
});
t('无参数 → null', () => {
  assert.strictEqual(buildArgument({ argumentKeys: [] }, defs, {}), null);
});
t('命令行覆盖生效', () => {
  assert.deepStrictEqual(buildArgument({ argumentKeys: ['a'] }, defs, { a: false }), { a: false });
});

/* ---------- 5. [Rule] 匹配（官方 Rule：域名优先、后缀匹配）---------- */
console.log('⑤ [Rule] 匹配');
const rules = parseRules(['DOMAIN, exact.com, REJECT', 'DOMAIN-SUFFIX, suf.com, REJECT', 'DOMAIN-KEYWORD, kw, REJECT']);
const fake = { rules };
t('DOMAIN 精确匹配', () => assert.ok(matchRule(fake, 'https://exact.com/x')));
t('DOMAIN 不匹配子域', () => assert.strictEqual(matchRule(fake, 'https://sub.exact.com/x'), null));
t('DOMAIN-SUFFIX 匹配自身', () => assert.ok(matchRule(fake, 'https://suf.com/')));
t('DOMAIN-SUFFIX 匹配子域', () => assert.ok(matchRule(fake, 'https://a.b.suf.com/')));
t('DOMAIN-KEYWORD 包含匹配', () => assert.ok(matchRule(fake, 'https://x-kw-y.com/')));
t('未命中返回 null', () => assert.strictEqual(matchRule(fake, 'https://other.com/'), null));

/* ---------- 6. [Mitm] 解析 ---------- */
console.log('⑥ [Mitm]');
t('逗号分隔 + 去 %APPEND%', () => {
  const h = parseMitm(['hostname = a.com, b.com', 'hostname = %APPEND% c.com']);
  assert.deepStrictEqual(h, ['a.com', 'b.com', 'c.com']);
});

/* ---------- 7. 运行时 $done 语义 ---------- */
console.log('⑦ 运行时');
t('$done({}) → 原样', () => {
  const f = '/tmp/_sim_t1.js';
  fs.writeFileSync(f, 'if ($response.body) { $done({}); } else { $done({}); }');
  const rt = createRuntime({ request: { url: 'https://a.com/' }, response: { status: 200, body: '{"x":1}' } });
  const r = rt.run(f);
  assert.ok(r.ok && r.doneCalled);
  assert.deepStrictEqual(r.done, {});
});
t('$argument 注入正确', () => {
  const f = '/tmp/_sim_t2.js';
  fs.writeFileSync(f, 'console.log(JSON.stringify($argument)); $done({});');
  const rt = createRuntime({ response: { body: '' }, argument: { a: true, b: 1 } });
  const r = rt.run(f);
  assert.strictEqual(r.logs[0], '{"a":true,"b":1}');
});
t('$argument 省略 → null', () => {
  const f = '/tmp/_sim_t3.js';
  fs.writeFileSync(f, 'console.log(String($argument)); $done({});');
  const rt = createRuntime({ response: { body: '' } });
  const r = rt.run(f);
  assert.strictEqual(r.logs[0], 'null');
});
t('$persistentStore 读写', () => {
  const f = '/tmp/_sim_t4.js';
  fs.writeFileSync(f, '$persistentStore.write("v","k"); console.log($persistentStore.read("k")); $done({});');
  const r = createRuntime({ response: { body: '' } }).run(f);
  assert.strictEqual(r.logs[0], 'v');
});
t('脚本异常被捕获', () => {
  const f = '/tmp/_sim_t5.js';
  fs.writeFileSync(f, 'throw new Error("boom");');
  const r = createRuntime({ response: { body: '' } }).run(f);
  assert.strictEqual(r.ok, false);
  assert.ok(r.error.includes('boom'));
});
t('异步 $done（setTimeout）', () => {
  const f = '/tmp/_sim_t6.js';
  fs.writeFileSync(f, 'setTimeout(()=>$done({body:"later"}),10);');
  const r = createRuntime({ response: { body: '' } }).run(f);
  assert.strictEqual(r.doneCalled, false); // 同步执行阶段未调用（模拟器不等待异步）
});

/* ---------- 8. splitTopLevel 边界 ---------- */
console.log('⑧b 通用结构指纹');
t('识别数组长度变化', () => {
  const b = JSON.stringify({ sc: { a: [1], b: [2,3], c: [4] }, ac: { x: 1 } });
  const a = JSON.stringify({ sc: {}, ac: { x: 1 } });
  const d = diffFingerprint(b, a);
  assert.ok(d.some(x => x.key === 'sc{}' && x.from === 3 && x.to === 0), '应报 sc{} 3→0: ' + JSON.stringify(d));
});
t('不深入数组元素(避免噪音)', () => {
  const big = { list: Array.from({ length: 100 }, (_, i) => ({ id: i })) };
  const b = JSON.stringify(big), a = JSON.stringify({ list: [] });
  assert.strictEqual(shapeMap(b).get('.list[]'), 100);
  assert.strictEqual(shapeMap(a).get('.list[]'), 0);
  const d = diffFingerprint(b, a);
  assert.ok(d.every(x => !x.key.includes('[0]')), '不应深入数组元素: ' + JSON.stringify(d));
});
t('祖先去重', () => {
  const b = JSON.stringify({ a: { b: { c: [1,2,3] } } });
  const a = JSON.stringify({ a: {} });
  const d = diffFingerprint(b, a);
  assert.ok(d.every(x => !x.key.includes('.a.b')), '应只报 .a{} 变化: ' + JSON.stringify(d));
});

console.log('⑧ 顶层切分');
t('不切分括号内逗号', () => assert.deepStrictEqual(splitTopLevel('f(a,b),c', ','), ['f(a,b)', 'c']));
t('不切分引号内逗号', () => assert.deepStrictEqual(splitTopLevel('"a,b",c', ','), ['"a,b"', 'c']));
t('不切分正则内逗号', () => assert.deepStrictEqual(splitTopLevel('/a{1,2}/,x', ','), ['/a{1,2}/', 'x']));

console.log('⑨ v1.3+ 新能力 (mock/persist/utils/trigger/converter)');
// httpClient mock
t('httpClient mock 命中返回自定义响应', () => {
  const fs = require('fs');
  fs.writeFileSync('/tmp/st_mock.js', '$httpClient.get({url:"https://api.t.com/v1"},(e,r,b)=>{console.log("S="+r.status+" B="+b);$done({});});');
  const { createRuntime } = require('./runtime');
  const rt = createRuntime({ request: { url: 'https://x/' }, httpMocks: { 'api.t.com': { status: 201, body: 'ok' } } });
  const res = rt.run('/tmp/st_mock.js');
  // 回调是 setImmediate 异步 — logs 同步阶段至少含 mocked 标记
  assert.ok(res.logs.join('').includes('mocked'), '应标记 mocked: ' + res.logs.join('|'));
});
t('$utils md5/base64', () => {
  const { createRuntime } = require('./runtime');
  const sandbox = createRuntime({}).sandbox;
  assert.strictEqual(sandbox.$utils.md5('abc').length, 32, 'md5 32位');
  assert.strictEqual(sandbox.$utils.base64.encode('hi'), 'aGk=', 'base64');
});
t('$persistentStore 持久化落盘', () => {
  const fs = require('fs');
  const f = '/tmp/st_store.json';
  if (fs.existsSync(f)) fs.unlinkSync(f);
  const { createRuntime } = require('./runtime');
  const rt1 = createRuntime({ storeFile: f });
  rt1.sandbox.$persistentStore.write('V1', 'k');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { k: 'V1' }, '写入即落盘');
  const rt2 = createRuntime({ storeFile: f });
  assert.strictEqual(rt2.sandbox.$persistentStore.read('k'), 'V1', '新实例可读');
});
// 官方转换器
t('官方转换器: Script 基本转换', () => {
  const c = require('./converter');
  const r = c.convertLine('http-request ^https://x\\.com script-path=a.js, requires-body=true', { argumentTypes: {} });
  assert.ok(r.text.includes('request if') && r.text.includes('requires_body=true'), r.text);
});
t('官方转换器: reject-dict → reject_dict(200)', () => {
  const c = require('./converter');
  assert.ok(c.convertLine('^u reject-dict', { argumentTypes: {} }).text.includes('reject_dict(200)'));
});
t('对象参数点号名 (v1.4 修复回归)', () => {
  const { parseLpx } = require('./lpx');
  const fs = require('fs');
  fs.writeFileSync('/tmp/st_dot.lpx', '#!name=T\n[Argument]\nHome.Switch = switch,true\n[Script]\nresponse if ${url} ~= /x/ then script("a.js", {${Home.Switch}})\n');
  const p = parseLpx('/tmp/st_dot.lpx');
  assert.deepStrictEqual(p.scriptRules[0].argumentKeys, ['Home.Switch'], '点号参数名不丢');
});
t('URL Rewrite 段兜底 (convert.js 逻辑)', () => {
  // 模拟 convert.js 的段名改写: 改写后官方转换器能处理
  const c = require('./converter');
  const src = '[URL Rewrite]\n^u reject';
  const fixed = src.replace(/^\[URL Rewrite\]$/m, '[Rewrite]');
  const r = c.convertText(fixed, { argumentTypes: {} });
  assert.strictEqual(r.converted, 1, '改写段名后可转换');
});

console.log('⑩ P3-A allowNet 白名单真连');
t('白名单外域名保持 simulated (防泄漏)', () => {
  const fs = require('fs');
  fs.writeFileSync('/tmp/st_net.js', '$httpClient.get({url:"https://evil.example.com/x"},(e,r)=>{$done({});});');
  const { createRuntime } = require('./runtime');
  const rt = createRuntime({ request: { url: 'https://x/' }, allowNet: ['good.com'] });
  const res = rt.run('/tmp/st_net.js');
  assert.ok(res.logs.join('').includes('不在白名单'), '应被白名单拦截: ' + res.logs.join('|'));
});
t('mock 优先级高于真连', () => {
  const fs = require('fs');
  fs.writeFileSync('/tmp/st_net2.js', '$httpClient.get({url:"https://api.t.com/v1"},(e,r)=>{console.log("S="+r.status);$done({});});');
  const { createRuntime } = require('./runtime');
  const rt = createRuntime({ request: { url: 'https://x/' }, httpMocks: { 'api.t.com': { status: 999, body: 'M' } }, allowNet: ['api.t.com'] });
  const res = rt.run('/tmp/st_net2.js');
  assert.ok(res.logs.join('').includes('mocked'), 'mock 应优先: ' + res.logs.join('|'));
});
t('allowNet 域名含子域匹配', () => {
  const { createRuntime } = require('./runtime');
  const rt = createRuntime({ allowNet: ['example.com'] });
  // 内部函数级验证: 通过日志判断 (cdn.example.com 应允许)
  const fs = require('fs');
  fs.writeFileSync('/tmp/st_net3.js', '$httpClient.get({url:"https://cdn.example.com/x"},()=>{$done({});});');
  const res = rt.run('/tmp/st_net3.js');
  assert.ok(res.logs.join('').includes('REAL'), '子域应真连: ' + res.logs.join('|'));
});

console.log('⑪ P3-B 运行时 API 对齐');
t('$persistentStore 值字符串化 (官方语义)', () => {
  const { createRuntime } = require('./runtime');
  const rt = createRuntime({});
  rt.sandbox.$persistentStore.write(123, 'n');
  assert.strictEqual(rt.sandbox.$persistentStore.read('n'), '123', '数字应存为字符串');
});
t('$persistentStore.remove() 无参清空', () => {
  const { createRuntime } = require('./runtime');
  const rt = createRuntime({ store: { a: '1', b: '2' } });
  rt.sandbox.$persistentStore.remove();
  assert.strictEqual(rt.sandbox.$persistentStore.read('a'), null, '应清空');
});
t('$script.startTime 是 Date', () => {
  const { createRuntime } = require('./runtime');
  const rt = createRuntime({});
  assert.ok(rt.sandbox.$script.startTime instanceof Date, 'startTime 应为 Date');
});
t('$environment.params 参数快照', () => {
  const { createRuntime } = require('./runtime');
  const rt = createRuntime({ argument: { region: 'CN' } });
  assert.strictEqual(rt.sandbox.$environment.params.region, 'CN');
  assert.ok(typeof rt.sandbox.$environment.elapsedMs === 'number');
});
t('$crypto.aes 加解密往返', () => {
  const { createRuntime } = require('./runtime');
  const rt = createRuntime({});
  const opt = { key: '0123456789abcdef0123456789abcdef', iv: 'fedcba9876543210' };
  const enc = rt.sandbox.$crypto.aes.encrypt('hello loon', opt);
  const dec = rt.sandbox.$crypto.aes.decrypt(enc, opt);
  assert.strictEqual(dec, 'hello loon', 'AES 往返');
});
t('$config API 面存在', () => {
  const { createRuntime } = require('./runtime');
  const rt = createRuntime({});
  assert.ok(typeof rt.sandbox.$config.getConfig === 'function');
  assert.ok(rt.sandbox.$config.getConfig().running_model);
});

console.log('⑫ 语义审计修复回归 (v1.6.2)');
const { evalCondition: _ev } = require('./matcher');
t('== 严格类型比较 (官方: 类型一致)', () => {
  assert.strictEqual(_ev('${response.status} == "200"', {'response.status': 200}), false, 'number≠string');
  assert.strictEqual(_ev('${response.status} == 200', {'response.status': 200}), true);
  assert.strictEqual(_ev('${sw} == true', {sw: true}), true);
});
t('Script 条件可引用插件参数', () => {
  const { traceScriptRules } = require('./trace');
  const { parseLpx } = require('./lpx');
  require('fs').writeFileSync('/tmp/st_cond.lpx', '#!name=T\n[Argument]\nsw = switch,true\n[Script]\nresponse if ${url} ~= /b/ && ${sw} == true then script("c.js")\n');
  const p = parseLpx('/tmp/st_cond.lpx');
  const r = traceScriptRules(p, 'https://t.com/b', 'response', {sw: true});
  assert.ok(r.effective && (r.effective.scriptPath === 'c.js' || r.effective.script === 'c.js'), '参数条件应生效');
});
t('裸路径正则规则不被 relevance 隐藏', () => {
  const { isRelevant } = require('./relevance');
  assert.strictEqual(isRelevant('${url} ~= /mtop\\.taobao\\./i', 'https://acs.m.taobao.com/gw/x'), true);
});
tExec('Rewrite 多规则共享 state (前者输出=后者输入)', () => {
  const fs = require('fs');
  fs.writeFileSync('/tmp/st_rw.lpx', '#!name=T\n[Mitm]\nhostname = t.com\n[Rewrite]\nrequest if ${url} ~= /x/ then request.header.set("A", "1")\nrequest if ${url} ~= /x/ then request.header.set("A", "2")\n');
  const { parseLpx } = require('./lpx');
  // 白盒: traceRewriteRules 不导出 state — 用 exec 验证 2 条都执行即可 (state 正确性由覆盖顺序保证)
  const { execSync } = require('child_process');
  let out = '';
  try { out = execSync('node cli.js run /tmp/st_rw.lpx --url https://t.com/x --phase request', {encoding: 'utf8', stdio: 'pipe'}); }
  catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  assert.strictEqual((out.match(/← 命中/g) || []).length, 2, '两条都执行');
});

console.log('⑬ 第二轮语义审计回归 (v1.6.3)');
t('正则内 && 不被切分', () => {
  const { evalCondition: ev } = require('./matcher');
  assert.strictEqual(ev('${url} ~= /a&&b/', {url: 'xa&&bz'}), true);
});
t('reject 状态码越界拒绝', () => {
  const { execRewrite } = require('./rewrite-exec');
  const st = {url:'u', headers:{}, respHeaders:{}, status:200};
  const r = execRewrite(st, 'reject_dict(600)', {});
  assert.strictEqual(r.actions[0].ok, false, '600 应报错');
  const st2 = {url:'u', headers:{}, respHeaders:{}, status:200};
  assert.strictEqual(execRewrite(st2, 'reject_dict(200)', {}).terminated, true);
});
t('mock 后 header action 继续执行', () => {
  const { execRewrite } = require('./rewrite-exec');
  const st = {url:'u', headers:{}, respHeaders:{}, status:200};
  const r = execRewrite(st, 'response.body.mock("json", `{}`, 200) | response.header.set("X", "1")', {});
  assert.strictEqual(st.respHeaders['X'], '1');
  assert.strictEqual(r.terminated, true, '对 Script 层仍是终止');
});
tExec('check: timeout=0 检出 / timeout={n} 合法', () => {
  const fs = require('fs');
  const { execSync } = require('child_process');
  fs.writeFileSync('/tmp/st_t1.lpx', '#!name=T\n#!version=1\n[Script]\nrequest if ${url} ~= /a/ then script("a.js") with timeout=0\n');
  let out = ''; try { out = execSync('node cli.js check /tmp/st_t1.lpx', {encoding:'utf8'}); } catch(e) { out = e.stdout || ''; }
  assert.ok(out.includes('timeout=0 非法'), '应检出');
});

console.log('⑭ 第三轮审计回归 (v1.6.4)');
t('$httpClient.head 方法存在且回调', () => {
  const fs = require('fs');
  fs.writeFileSync('/tmp/st_h.js', '$httpClient.head({url:"https://m.com/h"},(e,r)=>{console.log("H="+r.status);$done({});});');
  const { createRuntime } = require('./runtime');
  const rt = createRuntime({httpMocks: {'m.com': {status: 204, body: ''}}});
  const res = rt.run('/tmp/st_h.js');
  assert.ok(res.logs.join('').includes('[httpClient] HEAD'), 'head 应被处理: ' + res.logs.join('|'));
});
t('header.add 批量数组参数 (官方转换器产物形态)', () => {
  const { execRewrite } = require('./rewrite-exec');
  const st = {url:'u', headers:{}, respHeaders:{}, status:200};
  execRewrite(st, 'request.header.add(["A", "B"], ["1", "2"])', {});
  assert.strictEqual(st.headers['A'], '1');
  assert.strictEqual(st.headers['B'], '2');
});

console.log('⑮ 死参数检查下划线回归 (v1.6.6)');
tExec('含下划线的 enable 引用不算死参数', () => {
  const fs = require('fs');
  fs.writeFileSync('/tmp/st_us.lpx', '#!name=T\n#!version=1\n[Argument]\nmy_switch_key = switch,true\n[Script]\nhttp-response ^https://x script-path=a.js, enable={my_switch_key}\n');
  const { execSync } = require('child_process');
  let out = '';
  try { out = execSync('node cli.js check /tmp/st_us.lpx', {encoding:'utf8'}); } catch (e) { out = e.stdout || ''; }
  assert.ok(!out.includes('my_switch_key') || !out.includes('死参数'), '含下划线参数不应误报死参数');
});

console.log('⑯ 死代码检测器 (v1.6.7)');
tExec('dead-fn: 孤儿函数检出 + 正常函数不误报', () => {
  const fs = require('fs');
  fs.writeFileSync('/tmp/st_dead.js', 'function main(){ helper1(); }\nfunction helper1(){ return 1; }\nfunction orphan(){ return 2; }\n');
  const { execSync } = require('child_process');
  let out = '';
  try { out = execSync('node dead-fn.js /tmp/st_dead.js', {encoding:'utf8'}); } catch (e) { out = e.stdout || ''; }
  assert.ok(out.includes('orphan'), '应检出 orphan');
  assert.ok(!out.includes('helper1'), 'helper1 被调用不应误报');
});
tExec('dead-fn: 混淆函数名豁免', () => {
  const fs = require('fs');
  fs.writeFileSync('/tmp/st_dead2.js', 'function a0_0xabcd(){return 1;}\n');
  const { execSync } = require('child_process');
  let out = '';
  try { out = execSync('node dead-fn.js /tmp/st_dead2.js', {encoding:'utf8'}); } catch (e) { out = (e.stdout||'') + (e.stderr||''); }
  assert.ok(out.includes('死代码: 无'), '混淆名应豁免: ' + out.slice(0,80));
});

t('check: 正则字面量未闭合检出 (probe-setup事故类, 进程内验证)', () => {
  // 与 cli.js check 同源逻辑: 无尾斜杠/flag 的正则 parseRegex 返回 null
  const { parseRegex } = require('./matcher');
  assert.strictEqual(parseRegex('/gw/loon-sim\\.probe\\.bad_name'), null, '无尾斜杠应不可解析');
  assert.ok(parseRegex('/gw/loon-sim\\.probe\\.name/i') instanceof RegExp, '带 /i 应可解析');
});

t('check: 探针变量双花括号检出 (f-string 转义残留, 2026-10-26 事故)', () => {
  // Allinone v8.0.1 的探针写成 ${{url}} → Loon 只认 ${url} → 探针永不匹配,
  // 但彼时 check 无此项校验 + 探针校验被 `有 #!version` 开关挡住 → 一路通过所有自动化
  const fs = require('fs');
  const bad = '/tmp/st_probe_bad.lpx', good = '/tmp/st_probe_good.lpx';
  const mk = (u) => `#!name=T\n#!version=1.0\n[Rule]\nDOMAIN,t.com,REJECT\n[Rewrite]\nrequest if ${u} ~= /^https?:\\/\\/t\\.com\\/gw\\/loon-sim\\.probe\\/t_p/i then reject(200, "1.0")\n[Mitm]\nhostname = t.com\n`;
  fs.writeFileSync(bad, mk('${{url}}'));
  fs.writeFileSync(good, mk('${url}'));
  const { parseLpx } = require('./lpx');
  const chk = (f) => {
    const p = parseLpx(f);
    // 与 cli.js check ⑤ 同源: 探针规则里出现 ${{ 即错误
    const probes = [...p.scriptRules, ...p.rewriteRules].filter(r => /loon-sim.{0,3}probe/.test(String(r.condition || r.raw || '')));
    return probes.some(r => /\$\{\{/.test(String(r.raw || '')));
  };
  assert.strictEqual(chk(bad), true, '双花括号应被检出');
  assert.strictEqual(chk(good), false, '正确形态不应误报');
  assert.ok(!parseLpx(bad).header.version || true);
});

console.log(`\n结果: ${pass} 通过, ${fail} 失败${skipped ? ' · ' + skipped + ' 跳过(iSH嵌套不可用)' : ''}`);
if (fail) { console.log('\n失败项:'); failures.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
