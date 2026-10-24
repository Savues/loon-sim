#!/usr/bin/env node
'use strict'
/**
 * dead-fn — bundle.js 死函数检测 (v1.6.7)
 *
 * 判定规则 (源自 2026-10-24 两次真实事故的甄别经验):
 *   顶格 function 定义, 若【除定义行外全文零出现】→ 死代码
 *   (被调用/被二级分发器引用/被当回调传参 都算"出现" — 只有定义行孤零零存在的才是死代码)
 *
 * 误报防线:
 *   - handleMoonResponse 等二级分发器内的引用会被计入(它调用时函数名必然出现)
 *   - 内联重写后的孤儿函数(定义行唯一出现)正是本工具要抓的
 *
 * 用法: node dead-fn.js <bundle.js> [--json]
 */
const fs = require('fs');

const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('用法: node dead-fn.js <bundle.js> [--json]'); process.exit(1); }
const asJson = process.argv.includes('--json');
const code = fs.readFileSync(file, 'utf8');

// 顶格 function 定义 (缩进定义视为嵌套/私有, 不检)
const defs = [];
code.split('\n').forEach((l, i) => {
  const m = /^function (\w+)\s*\(/.exec(l);
  if (m) defs.push({ name: m[1], line: i + 1 });
});

// 每个 def 在其余行中的出现次数
const dead = [];
for (const d of defs) {
  let refs = 0;
  code.split('\n').forEach((l, i) => {
    if (i + 1 === d.line) return;
    // 词边界匹配 (避免 filterTAC 误中 filterTACServiceCall)
    if (new RegExp('\\b' + d.name + '\\b').test(l)) refs++;
  });
  if (refs === 0) dead.push(d);
}

// 入口函数豁免 (main 等); 混淆函数名豁免 (a0_0x..., 多为字符串解码器, 词边界分析不适用)
const ENTRY = new Set(['main']);
const OBFUSCATED = /^a\d+_\w+$|_0x/;
const isExempt = (d) => ENTRY.has(d.name) || OBFUSCATED.test(d.name);

if (asJson) {
  console.log(JSON.stringify({ total: defs.length, dead: dead.filter(d => !isExempt(d)) }));
} else {
  console.log(`函数定义: ${defs.length} (顶格)`);
  const realDead = dead.filter(d => !isExempt(d));
  if (realDead.length === 0) {
    console.log('死代码: 无 ✅');
  } else {
    console.log(`死代码: ${realDead.length} 🔴`);
    for (const d of realDead) console.log(`  L${d.line} ${d.name} — 定义行唯一出现, 无任何调用/引用`);
    process.exit(2);
  }
}
