/**
 * セキュリティ修正・不具合修正のテスト
 * - 登録APIでplan指定が無視されること
 * - translate APIの言語数制限
 * - translate API呼び出し時の利用量インクリメント
 * - create-checkoutでクライアントpriceIdが無視されること
 * - Stripe APIキー未設定時のエラーレスポンス
 * - 全APIエンドポイントがJSON形式で応答すること
 */

import { describe, it, expect } from 'vitest';
import { createMockEnv, createMockContext, createTestJWT, parseResponse } from './helpers.js';

import { onRequestPost as registerHandler } from '../functions/api/auth/register.js';
import { onRequestPost as translateHandler } from '../functions/api/translate.js';
import { onRequestPost as createCheckoutHandler } from '../functions/api/stripe/create-checkout.js';
import { onRequestPost as checkoutHandler } from '../functions/api/stripe/checkout.js';

// ─── 修正1: 登録APIでplan指定が無視される ───
describe('セキュリティ: 登録APIのplan無視', () => {
  it('plan:"pro"を送信しても常にfreeで登録される', async () => {
    const env = createMockEnv();
    const request = new Request('https://mylabeln.com/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
      body: JSON.stringify({ email: 'attacker@example.com', password: 'password123', plan: 'pro' }),
    });
    const response = await registerHandler(createMockContext(request, env));
    const { status, data } = await parseResponse(response);

    expect(status).toBe(201);
    expect(data.user.plan).toBe('free');
  });

  it('plan:"standard"を送信しても常にfreeで登録される', async () => {
    const env = createMockEnv();
    const request = new Request('https://mylabeln.com/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
      body: JSON.stringify({ email: 'attacker2@example.com', password: 'password123', plan: 'standard' }),
    });
    const response = await registerHandler(createMockContext(request, env));
    const { status, data } = await parseResponse(response);

    expect(status).toBe(201);
    expect(data.user.plan).toBe('free');
  });

  it('planパラメータ未指定でもfreeで登録される', async () => {
    const env = createMockEnv();
    const request = new Request('https://mylabeln.com/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
      body: JSON.stringify({ email: 'normal@example.com', password: 'password123' }),
    });
    const response = await registerHandler(createMockContext(request, env));
    const { status, data } = await parseResponse(response);

    expect(status).toBe(201);
    expect(data.user.plan).toBe('free');
  });
});

// ─── 修正2: translate APIの言語数制限 ───
describe('セキュリティ: translate API言語数制限', () => {
  it('freeプランで2言語以上を指定すると403を返す', async () => {
    const env = createMockEnv();
    env.DB._tables.users.push({ id: 'free-user', email: 'free@test.com', plan: 'free' });

    const token = await createTestJWT('free-user', 'free@test.com', env.JWT_SECRET);
    const request = new Request('https://mylabeln.com/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
      body: JSON.stringify({
        texts: ['テスト'],
        source_lang: 'ja',
        target_langs: ['en', 'ko'],
      }),
    });
    const response = await translateHandler(createMockContext(request, env));
    const { status, data } = await parseResponse(response);

    expect(status).toBe(403);
    expect(data.error).toContain('1言語まで');
  });

  it('freeプランで1言語なら成功する', async () => {
    const env = createMockEnv();
    env.DB._tables.users.push({ id: 'free-user-ok', email: 'freeok@test.com', plan: 'free' });

    const token = await createTestJWT('free-user-ok', 'freeok@test.com', env.JWT_SECRET);
    const request = new Request('https://mylabeln.com/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
      body: JSON.stringify({
        texts: ['テスト'],
        source_lang: 'ja',
        target_langs: ['en'],
      }),
    });
    const response = await translateHandler(createMockContext(request, env));
    const { status } = await parseResponse(response);

    expect(status).toBe(200);
  });

  it('liteプランで6言語以上を指定すると403を返す', async () => {
    const env = createMockEnv();
    env.DB._tables.users.push({ id: 'lite-user', email: 'lite@test.com', plan: 'lite' });

    const token = await createTestJWT('lite-user', 'lite@test.com', env.JWT_SECRET);
    const request = new Request('https://mylabeln.com/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
      body: JSON.stringify({
        texts: ['テスト'],
        source_lang: 'ja',
        target_langs: ['en', 'ko', 'fr', 'de', 'es', 'pt'],
      }),
    });
    const response = await translateHandler(createMockContext(request, env));
    const { status, data } = await parseResponse(response);

    expect(status).toBe(403);
    expect(data.error).toContain('5言語まで');
  });

  it('standardプランで18言語まで許可される', async () => {
    const env = createMockEnv();
    env.DB._tables.users.push({ id: 'std-user', email: 'std@test.com', plan: 'standard' });

    const token = await createTestJWT('std-user', 'std@test.com', env.JWT_SECRET);
    const request = new Request('https://mylabeln.com/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
      body: JSON.stringify({
        texts: ['テスト'],
        source_lang: 'ja',
        target_langs: ['en', 'ko', 'fr', 'de', 'es', 'pt', 'it', 'ru', 'ar', 'th', 'vi', 'id', 'ms', 'hi', 'nl', 'zh-CN', 'zh-TW'],
      }),
    });
    const response = await translateHandler(createMockContext(request, env));
    const { status } = await parseResponse(response);

    expect(status).toBe(200);
  });
});

// ─── 修正4: translate API呼び出し後に利用量がインクリメントされる ───
describe('修正: translate API利用量インクリメント', () => {
  it('翻訳API呼び出し後にusageテーブルにレコードが追加される', async () => {
    const env = createMockEnv();
    env.DB._tables.users.push({ id: 'usage-user', email: 'usage@test.com', plan: 'standard' });

    const token = await createTestJWT('usage-user', 'usage@test.com', env.JWT_SECRET);
    const request = new Request('https://mylabeln.com/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
      body: JSON.stringify({
        texts: ['テスト'],
        source_lang: 'ja',
        target_langs: ['en'],
      }),
    });
    const response = await translateHandler(createMockContext(request, env));
    const { status } = await parseResponse(response);

    expect(status).toBe(200);
    // usageテーブルにレコードが追加されていることを確認
    const usageRecords = env.DB._tables.usage;
    expect(usageRecords.length).toBeGreaterThan(0);
    const record = usageRecords.find(r => r.user_id === 'usage-user');
    expect(record).toBeDefined();
    // モックDBではINSERTのリテラル値(1)はbindされないため、user_idの存在で確認
    expect(record.user_id).toBe('usage-user');
  });
});

// ─── 修正5: create-checkoutでクライアントpriceIdが無視される ───
describe('セキュリティ: create-checkout priceId拒否', () => {
  it('環境変数のPrice ID未設定時、クライアントのpriceIdがあっても500を返す', async () => {
    const env = createMockEnv({
      STRIPE_SECRET_KEY: 'sk_test_xxx',
      STRIPE_PRICE_LITE: '',
      STRIPE_PRICE_STANDARD: '',
      STRIPE_PRICE_PRO: '',
    });
    env.DB._tables.users.push({ id: 'price-user', email: 'price@test.com', plan: 'free' });

    const token = await createTestJWT('price-user', 'price@test.com', env.JWT_SECRET);
    const request = new Request('https://mylabeln.com/api/stripe/create-checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
      body: JSON.stringify({
        planId: 'lite',
        priceId: 'price_attacker_injected',
      }),
    });
    const response = await createCheckoutHandler(createMockContext(request, env));
    const { status, data } = await parseResponse(response);

    expect(status).toBe(500);
    expect(data.error).toContain('Price IDが未設定');
  });
});

// ─── 修正6: Stripe APIキー未設定時の適切なエラーレスポンス ───
describe('Stripe APIエラーハンドリング', () => {
  it('STRIPE_SECRET_KEY未設定時にモックレスポンスをJSON形式で返す（create-checkout）', async () => {
    const env = createMockEnv();
    env.DB._tables.users.push({ id: 'mock-user', email: 'mock@test.com', plan: 'free' });

    const token = await createTestJWT('mock-user', 'mock@test.com', env.JWT_SECRET);
    const request = new Request('https://mylabeln.com/api/stripe/create-checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
      body: JSON.stringify({ planId: 'lite' }),
    });
    const response = await createCheckoutHandler(createMockContext(request, env));
    const { status, data } = await parseResponse(response);

    expect(status).toBe(200);
    expect(data.mock).toBe(true);
    expect(data.sessionId).toBeDefined();
    // JSONレスポンスであることを確認
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });

  it('STRIPE_SECRET_KEY未設定時にモックレスポンスをJSON形式で返す（checkout）', async () => {
    const env = createMockEnv();
    env.DB._tables.users.push({ id: 'mock-user2', email: 'mock2@test.com', plan: 'free' });

    const token = await createTestJWT('mock-user2', 'mock2@test.com', env.JWT_SECRET);
    const request = new Request('https://mylabeln.com/api/stripe/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
      body: JSON.stringify({ planId: 'standard' }),
    });
    const response = await checkoutHandler(createMockContext(request, env));
    const { status, data } = await parseResponse(response);

    expect(status).toBe(200);
    expect(data.mock).toBe(true);
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });
});

// ─── 全APIエンドポイントがJSON形式で応答する ───
describe('全APIエンドポイントのJSON応答確認', () => {
  it('register APIがJSON形式で応答する', async () => {
    const env = createMockEnv();
    const request = new Request('https://mylabeln.com/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
      body: JSON.stringify({ email: 'json@test.com', password: 'password123' }),
    });
    const response = await registerHandler(createMockContext(request, env));
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });

  it('register APIエラー時もJSON形式で応答する', async () => {
    const env = createMockEnv();
    const request = new Request('https://mylabeln.com/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
      body: JSON.stringify({ email: 'bad', password: '123' }),
    });
    const response = await registerHandler(createMockContext(request, env));
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });

  it('translate APIエラー時もJSON形式で応答する', async () => {
    const env = createMockEnv();
    const request = new Request('https://mylabeln.com/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
      body: JSON.stringify({ texts: ['test'], source_lang: 'ja', target_langs: ['en'] }),
    });
    const response = await translateHandler(createMockContext(request, env));
    // 401（認証なし）でもJSON
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });

  it('create-checkout APIエラー時もJSON形式で応答する', async () => {
    const env = createMockEnv();
    const request = new Request('https://mylabeln.com/api/stripe/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
      body: JSON.stringify({ planId: 'invalid' }),
    });
    const response = await createCheckoutHandler(createMockContext(request, env));
    // 認証エラーでもJSON
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });
});
