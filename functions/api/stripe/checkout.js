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

  // フロントエンドは planId で送信するため両方受け付ける
  const plan = body.planId || body.plan;
  if (!plan || !['lite', 'standard', 'pro'].includes(plan)) {
    return errorResponse('有効なプランを指定してください（lite / standard / pro）', 400);
  }

  // Stripe未設定時のモック
  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse({
      url: `https://mylabeln.com/account.html?session_id=mock_cs_${generateId()}`,
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

  try {
    // ユーザーのStripe Customer ID取得（なければ作成）
    const user = await env.DB.prepare('SELECT email, stripe_customer_id FROM users WHERE id = ?')
      .bind(payload.sub)
      .first();

    if (!user) {
      return errorResponse('ユーザーが見つかりません', 404);
    }

    let customerId = user?.stripe_customer_id;

    if (!customerId) {
      // Stripe Customer作成
      const customerResponse = await stripeRequest('POST', '/v1/customers', {
        email: user.email,
        metadata: { user_id: payload.sub },
      }, env.STRIPE_SECRET_KEY);

      if (!customerResponse.ok) {
        const errText = await customerResponse.text().catch(() => '');
        console.error('Stripe Customer creation error:', errText);
        return errorResponse('Stripe顧客の作成に失敗しました', 500);
      }

      const customer = await customerResponse.json();
      customerId = customer.id;

      // DB更新
      await env.DB.prepare('UPDATE users SET stripe_customer_id = ?, updated_at = ? WHERE id = ?')
        .bind(customerId, new Date().toISOString(), payload.sub)
        .run();
    }

    // リダイレクト型 Stripe Checkout（checkout.stripe.comに飛ぶ方式）
    const frontendUrl = env.FRONTEND_URL || 'https://mylabeln.com';
    const sessionResponse = await stripeRequest('POST', '/v1/checkout/sessions', {
      customer: customerId,
      mode: 'subscription',
      'line_items[0][price]': priceId,
      'line_items[0][quantity]': '1',
      success_url: `${frontendUrl}/account.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/pricing.html`,
      'metadata[user_id]': payload.sub,
      'metadata[plan]': plan,
      locale: 'ja',
    }, env.STRIPE_SECRET_KEY);

    if (!sessionResponse.ok) {
      const errText = await sessionResponse.text().catch(() => '');
      console.error('Stripe Checkout error:', errText);
      return errorResponse('Stripe Checkout Sessionの作成に失敗しました', 500);
    }

    const session = await sessionResponse.json();
    return jsonResponse({ url: session.url, session_id: session.id });
  } catch (err) {
    console.error('checkout unexpected error:', err);
    return errorResponse('決済処理中にエラーが発生しました', 500);
  }
}

export const onRequestPost = withMiddleware(handler);
export const onRequestOptions = withMiddleware(handler);
