/**
 * GET /api/stripe/status - Stripe接続状態確認
 * フロントエンド (js/stripe.js) の STRIPE_API_ENDPOINTS.WEBHOOK_STATUS に対応
 * _initStripe() で publishableKey を取得、_fetchPriceIds() で plans を取得
 *
 * レスポンス形式:
 * {
 *   connected: boolean,
 *   publishableKey: string | null,
 *   plans: { lite: priceId, standard: priceId, pro: priceId }
 * }
 */

import { withMiddleware } from '../../lib/middleware.js';
import { jsonResponse } from '../../lib/response.js';

async function handler({ request, env }) {
  const hasStripeKey = !!env.STRIPE_SECRET_KEY;
  const publishableKey = env.STRIPE_PUBLISHABLE_KEY || null;

  // Price IDマッピング（環境変数から取得）
  const plans = {};
  if (env.STRIPE_PRICE_LITE) plans.lite = env.STRIPE_PRICE_LITE;
  if (env.STRIPE_PRICE_STANDARD) plans.standard = env.STRIPE_PRICE_STANDARD;
  if (env.STRIPE_PRICE_PRO) plans.pro = env.STRIPE_PRICE_PRO;

  return jsonResponse({
    connected: hasStripeKey,
    publishableKey,
    plans: Object.keys(plans).length > 0 ? plans : null,
    paymentMethods: ['card', 'paypay'],
  });
}

export const onRequestGet = withMiddleware(handler, { skipRateLimit: true });
export const onRequestOptions = withMiddleware(handler, { skipRateLimit: true });
