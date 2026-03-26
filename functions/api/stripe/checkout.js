/**
 * POST /api/stripe/checkout - Stripe Checkout Session作成
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

  const { plan } = body;
  if (!plan || !['lite', 'standard', 'pro'].includes(plan)) {
    return errorResponse('有効なプランを指定してください（lite / standard / pro）', 400);
  }

  // Stripe未設定時のモック
  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse({
      clientSecret: `mock_client_secret_${generateId()}`,
      session_id: `mock_cs_${generateId()}`,
      mock: true,
    });
  }

  // Price IDマッピング
  const priceIdMap = {
    lite: env.STRIPE_PRICE_LITE,
    standard: env.STRIPE_PRICE_STANDARD,
    pro: env.STRIPE_PRICE_PRO,
  };

  const priceId = priceIdMap[plan];
  if (!priceId) {
    return errorResponse(`プラン「${plan}」のStripe Price IDが未設定です`, 500);
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

  // Embedded Checkout: ページ内埋め込み決済（リダイレクトなし）
  const origin = new URL(request.url).origin;
  const sessionResponse = await stripeRequest('POST', '/v1/checkout/sessions', {
    customer: customerId,
    mode: 'subscription',
    ui_mode: 'embedded',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    return_url: `${origin}/app.html?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    metadata: { user_id: payload.sub, plan },
    locale: 'ja',
  }, env.STRIPE_SECRET_KEY);

  if (!sessionResponse.ok) {
    const errText = await sessionResponse.text();
    console.error('Stripe Checkout error:', errText);
    return errorResponse('Stripe Checkout Sessionの作成に失敗しました', 502);
  }

  const session = await sessionResponse.json();
  return jsonResponse({ clientSecret: session.client_secret, session_id: session.id });
}

export const onRequestPost = withMiddleware(handler);
export const onRequestOptions = withMiddleware(handler);
