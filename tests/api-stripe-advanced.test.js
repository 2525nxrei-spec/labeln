/**
 * Stripe API 高度なテスト
 * checkout, create-checkout, portal, billing-portal, cancel, payments の異常系・エッジケース
 */

import { describe, it, expect, vi } from 'vitest';
import { createMockEnv, createMockContext, createTestJWT, parseResponse } from './helpers.js';

import { onRequestPost as checkoutHandler } from '../functions/api/stripe/checkout.js';
import { onRequestPost as createCheckoutHandler } from '../functions/api/stripe/create-checkout.js';
import { onRequestPost as portalHandler } from '../functions/api/stripe/portal.js';
import { onRequestPost as billingPortalHandler } from '../functions/api/stripe/billing-portal.js';
import { onRequestPost as cancelHandler } from '../functions/api/stripe/cancel.js';
import { onRequestGet as paymentsHandler } from '../functions/api/stripe/payments.js';
import { onRequestGet as statusHandler } from '../functions/api/stripe/status.js';

const userId = 'user-stripe-adv';
const email = 'stripeadv@example.com';

/** リクエスト生成ヘルパー */
function makeRequest(method, url, { body, token } = {}) {
  const headers = {
    'CF-Connecting-IP': '127.0.0.1',
    Origin: 'https://mylabeln.com',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  const init = { method, headers };
  if (body && method !== 'GET') {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return new Request(url, init);
}

describe('Stripe API 高度なテスト', () => {

  // ─── POST /api/stripe/checkout 追加テスト ───
  describe('POST /api/stripe/checkout 追加', () => {
    it('不正なJSONボディで400を返す', async () => {
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
        body: 'not-json-{{{',
      });
      const response = await checkoutHandler(createMockContext(request, env));
      expect(response.status).toBe(400);
    });

    it('空のボディで400を返す', async () => {
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
        body: '',
      });
      const response = await checkoutHandler(createMockContext(request, env));
      expect(response.status).toBe(400);
    });

    it('planIdフィールドでも受け付ける', async () => {
      const env = createMockEnv();
      const token = await createTestJWT(userId, email, env.JWT_SECRET);
      const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/checkout', {
        token,
        body: { planId: 'standard' },
      });
      const response = await checkoutHandler(createMockContext(request, env));
      const { status, data } = await parseResponse(response);
      expect(status).toBe(200);
      expect(data.mock).toBe(true);
    });

    it('planもplanIdもない場合400を返す', async () => {
      const env = createMockEnv();
      const token = await createTestJWT(userId, email, env.JWT_SECRET);
      const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/checkout', {
        token,
        body: {},
      });
      const response = await checkoutHandler(createMockContext(request, env));
      expect(response.status).toBe(400);
    });

    it('freeプランでは400を返す', async () => {
      const env = createMockEnv();
      const token = await createTestJWT(userId, email, env.JWT_SECRET);
      const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/checkout', {
        token,
        body: { plan: 'free' },
      });
      const response = await checkoutHandler(createMockContext(request, env));
      expect(response.status).toBe(400);
    });

    it('3つの有効なプラン（lite, standard, pro）が全て受理される', async () => {
      for (const plan of ['lite', 'standard', 'pro']) {
        const env = createMockEnv();
        const token = await createTestJWT(userId, email, env.JWT_SECRET);
        const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/checkout', {
          token,
          body: { plan },
        });
        const response = await checkoutHandler(createMockContext(request, env));
        const { status, data } = await parseResponse(response);
        expect(status).toBe(200);
        expect(data.mock).toBe(true);
      }
    });
  });

  // ─── POST /api/stripe/create-checkout 追加テスト ───
  describe('POST /api/stripe/create-checkout 追加', () => {
    it('不正なJSONで400を返す', async () => {
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
        body: '{invalid-json',
      });
      const response = await createCheckoutHandler(createMockContext(request, env));
      expect(response.status).toBe(400);
    });

    it('planIdなしで400を返す', async () => {
      const env = createMockEnv();
      const token = await createTestJWT(userId, email, env.JWT_SECRET);
      const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/create-checkout', {
        token,
        body: { someOtherField: 'value' },
      });
      const response = await createCheckoutHandler(createMockContext(request, env));
      expect(response.status).toBe(400);
    });

    it('各有効プランでモック返却される', async () => {
      for (const planId of ['lite', 'standard', 'pro']) {
        const env = createMockEnv();
        const token = await createTestJWT(userId, email, env.JWT_SECRET);
        const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/create-checkout', {
          token,
          body: { planId },
        });
        const response = await createCheckoutHandler(createMockContext(request, env));
        const { status, data } = await parseResponse(response);
        expect(status).toBe(200);
        expect(data.mock).toBe(true);
        expect(data.url).toContain(planId);
      }
    });

    it('payment_methodsパラメータがモックレスポンスに含まれる', async () => {
      const env = createMockEnv();
      const token = await createTestJWT(userId, email, env.JWT_SECRET);
      const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/create-checkout', {
        token,
        body: { planId: 'lite', payment_methods: ['card'] },
      });
      const response = await createCheckoutHandler(createMockContext(request, env));
      const { data } = await parseResponse(response);
      expect(data.payment_methods).toContain('card');
    });
  });

  // ─── POST /api/stripe/portal 追加テスト ───
  describe('POST /api/stripe/portal 追加', () => {
    it('Stripe設定済みだがstripe_customer_idが無い場合400', async () => {
      const env = createMockEnv({ STRIPE_SECRET_KEY: 'sk_test_xxx' });
      env.DB._tables.users.push({
        id: userId,
        email,
        stripe_customer_id: null,
      });
      const token = await createTestJWT(userId, email, env.JWT_SECRET);
      const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/portal', {
        token,
        body: {},
      });
      const response = await portalHandler(createMockContext(request, env));
      expect(response.status).toBe(400);
    });
  });

  // ─── POST /api/stripe/billing-portal 追加テスト ───
  describe('POST /api/stripe/billing-portal 追加', () => {
    it('Stripe設定済みだがstripe_customer_idが無い場合400', async () => {
      const env = createMockEnv({ STRIPE_SECRET_KEY: 'sk_test_xxx' });
      env.DB._tables.users.push({
        id: userId,
        email,
        stripe_customer_id: null,
      });
      const token = await createTestJWT(userId, email, env.JWT_SECRET);
      const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/billing-portal', {
        token,
        body: {},
      });
      const response = await billingPortalHandler(createMockContext(request, env));
      expect(response.status).toBe(400);
    });

    it('不正なJSONボディでも空オブジェクトにフォールバック', async () => {
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
        body: 'invalid-json',
      });
      const response = await billingPortalHandler(createMockContext(request, env));
      // billing-portal.jsはjson().catch(() => ({}))なのでエラーにならない
      const { status, data } = await parseResponse(response);
      expect(status).toBe(200);
      expect(data.mock).toBe(true);
    });
  });

  // ─── POST /api/stripe/cancel 追加テスト ───
  describe('POST /api/stripe/cancel 追加', () => {
    it('Stripe設定済みだがstripe_customer_idが無い場合400', async () => {
      const env = createMockEnv({ STRIPE_SECRET_KEY: 'sk_test_xxx' });
      env.DB._tables.users.push({
        id: userId,
        email,
        stripe_customer_id: null,
      });
      const token = await createTestJWT(userId, email, env.JWT_SECRET);
      const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/cancel', {
        token,
        body: {},
      });
      const response = await cancelHandler(createMockContext(request, env));
      expect(response.status).toBe(400);
    });
  });

  // ─── GET /api/stripe/payments 追加テスト ───
  describe('GET /api/stripe/payments 追加', () => {
    it('Stripe設定済みだがstripe_customer_idが無い場合は空payments配列を返す', async () => {
      const env = createMockEnv({ STRIPE_SECRET_KEY: 'sk_test_xxx' });
      env.DB._tables.users.push({
        id: userId,
        email,
        stripe_customer_id: null,
      });
      const token = await createTestJWT(userId, email, env.JWT_SECRET);
      const request = makeRequest('GET', 'https://mylabeln.com/api/stripe/payments', { token });
      const response = await paymentsHandler(createMockContext(request, env));
      const { status, data } = await parseResponse(response);
      expect(status).toBe(200);
      expect(data.payments).toEqual([]);
    });
  });

  // ─── GET /api/stripe/status 追加テスト ───
  describe('GET /api/stripe/status 追加', () => {
    it('全Price IDが設定されている場合plansオブジェクトを返す', async () => {
      const env = createMockEnv({ STRIPE_SECRET_KEY: 'sk_test_xxx' });
      const request = makeRequest('GET', 'https://mylabeln.com/api/stripe/status');
      const response = await statusHandler(createMockContext(request, env));
      const { data } = await parseResponse(response);

      expect(data.connected).toBe(true);
      expect(data.plans).toBeDefined();
      expect(data.plans.lite).toBe('price_test_lite');
      expect(data.plans.standard).toBe('price_test_standard');
      expect(data.plans.pro).toBe('price_test_pro');
      expect(data.paymentMethods).toContain('card');
      expect(data.paymentMethods).toContain('paypay');
    });

    it('Price IDが全て未設定の場合plans=null', async () => {
      const env = createMockEnv({
        STRIPE_PRICE_LITE: '',
        STRIPE_PRICE_STANDARD: '',
        STRIPE_PRICE_PRO: '',
      });
      const request = makeRequest('GET', 'https://mylabeln.com/api/stripe/status');
      const response = await statusHandler(createMockContext(request, env));
      const { data } = await parseResponse(response);

      expect(data.plans).toBeNull();
    });

    it('publishableKeyが未設定の場合null', async () => {
      const env = createMockEnv({ STRIPE_PUBLISHABLE_KEY: '' });
      const request = makeRequest('GET', 'https://mylabeln.com/api/stripe/status');
      const response = await statusHandler(createMockContext(request, env));
      const { data } = await parseResponse(response);
      // 空文字列はfalsyだがenvオーバーライドのため || null で null
      expect(data.publishableKey).toBeFalsy();
    });
  });
});
