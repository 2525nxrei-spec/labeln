/**
 * POST /api/stripe/cancel - サブスクリプション解約
 * フロントエンド (js/stripe.js) の STRIPE_API_ENDPOINTS.CANCEL に対応
 * 即時解約ではなく、現在の請求期間終了時に解約（cancel_at_period_end）
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
      canceled: true,
      mock: true,
      message: 'モックモード: 解約処理が完了しました',
    });
  }

  // ユーザーのStripe Customer IDとサブスクリプション情報を取得
  const user = await env.DB.prepare(
    'SELECT stripe_customer_id, stripe_subscription_id, plan FROM users WHERE id = ?'
  )
    .bind(payload.sub)
    .first();

  if (!user?.stripe_customer_id) {
    return errorResponse('Stripeアカウントが未連携です', 400);
  }

  // サブスクリプションIDがDBにある場合はそれを使用
  let subscriptionId = user.stripe_subscription_id;

  // DBにない場合はStripe APIから取得
  if (!subscriptionId) {
    const subsResponse = await stripeRequest('GET',
      `/v1/subscriptions?customer=${user.stripe_customer_id}&status=active&limit=1`,
      {}, env.STRIPE_SECRET_KEY);

    if (!subsResponse.ok) {
      return errorResponse('サブスクリプション情報の取得に失敗しました', 502);
    }

    const subsData = await subsResponse.json();
    if (!subsData.data || subsData.data.length === 0) {
      return errorResponse('アクティブなサブスクリプションが見つかりません', 404);
    }

    subscriptionId = subsData.data[0].id;
  }

  // サブスクリプションを期間終了時に解約（cancel_at_period_end = true）
  const cancelResponse = await stripeRequest('POST', `/v1/subscriptions/${subscriptionId}`, {
    cancel_at_period_end: 'true',
  }, env.STRIPE_SECRET_KEY);

  if (!cancelResponse.ok) {
    const errText = await cancelResponse.text();
    console.error('Stripe cancel error:', errText);
    return errorResponse('サブスクリプションの解約に失敗しました', 502);
  }

  const subscription = await cancelResponse.json();

  // DBのプラン情報を更新（期間終了後にfreeになる旨を記録）
  await env.DB.prepare(
    'UPDATE users SET cancel_at_period_end = 1, updated_at = ? WHERE id = ?'
  )
    .bind(new Date().toISOString(), payload.sub)
    .run();

  return jsonResponse({
    canceled: true,
    cancel_at_period_end: true,
    current_period_end: subscription.current_period_end,
    message: '解約が完了しました。現在の請求期間の終了までサービスをご利用いただけます。',
  });
}

export const onRequestPost = withMiddleware(handler);
export const onRequestOptions = withMiddleware(handler);
