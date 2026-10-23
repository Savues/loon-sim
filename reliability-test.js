// 仓库插件可靠性批量测试: 从每个插件的真实规则自动提取测试 URL, 全量跑决策追踪
// 用法: node reliability-test.js   (在 tools/loon-sim 下)
// 已知局限: 提取器只处理 gw/mtop.* 形态; 前缀规则(尾点)自动补 .report
const fs = require('fs');
const SIM = '/var/minis/shared/loon-plugin-patches/tools/loon-sim';
const { parseLpx } = require(SIM + '/lpx.js');
const { execFileSync } = require('child_process');
const dirs = fs.readdirSync('/var/minis/shared/loon-plugin-patches/plugins');
let plugins = 0, urls = 0, matchOk = 0, scriptOk = 0, crashes = 0;
const issues = [];
for (const d of dirs) {
  const dir = '/var/minis/shared/loon-plugin-patches/plugins/' + d;
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.lpx') || /^(test-|upstream-)/.test(f) || f.includes('jsdelivr')) continue;
    const path = dir + '/' + f;
    let p;
    try { p = parseLpx(path); } catch (e) { issues.push(`${d}: parse ${e.message}`); continue; }
    plugins++;
    const seen = new Set();
    for (const r of [...p.scriptRules, ...p.rewriteRules]) {
      const c = String(r.condition || '').replace(/\\/g, '');
      const cFlat = c.replace(/\(\?:([^()]+)\)/g, (_, g) => g.split('|')[0]);
      const m = /gw\/(mtop\.[a-z0-9.]+[a-z0-9])/i.exec(cFlat);
      if (!m) continue;
      const hm = /(?:acs|guide-acs|cn-acs|[a-z-]+)\.(m\.[a-z.]+?com|[a-z.]+\.goofish\.com)/.exec(cFlat); const host = hm ? (hm[0].startsWith('m.') ? 'acs.' + hm[0] : hm[0]) : 'acs.m.taobao.com';
      const url = `https://${host}/gw/${m[1]}/1.0/`;
      if (seen.has(url)) continue;
      seen.add(url);
      urls++;
      let out = '';
      try {
        out = execFileSync('node', [SIM + '/cli.js', 'run', path, '--url', url, '--phase', 'response'], {encoding: 'utf8', stdio: 'pipe'}).toString();
      } catch (e) { out = (e.stdout || '').toString(); }
      if (urls <= 1) console.log("DEBUG out.len=", out.length, "含生效:", out.includes("生效规则"), "色码:", out.includes(""), "输出头:", JSON.stringify(out.slice(0,120)));
      const hit = out.includes('生效规则') || out.includes('← 命中') || /✓ (response|request)/.test(out);
      if (hit) matchOk++;
      else issues.push(`${d} 未命中 ${url.slice(25, 75)}`);
      if (out.includes('已修改')) scriptOk++;
      if (/Cannot read|undefined is not|SyntaxError/.test(out)) { crashes++; issues.push(`${d}: JS错误 ${url.slice(25, 60)}`); }
    }
  }
}
console.log(`插件 ${plugins} · URL ${urls} · 命中 ${matchOk} · 脚本改写 ${scriptOk} · JS错误 ${crashes}`);
const miss = issues.filter(i => i.includes('未命中'));
const err = issues.filter(i => !i.includes('未命中'));
console.log(`未命中 ${miss.length}:`); miss.slice(0, 8).forEach(x => console.log(' ', x));
console.log(`JS错误 ${err.length}:`); err.slice(0, 8).forEach(x => console.log(' ', x));
