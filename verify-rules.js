#!/usr/bin/env node
'use strict';
/**
 * 规则判定批量校验 —— 用于把「模拟器判定」与「终端实测」对照
 *
 * 用法:
 *   node verify-rules.js <plugin.lpx> <urls.txt>          # urls.txt: 每行一个 URL
 *   node verify-rules.js <plugin.lpx> --from-rule         # 从插件 [Rule] 段自动生成 URL
 * 输出: TSV  <url> <期望策略> <模拟器判定> <是否一致>
 */

const fs = require('fs');
const { parseLpx } = require('./lpx');
const { matchRule, matchRequest } = require('./matcher');

const lpxPath = process.argv[2];
if (!lpxPath) { console.error('用法: node verify-rules.js <plugin.lpx> [urls.txt|--from-rule]'); process.exit(1); }
const lpx = parseLpx(lpxPath);

let urls = [];
const src = process.argv[3];
if (src === '--from-rule') {
  for (const r of lpx.rules) {
    const v = (r.value || '').replace(/^\*\./, '');
    if (!v) continue;
    if (/^(DOMAIN|DOMAIN-SUFFIX|DOMAIN-KEYWORD)$/.test(r.type)) urls.push({ url: `https://${v}/`, expect: r.policy });
  }
} else if (src) {
  urls = fs.readFileSync(src, 'utf8').split('\n').map(s => s.trim()).filter(Boolean).map(u => ({ url: u, expect: null }));
} else {
  // 从 [Script] 规则的 URL Guard 反推样例 URL
  for (const r of lpx.scriptRules) {
    const m = /\$\{url\}\s*~=\s*\/(.+?)\/[a-z]*/i.exec(r.condition || '');
    if (!m) continue;
    let rx = m[1].replace(/\\\//g, '/').replace(/\\\./g, '.').replace(/\(|\)|\?|\+|\*|\$|\^/g, '').split('|')[0];
    if (rx.startsWith('https:/')) urls.push({ url: rx, expect: 'SCRIPT' });
  }
}

const argValues = {};
for (const [k, d] of Object.entries(lpx.args)) argValues[k] = d.default;

let same = 0, diff = 0;
console.log('URL\t期望\t模拟器\t一致');
for (const { url, expect } of urls) {
  const r = matchRule(lpx, url);
  const verdict = r ? r.policy : '—';
  const exp = expect || '—';
  const ok = exp === '—' ? '?' : (verdict === exp ? '✓' : '✗');
  if (ok === '✓') same++; else if (ok === '✗') diff++;
  console.log([url, exp, verdict, ok].join('\t'));
}
console.log(`\n合计: ${urls.length} 条, 一致 ${same}, 不一致 ${diff}`);
