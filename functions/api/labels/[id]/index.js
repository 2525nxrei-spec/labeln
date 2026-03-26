/**
 * /api/labels/:id
 * GET    - ラベル詳細取得
 * DELETE - ラベル削除
 */

import { withMiddleware } from '../../../lib/middleware.js';
import { errorResponse, jsonResponse } from '../../../lib/response.js';
import { authenticateRequest } from '../../../lib/auth.js';

/** ラベル詳細取得 */
async function handleGet({ request, env, params }) {
  const payload = await authenticateRequest(request, env);
  if (!payload) return errorResponse('認証が必要です', 401);

  const label = await env.DB.prepare('SELECT * FROM labels WHERE id = ? AND user_id = ?')
    .bind(params.id, payload.sub)
    .first();

  if (!label) return errorResponse('ラベルが見つかりません', 404);

  return jsonResponse({
    id: label.id,
    user_id: label.user_id,
    product_name: label.product_name,
    category: label.category,
    ingredients: JSON.parse(label.ingredients_json || '[]'),
    allergens: JSON.parse(label.allergens_json || '[]'),
    nutrition: JSON.parse(label.nutrition_json || '{}'),
    label_settings: JSON.parse(label.label_settings_json || '{}'),
    translations: JSON.parse(label.translations_json || '{}'),
    created_at: label.created_at,
    updated_at: label.updated_at,
  });
}

/** ラベル削除 */
async function handleDelete({ request, env, params }) {
  const payload = await authenticateRequest(request, env);
  if (!payload) return errorResponse('認証が必要です', 401);

  // 所有権チェック付き削除
  const result = await env.DB.prepare('DELETE FROM labels WHERE id = ? AND user_id = ?')
    .bind(params.id, payload.sub)
    .run();

  if (!result.meta?.changes || result.meta.changes === 0) {
    return errorResponse('ラベルが見つかりません', 404);
  }

  // R2からPDFも削除（存在すれば）
  try {
    const objects = await env.STORAGE.list({ prefix: `labels/${params.id}/` });
    for (const obj of objects.objects || []) {
      await env.STORAGE.delete(obj.key);
    }
  } catch {
    // R2削除失敗は致命的でないためスルー
  }

  return jsonResponse({ deleted: true });
}

export const onRequestGet = withMiddleware(handleGet);
export const onRequestDelete = withMiddleware(handleDelete);
export const onRequestOptions = withMiddleware(handleGet);
