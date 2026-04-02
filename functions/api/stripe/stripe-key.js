/**
 * GET /api/stripe/stripe-key — Stripe公開鍵とプラン情報を返す（Embedded Checkout用）
 */

import { withMiddleware } from '../../lib/middleware.js';
import { errorResponse, jsonResponse } from '../../lib/response.js';

async function handler({ env }) {
  const publishableKey = env.STRIPE_PUBLISHABLE_KEY || '';
  if (!publishableKey) {
    return errorResponse('Stripe公開鍵が設定されていません', 500);
  }

  // プランのマッピング情報（Price IDは返さない。プラン名のみ）
  const plans = {
    lite: { name: 'ライトプラン', price: 300, interval: 'month' },
    standard: { name: 'スタンダードプラン', price: 500, interval: 'month' },
    pro: { name: 'プロプラン', price: 2000, interval: 'month' },
  };

  return jsonResponse({ publishableKey, plans });
}

export const onRequestGet = withMiddleware(handler, { skipRateLimit: true });
export const onRequestOptions = withMiddleware(handler, { skipRateLimit: true });
