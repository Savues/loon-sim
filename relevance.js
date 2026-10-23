'use strict';
/**
 * 判定规则与目标 URL 的「相关性」—— 用于过滤 trace 输出
 *
 * 相关性 = 规则 URL 正则的 **host 段** 与目标 URL 的 host 存在交集。
 * 严格模式：无法从正则提取出 host 时，一律视为「不相关」（避免噪音）。
 */

function hostOf(url) { try { return new URL(url).hostname; } catch { return ''; } }

/** 把 (?:a|b) 分组展开成多个候选 */
function expand(part) {
  const m = /^(.*?)\(\?:([^)]*)\)(.*)$/.exec(part);
  if (!m) return [part];
  const [, pre, alts, post] = m;
  return alts.split('|').flatMap(a => expand(pre + a + post));
}

/** 从 Loon URL 正则（condition 或裸正则）中提取可能的 host 列表 */
function hostsInRegex(rx) {
  if (!rx || typeof rx !== 'string') return [];
  // 1) 抽出 /.../  之间的正则体（兼容 `${url} ~= /.../i` 包装）
  let body = rx;
  const wrap = /~=\s*\/([\s\S]*)\/[a-z]*\s*$/.exec(rx.trim());
  if (wrap) body = wrap[1];
  // 2) 展平转义：\/ → /  \. → .
  const flat = body.replace(/\\\//g, '/').replace(/\\\./g, '.').replace(/\\\\/g, '\\');
  // 3) 取协议后的 host 段
  const m = /(?:https?:\/\/|\/\/)([^/]+)/.exec(flat);
  if (!m) return [];
  const hostPart = m[1];
  const out = [];
  for (const raw of expand(hostPart)) {
    const h = raw
      .replace(/\[[^\]]*\]/g, '')
      .replace(/[()?+*^$|]/g, '')
      .replace(/\\/g, '')
      .trim();
    if (h && h.includes('.')) out.push(h);
  }
  return out;
}

/** 判断规则是否与目标 URL 相关 */
function isRelevant(ruleCondition, url) {
  const host = hostOf(url);
  if (!host) return false;
  const cands = hostsInRegex(ruleCondition);
  if (!cands.length) return false;              // ★ 严格：提取不出 host → 不相关
  return cands.some(h => {
    const hh = h.replace(/^\*\./, '');
    if (hh === host) return true;
    if (host.endsWith('.' + hh)) return true;   // 子域
    if (hh.endsWith('.' + host)) return true;   // 规则更宽
    return false;
  });
}

module.exports = { isRelevant, hostsInRegex, hostOf };
