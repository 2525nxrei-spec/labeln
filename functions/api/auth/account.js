/**
 * DELETE /api/auth/account — アカウント削除
 */

import { withMiddleware } from '../../lib/middleware.js';
import { errorResponse, jsonResponse } from '../../lib/response.js';
import { authenticateRequest, hashPassword } from '../../lib/auth.js';

async function handler({ request, env }) {
  const payload = await authenticateRequest(request, env);
  if (!payload) return errorResponse('認証が必要です', 401);

  const body = await request.json().catch(() => null);
  if (!body) return errorResponse('リクエストボディが不正です', 400);

  const { password } = body;
  if (!password) return errorResponse('パスワードの入力が必要です', 400);

  // パスワード検証
  const user = await env.DB.prepare(
    'SELECT id, password_hash, salt FROM users WHERE id = ?'
  ).bind(payload.sub).first();

  if (!user) return errorResponse('ユーザーが見つかりません', 404);

  const hash = await hashPassword(password, user.salt);
  if (hash !== user.password_hash) {
    return errorResponse('パスワードが正しくありません', 401);
  }

  // アカウント削除
  await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(payload.sub).run();

  return jsonResponse({ message: 'アカウントを削除しました。ご利用ありがとうございました。' });
}

export const onRequestDelete = withMiddleware(handler);
