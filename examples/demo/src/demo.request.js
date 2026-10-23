// 示例请求脚本：改写请求头
const headers = Object.assign({}, $request.headers, { 'X-Simulated': '1' });
$done({ headers });
