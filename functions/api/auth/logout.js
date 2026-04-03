/**
 * POST /api/auth/logout - ログアウト
 * JWTはステートレスのため、サーバー側で無効化処理は不要。
 * httpOnly cookieがあれば削除し、成功レスポンスを返す。
 */

import { withMiddleware } from '../../lib/middleware.js';
import { jsonResponse } from '../../lib/response.js';

async function handler() {
  return new Response(JSON.stringify({ message: 'ログアウトしました' }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // httpOnly cookieを使用している場合に備えてクリア
      'Set-Cookie': 'token=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
    },
  });
}

export const onRequestPost = withMiddleware(handler);
export const onRequestOptions = withMiddleware(handler);
