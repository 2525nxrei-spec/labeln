/**
 * functions/api/stripe/ 全エンドポイントのテスト
 * Stripe APIは全てモック（STRIPE_SECRET_KEY未設定でモック返却される設計）
 */

import { describe, it, expect } from 'vitest';
import { createMockEnv, createMockContext, createTestJWT, parseResponse } from './helpers.js';

import { onRequestPost as checkoutHandler } from '../functions/api/stripe/checkout.js';
import { onRequestPost as createCheckoutHandler } from '../functions/api/stripe/create-checkout.js';
import { onRequestPost as webhookHandler } from '../functions/api/stripe/webhook.js';
import { onRequestPost as portalHandler } from '../functions/api/stripe/portal.js';
import { onRequestPost as billingPortalHandler } from '../functions/api/stripe/billing-portal.js';
import { onRequestPost as cancelHandler } from '../functions/api/stripe/cancel.js';
import { onRequestGet as statusHandler } from '../functions/api/stripe/status.js';
import { onRequestGet as paymentsHandler } from '../functions/api/stripe/payments.js';

const userId = 'user-stripe-test';
const email = 'stripe@example.com';

describe('Stripe API', () => {
  // ─── GET /api/stripe/status ───
  describe('GET /api/stripe/status', () => {
    it('Stripe接続情報を返す（STRIPE_SECRET_KEY未設定時connected=false）', async () => {
      const env = createMockEnv();
      const request = new Request('https://mylabeln.com/api/stripe/status', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
      });
      const response = await statusHandler(createMockContext(request, env));
      const { status, data } = await parseResponse(response);

      expect(status).toBe(200);
      expect(data.connected).toBe(false);
      expect(data.publishableKey).toBe('pk_test_xxx');
    });

    it('STRIPE_SECRET_KEY設定時connected=true', async () => {
      const env = createMockEnv({ STRIPE_SECRET_KEY: 'sk_test_xxx' });
      const request = new Request('https://mylabeln.com/api/stripe/status', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
      });
      const response = await statusHandler(createMockContext(request, env));
      const { data } = await parseResponse(response);
      expect(data.connected).toBe(true);
    });
  });

  // ─── POST /api/stripe/checkout ───
  describe('POST /api/stripe/checkout', () => {
    it('認証なしで401を返す', async () => {
      const env = createMockEnv();
      const request = new Request('https://mylabeln.com/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
        body: JSON.stringify({ plan: 'lite' }),
      });
      const response = await checkoutHandler(createMockContext(request, env));
      expect(response.status).toBe(401);
    });

    it('STRIPE_SECRET_KEY未設定時にモックを返す', async () => {
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
        body: JSON.stringify({ plan: 'lite' }),
      });
      const response = await checkoutHandler(createMockContext(request, env));
      const { status, data } = await parseResponse(response);

      expect(status).toBe(200);
      expect(data.mock).toBe(true);
      expect(data.clientSecret).toBeDefined();
    });

    it('無効なプランで400を返す', async () => {
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
        body: JSON.stringify({ plan: 'invalid' }),
      });
      const response = await checkoutHandler(createMockContext(request, env));
      expect(response.status).toBe(400);
    });
  });

  // ─── POST /api/stripe/create-checkout ───
  describe('POST /api/stripe/create-checkout', () => {
    it('認証なしで401を返す', async () => {
      const env = createMockEnv();
      const request = new Request('https://mylabeln.com/api/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
        body: JSON.stringify({ planId: 'lite' }),
      });
      const response = await createCheckoutHandler(createMockContext(request, env));
      expect(response.status).toBe(401);
    });

    it('STRIPE未設定時にモックを返す', async () => {
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
        body: JSON.stringify({ planId: 'standard' }),
      });
      const response = await createCheckoutHandler(createMockContext(request, env));
      const { status, data } = await parseResponse(response);

      expect(status).toBe(200);
      expect(data.mock).toBe(true);
      expect(data.url).toContain('mock_checkout');
    });

    it('無効なplanIdで400を返す', async () => {
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
        body: JSON.stringify({ planId: 'mega' }),
      });
      const response = await createCheckoutHandler(createMockContext(request, env));
      expect(response.status).toBe(400);
    });
  });

  // ─── POST /api/stripe/webhook ───
  describe('POST /api/stripe/webhook', () => {
    it('STRIPE未設定時にモックを返す', async () => {
      const env = createMockEnv();
      const request = new Request('https://mylabeln.com/api/stripe/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
        body: JSON.stringify({ type: 'test' }),
      });
      const response = await webhookHandler(createMockContext(request, env));
      const { status, data } = await parseResponse(response);

      expect(status).toBe(200);
      expect(data.received).toBe(true);
      expect(data.mock).toBe(true);
    });
  });

  // ─── POST /api/stripe/portal ───
  describe('POST /api/stripe/portal', () => {
    it('認証なしで401を返す', async () => {
      const env = createMockEnv();
      const request = new Request('https://mylabeln.com/api/stripe/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
        body: '{}',
      });
      const response = await portalHandler(createMockContext(request, env));
      expect(response.status).toBe(401);
    });

    it('STRIPE未設定時にモックURLを返す', async () => {
      const env = createMockEnv();
      const token = await createTestJWT(userId, email, env.JWT_SECRET);
      const request = new Request('https://mylabeln.com/api/stripe/portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
        },
        body: '{}',
      });
      const response = await portalHandler(createMockContext(request, env));
      const { status, data } = await parseResponse(response);

      expect(status).toBe(200);
      expect(data.mock).toBe(true);
      expect(data.url).toContain('mock_portal');
    });
  });

  // ─── POST /api/stripe/billing-portal ───
  describe('POST /api/stripe/billing-portal', () => {
    it('認証なしで401を返す', async () => {
      const env = createMockEnv();
      const request = new Request('https://mylabeln.com/api/stripe/billing-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
        body: '{}',
      });
      const response = await billingPortalHandler(createMockContext(request, env));
      expect(response.status).toBe(401);
    });

    it('STRIPE未設定時にモックURLを返す', async () => {
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
        body: '{}',
      });
      const response = await billingPortalHandler(createMockContext(request, env));
      const { status, data } = await parseResponse(response);

      expect(status).toBe(200);
      expect(data.mock).toBe(true);
    });
  });

  // ─── POST /api/stripe/cancel ───
  describe('POST /api/stripe/cancel', () => {
    it('認証なしで401を返す', async () => {
      const env = createMockEnv();
      const request = new Request('https://mylabeln.com/api/stripe/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
        body: '{}',
      });
      const response = await cancelHandler(createMockContext(request, env));
      expect(response.status).toBe(401);
    });

    it('STRIPE未設定時にモック解約を返す', async () => {
      const env = createMockEnv();
      const token = await createTestJWT(userId, email, env.JWT_SECRET);
      const request = new Request('https://mylabeln.com/api/stripe/cancel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
        },
        body: '{}',
      });
      const response = await cancelHandler(createMockContext(request, env));
      const { status, data } = await parseResponse(response);

      expect(status).toBe(200);
      expect(data.mock).toBe(true);
      expect(data.canceled).toBe(true);
    });
  });

  // ─── GET /api/stripe/payments ───
  describe('GET /api/stripe/payments', () => {
    it('認証なしで401を返す', async () => {
      const env = createMockEnv();
      const request = new Request('https://mylabeln.com/api/stripe/payments', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
      });
      const response = await paymentsHandler(createMockContext(request, env));
      expect(response.status).toBe(401);
    });

    it('STRIPE未設定時にモック（空配列）を返す', async () => {
      const env = createMockEnv();
      const token = await createTestJWT(userId, email, env.JWT_SECRET);
      const request = new Request('https://mylabeln.com/api/stripe/payments', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
        },
      });
      const response = await paymentsHandler(createMockContext(request, env));
      const { status, data } = await parseResponse(response);

      expect(status).toBe(200);
      expect(data.mock).toBe(true);
      expect(data.payments).toEqual([]);
    });
  });
});
