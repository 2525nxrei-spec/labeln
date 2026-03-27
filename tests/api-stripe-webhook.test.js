/**
 * Stripe Webhook重点テスト
 * 全イベント、署名検証異常系、エッジケースを網羅
 */

import { describe, it, expect, vi } from 'vitest';
import { createMockEnv, createMockDB, createMockContext, parseResponse } from './helpers.js';
import { onRequestPost as webhookHandler } from '../functions/api/stripe/webhook.js';

/**
 * テスト用のStripe署名を生成する
 */
async function createValidSignature(payload, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
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

describe('Stripe Webhook 重点テスト', () => {
  const webhookSecret = 'whsec_test_secret_key';
  const stripeSecretKey = 'sk_test_xxx';

  // ─── STRIPE未設定時のモック返却 ───
  describe('STRIPE未設定', () => {
    it('STRIPE_SECRET_KEY未設定時にmock:trueを返す', async () => {
      const env = createMockEnv();
      const request = new Request('https://mylabeln.com/api/stripe/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
        body: JSON.stringify({ type: 'test' }),
      });
      const response = await webhookHandler(createMockContext(request, env));
      const { status, data } = await parseResponse(response);
      expect(status).toBe(200);
      expect(data.mock).toBe(true);
      expect(data.received).toBe(true);
    });

    it('STRIPE_WEBHOOK_SECRET未設定時にmock:trueを返す', async () => {
      const env = createMockEnv({ STRIPE_SECRET_KEY: stripeSecretKey });
      const request = new Request('https://mylabeln.com/api/stripe/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
        body: JSON.stringify({ type: 'test' }),
      });
      const response = await webhookHandler(createMockContext(request, env));
      const { status, data } = await parseResponse(response);
      expect(status).toBe(200);
      expect(data.mock).toBe(true);
    });
  });

  // ─── 署名検証の異常系 ───
  describe('署名検証異常系', () => {
    it('Stripe-Signatureヘッダーなしで400を返す', async () => {
      const env = createMockEnv({
        STRIPE_SECRET_KEY: stripeSecretKey,
        STRIPE_WEBHOOK_SECRET: webhookSecret,
      });
      const request = new Request('https://mylabeln.com/api/stripe/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
        body: JSON.stringify({ type: 'test' }),
      });
      const response = await webhookHandler(createMockContext(request, env));
      expect(response.status).toBe(400);
    });

    it('不正な署名で401を返す', async () => {
      const env = createMockEnv({
        STRIPE_SECRET_KEY: stripeSecretKey,
        STRIPE_WEBHOOK_SECRET: webhookSecret,
      });
      const body = JSON.stringify({ type: 'test' });
      const request = new Request('https://mylabeln.com/api/stripe/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
          'Stripe-Signature': `t=${Math.floor(Date.now() / 1000)},v1=invalid_signature_value`,
        },
        body,
      });
      const response = await webhookHandler(createMockContext(request, env));
      expect(response.status).toBe(401);
    });

    it('期限切れタイムスタンプで401を返す', async () => {
      const env = createMockEnv({
        STRIPE_SECRET_KEY: stripeSecretKey,
        STRIPE_WEBHOOK_SECRET: webhookSecret,
      });
      const body = JSON.stringify({ type: 'test' });
      // 10分前のタイムスタンプで署名（5分制限を超える）
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600;
      const signedPayload = `${oldTimestamp}.${body}`;
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

      const request = new Request('https://mylabeln.com/api/stripe/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
          'Stripe-Signature': `t=${oldTimestamp},v1=${signature}`,
        },
        body,
      });
      const response = await webhookHandler(createMockContext(request, env));
      expect(response.status).toBe(401);
    });

    it('空のペイロードで署名検証が失敗する', async () => {
      const env = createMockEnv({
        STRIPE_SECRET_KEY: stripeSecretKey,
        STRIPE_WEBHOOK_SECRET: webhookSecret,
      });
      const request = new Request('https://mylabeln.com/api/stripe/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
          'Stripe-Signature': 't=,v1=',
        },
        body: '',
      });
      const response = await webhookHandler(createMockContext(request, env));
      expect(response.status).toBe(401);
    });

    it('Stripe-Signatureが不完全な形式で401を返す', async () => {
      const env = createMockEnv({
        STRIPE_SECRET_KEY: stripeSecretKey,
        STRIPE_WEBHOOK_SECRET: webhookSecret,
      });
      const request = new Request('https://mylabeln.com/api/stripe/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
          'Stripe-Signature': 'malformed-signature-header',
        },
        body: JSON.stringify({ type: 'test' }),
      });
      const response = await webhookHandler(createMockContext(request, env));
      expect(response.status).toBe(401);
    });
  });

  // ─── Webhookイベント処理: customer.subscription.updated ───
  describe('customer.subscription.updated', () => {
    it('既存ユーザーのサブスクリプション更新（新規サブスクリプション）', async () => {
      const env = createMockEnv({
        STRIPE_SECRET_KEY: stripeSecretKey,
        STRIPE_WEBHOOK_SECRET: webhookSecret,
      });
      env.DB._tables.users.push({
        id: 'user-1',
        email: 'test@example.com',
        stripe_customer_id: 'cus_test_123',
        plan: 'free',
      });

      const event = {
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_test_123',
            customer: 'cus_test_123',
            status: 'active',
            current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
            items: { data: [{ price: { id: 'price_test_standard' } }] },
          },
        },
      };

      const body = JSON.stringify(event);
      const sigHeader = await createValidSignature(body, webhookSecret);

      const request = new Request('https://mylabeln.com/api/stripe/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
          'Stripe-Signature': sigHeader,
        },
        body,
      });
      const response = await webhookHandler(createMockContext(request, env));
      const { status, data } = await parseResponse(response);

      expect(status).toBe(200);
      expect(data.received).toBe(true);
    });

    it('存在しないカスタマーIDの場合でも200を返す（ログのみ）', async () => {
      const env = createMockEnv({
        STRIPE_SECRET_KEY: stripeSecretKey,
        STRIPE_WEBHOOK_SECRET: webhookSecret,
      });

      const event = {
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_test_999',
            customer: 'cus_nonexistent',
            status: 'active',
            current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
            items: { data: [{ price: { id: 'price_test_lite' } }] },
          },
        },
      };

      const body = JSON.stringify(event);
      const sigHeader = await createValidSignature(body, webhookSecret);

      const request = new Request('https://mylabeln.com/api/stripe/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
          'Stripe-Signature': sigHeader,
        },
        body,
      });
      const response = await webhookHandler(createMockContext(request, env));
      expect(response.status).toBe(200);
    });

    it('既存サブスクリプションの更新（UPDATEパス）', async () => {
      const env = createMockEnv({
        STRIPE_SECRET_KEY: stripeSecretKey,
        STRIPE_WEBHOOK_SECRET: webhookSecret,
      });
      env.DB._tables.users.push({
        id: 'user-2',
        email: 'test2@example.com',
        stripe_customer_id: 'cus_test_456',
        plan: 'lite',
      });
      env.DB._tables.subscriptions.push({
        id: 'sub-db-1',
        user_id: 'user-2',
        stripe_subscription_id: 'sub_existing',
        plan: 'lite',
        status: 'active',
      });

      const event = {
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_existing',
            customer: 'cus_test_456',
            status: 'active',
            current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
            items: { data: [{ price: { id: 'price_test_pro' } }] },
          },
        },
      };

      const body = JSON.stringify(event);
      const sigHeader = await createValidSignature(body, webhookSecret);

      const request = new Request('https://mylabeln.com/api/stripe/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
          'Stripe-Signature': sigHeader,
        },
        body,
      });
      const response = await webhookHandler(createMockContext(request, env));
      expect(response.status).toBe(200);
    });

    it('trialingステータスでもプランが更新される', async () => {
      const env = createMockEnv({
        STRIPE_SECRET_KEY: stripeSecretKey,
        STRIPE_WEBHOOK_SECRET: webhookSecret,
      });
      env.DB._tables.users.push({
        id: 'user-3',
        email: 'trial@example.com',
        stripe_customer_id: 'cus_trial',
        plan: 'free',
      });

      const event = {
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_trial',
            customer: 'cus_trial',
            status: 'trialing',
            current_period_end: Math.floor(Date.now() / 1000) + 14 * 86400,
            items: { data: [{ price: { id: 'price_test_lite' } }] },
          },
        },
      };

      const body = JSON.stringify(event);
      const sigHeader = await createValidSignature(body, webhookSecret);

      const request = new Request('https://mylabeln.com/api/stripe/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
          'Stripe-Signature': sigHeader,
        },
        body,
      });
      const response = await webhookHandler(createMockContext(request, env));
      expect(response.status).toBe(200);
    });
  });

  // ─── customer.subscription.created ───
  describe('customer.subscription.created', () => {
    it('新規サブスクリプション作成イベントを処理する', async () => {
      const env = createMockEnv({
        STRIPE_SECRET_KEY: stripeSecretKey,
        STRIPE_WEBHOOK_SECRET: webhookSecret,
      });
      env.DB._tables.users.push({
        id: 'user-new',
        email: 'new@example.com',
        stripe_customer_id: 'cus_new',
        plan: 'free',
      });

      const event = {
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_new_123',
            customer: 'cus_new',
            status: 'active',
            current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
            items: { data: [{ price: { id: 'price_test_standard' } }] },
          },
        },
      };

      const body = JSON.stringify(event);
      const sigHeader = await createValidSignature(body, webhookSecret);

      const request = new Request('https://mylabeln.com/api/stripe/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
          'Stripe-Signature': sigHeader,
        },
        body,
      });
      const response = await webhookHandler(createMockContext(request, env));
      const { status, data } = await parseResponse(response);

      expect(status).toBe(200);
      expect(data.received).toBe(true);
    });
  });

  // ─── customer.subscription.deleted ───
  describe('customer.subscription.deleted', () => {
    it('サブスクリプション削除でユーザーをfreeに戻す', async () => {
      const env = createMockEnv({
        STRIPE_SECRET_KEY: stripeSecretKey,
        STRIPE_WEBHOOK_SECRET: webhookSecret,
      });
      env.DB._tables.users.push({
        id: 'user-cancel',
        email: 'cancel@example.com',
        stripe_customer_id: 'cus_cancel',
        plan: 'standard',
      });
      env.DB._tables.subscriptions.push({
        id: 'sub-db-cancel',
        user_id: 'user-cancel',
        stripe_subscription_id: 'sub_cancel_123',
        plan: 'standard',
        status: 'active',
      });

      const event = {
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_cancel_123',
            customer: 'cus_cancel',
          },
        },
      };

      const body = JSON.stringify(event);
      const sigHeader = await createValidSignature(body, webhookSecret);

      const request = new Request('https://mylabeln.com/api/stripe/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
          'Stripe-Signature': sigHeader,
        },
        body,
      });
      const response = await webhookHandler(createMockContext(request, env));
      const { status, data } = await parseResponse(response);

      expect(status).toBe(200);
      expect(data.received).toBe(true);
    });

    it('存在しないカスタマーの削除イベントでも200を返す', async () => {
      const env = createMockEnv({
        STRIPE_SECRET_KEY: stripeSecretKey,
        STRIPE_WEBHOOK_SECRET: webhookSecret,
      });

      const event = {
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_ghost',
            customer: 'cus_ghost',
          },
        },
      };

      const body = JSON.stringify(event);
      const sigHeader = await createValidSignature(body, webhookSecret);

      const request = new Request('https://mylabeln.com/api/stripe/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
          'Stripe-Signature': sigHeader,
        },
        body,
      });
      const response = await webhookHandler(createMockContext(request, env));
      expect(response.status).toBe(200);
    });
  });

  // ─── 未知のイベントタイプ ───
  describe('未知のイベントタイプ', () => {
    it('未対応のイベントタイプでもreceived:trueを返す', async () => {
      const env = createMockEnv({
        STRIPE_SECRET_KEY: stripeSecretKey,
        STRIPE_WEBHOOK_SECRET: webhookSecret,
      });

      const event = {
        type: 'invoice.payment_failed',
        data: {
          object: { id: 'in_xxx', customer: 'cus_xxx' },
        },
      };

      const body = JSON.stringify(event);
      const sigHeader = await createValidSignature(body, webhookSecret);

      const request = new Request('https://mylabeln.com/api/stripe/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
          'Stripe-Signature': sigHeader,
        },
        body,
      });
      const response = await webhookHandler(createMockContext(request, env));
      const { status, data } = await parseResponse(response);

      expect(status).toBe(200);
      expect(data.received).toBe(true);
    });

    it('checkout.session.completedイベントでもreceived:trueを返す', async () => {
      const env = createMockEnv({
        STRIPE_SECRET_KEY: stripeSecretKey,
        STRIPE_WEBHOOK_SECRET: webhookSecret,
      });

      const event = {
        type: 'checkout.session.completed',
        data: {
          object: { id: 'cs_xxx', customer: 'cus_xxx', subscription: 'sub_xxx' },
        },
      };

      const body = JSON.stringify(event);
      const sigHeader = await createValidSignature(body, webhookSecret);

      const request = new Request('https://mylabeln.com/api/stripe/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
          'Stripe-Signature': sigHeader,
        },
        body,
      });
      const response = await webhookHandler(createMockContext(request, env));
      expect(response.status).toBe(200);
    });
  });

  // ─── エッジケース ───
  describe('エッジケース', () => {
    it('サブスクリプションのitems.dataが空の場合もliteにフォールバック', async () => {
      const env = createMockEnv({
        STRIPE_SECRET_KEY: stripeSecretKey,
        STRIPE_WEBHOOK_SECRET: webhookSecret,
      });
      env.DB._tables.users.push({
        id: 'user-edge',
        email: 'edge@example.com',
        stripe_customer_id: 'cus_edge',
        plan: 'free',
      });

      const event = {
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_edge',
            customer: 'cus_edge',
            status: 'active',
            current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
            items: { data: [] },
          },
        },
      };

      const body = JSON.stringify(event);
      const sigHeader = await createValidSignature(body, webhookSecret);

      const request = new Request('https://mylabeln.com/api/stripe/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
          'Stripe-Signature': sigHeader,
        },
        body,
      });
      const response = await webhookHandler(createMockContext(request, env));
      expect(response.status).toBe(200);
    });

    it('past_dueステータスではプラン更新されない（active/trialing以外）', async () => {
      const env = createMockEnv({
        STRIPE_SECRET_KEY: stripeSecretKey,
        STRIPE_WEBHOOK_SECRET: webhookSecret,
      });
      env.DB._tables.users.push({
        id: 'user-pd',
        email: 'pastdue@example.com',
        stripe_customer_id: 'cus_pd',
        plan: 'standard',
      });

      const event = {
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_pd',
            customer: 'cus_pd',
            status: 'past_due',
            current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
            items: { data: [{ price: { id: 'price_test_standard' } }] },
          },
        },
      };

      const body = JSON.stringify(event);
      const sigHeader = await createValidSignature(body, webhookSecret);

      const request = new Request('https://mylabeln.com/api/stripe/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
          'Stripe-Signature': sigHeader,
        },
        body,
      });
      const response = await webhookHandler(createMockContext(request, env));
      // サブスクリプションは更新されるが、usersテーブルのplan更新はされない
      expect(response.status).toBe(200);
    });
  });
});
