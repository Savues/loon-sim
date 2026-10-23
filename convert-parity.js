#!/usr/bin/env node
'use strict';
/**
 * 转换一致性测试: 官方转换器(旧→新)后, 模拟器对两版本的解析决策必须等价
 * 用法: node convert-parity.js <plugin.lpx>
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const converter = require('./converter');
const { parseLpx } = require('./lpx');

const file = process.argv[2];
if (!file) { console.error('用法: node convert-parity.js <plugin.lpx>'); process.exit(1); }

const src = fs.readFileSync(file, 'utf8');
const conv = converter.convertText(src);
if (!conv.converted) { console.log('无旧语法规则，跳过'); process.exit(0); }

const tmp = '/tmp/parity_' + path.basename(file);
fs.writeFileSync(tmp, conv.text);

const a = parseLpx(file), b = parseLpx(tmp);
let fail = 0;

// ① Script 规则数一致
if (a.scriptRules.length !== b.scriptRules.length) {
  console.log(`❌ Script 规则数: 旧 ${a.scriptRules.length} vs 新 ${b.scriptRules.length}`); fail++;
}
// ② 逐条对比 (phase/trigger/scriptPath/argumentKeys)
for (let i = 0; i < Math.min(a.scriptRules.length, b.scriptRules.length); i++) {
  const ra = a.scriptRules[i], rb = b.scriptRules[i];
  const cmp = (field) => {
    const va = JSON.stringify(ra[field]), vb = JSON.stringify(rb[field]);
    if (va !== vb) { console.log(`❌ Script[${i}].${field}: ${va?.slice(0,60)} vs ${vb?.slice(0,60)}`); fail++; }
  };
  cmp('phase');
  // trigger 归一化: 旧='cron'(+condition 存表达式) / 新='cron "expr"' — 取触发类型词比较
  const normT = (r) => String(r.trigger || '').split(/\s/)[0].replace(/"[^"]*"/g, '').trim() || (r.condition && !r.condition.startsWith('$') ? 'cron' : '');
  const ta = normT(ra), tb = normT(rb);
  if (ta !== tb) { console.log(`❌ Script[${i}].trigger: ${ta} vs ${tb}`); fail++; }
  cmp('scriptPath');
  const ka = JSON.stringify(ra.argumentKeys?.sort()), kb = JSON.stringify(rb.argumentKeys?.sort());
  if (ka !== kb) { console.log(`❌ Script[${i}].argumentKeys: ${ka} vs ${kb}`); fail++; }
}
// ③ Rewrite 规则数
if (a.rewriteRules.length !== b.rewriteRules.length) {
  console.log(`❌ Rewrite 规则数: 旧 ${a.rewriteRules.length} vs 新 ${b.rewriteRules.length}`); fail++;
}
// ④ Argument 解析一致
const ak = JSON.stringify(Object.keys(a.args).sort()), bk = JSON.stringify(Object.keys(b.args).sort());
if (ak !== bk) { console.log(`❌ Argument keys 不一致: ${ak} vs ${bk}`); fail++; }

console.log(fail ? `\n结果: ${fail} 处不一致 ❌` : `\n结果: 一致性通过 ✅ (Script ${a.scriptRules.length} · Rewrite ${a.rewriteRules.length} · 转换 ${conv.converted} 条)`);
process.exit(fail ? 1 : 0);
