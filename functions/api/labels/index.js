/**
 * /api/labels
 * POST - ラベル新規作成
 * GET  - ラベル一覧取得
 */

import { withMiddleware } from '../../lib/middleware.js';
import { errorResponse, jsonResponse } from '../../lib/response.js';
import { authenticateRequest, generateId } from '../../lib/auth.js';
import { checkUsageLimit, incrementUsage } from '../../lib/usage.js';

/** ラベル保存（新規作成） */
async function handleCreate({ request, env }) {
  const payload = await authenticateRequest(request, env);
  if (!payload) return errorResponse('認証が必要です', 401);

  const body = await request.json().catch(() => null);
  if (!body) return errorResponse('リクエストボディが不正です', 400);

  const { product_name, category, ingredients, allergens, nutrition, label_settings, translations } = body;

  if (!product_name || typeof product_name !== 'string') {
    return errorResponse('製品名（product_name）は必須です', 400);
  }

  // 利用量上限チェック（freeプラン月3件等）
  const usageOk = await checkUsageLimit(payload.sub, env);
  if (!usageOk) {
    return errorResponse('今月のラベル作成上限に達しました。プランをアップグレードしてください。', 403);
  }

  const labelId = generateId();
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO labels (id, user_id, product_name, category, ingredients_json, allergens_json, nutrition_json, label_settings_json, translations_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      labelId,
      payload.sub,
      product_name,
      category || null,
      JSON.stringify(ingredients || []),
      JSON.stringify(allergens || []),
      JSON.stringify(nutrition || {}),
      JSON.stringify(label_settings || {}),
      JSON.stringify(translations || {}),
      now,
      now
    )
    .run();

  // 利用量カウントをインクリメント
  await incrementUsage(payload.sub, env);

  return jsonResponse({ id: labelId, product_name, created_at: now }, 201);
}

/** ラベル一覧取得 */
async function handleList({ request, env }) {
  const payload = await authenticateRequest(request, env);
  if (!payload) return errorResponse('認証が必要です', 401);

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10)));
  const offset = (page - 1) * limit;

  // 総件数
  const countResult = await env.DB.prepare('SELECT COUNT(*) as total FROM labels WHERE user_id = ?')
    .bind(payload.sub)
    .first();

  // ラベル一覧（翻訳データを除く軽量版）
  const labels = await env.DB.prepare(
    `SELECT id, product_name, category, created_at, updated_at
     FROM labels WHERE user_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`
  )
    .bind(payload.sub, limit, offset)
    .all();

  return jsonResponse({
    labels: labels.results || [],
    total: countResult?.total || 0,
    page,
    limit,
  });
}

export const onRequestPost = withMiddleware(handleCreate);
export const onRequestGet = withMiddleware(handleList);
export const onRequestOptions = withMiddleware(handleCreate);
