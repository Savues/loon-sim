#!/usr/bin/env node
'use strict';
/**
 * 插件脚手架生成器
 * 用法: node cli.js init <plugin-name> [dir]
 * 生成: <dir>/<name>/<name>.lpx + src/<name>.response.js + README.md
 */
const fs = require('fs');
const path = require('path');

const name = process.argv[3];
if (!name || !/^[a-zA-Z][\w-]*$/.test(name)) {
  console.error('用法: node cli.js init <plugin-name> [dir]  (名称以字母开头，仅字母数字连字符)');
  process.exit(1);
}
const base = process.argv[4] || '.';
const dir = path.join(base, name);
if (fs.existsSync(dir)) { console.error(`❌ 目录已存在: ${dir}`); process.exit(1); }

const lpx = `#!name=${name}
#!desc=${name} 插件 — 一句话描述
#!author=YourName
#!homepage=https://github.com/you/your-repo
#!icon=https://example.com/icon.png
#!system=iOS, iPadOS
#!date=${new Date().toISOString().slice(0, 10)}
#!tag=去广告
#!type=normal

[Argument]
enabled = switch,true,tag=启用

[Mitm]
hostname = api.example.com

[Script]
response if ${'${url}'} ~= /^https:\\/\\/api\\.example\\.com\\/v1\\/feed/i then script("src/${name}.response.js", {${'${enabled}'}}) with enable=${'${enabled}'}, requires_body=true, tag="清理Feed"

[Rewrite]
request if ${'${url}'} ~= /^https:\\/\\/api\\.example\\.com\\/ads\\//i then reject_dict(200)

[Rule]
# DOMAIN-SUFFIX, ads.example.com, REJECT
`;

const script = `// ${name} response script
// Loon API 见 docs/script-api.md: $request/$response/$argument/$done
console.log('[${name}] url: ' + $request.url);

let body = $response.body;
try {
  const obj = JSON.parse(body);
  // TODO: 在这里清理广告字段
  if (obj && obj.data && Array.isArray(obj.data.items)) {
    const before = obj.data.items.length;
    obj.data.items = obj.data.items.filter(it => !it.is_ad);
    console.log('[${name}] items: ' + before + ' → ' + obj.data.items.length);
  }
  body = JSON.stringify(obj);
} catch (e) { console.log('[${name}] 非 JSON body, 原样放行'); }

$done({ body });
`;

const readme = `# ${name}

## 开发

\`\`\`bash
# 静态校验
node tools/loon-sim/cli.js check plugins/${name}/${name}.lpx

# 决策追踪 (换成你的目标 URL)
node tools/loon-sim/cli.js run plugins/${name}/${name}.lpx --url "https://api.example.com/v1/feed"

# HAR 回放 / 转换 / 一致性 — 见 tools/loon-sim/README.md
\`\`\`

## 开关

| 参数 | 默认 | 说明 |
|------|------|------|
| enabled | true | 启用 |

## 验证记录

- [ ] check 0 错误
- [ ] run 决策符合预期
- [ ] 真机确认
`;

fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
fs.writeFileSync(path.join(dir, `${name}.lpx`), lpx);
fs.writeFileSync(path.join(dir, 'src', `${name}.response.js`), script);
fs.writeFileSync(path.join(dir, 'README.md'), readme);
console.log(`✅ 已生成 ${dir}/`);
console.log(`   ${name}.lpx · src/${name}.response.js · README.md`);
console.log(`\n下一步:`);
console.log(`  node cli.js check ${dir}/${name}.lpx`);
