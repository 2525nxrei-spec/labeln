/**
 * Cloudflare Pages Functions グローバルミドルウェア
 * 全APIルートに対してOPTIONSリクエストを早期に処理し、
 * 個別ハンドラーへのルーティングを回避する
 */

import { withCORS } from './lib/response.js';

export async function onRequest(context) {
  const { request } = context;

  // OPTIONSリクエスト（CORS preflight）は即座に204を返す
  // 個別ハンドラーに到達させない
  if (request.method === 'OPTIONS') {
    const origin = request.headers.get('Origin');
    return withCORS(new Response(null, { status: 204 }), origin);
  }

  // その他のリクエストは次のハンドラーに委譲
  return context.next();
}
