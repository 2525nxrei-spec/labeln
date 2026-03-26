/**
 * POST /api/labels/:id/pdf - PDF保存
 */

import { withMiddleware } from '../../../lib/middleware.js';
import { errorResponse, jsonResponse } from '../../../lib/response.js';
import { authenticateRequest } from '../../../lib/auth.js';

async function handler({ request, env, params }) {
  const payload = await authenticateRequest(request, env);
  if (!payload) return errorResponse('認証が必要です', 401);

  // ラベル所有権チェック
  const label = await env.DB.prepare('SELECT id, product_name FROM labels WHERE id = ? AND user_id = ?')
    .bind(params.id, payload.sub)
    .first();

  if (!label) return errorResponse('ラベルが見つかりません', 404);

  // Content-Typeチェック
  const contentType = request.headers.get('Content-Type') || '';

  if (contentType.includes('application/pdf')) {
    // PDFバイナリを直接受け取る場合
    const pdfBuffer = await request.arrayBuffer();
    if (pdfBuffer.byteLength === 0) {
      return errorResponse('PDFデータが空です', 400);
    }
    if (pdfBuffer.byteLength > 10 * 1024 * 1024) {
      return errorResponse('PDFファイルサイズが上限（10MB）を超えています', 413);
    }

    const key = `labels/${params.id}/${Date.now()}.pdf`;

    await env.STORAGE.put(key, pdfBuffer, {
      httpMetadata: { contentType: 'application/pdf' },
      customMetadata: {
        userId: payload.sub,
        labelId: params.id,
        productName: label.product_name,
      },
    });

    return jsonResponse({
      key,
      size: pdfBuffer.byteLength,
      url: `/api/files/${key}`,
    }, 201);
  }

  // JSON形式でPDF生成パラメータを受け取る場合（将来のサーバーサイドPDF生成用）
  return errorResponse('Content-Type: application/pdf でPDFバイナリを送信してください', 415);
}

export const onRequestPost = withMiddleware(handler);
export const onRequestOptions = withMiddleware(handler);
