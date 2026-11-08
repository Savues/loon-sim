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
 * 用法: node dead-fn.js <bundle.js> [更多文件...] [--json]
 *   支持一次传多个文件 — iSH 里 node 启动 ~0.37s，逐文件 spawn 是主要耗时
 */
const fs = require('fs');

const asJson = process.argv.includes('--json');
const files = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (files.length === 0 || !files.every(f => fs.existsSync(f))) {
  console.error('用法: node dead-fn.js <bundle.js> [更多文件...] [--json]');
  process.exit(1);
}
const multi = files.length > 1;
let anyDead = false;
const jsonOut = [];

// 入口函数豁免 (main 等); 混淆函数名豁免 (a0_0x..., 多为字符串解码器, 词边界分析不适用)
const ENTRY = new Set(['main']);
const OBFUSCATED = /^a\d+_\w+$|_0x/;
const isExempt = (d) => ENTRY.has(d.name) || OBFUSCATED.test(d.name);

for (const file of files) {
  const code = fs.readFileSync(file, 'utf8');
  const lines = code.split('\n');

  // 顶格 function 或变量函数定义 (缩进定义视为嵌套/私有, 不检)
  const defs = [];
  lines.forEach((l, i) => {
    let m = /^function (\w+)\s*\(/.exec(l);
    if (!m) {
      m = /^(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[a-zA-Z_$][\w$]*)\s*=>/.exec(l);
    }
    if (!m) {
      m = /^(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?function\s*(?:\w+)?\s*\(/.exec(l);
    }
    if (m) defs.push({ name: m[1], line: i + 1 });
  });

  // 每个 def 在其余行中的出现次数
  const dead = [];
  for (const d of defs) {
    const re = new RegExp('\\b' + d.name + '\\b');
    let refs = 0;
    for (let i = 0; i < lines.length; i++) {
      if (i + 1 === d.line) continue;
      if (re.test(lines[i])) refs++;
    }
    if (refs === 0) dead.push(d);
  }

  const realDead = dead.filter(d => !isExempt(d));
  if (realDead.length > 0) anyDead = true;

  if (asJson) {
    jsonOut.push({ file, total: defs.length, dead: realDead });
    continue;
  }

  const tag = multi ? file + ': ' : '';
  console.log(`${tag}函数定义: ${defs.length} (顶格)`);
  if (realDead.length === 0) {
    console.log(`${tag}死代码: 无 ✅`);
  } else {
    console.log(`${tag}死代码: ${realDead.length} 🔴`);
    for (const d of realDead) console.log(`  L${d.line} ${d.name} — 定义行唯一出现, 无任何调用/引用`);
  }
}

if (asJson) console.log(JSON.stringify(multi ? jsonOut : jsonOut[0]));
process.exit(anyDead ? 2 : 0);
