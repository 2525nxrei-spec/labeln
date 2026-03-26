/**
 * Pages Functions共通ミドルウェア
 * CORS処理とレート制限を一元管理
 */

import { withCORS, errorResponse } from './response.js';
import { isRateLimited } from './rate-limit.js';

/**
 * CORSとレート制限を適用するラッパー
 * @param {Function} handler - 実際のリクエスト処理関数(context) => Response
 * @param {Object} options - オプション
 * @param {boolean} options.skipRateLimit - レート制限をスキップするか
 */
export function withMiddleware(handler, options = {}) {
  return async (context) => {
    const { request, env } = context;
    const origin = request.headers.get('Origin');

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return withCORS(new Response(null, { status: 204 }), origin);
    }

    // レート制限チェック
    if (!options.skipRateLimit) {
      const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
      const limited = await isRateLimited(clientIP, env);
      if (limited) {
        return withCORS(
          errorResponse('リクエスト数が上限を超えました。しばらく待ってから再試行してください。', 429),
          origin
        );
      }
    }

    try {
      const response = await handler(context);
      return withCORS(response, origin);
    } catch (err) {
      console.error(`Error in ${request.method} ${new URL(request.url).pathname}:`, err);
      return withCORS(
        errorResponse('サーバー内部エラーが発生しました', 500),
        origin
      );
    }
  };
}
