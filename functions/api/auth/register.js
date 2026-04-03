/**
 * POST /api/auth/register - ユーザー登録
 */

import { withMiddleware } from '../../lib/middleware.js';
import { errorResponse, jsonResponse } from '../../lib/response.js';
import { hashPassword, generateSalt, generateId, createJWT, isValidEmail, isValidPassword } from '../../lib/auth.js';

async function handler({ request, env }) {
  const body = await request.json().catch(() => null);
  if (!body) return errorResponse('リクエストボディが不正です', 400);

  const { email, password } = body;

  if (!email || !isValidEmail(email)) {
    return errorResponse('有効なメールアドレスを入力してください', 400);
  }
  if (!password || !isValidPassword(password)) {
    return errorResponse('パスワードは8文字以上で入力してください', 400);
  }
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return errorResponse('パスワードは英字と数字の両方を含めてください', 400);
  }

  // セキュリティ: 登録時は常にfreeプラン。有料プランはStripe決済後にのみ変更される
  const selectedPlan = 'free';

  // メールアドレス正規化
  const emailLower = email.toLowerCase().trim();

  // 既存ユーザーチェック
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(emailLower).first();
  if (existing) {
    return errorResponse('このメールアドレスは既に登録されています', 409);
  }

  // パスワードハッシュ化
  const salt = generateSalt();
  const passwordHash = await hashPassword(password, salt);
  const userId = generateId();
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, salt, plan, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(userId, emailLower, passwordHash, salt, selectedPlan, now, now)
    .run();

  // JWT発行（JWT_SECRET未設定時はエラー）
  if (!env.JWT_SECRET) {
    return errorResponse('サーバー設定エラー: JWT_SECRETが未設定です', 500);
  }
  const secret = env.JWT_SECRET;
  const token = await createJWT(
    {
      sub: userId,
      email: emailLower,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    },
    secret
  );

  return jsonResponse({ token, user: { id: userId, email: emailLower, plan: selectedPlan } }, 201);
}

export const onRequestPost = withMiddleware(handler);
export const onRequestOptions = withMiddleware(handler);
