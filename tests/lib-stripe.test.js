/**
 * functions/lib/stripe.js のユニットテスト
 * 外部API呼び出しはモック（stripeRequestのfetchは呼ばない）
 */

import { describe, it, expect, vi } from 'vitest';
import { verifyStripeSignature, determinePlanFromPrice } from '../functions/lib/stripe.js';

describe('stripe.js ユーティリティ', () => {
  // ─── determinePlanFromPrice ───
  describe('determinePlanFromPrice', () => {
    const env = {
      STRIPE_PRICE_LITE: 'price_lite_123',
      STRIPE_PRICE_STANDARD: 'price_std_456',
      STRIPE_PRICE_PRO: 'price_pro_789',
    };

    it('Lite Price IDからliteを返す', () => {
      expect(determinePlanFromPrice('price_lite_123', env)).toBe('lite');
    });

    it('Standard Price IDからstandardを返す', () => {
      expect(determinePlanFromPrice('price_std_456', env)).toBe('standard');
    });

    it('Pro Price IDからproを返す', () => {
      expect(determinePlanFromPrice('price_pro_789', env)).toBe('pro');
    });

    it('不明なPrice IDではliteにフォールバックする', () => {
      expect(determinePlanFromPrice('price_unknown', env)).toBe('lite');
    });
  });

  // ─── verifyStripeSignature ───
  describe('verifyStripeSignature', () => {
    it('正しい署名を検証できる', async () => {
      const secret = 'whsec_test_secret';
      const payload = '{"type":"test"}';
      const timestamp = Math.floor(Date.now() / 1000);

      // HMAC-SHA256で署名を生成
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

      const sigHeader = `t=${timestamp},v1=${signature}`;
      const result = await verifyStripeSignature(payload, sigHeader, secret);
      expect(result).toBe(true);
    });

    it('不正な署名を拒否する', async () => {
      const result = await verifyStripeSignature(
        '{"type":"test"}',
        `t=${Math.floor(Date.now() / 1000)},v1=invalid_signature`,
        'whsec_secret'
      );
      expect(result).toBe(false);
    });

    it('タイムスタンプが古すぎる場合に拒否する', async () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10分前
      const result = await verifyStripeSignature(
        '{"type":"test"}',
        `t=${oldTimestamp},v1=abc`,
        'whsec_secret'
      );
      expect(result).toBe(false);
    });

    it('Stripe-Signatureヘッダーが不正な形式の場合falseを返す', async () => {
      expect(await verifyStripeSignature('body', 'invalid', 'secret')).toBe(false);
      expect(await verifyStripeSignature('body', '', 'secret')).toBe(false);
    });
  });
});
