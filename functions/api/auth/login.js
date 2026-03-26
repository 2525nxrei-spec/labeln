/**
 * POST /api/auth/login - ログイン
 */

import { withMiddleware } from '../../lib/middleware.js';
import { errorResponse, jsonResponse } from '../../lib/response.js';
import { hashPassword, createJWT } from '../../lib/auth.js';

async function handler({ request, env }) {
  const body = await request.json().catch(() => null);
  if (!body) return errorResponse('リクエストボディが不正です', 400);

  const { email, password } = body;
  if (!email || !password) {
    return errorResponse('メールアドレスとパスワードを入力してください', 400);
  }

  // メールアドレス正規化
  const emailLower = email.toLowerCase().trim();

  // ユーザー検索
  const user = await env.DB.prepare('SELECT id, email, password_hash, salt, plan FROM users WHERE email = ?')
    .bind(emailLower)
    .first();

  if (!user) {
    return errorResponse('メールアドレスまたはパスワードが正しくありません', 401);
  }

  // パスワード照合
  const inputHash = await hashPassword(password, user.salt);
  if (inputHash !== user.password_hash) {
    return errorResponse('メールアドレスまたはパスワードが正しくありません', 401);
  }

  // JWT発行（JWT_SECRET未設定時はエラー）
  if (!env.JWT_SECRET) {
    return errorResponse('サーバー設定エラー: JWT_SECRETが未設定です', 500);
  }
  const secret = env.JWT_SECRET;
  const token = await createJWT(
    {
      sub: user.id,
      email: user.email,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    },
    secret
  );

  return jsonResponse({
    token,
    user: { id: user.id, email: user.email, plan: user.plan },
  });
}

export const onRequestPost = withMiddleware(handler);
export const onRequestOptions = withMiddleware(handler);
