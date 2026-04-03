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
  // 許可するオリジン（本番 + ローカル開発）
  const allowedOrigins = [
    'https://mylabeln.com',
    'https://www.mylabeln.com',
    'http://localhost:8788',
  ];
  // Cloudflare Pagesプレビュー用（自プロジェクトのみ許可）
  const isAllowed = origin &&
    (allowedOrigins.includes(origin) || /^https:\/\/[a-z0-9-]+\.label[nu][a-z0-9-]*\.pages\.dev$/.test(origin));
  const resolvedOrigin = isAllowed ? origin : 'https://mylabeln.com';

  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', resolvedOrigin);
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  headers.set('Access-Control-Max-Age', '86400');
  // セキュリティヘッダー
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-XSS-Protection', '1; mode=block');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
