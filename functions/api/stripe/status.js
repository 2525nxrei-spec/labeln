/**
 * GET /api/stripe/status - Stripe接続状態確認
 * フロントエンド (js/stripe.js) の STRIPE_API_ENDPOINTS.WEBHOOK_STATUS に対応
 * _initStripe() で publishableKey を取得、_fetchPriceIds() で plans を取得
 *
 * レスポンス形式:
 * {
 *   connected: boolean,
 *   publishableKey: string | null,
 *   plans: { lite: 'lite', standard: 'standard', pro: 'pro' }
 * }
 */

import { withMiddleware } from '../../lib/middleware.js';
import { jsonResponse } from '../../lib/response.js';

async function handler({ request, env }) {
  const hasStripeKey = !!env.STRIPE_SECRET_KEY;
  // 空文字の場合もnullとして扱う（wrangler.tomlで空文字定義された場合の対策）
  const publishableKey = env.STRIPE_PUBLISHABLE_KEY && env.STRIPE_PUBLISHABLE_KEY.trim() !== '' ? env.STRIPE_PUBLISHABLE_KEY : null;

  // プラン名のみ返す（Price IDはサーバー側で保持、クライアントに露出しない）
  const plans = {};
  if (env.STRIPE_PRICE_LITE) plans.lite = 'lite';
  if (env.STRIPE_PRICE_STANDARD) plans.standard = 'standard';
  if (env.STRIPE_PRICE_PRO) plans.pro = 'pro';

  return jsonResponse({
    connected: hasStripeKey,
    publishableKey,
    plans: Object.keys(plans).length > 0 ? plans : null,
    paymentMethods: ['card', 'paypay'],
  });
}

export const onRequestGet = withMiddleware(handler, { skipRateLimit: true });
export const onRequestOptions = withMiddleware(handler, { skipRateLimit: true });
