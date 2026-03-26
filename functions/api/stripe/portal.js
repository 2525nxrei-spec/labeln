/**
 * POST /api/stripe/portal - Stripe Customer Portal
 */

import { withMiddleware } from '../../lib/middleware.js';
import { errorResponse, jsonResponse } from '../../lib/response.js';
import { authenticateRequest } from '../../lib/auth.js';
import { stripeRequest } from '../../lib/stripe.js';

async function handler({ request, env }) {
  const payload = await authenticateRequest(request, env);
  if (!payload) return errorResponse('認証が必要です', 401);

  // Stripe未設定時のモック
  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse({
      url: '/app.html?mock_portal=true',
      mock: true,
    });
  }

  const user = await env.DB.prepare('SELECT stripe_customer_id FROM users WHERE id = ?')
    .bind(payload.sub)
    .first();

  if (!user?.stripe_customer_id) {
    return errorResponse('Stripeアカウントが未連携です', 400);
  }

  const origin = new URL(request.url).origin;
  const portalResponse = await stripeRequest('POST', '/v1/billing_portal/sessions', {
    customer: user.stripe_customer_id,
    return_url: `${origin}/app.html`,
  }, env.STRIPE_SECRET_KEY);

  if (!portalResponse.ok) {
    return errorResponse('Customer Portalの作成に失敗しました', 502);
  }

  const portal = await portalResponse.json();
  return jsonResponse({ url: portal.url });
}

export const onRequestPost = withMiddleware(handler);
export const onRequestOptions = withMiddleware(handler);
