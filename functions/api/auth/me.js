/**
 * GET /api/auth/me - ユーザー情報取得
 */

import { withMiddleware } from '../../lib/middleware.js';
import { errorResponse, jsonResponse } from '../../lib/response.js';
import { authenticateRequest } from '../../lib/auth.js';

async function handler({ request, env }) {
  const payload = await authenticateRequest(request, env);
  if (!payload) return errorResponse('認証が必要です', 401);

  const user = await env.DB.prepare(
    'SELECT id, email, plan, stripe_customer_id, created_at FROM users WHERE id = ?'
  )
    .bind(payload.sub)
    .first();

  if (!user) return errorResponse('ユーザーが見つかりません', 404);

  return jsonResponse({
    id: user.id,
    email: user.email,
    plan: user.plan,
    stripe_customer_id: user.stripe_customer_id,
    created_at: user.created_at,
  });
}

export const onRequestGet = withMiddleware(handler);
export const onRequestOptions = withMiddleware(handler);
