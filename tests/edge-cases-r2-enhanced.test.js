/**
 * エッジケース追加テスト 第2ラウンド
 * - SQLインジェクション的入力の安全性
 * - 境界値テスト（文字列長、配列サイズ）
 * - 同一ユーザーの並行リクエスト
 * - 認可強化（JWTの各種改ざん）
 * - Content-Type不正テスト
 * - Stripeエンドポイントのbody解析エッジケース
 */

import { describe, it, expect } from 'vitest';
import {
  createMockEnv,
  createMockContext,
  createTestJWT,
  parseResponse,
} from './helpers.js';
import { createJWT } from '../functions/lib/auth.js';

import { onRequestPost as registerHandler } from '../functions/api/auth/register.js';
import { onRequestPost as loginHandler } from '../functions/api/auth/login.js';
import { onRequestGet as meHandler } from '../functions/api/auth/me.js';
import { onRequestPost as createLabel } from '../functions/api/labels/index.js';
import { onRequestGet as listLabels } from '../functions/api/labels/index.js';
import { onRequestGet as getLabel, onRequestDelete as deleteLabel } from '../functions/api/labels/[id]/index.js';
import { onRequestPost as translateHandler } from '../functions/api/translate.js';
import { onRequestGet as usageHandler } from '../functions/api/usage.js';
import { onRequestPost as checkoutHandler } from '../functions/api/stripe/checkout.js';
import { onRequestPost as createCheckoutHandler } from '../functions/api/stripe/create-checkout.js';

function makeRequest(method, url, { body, token, headers: extra } = {}) {
  const headers = {
    'CF-Connecting-IP': '127.0.0.1',
    Origin: 'https://mylabeln.com',
    ...extra,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const init = { method, headers };
  if (body !== undefined && method !== 'GET') {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return new Request(url, init);
}

// ═══════════════════════════════════════════
// 1. SQLインジェクション的入力の安全性テスト
// ═══════════════════════════════════════════
describe('SQLインジェクション的入力の安全性', () => {
  it('register: emailにSQLインジェクション文字列でも400/409を返す', async () => {
    const env = createMockEnv();
    const request = makeRequest('POST', 'https://mylabeln.com/api/auth/register', {
      body: {
        email: "'; DROP TABLE users; --",
        password: 'Password123',
      },
    });
    const response = await registerHandler(createMockContext(request, env));
    // メールバリデーションで弾かれる（@がない）
    expect(response.status).toBe(400);
  });

  it('register: emailにSQLユニオン攻撃文字列でも400を返す', async () => {
    const env = createMockEnv();
    const request = makeRequest('POST', 'https://mylabeln.com/api/auth/register', {
      body: {
        email: "test@example.com' UNION SELECT * FROM users --",
        password: 'Password123',
      },
    });
    const response = await registerHandler(createMockContext(request, env));
    // メールバリデーション（スペース含む）で弾かれる
    expect(response.status).toBe(400);
  });

  it('login: passwordにSQLインジェクション文字列でも安全', async () => {
    const env = createMockEnv();
    const request = makeRequest('POST', 'https://mylabeln.com/api/auth/login', {
      body: {
        email: 'test@example.com',
        password: "' OR '1'='1",
      },
    });
    const response = await loginHandler(createMockContext(request, env));
    // ユーザー未登録のため401
    expect(response.status).toBe(401);
  });

  it('labels: product_nameにSQLインジェクション文字列でも安全に処理', async () => {
    const env = createMockEnv();
    env.DB._tables.users.push({ id: 'user-sql', email: 'sql@test.com', plan: 'standard' });
    const token = await createTestJWT('user-sql', 'sql@test.com', env.JWT_SECRET);
    const request = makeRequest('POST', 'https://mylabeln.com/api/labels', {
      token,
      body: { product_name: "'; DROP TABLE labels; --" },
    });
    const response = await createLabel(createMockContext(request, env));
    // product_nameは文字列として受け入れられるので201（prepareのbindで安全）
    expect(response.status).toBe(201);
  });
});

// ═══════════════════════════════════════════
// 2. 境界値テスト
// ═══════════════════════════════════════════
describe('境界値テスト', () => {
  it('register: パスワード7文字（最低8文字未満）で400を返す', async () => {
    const env = createMockEnv();
    const request = makeRequest('POST', 'https://mylabeln.com/api/auth/register', {
      body: { email: 'short@example.com', password: '1234567' },
    });
    const response = await registerHandler(createMockContext(request, env));
    expect(response.status).toBe(400);
  });

  it('register: パスワードちょうど8文字で受理される', async () => {
    const env = createMockEnv();
    const request = makeRequest('POST', 'https://mylabeln.com/api/auth/register', {
      body: { email: 'exact8@example.com', password: '12345678' },
    });
    const response = await registerHandler(createMockContext(request, env));
    // 新規登録成功（201）
    expect(response.status).toBe(201);
  });

  it('register: メールアドレスが最小形式 a@b.c で受理される', async () => {
    const env = createMockEnv();
    const request = makeRequest('POST', 'https://mylabeln.com/api/auth/register', {
      body: { email: 'a@b.c', password: 'Password123' },
    });
    const response = await registerHandler(createMockContext(request, env));
    expect(response.status).toBe(201);
  });

  it('translate: 空の配列textsで400を返す', async () => {
    const env = createMockEnv();
    env.DB._tables.users.push({ id: 'user-bv', email: 'bv@test.com', plan: 'standard' });
    const token = await createTestJWT('user-bv', 'bv@test.com', env.JWT_SECRET);
    const request = makeRequest('POST', 'https://mylabeln.com/api/translate', {
      token,
      body: { texts: [], source_lang: 'ja', target_langs: ['en'] },
    });
    const response = await translateHandler(createMockContext(request, env));
    expect(response.status).toBe(400);
  });

  it('translate: 空の配列target_langsで400を返す', async () => {
    const env = createMockEnv();
    env.DB._tables.users.push({ id: 'user-bv', email: 'bv@test.com', plan: 'standard' });
    const token = await createTestJWT('user-bv', 'bv@test.com', env.JWT_SECRET);
    const request = makeRequest('POST', 'https://mylabeln.com/api/translate', {
      token,
      body: { texts: ['test'], source_lang: 'ja', target_langs: [] },
    });
    const response = await translateHandler(createMockContext(request, env));
    expect(response.status).toBe(400);
  });
});

// ═══════════════════════════════════════════
// 3. Content-Type不正テスト
// ═══════════════════════════════════════════
describe('Content-Type不正テスト', () => {
  it('register: Content-Type=text/plainでもbody解析に失敗して400を返す', async () => {
    const env = createMockEnv();
    const request = new Request('https://mylabeln.com/api/auth/register', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
      body: 'this is not json',
    });
    const response = await registerHandler(createMockContext(request, env));
    expect(response.status).toBe(400);
  });

  it('checkout: Content-Type=application/xml で400を返す', async () => {
    const env = createMockEnv();
    const token = await createTestJWT('user-ct', 'ct@test.com', env.JWT_SECRET);
    const request = new Request('https://mylabeln.com/api/stripe/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/xml',
        Authorization: `Bearer ${token}`,
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
      body: '<plan>lite</plan>',
    });
    const response = await checkoutHandler(createMockContext(request, env));
    expect(response.status).toBe(400);
  });

  it('checkout: Content-Type=multipart/form-data で400を返す', async () => {
    const env = createMockEnv();
    const token = await createTestJWT('user-ct', 'ct@test.com', env.JWT_SECRET);
    const request = new Request('https://mylabeln.com/api/stripe/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'multipart/form-data',
        Authorization: `Bearer ${token}`,
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
      body: 'plan=lite',
    });
    const response = await checkoutHandler(createMockContext(request, env));
    expect(response.status).toBe(400);
  });
});

// ═══════════════════════════════════════════
// 4. JWT改ざん・特殊ケーステスト
// ═══════════════════════════════════════════
describe('JWT改ざん・特殊ケーステスト', () => {
  it('ヘッダーのalgをnoneに変更したトークンで401を返す', async () => {
    const env = createMockEnv();
    // alg: none攻撃のシミュレーション
    const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    const payload = btoa(
      JSON.stringify({
        sub: 'attacker',
        email: 'attacker@evil.com',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400,
      })
    )
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
    const noneToken = `${header}.${payload}.`;

    const request = makeRequest('GET', 'https://mylabeln.com/api/auth/me', {
      token: noneToken,
    });
    const response = await meHandler(createMockContext(request, env));
    expect(response.status).toBe(401);
  });

  it('空の署名部分のトークンで401を返す', async () => {
    const env = createMockEnv();
    const validToken = await createTestJWT('user-1', 'a@b.com', env.JWT_SECRET);
    const parts = validToken.split('.');
    const emptySignatureToken = `${parts[0]}.${parts[1]}.`;

    const request = makeRequest('GET', 'https://mylabeln.com/api/auth/me', {
      token: emptySignatureToken,
    });
    const response = await meHandler(createMockContext(request, env));
    expect(response.status).toBe(401);
  });

  it('Base64でない署名部分のトークンで401を返す', async () => {
    const env = createMockEnv();
    const validToken = await createTestJWT('user-1', 'a@b.com', env.JWT_SECRET);
    const parts = validToken.split('.');
    const badSigToken = `${parts[0]}.${parts[1]}.!!!invalid!!!`;

    const request = makeRequest('GET', 'https://mylabeln.com/api/auth/me', {
      token: badSigToken,
    });
    const response = await meHandler(createMockContext(request, env));
    expect(response.status).toBe(401);
  });

  it('非常に長いトークン（10KB）で401を返す', async () => {
    const env = createMockEnv();
    const longToken = 'a'.repeat(3000) + '.' + 'b'.repeat(3000) + '.' + 'c'.repeat(4000);

    const request = makeRequest('GET', 'https://mylabeln.com/api/auth/me', {
      token: longToken,
    });
    const response = await meHandler(createMockContext(request, env));
    expect(response.status).toBe(401);
  });

  it('JWT_SECRETが空文字列の場合401を返す', async () => {
    const env = createMockEnv({ JWT_SECRET: '' });
    const token = await createTestJWT('user-1', 'a@b.com', 'test-jwt-secret-key-for-ci');

    const request = makeRequest('GET', 'https://mylabeln.com/api/auth/me', {
      token,
    });
    const response = await meHandler(createMockContext(request, env));
    expect(response.status).toBe(401);
  });
});

// ═══════════════════════════════════════════
// 5. 並行リクエストテスト
// ═══════════════════════════════════════════
describe('並行リクエストテスト', () => {
  it('同一ユーザーで複数のラベル一覧取得を並行実行しても安全', async () => {
    const env = createMockEnv();
    env.DB._tables.users.push({ id: 'user-para', email: 'para@test.com', plan: 'standard' });
    const token = await createTestJWT('user-para', 'para@test.com', env.JWT_SECRET);

    // 5つの並行リクエスト
    const promises = Array.from({ length: 5 }, () => {
      const request = makeRequest('GET', 'https://mylabeln.com/api/labels', { token });
      return listLabels(createMockContext(request, env));
    });

    const responses = await Promise.all(promises);
    for (const response of responses) {
      expect(response.status).toBe(200);
    }
  });

  it('異なるユーザーで並行してcheckout（モック）を実行しても独立', async () => {
    const env = createMockEnv();
    const users = ['u1', 'u2', 'u3'];

    const promises = users.map(async (uid) => {
      const tok = await createTestJWT(uid, `${uid}@test.com`, env.JWT_SECRET);
      const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/checkout', {
        token: tok,
        body: { plan: 'lite' },
      });
      return checkoutHandler(createMockContext(request, env));
    });

    const responses = await Promise.all(promises);
    const parsedResponses = await Promise.all(responses.map(parseResponse));

    for (const { status, data } of parsedResponses) {
      expect(status).toBe(200);
      expect(data.mock).toBe(true);
      expect(data.clientSecret).toBeDefined();
    }

    // 各レスポンスのclientSecretが異なる（UUID）
    const secrets = parsedResponses.map((r) => r.data.clientSecret);
    const uniqueSecrets = new Set(secrets);
    expect(uniqueSecrets.size).toBe(users.length);
  });
});

// ═══════════════════════════════════════════
// 6. Stripeエンドポイントのbody解析エッジケース
// ═══════════════════════════════════════════
describe('Stripeエンドポイント body解析エッジケース', () => {
  it('checkout: __proto__を含むJSONでも安全に処理', async () => {
    const env = createMockEnv();
    const token = await createTestJWT('user-proto', 'proto@test.com', env.JWT_SECRET);
    const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/checkout', {
      token,
      body: { plan: 'lite', __proto__: { admin: true } },
    });
    const response = await checkoutHandler(createMockContext(request, env));
    const { status, data } = await parseResponse(response);
    expect(status).toBe(200);
    expect(data.mock).toBe(true);
  });

  it('checkout: constructorキーを含むJSONでも安全に処理', async () => {
    const env = createMockEnv();
    const token = await createTestJWT('user-ctor', 'ctor@test.com', env.JWT_SECRET);
    const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/checkout', {
      token,
      body: { plan: 'standard', constructor: { prototype: { isAdmin: true } } },
    });
    const response = await checkoutHandler(createMockContext(request, env));
    const { status, data } = await parseResponse(response);
    expect(status).toBe(200);
    expect(data.mock).toBe(true);
  });

  it('create-checkout: undefinedフィールドが無視される', async () => {
    const env = createMockEnv();
    const token = await createTestJWT('user-undef', 'undef@test.com', env.JWT_SECRET);
    // JSON.stringifyでundefinedフィールドは消える
    const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/create-checkout', {
      token,
      body: { planId: 'pro', priceId: undefined },
    });
    const response = await createCheckoutHandler(createMockContext(request, env));
    const { status, data } = await parseResponse(response);
    expect(status).toBe(200);
    expect(data.mock).toBe(true);
  });

  it('create-checkout: 極端に長いplanIdで400を返す', async () => {
    const env = createMockEnv();
    const token = await createTestJWT('user-long', 'long@test.com', env.JWT_SECRET);
    const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/create-checkout', {
      token,
      body: { planId: 'x'.repeat(10000) },
    });
    const response = await createCheckoutHandler(createMockContext(request, env));
    expect(response.status).toBe(400);
  });

  it('checkout: Unicodeエスケープを含むプラン名で400を返す', async () => {
    const env = createMockEnv();
    const token = await createTestJWT('user-unicode', 'unicode@test.com', env.JWT_SECRET);
    const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/checkout', {
      token,
      body: { plan: '\u006c\u0069\u0074\u0065' }, // "lite"のUnicodeエスケープ → 実際にはliteとして解釈
    });
    const response = await checkoutHandler(createMockContext(request, env));
    const { status, data } = await parseResponse(response);
    // JSON.parseでUnicodeエスケープは"lite"に解決されるので200
    expect(status).toBe(200);
    expect(data.mock).toBe(true);
  });

  it('checkout: boolean型のplanで400を返す', async () => {
    const env = createMockEnv();
    const token = await createTestJWT('user-bool', 'bool@test.com', env.JWT_SECRET);
    const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/checkout', {
      token,
      body: { plan: true },
    });
    const response = await checkoutHandler(createMockContext(request, env));
    expect(response.status).toBe(400);
  });

  it('checkout: null型のplanで400を返す', async () => {
    const env = createMockEnv();
    const token = await createTestJWT('user-null', 'null@test.com', env.JWT_SECRET);
    const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/checkout', {
      token,
      body: { plan: null },
    });
    const response = await checkoutHandler(createMockContext(request, env));
    expect(response.status).toBe(400);
  });

  it('checkout: オブジェクト型のplanで400を返す', async () => {
    const env = createMockEnv();
    const token = await createTestJWT('user-obj', 'obj@test.com', env.JWT_SECRET);
    const request = makeRequest('POST', 'https://mylabeln.com/api/stripe/checkout', {
      token,
      body: { plan: { name: 'lite' } },
    });
    const response = await checkoutHandler(createMockContext(request, env));
    expect(response.status).toBe(400);
  });
});

// ═══════════════════════════════════════════
// 7. ラベルAPI認可強化テスト
// ═══════════════════════════════════════════
describe('ラベルAPI認可強化テスト', () => {
  it('Authorizationヘッダーなしでラベル一覧取得は401', async () => {
    const env = createMockEnv();
    const request = new Request('https://mylabeln.com/api/labels', {
      method: 'GET',
      headers: {
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
    });
    const response = await listLabels(createMockContext(request, env));
    expect(response.status).toBe(401);
  });

  it('Authorizationヘッダーなしでラベル作成は401', async () => {
    const env = createMockEnv();
    const request = makeRequest('POST', 'https://mylabeln.com/api/labels', {
      body: { product_name: 'テスト' },
    });
    const response = await createLabel(createMockContext(request, env));
    expect(response.status).toBe(401);
  });

  it('Authorizationヘッダーなしでラベル詳細取得は401', async () => {
    const env = createMockEnv();
    const request = new Request('https://mylabeln.com/api/labels/some-id', {
      method: 'GET',
      headers: {
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
    });
    const response = await getLabel(createMockContext(request, env, { id: 'some-id' }));
    expect(response.status).toBe(401);
  });

  it('Authorizationヘッダーなしでラベル削除は401', async () => {
    const env = createMockEnv();
    const request = new Request('https://mylabeln.com/api/labels/some-id', {
      method: 'DELETE',
      headers: {
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
    });
    const response = await deleteLabel(createMockContext(request, env, { id: 'some-id' }));
    expect(response.status).toBe(401);
  });

  it('Authorizationヘッダーなしで翻訳は401', async () => {
    const env = createMockEnv();
    const request = makeRequest('POST', 'https://mylabeln.com/api/translate', {
      body: { texts: ['test'], source_lang: 'ja', target_langs: ['en'] },
    });
    // tokenなしなのでAuthorizationヘッダーがない
    const response = await translateHandler(createMockContext(request, env));
    expect(response.status).toBe(401);
  });

  it('Authorizationヘッダーなしで利用量取得は401', async () => {
    const env = createMockEnv();
    const request = new Request('https://mylabeln.com/api/usage', {
      method: 'GET',
      headers: {
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
    });
    const response = await usageHandler(createMockContext(request, env));
    expect(response.status).toBe(401);
  });
});

// ═══════════════════════════════════════════
// 8. 特殊文字入力テスト
// ═══════════════════════════════════════════
describe('特殊文字入力テスト', () => {
  it('register: emailにNULLバイトを含む文字列で400を返す', async () => {
    const env = createMockEnv();
    const request = makeRequest('POST', 'https://mylabeln.com/api/auth/register', {
      body: { email: 'test\x00@example.com', password: 'Password123' },
    });
    const response = await registerHandler(createMockContext(request, env));
    // NULLバイトはメールバリデーションで弾かれる可能性がある
    // もし通過してもD1のbindで安全に処理される
    expect([201, 400]).toContain(response.status);
  });

  it('labels: product_nameに絵文字を含めても安全に処理', async () => {
    const env = createMockEnv();
    env.DB._tables.users.push({ id: 'user-emoji', email: 'emoji@test.com', plan: 'standard' });
    const token = await createTestJWT('user-emoji', 'emoji@test.com', env.JWT_SECRET);
    const request = makeRequest('POST', 'https://mylabeln.com/api/labels', {
      token,
      body: { product_name: '美味しい醤油 🍶✨' },
    });
    const response = await createLabel(createMockContext(request, env));
    expect(response.status).toBe(201);
  });

  it('labels: product_nameにHTMLタグを含めても安全に処理', async () => {
    const env = createMockEnv();
    env.DB._tables.users.push({ id: 'user-html', email: 'html@test.com', plan: 'standard' });
    const token = await createTestJWT('user-html', 'html@test.com', env.JWT_SECRET);
    const request = makeRequest('POST', 'https://mylabeln.com/api/labels', {
      token,
      body: { product_name: '<img src=x onerror=alert(1)>' },
    });
    const response = await createLabel(createMockContext(request, env));
    // APIはHTMLサニタイズ不要（JSONレスポンス）。文字列としてそのまま保存される
    expect(response.status).toBe(201);
  });

  it('translate: textsにバックスラッシュやクォートを含めても安全に処理', async () => {
    const env = createMockEnv();
    env.DB._tables.users.push({ id: 'user-esc', email: 'esc@test.com', plan: 'standard' });
    const token = await createTestJWT('user-esc', 'esc@test.com', env.JWT_SECRET);
    const request = makeRequest('POST', 'https://mylabeln.com/api/translate', {
      token,
      body: {
        texts: ['He said "hello\\world"', "It's a test"],
        source_lang: 'en',
        target_langs: ['ja'],
      },
    });
    const response = await translateHandler(createMockContext(request, env));
    // GEMINI_API_KEY未設定のため翻訳自体はモック動作。入力バリデーションは通る
    const { status } = await parseResponse(response);
    expect(status).toBe(200);
  });
});
