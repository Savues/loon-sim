#!/usr/bin/env node
'use strict';
/**
 * 旧版插件 → 新版语法转换（官方实现）+ 自动兜底流水线
 *
 * 兜底内容（对应官方转换器审计报告的问题 1/3/4）：
 *   ① [URL Rewrite] 段被官方 convertText 跳过 → 检测后把段名改写为 [Rewrite] 重转（问题1）
 *   ② 转换产物自动跑 loon-sim check（能兜住捕获组越界/未声明 enable 等，问题3/4）
 *   ③ 转换产物自动跑 parity 一致性验证
 *
 * 用法:
 *   node cli.js convert <plugin.lpx>            # 转换 + 兜底验证，打印明细
 *   node cli.js convert <plugin.lpx> -o out.lpx # 写出转换结果（含 [URL Rewrite] 修复）
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const converter = require('./converter');

function cmdConvert() {
  const lpxPath = process.argv[3];
  const outIdx = process.argv.indexOf('-o');
  const outPath = outIdx > 0 ? process.argv[outIdx + 1] : null;
  if (!lpxPath || !fs.existsSync(lpxPath)) { console.error('用法: node cli.js convert <plugin.lpx> [-o out.lpx]'); process.exit(1); }
  let src = fs.readFileSync(lpxPath, 'utf8');

  // ① [URL Rewrite] 段兜底: 官方 convertText 段过滤只认小写 rewrite/script,
  //    [URL Rewrite] 段被静默跳过 (审计问题1) → 改写段名后重转
  const hasUrlRewrite = /^\[URL Rewrite\]/m.test(src);
  if (hasUrlRewrite) {
    src = src.replace(/^\[URL Rewrite\]$/m, '[Rewrite]');
    console.log('⚠️ 检测到 [URL Rewrite] 段（官方转换器会跳过它）→ 已改写为 [Rewrite] 处理');
  }

  const r = converter.convertText(src);
  console.log(`转换完成: ${r.converted} 条已转换 · ${r.errors} 条失败`);
  for (const rec of r.records) {
    if (rec.status === 'error') console.log(`  ❌ L${rec.line} [${rec.kind}] ${rec.source.trim().slice(0, 80)}`);
  }
  for (const d of r.diagnostics) console.log(`  ⚠️ L${d.line} ${d.code}: ${d.message}`);

  const tmpOut = outPath || '/tmp/loon_convert_out.lpx';
  fs.writeFileSync(tmpOut, r.text);

  // ② 转换产物 check 兜底 (比官方转换器严格)
  console.log('\n--- 兜底① check（转换产物静态校验）---');
  try {
    const out = execSync(`node "${__dirname}/cli.js" check "${tmpOut}"`, { encoding: 'utf8', cwd: __dirname });
    console.log(out.trim().split('\n').filter(l => /❌|⚠️|结果/.test(l)).join('\n') || '  ✅ check 通过');
  } catch (e) {
    console.log((e.stdout || e.message).trim().split('\n').filter(l => /❌|⚠️|结果/.test(l)).join('\n'));
  }

  // ③ parity 一致性
  console.log('\n--- 兜底② parity（新旧解析一致性）---');
  try {
    const out = execSync(`node "${__dirname}/convert-parity.js" "${lpxPath}"`, { encoding: 'utf8', cwd: __dirname })
      .trim().split('\n').filter(l => /❌|结果/.test(l)).join('\n');
    console.log(out || '  ✅ 一致');
  } catch (e) {
    console.log((e.stdout || e.message).trim().split('\n').filter(l => /❌|结果/.test(l)).join('\n'));
  }

  if (outPath) {
    console.log(`\n✅ 已写出: ${outPath}`);
  } else {
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
