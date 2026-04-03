/**
 * PUT /api/auth/password — パスワード変更
 */

import { withMiddleware } from '../../lib/middleware.js';
import { errorResponse, jsonResponse } from '../../lib/response.js';
import { authenticateRequest, hashPassword, generateSalt } from '../../lib/auth.js';

async function handler({ request, env }) {
  const payload = await authenticateRequest(request, env);
  if (!payload) return errorResponse('認証が必要です', 401);

  const body = await request.json().catch(() => null);
  if (!body) return errorResponse('リクエストボディが不正です', 400);

  const { current_password, new_password } = body;
  if (!current_password || !new_password) {
    return errorResponse('現在のパスワードと新しいパスワードは必須です', 400);
  }

  if (new_password.length < 8) {
    return errorResponse('新しいパスワードは8文字以上で設定してください', 400);
  }

  if (!/[a-zA-Z]/.test(new_password) || !/[0-9]/.test(new_password)) {
    return errorResponse('パスワードは英字と数字の両方を含めてください', 400);
  }

  // 現在のパスワードを検証
  const user = await env.DB.prepare(
    'SELECT id, password_hash, salt FROM users WHERE id = ?'
  ).bind(payload.sub).first();

  if (!user) return errorResponse('ユーザーが見つかりません', 404);

  const currentHash = await hashPassword(current_password, user.salt);
  if (currentHash !== user.password_hash) {
    return errorResponse('現在のパスワードが正しくありません', 401);
  }

  // 新しいパスワードで更新
  const newSalt = generateSalt();
  const newHash = await hashPassword(new_password, newSalt);

  await env.DB.prepare(
    "UPDATE users SET password_hash = ?, salt = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(newHash, newSalt, payload.sub).run();

  return jsonResponse({ message: 'パスワードを変更しました' });
}

export const onRequestPut = withMiddleware(handler);
export const onRequestOptions = withMiddleware(handler);
