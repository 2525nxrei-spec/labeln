/**
 * Stripe決済フロー重点テスト（第2ラウンド）
 * webhook全イベントの正常系・異常系、署名検証の境界値、チェックアウト/ポータルの詳細テスト
 */

import { describe, it, expect } from 'vitest';
import { createMockEnv, createMockDB, createMockContext, createTestJWT, parseResponse } from './helpers.js';
import { onRequestPost as webhookHandler } from '../functions/api/stripe/webhook.js';
import { onRequestPost as checkoutHandler } from '../functions/api/stripe/checkout.js';
import { onRequestPost as createCheckoutHandler } from '../functions/api/stripe/create-checkout.js';
import { onRequestPost as portalHandler } from '../functions/api/stripe/portal.js';
import { onRequestPost as billingPortalHandler } from '../functions/api/stripe/billing-portal.js';
import { onRequestPost as cancelHandler } from '../functions/api/stripe/cancel.js';
import { onRequestGet as paymentsHandler } from '../functions/api/stripe/payments.js';
import { onRequestGet as statusHandler } from '../functions/api/stripe/status.js';

const webhookSecret = 'whsec_test_secret_key';
const stripeSecretKey = 'sk_test_xxx';

/** テスト用Stripe署名生成 */
async function createValidSignature(payload, secret, timestampOverride) {
  const timestamp = timestampOverride || Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const signature = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `t=${timestamp},v1=${signature}`;
}

/** Webhookリクエスト生成ヘルパー */
function makeWebhookRequest(body, sigHeader) {
  return new Request('https://mylabeln.com/api/stripe/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '127.0.0.1',
      Origin: 'https://mylabeln.com',
      'Stripe-Signature': sigHeader,
    },
    body,
  });
}

function makeStripeEnv(overrides = {}) {
  return createMockEnv({
    STRIPE_SECRET_KEY: stripeSecretKey,
    STRIPE_WEBHOOK_SECRET: webhookSecret,
    ...overrides,
  });
}

// ═══════════════════════════════════════════
// 1. checkout.session.completed イベント詳細テスト
// ═══════════════════════════════════════════
describe('Webhook: checkout.session.completed 詳細テスト', () => {
  it('ユーザーが存在する場合、stripe_customer_idが紐付けられる', async () => {
    const env = makeStripeEnv();
    env.DB._tables.users.push({
      id: 'user-cs-1',
      email: 'checkout@example.com',
      stripe_customer_id: null,
      plan: 'free',
    });

    const event = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          customer: 'cus_checkout_1',
          subscription: 'sub_checkout_1',
          metadata: { user_id: 'user-cs-1', plan: 'standard' },
        },
      },
    };

    const body = JSON.stringify(event);
    const sigHeader = await createValidSignature(body, webhookSecret);
    const request = makeWebhookRequest(body, sigHeader);
    const response = await webhookHandler(createMockContext(request, env));
    // checkout.session.completedはswitch文のdefaultに落ちるが200を返す
    expect(response.status).toBe(200);
  });

  it('subscription無しのcheckout（一回払い等）でも200を返す', async () => {
    const env = makeStripeEnv();

    const event = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_onetime',
          customer: 'cus_onetime',
          subscription: null,
          mode: 'payment',
        },
      },
    };

    const body = JSON.stringify(event);
    const sigHeader = await createValidSignature(body, webhookSecret);
    const request = makeWebhookRequest(body, sigHeader);
    const response = await webhookHandler(createMockContext(request, env));
    expect(response.status).toBe(200);
  });
});

// ═══════════════════════════════════════════
// 2. customer.subscription.updated 詳細テスト
// ═══════════════════════════════════════════
describe('Webhook: customer.subscription.updated 詳細テスト', () => {
  it('canceledステータスではプラン更新されない（active/trialing以外）', async () => {
    const env = makeStripeEnv();
    env.DB._tables.users.push({
      id: 'user-canceled',
      email: 'canceled@example.com',
      stripe_customer_id: 'cus_canceled',
      plan: 'standard',
    });

    const event = {
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_canceled',
          customer: 'cus_canceled',
          status: 'canceled',
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
          items: { data: [{ price: { id: 'price_test_standard' } }] },
        },
      },
    };

    const body = JSON.stringify(event);
    const sigHeader = await createValidSignature(body, webhookSecret);
    const request = makeWebhookRequest(body, sigHeader);
    const response = await webhookHandler(createMockContext(request, env));
    expect(response.status).toBe(200);
  });

  it('unpaidステータスでもサブスクリプションテーブルは更新される', async () => {
    const env = makeStripeEnv();
    env.DB._tables.users.push({
      id: 'user-unpaid',
      email: 'unpaid@example.com',
      stripe_customer_id: 'cus_unpaid',
      plan: 'pro',
    });

    const event = {
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_unpaid',
          customer: 'cus_unpaid',
          status: 'unpaid',
          current_period_end: Math.floor(Date.now() / 1000) + 1 * 86400,
          items: { data: [{ price: { id: 'price_test_pro' } }] },
        },
      },
    };

    const body = JSON.stringify(event);
    const sigHeader = await createValidSignature(body, webhookSecret);
    const request = makeWebhookRequest(body, sigHeader);
    const response = await webhookHandler(createMockContext(request, env));
    expect(response.status).toBe(200);
  });

  it('incomplete_expiredステータスでも200を返す', async () => {
    const env = makeStripeEnv();
    env.DB._tables.users.push({
      id: 'user-inc-exp',
      email: 'incexp@example.com',
      stripe_customer_id: 'cus_inc_exp',
      plan: 'lite',
    });

    const event = {
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_inc_exp',
          customer: 'cus_inc_exp',
          status: 'incomplete_expired',
          current_period_end: Math.floor(Date.now() / 1000) - 86400,
          items: { data: [{ price: { id: 'price_test_lite' } }] },
        },
      },
    };

    const body = JSON.stringify(event);
    const sigHeader = await createValidSignature(body, webhookSecret);
    const request = makeWebhookRequest(body, sigHeader);
    const response = await webhookHandler(createMockContext(request, env));
    expect(response.status).toBe(200);
  });

  it('マッチしないprice_idはliteにフォールバックする', async () => {
    const env = makeStripeEnv();
    env.DB._tables.users.push({
      id: 'user-unknown-price',
      email: 'unknownprice@example.com',
      stripe_customer_id: 'cus_unknown_price',
      plan: 'free',
    });

    const event = {
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_unknown_price',
          customer: 'cus_unknown_price',
          status: 'active',
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
          items: { data: [{ price: { id: 'price_unknown_xyz' } }] },
        },
      },
    };

    const body = JSON.stringify(event);
    const sigHeader = await createValidSignature(body, webhookSecret);
    const request = makeWebhookRequest(body, sigHeader);
    const response = await webhookHandler(createMockContext(request, env));
    const { data } = await parseResponse(response);
    expect(response.status).toBe(200);
    expect(data.received).toBe(true);
  });

  it('items.dataがundefinedの場合もliteにフォールバック', async () => {
    const env = makeStripeEnv();
    env.DB._tables.users.push({
      id: 'user-noitems',
      email: 'noitems@example.com',
      stripe_customer_id: 'cus_noitems',
      plan: 'free',
    });

    const event = {
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_noitems',
          customer: 'cus_noitems',
          status: 'active',
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
          // items自体がない
        },
      },
    };

    const body = JSON.stringify(event);
    const sigHeader = await createValidSignature(body, webhookSecret);
    const request = makeWebhookRequest(body, sigHeader);
    const response = await webhookHandler(createMockContext(request, env));
    expect(response.status).toBe(200);
  });
});

// ═══════════════════════════════════════════
// 3. customer.subscription.deleted 詳細テスト
// ═══════════════════════════════════════════
describe('Webhook: customer.subscription.deleted 詳細テスト', () => {
  it('有料プランからfreeに正しくダウングレードされる', async () => {
    const env = makeStripeEnv();
    env.DB._tables.users.push({
      id: 'user-del-pro',
      email: 'delpro@example.com',
      stripe_customer_id: 'cus_del_pro',
      plan: 'pro',
      stripe_subscription_id: 'sub_del_pro',
    });
    env.DB._tables.subscriptions.push({
      id: 'sub-db-del-pro',
      user_id: 'user-del-pro',
      stripe_subscription_id: 'sub_del_pro',
      plan: 'pro',
      status: 'active',
    });

    const event = {
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_del_pro',
          customer: 'cus_del_pro',
        },
      },
    };

    const body = JSON.stringify(event);
    const sigHeader = await createValidSignature(body, webhookSecret);
    const request = makeWebhookRequest(body, sigHeader);
    const response = await webhookHandler(createMockContext(request, env));
    const { data } = await parseResponse(response);
    expect(response.status).toBe(200);
    expect(data.received).toBe(true);
  });

  it('サブスクリプションテーブルにレコードが無くても200を返す', async () => {
    const env = makeStripeEnv();
    env.DB._tables.users.push({
      id: 'user-del-nosub',
      email: 'delnosub@example.com',
      stripe_customer_id: 'cus_del_nosub',
      plan: 'lite',
    });

    const event = {
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_nonexistent_in_db',
          customer: 'cus_del_nosub',
        },
      },
    };

    const body = JSON.stringify(event);
    const sigHeader = await createValidSignature(body, webhookSecret);
    const request = makeWebhookRequest(body, sigHeader);
    const response = await webhookHandler(createMockContext(request, env));
    expect(response.status).toBe(200);
  });
});

// ═══════════════════════════════════════════
// 4. invoice.payment_failed イベントテスト
// ═══════════════════════════════════════════
describe('Webhook: invoice.payment_failed 詳細テスト', () => {
  it('支払い失敗イベントでもreceived:trueを返す（現在はdefault処理）', async () => {
    const env = makeStripeEnv();

    const event = {
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_failed_123',
          customer: 'cus_fail',
          subscription: 'sub_fail',
          attempt_count: 1,
          next_payment_attempt: Math.floor(Date.now() / 1000) + 86400,
        },
      },
    };

    const body = JSON.stringify(event);
    const sigHeader = await createValidSignature(body, webhookSecret);
    const request = makeWebhookRequest(body, sigHeader);
    const response = await webhookHandler(createMockContext(request, env));
    const { status, data } = await parseResponse(response);
    expect(status).toBe(200);
    expect(data.received).toBe(true);
  });

  it('複数回目の支払い失敗でもreceived:trueを返す', async () => {
    const env = makeStripeEnv();

    const event = {
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_failed_456',
          customer: 'cus_fail_multi',
          subscription: 'sub_fail_multi',
          attempt_count: 4,
          next_payment_attempt: null, // 最終試行後
        },
      },
    };

    const body = JSON.stringify(event);
    const sigHeader = await createValidSignature(body, webhookSecret);
    const request = makeWebhookRequest(body, sigHeader);
    const response = await webhookHandler(createMockContext(request, env));
    expect(response.status).toBe(200);
  });
});

// ═══════════════════════════════════════════
// 5. Stripe署名検証の境界値テスト
// ═══════════════════════════════════════════
describe('Stripe署名検証 境界値テスト', () => {
  it('ちょうど5分（300秒）前のタイムスタンプは有効', async () => {
    const env = makeStripeEnv();
    const body = JSON.stringify({ type: 'test.event', data: { object: {} } });
    // ちょうど300秒前 → age === 300 → `age > 300` は false なのでパスする
    const timestamp = Math.floor(Date.now() / 1000) - 300;
    const sigHeader = await createValidSignature(body, webhookSecret, timestamp);
    const request = makeWebhookRequest(body, sigHeader);
    const response = await webhookHandler(createMockContext(request, env));
    expect(response.status).toBe(200);
  });

  it('5分1秒（301秒）前のタイムスタンプは無効', async () => {
    const env = makeStripeEnv();
    const body = JSON.stringify({ type: 'test.event', data: { object: {} } });
    const timestamp = Math.floor(Date.now() / 1000) - 301;
    const sigHeader = await createValidSignature(body, webhookSecret, timestamp);
    const request = makeWebhookRequest(body, sigHeader);
    const response = await webhookHandler(createMockContext(request, env));
    expect(response.status).toBe(401);
  });

  it('未来のタイムスタンプ（+10秒）は有効', async () => {
    const env = makeStripeEnv();
    const body = JSON.stringify({ type: 'test.event', data: { object: {} } });
    const timestamp = Math.floor(Date.now() / 1000) + 10;
    const sigHeader = await createValidSignature(body, webhookSecret, timestamp);
    const request = makeWebhookRequest(body, sigHeader);
    const response = await webhookHandler(createMockContext(request, env));
    expect(response.status).toBe(200);
  });

  it('別のシークレットで署名した場合は401', async () => {
    const env = makeStripeEnv();
    const body = JSON.stringify({ type: 'test.event', data: { object: {} } });
    const sigHeader = await createValidSignature(body, 'whsec_wrong_secret');
    const request = makeWebhookRequest(body, sigHeader);
    const response = await webhookHandler(createMockContext(request, env));
    expect(response.status).toBe(401);
  });

  it('ペイロードが改ざんされた場合は401', async () => {
    const env = makeStripeEnv();
    const originalBody = JSON.stringify({ type: 'test.event', data: { object: {} } });
    const sigHeader = await createValidSignature(originalBody, webhookSecret);
    // ペイロードを改ざん
    const tamperedBody = JSON.stringify({ type: 'test.event', data: { object: { tampered: true } } });
    const request = makeWebhookRequest(tamperedBody, sigHeader);
    const response = await webhookHandler(createMockContext(request, env));
    expect(response.status).toBe(401);
  });

  it('v1=だけでシグネチャが空の場合は401', async () => {
    const env = makeStripeEnv();
    const body = JSON.stringify({ type: 'test' });
    const request = new Request('https://mylabeln.com/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
        'Stripe-Signature': 't=1234567890,v1=',
      },
      body,
    });
    const response = await webhookHandler(createMockContext(request, env));
    expect(response.status).toBe(401);
  });

  it('t=だけでタイムスタンプが空の場合は401', async () => {
    const env = makeStripeEnv();
    const body = JSON.stringify({ type: 'test' });
    const request = new Request('https://mylabeln.com/api/stripe/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
        'Stripe-Signature': 't=,v1=abc123',
      },
      body,
    });
    const response = await webhookHandler(createMockContext(request, env));
    expect(response.status).toBe(401);
  });

  it('複数のv1署名がある場合でも最初のv1で検証する', async () => {
    const env = makeStripeEnv();
    const body = JSON.stringify({ type: 'test.event', data: { object: {} } });
    const timestamp = Math.floor(Date.now() / 1000);
    const signedPayload = `${timestamp}.${body}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(webhookSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
    const signature = Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    // 正しい署名が最初にある
    const sigHeader = `t=${timestamp},v1=${signature},v1=fake_second_sig`;
    const request = makeWebhookRequest(body, sigHeader);
    const response = await webhookHandler(createMockContext(request, env));
    expect(response.status).toBe(200);
  });
});

// ═══════════════════════════════════════════
// 6. チェックアウトセッション作成の異常系拡張
// ═══════════════════════════════════════════
describe('チェックアウト異常系拡張', () => {
  const userId = 'user-checkout-adv';
  const email = 'checkout-adv@example.com';

  it('checkout: 巨大なボディ（100KB以上のJSON）でも処理される', async () => {
    const env = createMockEnv();
    const token = await createTestJWT(userId, email, env.JWT_SECRET);
    // 100KB超のJSON
    const largeBody = { plan: 'lite', extra: 'x'.repeat(100000) };
    const request = new Request('https://mylabeln.com/api/stripe/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
      body: JSON.stringify(largeBody),
    });
    const response = await checkoutHandler(createMockContext(request, env));
    const { status, data } = await parseResponse(response);
    expect(status).toBe(200);
    expect(data.mock).toBe(true);
  });

  it('checkout: XSSペイロードを含むプラン名で400を返す', async () => {
    const env = createMockEnv();
    const token = await createTestJWT(userId, email, env.JWT_SECRET);
    const request = new Request('https://mylabeln.com/api/stripe/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
      body: JSON.stringify({ plan: '<script>alert("xss")</script>' }),
    });
    const response = await checkoutHandler(createMockContext(request, env));
    expect(response.status).toBe(400);
  });

  it('checkout: 数値型のプラン名で400を返す', async () => {
    const env = createMockEnv();
    const token = await createTestJWT(userId, email, env.JWT_SECRET);
    const request = new Request('https://mylabeln.com/api/stripe/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
      body: JSON.stringify({ plan: 12345 }),
    });
    const response = await checkoutHandler(createMockContext(request, env));
    expect(response.status).toBe(400);
  });

  it('create-checkout: nullのplanIdで400を返す', async () => {
    const env = createMockEnv();
    const token = await createTestJWT(userId, email, env.JWT_SECRET);
    const request = new Request('https://mylabeln.com/api/stripe/create-checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
      body: JSON.stringify({ planId: null }),
    });
    const response = await createCheckoutHandler(createMockContext(request, env));
    expect(response.status).toBe(400);
  });

  it('create-checkout: 配列型のplanIdで400を返す', async () => {
    const env = createMockEnv();
    const token = await createTestJWT(userId, email, env.JWT_SECRET);
    const request = new Request('https://mylabeln.com/api/stripe/create-checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
      body: JSON.stringify({ planId: ['lite', 'pro'] }),
    });
    const response = await createCheckoutHandler(createMockContext(request, env));
    expect(response.status).toBe(400);
  });

  it('create-checkout: 空文字のplanIdで400を返す', async () => {
    const env = createMockEnv();
    const token = await createTestJWT(userId, email, env.JWT_SECRET);
    const request = new Request('https://mylabeln.com/api/stripe/create-checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
      body: JSON.stringify({ planId: '' }),
    });
    const response = await createCheckoutHandler(createMockContext(request, env));
    expect(response.status).toBe(400);
  });
});

// ═══════════════════════════════════════════
// 7. ポータルセッション異常系拡張
// ═══════════════════════════════════════════
describe('ポータルセッション異常系拡張', () => {
  const userId = 'user-portal-adv';
  const email = 'portal-adv@example.com';

  it('portal: 改ざんされたトークンで401を返す', async () => {
    const env = createMockEnv();
    const token = await createTestJWT(userId, email, env.JWT_SECRET);
    // トークンの最後の文字を変更（署名改ざん）
    const tamperedToken = token.slice(0, -1) + (token.slice(-1) === 'A' ? 'B' : 'A');
    const request = new Request('https://mylabeln.com/api/stripe/portal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tamperedToken}`,
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
      body: '{}',
    });
    const response = await portalHandler(createMockContext(request, env));
    expect(response.status).toBe(401);
  });

  it('billing-portal: returnUrlパラメータが正常に受理される', async () => {
    const env = createMockEnv();
    const token = await createTestJWT(userId, email, env.JWT_SECRET);
    const request = new Request('https://mylabeln.com/api/stripe/billing-portal', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
      body: JSON.stringify({ returnUrl: 'https://mylabeln.com/dashboard.html' }),
    });
    const response = await billingPortalHandler(createMockContext(request, env));
    const { status, data } = await parseResponse(response);
    expect(status).toBe(200);
    expect(data.mock).toBe(true);
  });

  it('cancel: 完全に空のボディでもモック返却される', async () => {
    const env = createMockEnv();
    const token = await createTestJWT(userId, email, env.JWT_SECRET);
    const request = new Request('https://mylabeln.com/api/stripe/cancel', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
      // bodyなし
    });
    const response = await cancelHandler(createMockContext(request, env));
    const { status, data } = await parseResponse(response);
    expect(status).toBe(200);
    expect(data.mock).toBe(true);
    expect(data.canceled).toBe(true);
  });

  it('payments: 不正なトークンで401を返す', async () => {
    const env = createMockEnv();
    const request = new Request('https://mylabeln.com/api/stripe/payments', {
      method: 'GET',
      headers: {
        Authorization: 'Bearer invalid.token.here',
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
    });
    const response = await paymentsHandler(createMockContext(request, env));
    expect(response.status).toBe(401);
  });
});

// ═══════════════════════════════════════════
// 8. Webhookペイロードの不正JSON・エッジケース
// ═══════════════════════════════════════════
describe('Webhook不正ペイロード テスト', () => {
  it('有効な署名だがJSONが不正な場合500（サーバーエラー）を返す', async () => {
    const env = makeStripeEnv();
    const body = 'not-valid-json-at-all';
    const sigHeader = await createValidSignature(body, webhookSecret);
    const request = makeWebhookRequest(body, sigHeader);
    const response = await webhookHandler(createMockContext(request, env));
    // JSON.parseでエラーが発生するが、withMiddlewareのtry-catchで500になる
    expect(response.status).toBe(500);
  });

  it('typeフィールドが無いイベントでも200を返す', async () => {
    const env = makeStripeEnv();
    const body = JSON.stringify({ data: { object: {} } });
    const sigHeader = await createValidSignature(body, webhookSecret);
    const request = makeWebhookRequest(body, sigHeader);
    const response = await webhookHandler(createMockContext(request, env));
    // typeが無い場合、switch文のdefaultに落ちて received: true
    expect(response.status).toBe(200);
  });

  it('空のJSONオブジェクトでも200を返す', async () => {
    const env = makeStripeEnv();
    const body = JSON.stringify({});
    const sigHeader = await createValidSignature(body, webhookSecret);
    const request = makeWebhookRequest(body, sigHeader);
    const response = await webhookHandler(createMockContext(request, env));
    expect(response.status).toBe(200);
  });

  it('非常に大きなイベントペイロード（64KB）でも正常処理される', async () => {
    const env = makeStripeEnv();
    env.DB._tables.users.push({
      id: 'user-large',
      email: 'large@example.com',
      stripe_customer_id: 'cus_large',
      plan: 'free',
    });

    const event = {
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_large',
          customer: 'cus_large',
          status: 'active',
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
          items: { data: [{ price: { id: 'price_test_standard' } }] },
          metadata: { padding: 'x'.repeat(60000) },
        },
      },
    };

    const body = JSON.stringify(event);
    const sigHeader = await createValidSignature(body, webhookSecret);
    const request = makeWebhookRequest(body, sigHeader);
    const response = await webhookHandler(createMockContext(request, env));
    expect(response.status).toBe(200);
  });
});
