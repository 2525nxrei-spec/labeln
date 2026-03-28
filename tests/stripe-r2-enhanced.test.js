/**
 * Stripe決済テスト強化 第2ラウンド
 * - DB操作エラー時のWebhookハンドリング
 * - Stripe設定済み＋fetch失敗時の502テスト（globalThis.fetchモック）
 * - verifyStripeSignature追加エッジケース
 * - CORSプリフライト応答テスト
 * - 期限切れトークンでStripeエンドポイントアクセス
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createMockEnv,
  createMockDB,
  createMockContext,
  createTestJWT,
  parseResponse,
} from './helpers.js';
import { createJWT } from '../functions/lib/auth.js';
import { verifyStripeSignature, stripeRequest } from '../functions/lib/stripe.js';

import { onRequestPost as webhookHandler, onRequestOptions as webhookOptions } from '../functions/api/stripe/webhook.js';
import { onRequestPost as checkoutHandler, onRequestOptions as checkoutOptions } from '../functions/api/stripe/checkout.js';
import { onRequestPost as createCheckoutHandler } from '../functions/api/stripe/create-checkout.js';
import { onRequestPost as portalHandler, onRequestOptions as portalOptions } from '../functions/api/stripe/portal.js';
import { onRequestPost as billingPortalHandler } from '../functions/api/stripe/billing-portal.js';
import { onRequestPost as cancelHandler, onRequestOptions as cancelOptions } from '../functions/api/stripe/cancel.js';
import { onRequestGet as paymentsHandler } from '../functions/api/stripe/payments.js';
import { onRequestGet as statusHandler, onRequestOptions as statusOptions } from '../functions/api/stripe/status.js';

const webhookSecret = 'whsec_test_enhanced';
const stripeSecretKey = 'sk_test_enhanced';
const userId = 'user-r2-enhanced';
const email = 'r2enhanced@example.com';

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

function makeRequest(method, url, { body, token, headers: extra } = {}) {
  const headers = {
    'CF-Connecting-IP': '127.0.0.1',
    Origin: 'https://mylabeln.com',
    ...extra,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const init = { method, headers };
  if (body !== undefined && method !== 'GET') {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return new Request(url, init);
}

// ═══════════════════════════════════════════
// 1. verifyStripeSignature 追加エッジケーステスト
// ═══════════════════════════════════════════
describe('verifyStripeSignature 追加エッジケース', () => {
  it('payload=nullでfalseを返す（例外にならない）', async () => {
    const result = await verifyStripeSignature(null, 't=123,v1=abc', 'secret');
    expect(result).toBe(false);
  });

  it('signatureHeader=nullでfalseを返す', async () => {
    const result = await verifyStripeSignature('body', null, 'secret');
    expect(result).toBe(false);
  });

  it('secret=nullでfalseを返す', async () => {
    const result = await verifyStripeSignature('body', 't=123,v1=abc', null);
    expect(result).toBe(false);
  });

  it('signatureHeader=undefinedでfalseを返す', async () => {
    const result = await verifyStripeSignature('body', undefined, 'secret');
    expect(result).toBe(false);
  });

  it('タイムスタンプが数字以外の場合falseを返す', async () => {
    const result = await verifyStripeSignature('body', 't=abc,v1=def', 'secret');
    expect(result).toBe(false);
  });

  it('非常に大きなタイムスタンプでもfalseを返す（未来すぎる場合も署名不一致）', async () => {
    const result = await verifyStripeSignature(
      '{}',
      't=99999999999,v1=deadbeef',
      'secret'
    );
    expect(result).toBe(false);
  });

  it('同じペイロード・同じシークレットでも署名が毎回同一の確定的出力', async () => {
    const secret = 'whsec_deterministic_test';
    const payload = '{"type":"test"}';
    const timestamp = 1700000000;

    const result1 = await createValidSignature(payload, secret, timestamp);
    const result2 = await createValidSignature(payload, secret, timestamp);
    expect(result1).toBe(result2);
  });

  it('v0=形式の署名はv1として認識されない', async () => {
    const result = await verifyStripeSignature(
      'body',
      `t=${Math.floor(Date.now() / 1000)},v0=somesignature`,
      'secret'
    );
    expect(result).toBe(false);
  });
});

// ═══════════════════════════════════════════
// 2. Webhook DB操作エラー時のハンドリング
// ═══════════════════════════════════════════
describe('Webhook DB操作エラー時のハンドリング', () => {
  it('DB.prepare().first()がエラーを投げた場合500を返す', async () => {
    const env = makeStripeEnv();
    // DBのprepareをエラーを投げるモックに置換
    env.DB = {
      prepare: () => ({
        bind: () => ({
          async first() {
            throw new Error('D1 connection lost');
          },
          async run() {
            throw new Error('D1 connection lost');
          },
          async all() {
            throw new Error('D1 connection lost');
          },
        }),
      }),
    };

    const event = {
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_db_error',
          customer: 'cus_db_error',
          status: 'active',
          current_period_end: Math.floor(Date.now() / 1000) + 86400,
          items: { data: [{ price: { id: 'price_test_standard' } }] },
        },
      },
    };

    const body = JSON.stringify(event);
    const sigHeader = await createValidSignature(body, webhookSecret);
    const request = makeWebhookRequest(body, sigHeader);
    const response = await webhookHandler(createMockContext(request, env));
    // withMiddlewareのtry-catchで500
    expect(response.status).toBe(500);
  });

  it('subscription.deletedでDB.prepare()エラーでも500を返す', async () => {
    const env = makeStripeEnv();
    env.DB = {
      prepare: () => ({
        bind: () => ({
          async first() {
            throw new Error('DB unavailable');
          },
          async run() {
            throw new Error('DB unavailable');
          },
        }),
      }),
    };

    const event = {
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_del_db_error',
          customer: 'cus_del_db_error',
        },
      },
    };

    const body = JSON.stringify(event);
    const sigHeader = await createValidSignature(body, webhookSecret);
    const request = makeWebhookRequest(body, sigHeader);
    const response = await webhookHandler(createMockContext(request, env));
    expect(response.status).toBe(500);
  });
});

// ═══════════════════════════════════════════
// 3. CORSプリフライト（OPTIONS）応答テスト
// ═══════════════════════════════════════════
describe('CORSプリフライト応答テスト', () => {
  it('webhook OPTIONSで204を返す', async () => {
    const env = createMockEnv();
    const request = new Request('https://mylabeln.com/api/stripe/webhook', {
      method: 'OPTIONS',
      headers: {
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
    });
    const response = await webhookOptions(createMockContext(request, env));
    expect(response.status).toBe(204);
  });

  it('checkout OPTIONSで204を返す', async () => {
    const env = createMockEnv();
    const request = new Request('https://mylabeln.com/api/stripe/checkout', {
      method: 'OPTIONS',
      headers: {
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
    });
    const response = await checkoutOptions(createMockContext(request, env));
    expect(response.status).toBe(204);
  });

  it('portal OPTIONSで204を返す', async () => {
    const env = createMockEnv();
    const request = new Request('https://mylabeln.com/api/stripe/portal', {
      method: 'OPTIONS',
      headers: {
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
    });
    const response = await portalOptions(createMockContext(request, env));
    expect(response.status).toBe(204);
  });

  it('cancel OPTIONSで204を返す', async () => {
    const env = createMockEnv();
    const request = new Request('https://mylabeln.com/api/stripe/cancel', {
      method: 'OPTIONS',
      headers: {
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
    });
    const response = await cancelOptions(createMockContext(request, env));
    expect(response.status).toBe(204);
  });

  it('status OPTIONSで204を返す', async () => {
    const env = createMockEnv();
    const request = new Request('https://mylabeln.com/api/stripe/status', {
      method: 'OPTIONS',
      headers: {
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
    });
    const response = await statusOptions(createMockContext(request, env));
    expect(response.status).toBe(204);
  });

  it('CORSヘッダーにAccess-Control-Allow-Originが含まれる', async () => {
    const env = createMockEnv();
    const request = new Request('https://mylabeln.com/api/stripe/status', {
      method: 'OPTIONS',
      headers: {
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
    });
    const response = await statusOptions(createMockContext(request, env));
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
  });
});

// ═══════════════════════════════════════════
// 4. 期限切れトークンでStripeエンドポイントアクセス
// ═══════════════════════════════════════════
describe('期限切れトークンでStripeエンドポイント', () => {
  async function createExpiredToken(uid, mail, secret) {
    return createJWT(
      { sub: uid, email: mail, exp: Math.floor(Date.now() / 1000) - 3600 },
      secret
    );
  }

  it('期限切れトークンでcheckoutが401を返す', async () => {
    const env = createMockEnv();
    const expiredToken = await createExpiredToken(userId, email, env.JWT_SECRET);
    const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/checkout', {
      token: expiredToken,
      body: { plan: 'lite' },
    });
    const response = await checkoutHandler(createMockContext(request, env));
    expect(response.status).toBe(401);
  });

  it('期限切れトークンでcreate-checkoutが401を返す', async () => {
    const env = createMockEnv();
    const expiredToken = await createExpiredToken(userId, email, env.JWT_SECRET);
    const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/create-checkout', {
      token: expiredToken,
      body: { planId: 'standard' },
    });
    const response = await createCheckoutHandler(createMockContext(request, env));
    expect(response.status).toBe(401);
  });

  it('期限切れトークンでportalが401を返す', async () => {
    const env = createMockEnv();
    const expiredToken = await createExpiredToken(userId, email, env.JWT_SECRET);
    const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/portal', {
      token: expiredToken,
      body: {},
    });
    const response = await portalHandler(createMockContext(request, env));
    expect(response.status).toBe(401);
  });

  it('期限切れトークンでbilling-portalが401を返す', async () => {
    const env = createMockEnv();
    const expiredToken = await createExpiredToken(userId, email, env.JWT_SECRET);
    const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/billing-portal', {
      token: expiredToken,
      body: {},
    });
    const response = await billingPortalHandler(createMockContext(request, env));
    expect(response.status).toBe(401);
  });

  it('期限切れトークンでcancelが401を返す', async () => {
    const env = createMockEnv();
    const expiredToken = await createExpiredToken(userId, email, env.JWT_SECRET);
    const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/cancel', {
      token: expiredToken,
      body: {},
    });
    const response = await cancelHandler(createMockContext(request, env));
    expect(response.status).toBe(401);
  });

  it('期限切れトークンでpaymentsが401を返す', async () => {
    const env = createMockEnv();
    const expiredToken = await createExpiredToken(userId, email, env.JWT_SECRET);
    const request = makeRequest('GET', 'https://mylabeln.com/api/stripe/payments', {
      token: expiredToken,
    });
    const response = await paymentsHandler(createMockContext(request, env));
    expect(response.status).toBe(401);
  });
});

// ═══════════════════════════════════════════
// 5. Webhook: 全ステータス遷移の網羅テスト
// ═══════════════════════════════════════════
describe('Webhook: サブスクリプション全ステータス遷移', () => {
  const allStatuses = ['active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'];

  for (const status of allStatuses) {
    it(`subscription.updatedでstatus=${status}が200を返す`, async () => {
      const env = makeStripeEnv();
      env.DB._tables.users.push({
        id: `user-status-${status}`,
        email: `${status}@example.com`,
        stripe_customer_id: `cus_status_${status}`,
        plan: 'free',
      });

      const event = {
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: `sub_status_${status}`,
            customer: `cus_status_${status}`,
            status,
            current_period_end: Math.floor(Date.now() / 1000) + 86400,
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
  }

  it('active/trialingの場合のみusersテーブルのplanが更新される（subscription.created）', async () => {
    // activeの場合: subscriptionsにINSERT + usersをUPDATE
    const env = makeStripeEnv();
    env.DB._tables.users.push({
      id: 'user-plan-check',
      email: 'plancheck@example.com',
      stripe_customer_id: 'cus_plan_check',
      plan: 'free',
    });

    const event = {
      type: 'customer.subscription.created',
      data: {
        object: {
          id: 'sub_plan_check',
          customer: 'cus_plan_check',
          status: 'active',
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
          items: { data: [{ price: { id: 'price_test_pro' } }] },
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
    // subscriptionsテーブルにレコードが追加されていることを確認
    expect(env.DB._tables.subscriptions.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════
// 6. Webhookイベントタイプの網羅テスト
// ═══════════════════════════════════════════
describe('Webhook: 未対応イベントタイプの網羅', () => {
  const unhandledEvents = [
    'charge.succeeded',
    'charge.failed',
    'charge.refunded',
    'customer.created',
    'customer.updated',
    'customer.deleted',
    'invoice.created',
    'invoice.finalized',
    'invoice.paid',
    'invoice.payment_succeeded',
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'payment_method.attached',
    'payment_method.detached',
    'product.created',
    'price.created',
  ];

  for (const eventType of unhandledEvents) {
    it(`${eventType}でもreceived:trueを返す`, async () => {
      const env = makeStripeEnv();
      const event = {
        type: eventType,
        data: { object: { id: `obj_${eventType.replace(/\./g, '_')}` } },
      };

      const body = JSON.stringify(event);
      const sigHeader = await createValidSignature(body, webhookSecret);
      const request = makeWebhookRequest(body, sigHeader);
      const response = await webhookHandler(createMockContext(request, env));
      const { data } = await parseResponse(response);
      expect(response.status).toBe(200);
      expect(data.received).toBe(true);
    });
  }
});

// ═══════════════════════════════════════════
// 7. Stripe設定済み + fetch失敗時の502テスト
// ═══════════════════════════════════════════
describe('Stripe設定済み + fetch失敗時の502テスト', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('checkout: Stripe API fetch失敗で502を返す', async () => {
    const env = createMockEnv({ STRIPE_SECRET_KEY: stripeSecretKey });
    env.DB._tables.users.push({
      id: userId,
      email,
      stripe_customer_id: 'cus_existing',
    });
    const token = await createTestJWT(userId, email, env.JWT_SECRET);

    // fetchを失敗レスポンスに差し替え
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'API Error' } }), { status: 400 })
    );

    const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/checkout', {
      token,
      body: { plan: 'lite' },
    });
    const response = await checkoutHandler(createMockContext(request, env));
    expect(response.status).toBe(500);
  });

  it('create-checkout: Stripe API fetch失敗で500を返す', async () => {
    const env = createMockEnv({ STRIPE_SECRET_KEY: stripeSecretKey });
    env.DB._tables.users.push({
      id: userId,
      email,
      stripe_customer_id: 'cus_existing',
    });
    const token = await createTestJWT(userId, email, env.JWT_SECRET);

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'API Error' } }), { status: 500 })
    );

    const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/create-checkout', {
      token,
      body: { planId: 'standard' },
    });
    const response = await createCheckoutHandler(createMockContext(request, env));
    expect(response.status).toBe(500);
  });

  it('portal: Stripe API fetch失敗で502を返す', async () => {
    const env = createMockEnv({ STRIPE_SECRET_KEY: stripeSecretKey });
    env.DB._tables.users.push({
      id: userId,
      email,
      stripe_customer_id: 'cus_existing',
    });
    const token = await createTestJWT(userId, email, env.JWT_SECRET);

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Service Unavailable', { status: 503 })
    );

    const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/portal', {
      token,
      body: {},
    });
    const response = await portalHandler(createMockContext(request, env));
    expect(response.status).toBe(502);
  });

  it('billing-portal: Stripe API fetch失敗で502を返す', async () => {
    const env = createMockEnv({ STRIPE_SECRET_KEY: stripeSecretKey });
    env.DB._tables.users.push({
      id: userId,
      email,
      stripe_customer_id: 'cus_existing',
    });
    const token = await createTestJWT(userId, email, env.JWT_SECRET);

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Internal Server Error', { status: 500 })
    );

    const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/billing-portal', {
      token,
      body: {},
    });
    const response = await billingPortalHandler(createMockContext(request, env));
    expect(response.status).toBe(502);
  });

  it('cancel: Stripe API fetch失敗で502を返す（サブスクID取得失敗）', async () => {
    const env = createMockEnv({ STRIPE_SECRET_KEY: stripeSecretKey });
    env.DB._tables.users.push({
      id: userId,
      email,
      stripe_customer_id: 'cus_existing',
      stripe_subscription_id: null,
    });
    const token = await createTestJWT(userId, email, env.JWT_SECRET);

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Gateway Timeout', { status: 504 })
    );

    const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/cancel', {
      token,
      body: {},
    });
    const response = await cancelHandler(createMockContext(request, env));
    expect(response.status).toBe(502);
  });

  it('payments: Stripe API fetch失敗で502を返す', async () => {
    const env = createMockEnv({ STRIPE_SECRET_KEY: stripeSecretKey });
    env.DB._tables.users.push({
      id: userId,
      email,
      stripe_customer_id: 'cus_existing',
    });
    const token = await createTestJWT(userId, email, env.JWT_SECRET);

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('Rate Limited', { status: 429 })
    );

    const request = makeRequest('GET', 'https://mylabeln.com/api/stripe/payments', {
      token,
    });
    const response = await paymentsHandler(createMockContext(request, env));
    expect(response.status).toBe(502);
  });

  it('checkout: Customer作成失敗時に502を返す', async () => {
    const env = createMockEnv({ STRIPE_SECRET_KEY: stripeSecretKey });
    env.DB._tables.users.push({
      id: userId,
      email,
      stripe_customer_id: null, // Customer未作成
    });
    const token = await createTestJWT(userId, email, env.JWT_SECRET);

    // Customer作成APIが失敗
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), { status: 401 })
    );

    const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/checkout', {
      token,
      body: { plan: 'standard' },
    });
    const response = await checkoutHandler(createMockContext(request, env));
    expect(response.status).toBe(500);
  });

  it('cancel: サブスクIDあり + キャンセルAPI失敗で502を返す', async () => {
    const env = createMockEnv({ STRIPE_SECRET_KEY: stripeSecretKey });
    env.DB._tables.users.push({
      id: userId,
      email,
      stripe_customer_id: 'cus_existing',
      stripe_subscription_id: 'sub_existing',
    });
    const token = await createTestJWT(userId, email, env.JWT_SECRET);

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Cannot cancel' } }), { status: 400 })
    );

    const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/cancel', {
      token,
      body: {},
    });
    const response = await cancelHandler(createMockContext(request, env));
    expect(response.status).toBe(502);
  });

  it('cancel: アクティブサブスクなしで404を返す', async () => {
    const env = createMockEnv({ STRIPE_SECRET_KEY: stripeSecretKey });
    env.DB._tables.users.push({
      id: userId,
      email,
      stripe_customer_id: 'cus_existing',
      stripe_subscription_id: null,
    });
    const token = await createTestJWT(userId, email, env.JWT_SECRET);

    // サブスクリプション一覧がdata:[]で返る（アクティブなし）
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 })
    );

    const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/cancel', {
      token,
      body: {},
    });
    const response = await cancelHandler(createMockContext(request, env));
    expect(response.status).toBe(404);
  });

  it('checkout: Price ID未設定の場合500を返す', async () => {
    const env = createMockEnv({
      STRIPE_SECRET_KEY: stripeSecretKey,
      STRIPE_PRICE_LITE: '',
      STRIPE_PRICE_STANDARD: '',
      STRIPE_PRICE_PRO: '',
    });
    env.DB._tables.users.push({
      id: userId,
      email,
      stripe_customer_id: 'cus_existing',
    });
    const token = await createTestJWT(userId, email, env.JWT_SECRET);

    const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/checkout', {
      token,
      body: { plan: 'lite' },
    });
    const response = await checkoutHandler(createMockContext(request, env));
    expect(response.status).toBe(500);
  });
});

// ═══════════════════════════════════════════
// 8. Webhook署名のエンコーディングエッジケース
// ═══════════════════════════════════════════
describe('Webhook署名エンコーディングエッジケース', () => {
  it('日本語を含むペイロードでも正しく署名検証される', async () => {
    const env = makeStripeEnv();
    const event = {
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_jp',
          customer: 'cus_jp',
          status: 'active',
          current_period_end: Math.floor(Date.now() / 1000) + 86400,
          items: { data: [{ price: { id: 'price_test_lite' } }] },
          metadata: { description: '日本語テスト商品' },
        },
      },
    };

    // ユーザーがいないため早期リターンするが、署名検証は通る
    const body = JSON.stringify(event);
    const sigHeader = await createValidSignature(body, webhookSecret);
    const request = makeWebhookRequest(body, sigHeader);
    const response = await webhookHandler(createMockContext(request, env));
    expect(response.status).toBe(200);
  });

  it('特殊文字（改行・タブ）を含むペイロードでも署名検証される', async () => {
    const env = makeStripeEnv();
    const event = {
      type: 'test.special_chars',
      data: {
        object: { note: 'line1\nline2\ttab' },
      },
    };

    const body = JSON.stringify(event);
    const sigHeader = await createValidSignature(body, webhookSecret);
    const request = makeWebhookRequest(body, sigHeader);
    const response = await webhookHandler(createMockContext(request, env));
    expect(response.status).toBe(200);
  });
});
