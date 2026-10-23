// 示例响应脚本：清理 feed 里的广告项
const body = $response.body;
if (!body) { $done({}); }

let data;
try { data = JSON.parse(body); } catch (e) { $done({}); return; }

const items = (data && data.data && data.data.list) || [];
const kept = items.filter(it => !(it && (it.isAd === true || it.adType)));
const removed = items.length - kept.length;

if (data.data) data.data.list = kept;
if ($argument && $argument.addTag) data.simTag = 'processed';

console.log(`[demo] 移除广告 ${removed} 条, 保留 ${kept.length} 条`);
$done({ body: JSON.stringify(data) });
