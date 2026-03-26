/**
 * 共通レスポンスユーティリティ
 */

/** 統一エラーレスポンス */
export function errorResponse(message, code = 400) {
  return new Response(JSON.stringify({ error: message, code }), {
    status: code,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 成功レスポンス */
export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** CORSヘッダーを付与 */
export function withCORS(response, origin) {
  const allowedOrigin = origin || '*';
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', allowedOrigin);
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  headers.set('Access-Control-Max-Age', '86400');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
