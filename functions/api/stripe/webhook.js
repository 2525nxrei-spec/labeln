/**
 * POST /api/stripe/webhook - Stripe Webhook処理
 * レート制限はスキップ（Stripeからのリクエスト）
 */

import { withMiddleware } from '../../lib/middleware.js';
import { errorResponse, jsonResponse } from '../../lib/response.js';
import { generateId } from '../../lib/auth.js';
import { verifyStripeSignature, determinePlanFromPrice } from '../../lib/stripe.js';

/** サブスクリプション更新処理 */
async function handleSubscriptionUpdate(subscription, env) {
  const customerId = subscription.customer;
  const now = new Date().toISOString();

  const user = await env.DB.prepare('SELECT id FROM users WHERE stripe_customer_id = ?')
    .bind(customerId)
    .first();

  if (!user) {
    console.error('User not found for Stripe customer:', customerId);
    return;
  }

  const priceId = subscription.items?.data?.[0]?.price?.id;
  const plan = determinePlanFromPrice(priceId, env);
  const status = subscription.status;
  const periodEnd = new Date(subscription.current_period_end * 1000).toISOString();

  // subscriptionsテーブルをUPSERT
  const existing = await env.DB.prepare(
    'SELECT id FROM subscriptions WHERE stripe_subscription_id = ?'
  )
    .bind(subscription.id)
    .first();

  if (existing) {
    await env.DB.prepare(
      `UPDATE subscriptions SET plan = ?, status = ?, current_period_end = ?, updated_at = ?
       WHERE stripe_subscription_id = ?`
    )
      .bind(plan, status, periodEnd, now, subscription.id)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO subscriptions (id, user_id, stripe_subscription_id, plan, status, current_period_end, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(generateId(), user.id, subscription.id, plan, status, periodEnd, now, now)
      .run();
  }

  // アクティブなサブスクリプションならユーザーのプランとサブスクリプションIDを更新
  if (status === 'active' || status === 'trialing') {
    await env.DB.prepare('UPDATE users SET plan = ?, stripe_subscription_id = ?, cancel_at_period_end = 0, updated_at = ? WHERE id = ?')
      .bind(plan, subscription.id, now, user.id)
      .run();
  }
}

/** サブスクリプション削除（キャンセル）処理 */
async function handleSubscriptionDeleted(subscription, env) {
  const customerId = subscription.customer;
  const now = new Date().toISOString();

  const user = await env.DB.prepare('SELECT id FROM users WHERE stripe_customer_id = ?')
    .bind(customerId)
    .first();

  if (!user) return;

  await env.DB.prepare(
    `UPDATE subscriptions SET status = 'canceled', updated_at = ? WHERE stripe_subscription_id = ?`
  )
    .bind(now, subscription.id)
    .run();

  await env.DB.prepare("UPDATE users SET plan = 'free', stripe_subscription_id = NULL, cancel_at_period_end = 0, updated_at = ? WHERE id = ?")
    .bind(now, user.id)
    .run();
}

async function handler({ request, env }) {
  // Stripe未設定時はスキップ
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    return jsonResponse({ received: true, mock: true });
  }

  const body = await request.text();
  const signature = request.headers.get('Stripe-Signature');

  if (!signature) {
    return errorResponse('Stripe-Signatureヘッダーがありません', 400);
  }

  // Webhook署名検証
  const isValid = await verifyStripeSignature(body, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!isValid) {
    return errorResponse('Webhook署名が無効です', 401);
  }

  const event = JSON.parse(body);

  // 冪等性チェック: 処理済みイベントはスキップ
  const existing = await env.DB.prepare(
    'SELECT id FROM webhooks_log WHERE stripe_event_id = ?'
  )
    .bind(event.id)
    .first();

  if (existing) {
    return jsonResponse({ received: true, status: 'already_processed' });
  }

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      await handleSubscriptionUpdate(subscription, env);
      break;
    }
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      await handleSubscriptionDeleted(subscription, env);
      break;
    }
    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      const customerId = invoice.customer;
      const subscriptionId = invoice.subscription;
      const amountPaid = invoice.amount_paid;

      await env.DB.prepare(
        `UPDATE users SET updated_at = ? WHERE stripe_customer_id = ?`
      ).bind(new Date().toISOString(), customerId).run();

      console.log(`支払い成功: customer=${customerId}, subscription=${subscriptionId}, amount=${amountPaid}円`);
      break;
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      console.error('Invoice payment failed:', {
        customer: invoice.customer,
        attempt_count: invoice.attempt_count,
        invoice_id: invoice.id,
      });
      break;
    }
    default:
      break;
  }

  // Webhookログ保存（並行リクエスト時のUNIQUE制約違反は無視）
  try {
    await env.DB.prepare(
      `INSERT INTO webhooks_log (id, event_type, stripe_event_id, payload, processed_at)
       VALUES (?, ?, ?, ?, ?)`
    )
      .bind(generateId(), event.type, event.id, body, new Date().toISOString())
      .run();
  } catch (err) {
    // UNIQUE制約違反は並行リクエストによるものなので無視
    if (!err.message?.includes('UNIQUE')) {
      console.error('Webhook log insert error:', err);
    }
  }

  return jsonResponse({ received: true });
}

// Webhookはレート制限をスキップ
export const onRequestPost = withMiddleware(handler, { skipRateLimit: true });
export const onRequestOptions = withMiddleware(handler, { skipRateLimit: true });
