/**
 * GET /api/files/:key+ - R2ストレージからファイルを配信
 * catch-allルートでスラッシュを含むキー（例: labels/xxx/yyy.pdf）に対応
 */

import { withMiddleware } from '../../lib/middleware.js';
import { errorResponse } from '../../lib/response.js';
import { authenticateRequest } from '../../lib/auth.js';

async function handler({ request, env, params }) {
  // 認証チェック
  const payload = await authenticateRequest(request, env);
  if (!payload) return errorResponse('認証が必要です', 401);

  // catch-allパラメータからキーを組み立て
  const keyParts = params.key;
  if (!keyParts || keyParts.length === 0) {
    return errorResponse('ファイルキーが指定されていません', 400);
  }
  const key = keyParts.join('/');

  // パストラバーサル防止
  if (key.includes('..')) {
    return errorResponse('不正なファイルパスです', 400);
  }

  // R2からファイル取得
  const object = await env.STORAGE.get(key);
  if (!object) {
    return errorResponse('ファイルが見つかりません', 404);
  }

  // 所有権チェック（メタデータにuserIdがあれば照合）
  const userId = object.customMetadata?.userId;
  if (userId && userId !== payload.sub) {
    return errorResponse('このファイルへのアクセス権がありません', 403);
  }

  // レスポンス返却
  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Content-Length', object.size.toString());
  // PDFの場合はインライン表示
  if (key.endsWith('.pdf')) {
    headers.set('Content-Disposition', 'inline');
  }
  headers.set('Cache-Control', 'private, max-age=3600');

  return new Response(object.body, { status: 200, headers });
}

export const onRequestGet = withMiddleware(handler);
export const onRequestOptions = withMiddleware(handler);
