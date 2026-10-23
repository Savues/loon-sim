#!/usr/bin/env node
'use strict';
/**
 * 旧版插件 → 新版语法转换（官方实现）
 * 来源: nsloon.app/plugin-converter 页面的本地 JS 实现（纯浏览器端，无服务端）
 * 用法:
 *   node cli.js convert <plugin.lpx>            # 转换并打印 diff 摘要
 *   node cli.js convert <plugin.lpx> -o out.lpx # 写出转换结果
 */
const fs = require('fs');
const converter = require('./converter');

function cmdConvert() {
  const [lpxPath] = [process.argv[3]];
  const outIdx = process.argv.indexOf('-o');
  const outPath = outIdx > 0 ? process.argv[outIdx + 1] : null;
  if (!lpxPath || !fs.existsSync(lpxPath)) { console.error('用法: node cli.js convert <plugin.lpx> [-o out.lpx]'); process.exit(1); }
  const src = fs.readFileSync(lpxPath, 'utf8');
  const r = converter.convertText(src);
  console.log(`转换完成: ${r.converted} 条已转换 · ${r.errors} 条失败`);
  for (const rec of r.records) {
    if (rec.status === 'error') console.log(`  ❌ L${rec.line} [${rec.kind}] ${rec.source.trim().slice(0, 80)}`);
  }
  for (const d of r.diagnostics) console.log(`  ⚠️ L${d.line} ${d.code}: ${d.message}`);
  if (outPath) { fs.writeFileSync(outPath, r.text); console.log(`✅ 已写出: ${outPath}`); }
  else {
    console.log('\n--- 转换明细 ---');
    for (const rec of r.records) {
      if (rec.status === 'converted') {
        console.log(`L${rec.line} [${rec.kind}]`);
        console.log('  旧: ' + rec.source.trim().slice(0, 150));
        console.log('  新: ' + rec.output.trim().slice(0, 150));
      }
    }
  }
  process.exit(r.errors ? 2 : 0);
}
cmdConvert();
