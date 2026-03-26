/**
 * GET /api/usage - 利用量取得
 */

import { withMiddleware } from '../lib/middleware.js';
import { errorResponse, jsonResponse } from '../lib/response.js';
import { authenticateRequest } from '../lib/auth.js';
import { PLAN_LIMITS, getCurrentMonth } from '../lib/usage.js';

async function handler({ request, env }) {
  const payload = await authenticateRequest(request, env);
  if (!payload) return errorResponse('認証が必要です', 401);

  const month = getCurrentMonth();

  const user = await env.DB.prepare('SELECT plan FROM users WHERE id = ?').bind(payload.sub).first();
  const plan = user?.plan || 'free';
  const limit = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

  const usage = await env.DB.prepare(
    'SELECT label_count FROM usage WHERE user_id = ? AND month = ?'
  )
    .bind(payload.sub, month)
    .first();

  const currentCount = usage?.label_count || 0;

  return jsonResponse({
    month,
    plan,
    label_count: currentCount,
    label_limit: limit,
    remaining: Math.max(0, limit - currentCount),
  });
}

export const onRequestGet = withMiddleware(handler);
export const onRequestOptions = withMiddleware(handler);
