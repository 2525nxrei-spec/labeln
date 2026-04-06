/**
 * POST /api/requests - リクエスト・フィードバック送信
 * 認証不要（匿名投稿可）
 */

import { withMiddleware } from '../lib/middleware.js';
import { errorResponse, jsonResponse } from '../lib/response.js';
import { generateId } from '../lib/auth.js';

async function handler({ request, env }) {
  const body = await request.json().catch(() => null);
  if (!body) return errorResponse('リクエストボディが不正です', 400);

  const { name, email, category, message } = body;

  // バリデーション
  if (!category || !['feature', 'bug', 'other'].includes(category)) {
    return errorResponse('有効なカテゴリを指定してください', 400);
  }
  if (!message || message.trim().length === 0) {
    return errorResponse('内容を入力してください', 400);
  }
  if (message.trim().length > 5000) {
    return errorResponse('内容は5000文字以内で入力してください', 400);
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return errorResponse('メールアドレスの形式が正しくありません', 400);
  }

  const id = generateId();
  const now = new Date().toISOString();
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  await env.DB.prepare(
    'INSERT INTO requests (id, name, email, category, message, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, name || '', email || '', category, message.trim(), ip, now)
    .run();

  return jsonResponse({ success: true, id }, 201);
}

export const onRequestPost = withMiddleware(handler);
export const onRequestOptions = withMiddleware(handler);
