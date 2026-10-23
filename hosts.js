'use strict';
/**
 * 从规则正则文本中提取 host（容忍 \/ 转义、(?:a|b) 分组、\. 转义、https? 量词）
 */
function extractHosts(txt) {
  // 先归一化: 去掉反斜杠转义, https? -> https
  const plain = String(txt || '')
    .replace(/\\/g, '')
    .replace(/https\?/g, 'https');
  const hosts = new Set();
  const re = /https?:\/\/([^/\s]+)/gi;
  let m;
  while ((m = re.exec(plain))) {
    let seg = m[1].split('|')[0];
    // 展开 (?:acs|guide-acs).m.taobao.com 形式 → 取分组内每个分支
    if (seg.includes('(?:')) seg = ''; // 嵌套分组无法静态展开
    const grp = /^\(\?:([^)]*)\)(.+)$/.exec(seg);
    if (grp) {
      for (const b of grp[1].split('|')) {
        const h = b + grp[2];
        if (/[a-z]/i.test(b)) hosts.add(h); // 忽略纯数字/空分支
      }
    } else if (/^[a-z0-9*.-]+\.[a-z]{2,}$/i.test(seg) && !seg.includes('(')) {
      hosts.add(seg);
    }
  }
  return [...hosts];
}

module.exports = { extractHosts };
