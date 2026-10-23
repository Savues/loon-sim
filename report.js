'use strict';
/** Loon 式报告渲染 —— 把 trace 结果格式化成开发者可读的视图 */

const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', b: '\x1b[34m', d: '\x1b[2m', B: '\x1b[1m', x: '\x1b[0m' };
const useColor = process.stdout.isTTY !== false;
const c = (code, s) => (useColor ? code + s + C.x : s);
const tag = (sym, text, color) => `${c(color, sym)} ${text}`;

// ---- 单个 URL 的完整决策视图 ----
function renderTrace({ url, phase, status, argValues, rewrite, script, mitm, done, logs, bodyBefore, bodyAfter, ruleHit, argFormMismatch }) {
  const L = [];
  L.push('');
  L.push(c(C.B, '━'.repeat(72)));
  L.push(c(C.B, `◇ 请求  ${url}`));
  L.push(c(C.B, '━'.repeat(72)));
  L.push(`  阶段 ${c(C.y, phase)}   状态 ${status}   MITM ${mitm.inList ? c(C.g, '命中(' + mitm.matched + ')') : c(C.y, '未命中')}`);
  if (phase === 'response' && bodyBefore != null)
    L.push(`  响应体 ${bodyBefore}B${bodyAfter != null && bodyAfter !== bodyBefore ? ` → ${c(C.g, bodyAfter + 'B')}` : ''}`);

  // ---- Rewrite ----
  if (rewrite && rewrite.length) {
    L.push('');
    const relR = rewrite.filter(r => r.relevant || r.result === 'match');
    L.push(c(C.B, `▸ [Rewrite]  共 ${rewrite.length} 条，与本次请求相关 ${relR.length} 条`));
    if (!relR.length) L.push(`  ${c(C.d, '(无相关规则 — 该 URL 不在任何 [Rewrite] 规则的域名范围内)')}`);
    for (const r of relR) {
      const sym = r.result === 'match' ? c(C.g, '✓') : r.result === 'skip' ? c(C.d, '·') : c(C.d, '✗');
      let line = `  ${sym} ${r.phase}/${shortAction(r.action)}`;
      if (r.result === 'match') line += c(C.g, '   ← 命中');
      if (r.result === 'no') line = `  ${sym} ${c(C.d, shortAction(r.action) + '   (' + r.reason + ')')}`;
      if (r.result === 'skip') line = `  ${sym} ${c(C.d, shortAction(r.action) + '   (' + r.reason + ')')}`;
      L.push(line);
      if (r.note) L.push(`      ${c(C.r, r.note)}`);
    }
  }

  // ---- Script ----
  if (script) {
    const rules = script.rules || [];
    const evaluated = rules.filter(r => r.result !== 'skip');
    L.push('');

    // 只展示参与评估的 + 命中的
    const relS = rules.filter(r => r.relevant || r.result === 'match' || r.result === 'blocked');
    const phaseN = rules.filter(r => r.phase === r.__phase || true).length;
    L.push(c(C.B, `▸ [Script]  插件共 ${rules.length} 条 · 相关 ${relS.length} 条`));
    const show = relS;
    for (const r of show) {
      const sym = r.result === 'match' ? c(C.g, '✓') : r.result === 'blocked' ? c(C.r, '✗') : c(C.d, '✗');
      L.push(`  ${sym} ${c(C.d, r.phase)} → ${shorten(r.script, 46)}`);
      if (r.result === 'match') L.push(`      ${c(C.g, 'URL Guard 匹配')}`);
      if (r.result === 'blocked') L.push(`      ${c(C.r, r.reason)}`);
      if (r.result === 'no') L.push(`      ${c(C.d, r.reason)}`);
    }
    const eff = script.effective;
    if (eff) {
      L.push('');
      L.push(`  ${c(C.g, '▶ 生效规则')}: ${shorten(eff.script, 50)}`);
      L.push(`  ${c(C.B, '$argument')} = ${c(C.y, JSON.stringify(eff.argument))}`);
    } else {
      L.push(`  ${c(C.d, '▶ 无 Script 规则生效')}`);
    }
  }

  // ---- 执行日志 ----
  if (logs && logs.length) {
    L.push('');
    L.push(c(C.B, '▸ 脚本输出 (console.log)'));
    for (const l of logs) L.push(`  ${c(C.d, '|')} ${l}`);
  }

  // ---- 最终结果 ----
  if (done) {
    L.push('');
    L.push(c(C.B, '▸ $done 结果'));
    if (done.error) L.push(`  ${c(C.r, '✗ 执行异常: ' + done.error)}`);
    else if (done.unchanged) L.push(`  ${c(C.d, '原样返回（未修改）')}`);
    else {
      L.push(`  ${c(C.g, '✓ 已修改')}`);
      for (const k of Object.keys(done.fields || {})) {
        const f = done.fields[k];
        L.push(`      ${c(C.y, k)}: ${f.from} ${c(C.g, '→')} ${f.to}`);
      }
    }
  }
  // ---- 诊断建议 ----
  const hints = [];
  const relR = (rewrite || []).filter(r => r.relevant);
  // 注意：relS 要含被 blocked 的（它们在相关规则里）
  const relS = (script && script.rules || []).filter(r => r.relevant || r.result === 'blocked');
  const hasAnyRule = relR.length || relS.length;
  if (!mitm.inList && hasAnyRule)
    hints.push('该域名【不在 MITM 列表】→ 带路径的 [Rewrite]/[Script] 规则永远无法命中。请把域名加入 [Mitm]；纯域名拦截可改用 [Rule]（无需 MITM）');
  if (!hasAnyRule) {
    if (ruleHit) hints.push(`由 [Rule] 段处理（${ruleHit.policy}）—— 域名级拦截无需 MITM，也不会触发 Script`);
    else hints.push('该 URL 不匹配任何规则的域名范围 → 若预期应命中，检查正则（转义 \\. 与 \\/、域名是否写全）');
  }
  if (!done && !blockedGlobal(rewrite) && relS.length && !(script && script.effective)) {
    const blocked = relS.filter(r => r.result === 'blocked');
    if (blocked.length) hints.push(`相关规则被 with enable 挡住：${blocked.map(b => b.reason).join('；')}`);
  }
  // 命中但未修改 → 可疑（常见于"函数定义了但没调用"）
  if (argFormMismatch) {
    hints.push('★ 脚本对 $argument 的【对象/数组】两种形态处理结果不同 —— 真机可能传数组 [{...}]，'
      + '脚本需兼容（本仓库历史事故：v3.37.3 因只处理对象形态导致全部 Script 规则失效）');
    hints.push(`  对象形态 → ${argFormMismatch.object}`);
    hints.push(`  数组形态 → ${argFormMismatch.array}`);
  }
  if (done && done.unchanged && script && script.effective) {
    hints.push('规则已命中，但脚本【未修改任何内容】—— 若预期应修改，检查脚本逻辑（例如清洗函数是否真的被调用；函数定义了但没调用是常见原因）');
  }
  if (hints.length) {
    L.push(c(C.B, '▸ 诊断'));
    for (const h of hints) L.push(`  ${c(C.y, '!')} ${h}`);
  }
  L.push('');
  return L.join('\n');
}

function blockedGlobal(rewrite) {
  return (rewrite || []).some(r => r.result === 'match' && r.terminating);
}

function shortAction(a) {
  if (!a) return '(无动作)';
  return String(a).replace(/\s+/g, ' ').slice(0, 56);
}
function shorten(s, n) { return s && s.length > n ? '…' + s.slice(-(n - 1)) : (s || ''); }

module.exports = { renderTrace, c, C };
