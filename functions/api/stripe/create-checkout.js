/**
 * POST /api/stripe/create-checkout - Stripe Checkout Session作成
 * フロントエンド (js/stripe.js) の STRIPE_API_ENDPOINTS.CREATE_CHECKOUT に対応
 */

import { withMiddleware } from '../../lib/middleware.js';
import { errorResponse, jsonResponse } from '../../lib/response.js';
import { authenticateRequest, generateId } from '../../lib/auth.js';
import { stripeRequest } from '../../lib/stripe.js';

async function handler({ request, env }) {
  const payload = await authenticateRequest(request, env);
  if (!payload) return errorResponse('認証が必要です', 401);

  const body = await request.json().catch(() => null);
  if (!body) return errorResponse('リクエストボディが不正です', 400);

  // フロントエンドから送られるパラメータ: planId, priceId, payment_methods, successUrl, cancelUrl
  const { planId, priceId, payment_methods, successUrl, cancelUrl } = body;

  if (!planId || !['lite', 'standard', 'pro'].includes(planId)) {
    return errorResponse('有効なプランを指定してください（lite / standard / pro）', 400);
  }

  // Stripe未設定時のモック
  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse({
      url: `/app.html?mock_checkout=true&plan=${planId}`,
      sessionId: `mock_cs_${generateId()}`,
      mock: true,
      payment_methods: payment_methods || ['card', 'paypay'],
    });
  }

  // Price IDマッピング（env優先、なければフロントから受け取ったpriceIdを使用）
  const priceIdMap = {
    lite: env.STRIPE_PRICE_LITE,
    standard: env.STRIPE_PRICE_STANDARD,
    pro: env.STRIPE_PRICE_PRO,
  };

  const resolvedPriceId = priceIdMap[planId] || priceId;
  if (!resolvedPriceId) {
    return errorResponse(`プラン「${planId}」のStripe Price IDが未設定です`, 500);
  }

  // ユーザーのStripe Customer ID取得（なければ作成）
  const user = await env.DB.prepare('SELECT email, stripe_customer_id FROM users WHERE id = ?')
    .bind(payload.sub)
    .first();

  let customerId = user?.stripe_customer_id;

  if (!customerId) {
    // Stripe Customer作成
    const customerResponse = await stripeRequest('POST', '/v1/customers', {
      email: user.email,
      metadata: { user_id: payload.sub },
    }, env.STRIPE_SECRET_KEY);

    if (!customerResponse.ok) {
      return errorResponse('Stripe顧客の作成に失敗しました', 502);
    }

    const customer = await customerResponse.json();
    customerId = customer.id;

    // DB更新
    await env.DB.prepare('UPDATE users SET stripe_customer_id = ?, updated_at = ? WHERE id = ?')
      .bind(customerId, new Date().toISOString(), payload.sub)
      .run();
  }

  // success_url / cancel_url はフロントエンドからの指定を優先
  const origin = new URL(request.url).origin;
  const resolvedSuccessUrl = successUrl || `${origin}/app.html?payment=success`;
  const resolvedCancelUrl = cancelUrl || `${origin}/app.html?payment=cancel`;

  // Checkout Session作成
  // payment_method_types を指定しない → Stripeダッシュボードで有効化した決済方法が全て自動表示
  // （card=クレカ/Apple Pay/Google Pay、paypay、konbini 等）
  const sessionResponse = await stripeRequest('POST', '/v1/checkout/sessions', {
    customer: customerId,
    mode: 'subscription',
    'line_items[0][price]': resolvedPriceId,
    'line_items[0][quantity]': '1',
    success_url: resolvedSuccessUrl,
    cancel_url: resolvedCancelUrl,
    metadata: { user_id: payload.sub, plan: planId },
    locale: 'ja',
  }, env.STRIPE_SECRET_KEY);

  if (!sessionResponse.ok) {
    const errText = await sessionResponse.text();
    console.error('Stripe Checkout error:', errText);
    return errorResponse('Stripe Checkout Sessionの作成に失敗しました', 502);
  }

  const session = await sessionResponse.json();
  // フロントエンドは sessionId と url の両方をチェックする
  return jsonResponse({ url: session.url, sessionId: session.id });
}

export const onRequestPost = withMiddleware(handler);
export const onRequestOptions = withMiddleware(handler);
