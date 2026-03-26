/**
 * GET /api/stripe/payments - 支払い履歴取得
 * フロントエンド (js/stripe.js) の STRIPE_API_ENDPOINTS.PAYMENT_HISTORY に対応
 * レスポンス形式: { payments: [{ date, planName, amount, status }] }
 */

import { withMiddleware } from '../../lib/middleware.js';
import { errorResponse, jsonResponse } from '../../lib/response.js';
import { authenticateRequest } from '../../lib/auth.js';
import { stripeRequest, determinePlanFromPrice } from '../../lib/stripe.js';

async function handler({ request, env }) {
  const payload = await authenticateRequest(request, env);
  if (!payload) return errorResponse('認証が必要です', 401);

  // Stripe未設定時のモック
  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse({
      payments: [],
      mock: true,
    });
  }

  const user = await env.DB.prepare('SELECT stripe_customer_id FROM users WHERE id = ?')
    .bind(payload.sub)
    .first();

  if (!user?.stripe_customer_id) {
    return jsonResponse({ payments: [] });
  }

  // Stripe APIから支払い履歴を取得（最新20件）
  const invoicesResponse = await stripeRequest('GET',
    `/v1/invoices?customer=${user.stripe_customer_id}&limit=20&status=paid`,
    {}, env.STRIPE_SECRET_KEY);

  if (!invoicesResponse.ok) {
    return errorResponse('支払い履歴の取得に失敗しました', 502);
  }

  const invoicesData = await invoicesResponse.json();
  const invoices = invoicesData.data || [];

  // フロントエンドが期待する形式に変換
  const payments = invoices.map((invoice) => {
    // インボイスのline_itemsからprice_idを取得してプラン名を判定
    const lineItem = invoice.lines?.data?.[0];
    const priceId = lineItem?.price?.id || '';
    const planName = determinePlanFromPrice(priceId, env);

    // プラン名の日本語マッピング
    const planNameMap = {
      lite: 'ライトプラン',
      standard: 'スタンダードプラン',
      pro: 'プロプラン',
    };

    return {
      date: invoice.created ? new Date(invoice.created * 1000).toISOString() : null,
      planName: planNameMap[planName] || planName,
      amount: invoice.amount_paid || 0,
      status: invoice.status === 'paid' ? 'succeeded' : invoice.status,
      invoiceId: invoice.id,
      invoicePdf: invoice.invoice_pdf || null,
    };
  });

  return jsonResponse({ payments });
}

export const onRequestGet = withMiddleware(handler);
export const onRequestOptions = withMiddleware(handler);
