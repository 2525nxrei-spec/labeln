/**
 * functions/api/auth/ 全エンドポイントのテスト
 * register, login, me, password, account
 */

import { describe, it, expect } from 'vitest';
import { createMockEnv, createMockContext, createTestJWT, parseResponse } from './helpers.js';

// ハンドラーをインポート
import { onRequestPost as registerHandler } from '../functions/api/auth/register.js';
import { onRequestPost as loginHandler } from '../functions/api/auth/login.js';
import { onRequestGet as meHandler } from '../functions/api/auth/me.js';
import { onRequestPut as passwordHandler } from '../functions/api/auth/password.js';
import { onRequestDelete as deleteAccountHandler } from '../functions/api/auth/account.js';

describe('認証API', () => {
  // ─── POST /api/auth/register ───
  describe('POST /api/auth/register', () => {
    it('有効な入力で新規ユーザーを作成する（201）', async () => {
      const env = createMockEnv();
      const request = new Request('https://mylabeln.com/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
        body: JSON.stringify({ email: 'test@example.com', password: 'password123' }),
      });
      const ctx = createMockContext(request, env);
      const response = await registerHandler(ctx);
      const { status, data } = await parseResponse(response);

      expect(status).toBe(201);
      expect(data.token).toBeDefined();
      expect(data.user.email).toBe('test@example.com');
      expect(data.user.plan).toBe('free');
    });

    it('無効なメールアドレスで400を返す', async () => {
      const env = createMockEnv();
      const request = new Request('https://mylabeln.com/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
        body: JSON.stringify({ email: 'not-email', password: 'password123' }),
      });
      const response = await registerHandler(createMockContext(request, env));
      expect(response.status).toBe(400);
    });

    it('短いパスワードで400を返す', async () => {
      const env = createMockEnv();
      const request = new Request('https://mylabeln.com/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
        body: JSON.stringify({ email: 'test@example.com', password: '1234' }),
      });
      const response = await registerHandler(createMockContext(request, env));
      expect(response.status).toBe(400);
    });

    it('メール・パスワード未送信で400を返す', async () => {
      const env = createMockEnv();
      const request = new Request('https://mylabeln.com/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
        body: JSON.stringify({}),
      });
      const response = await registerHandler(createMockContext(request, env));
      expect(response.status).toBe(400);
    });

    it('不正なJSONで400を返す', async () => {
      const env = createMockEnv();
      const request = new Request('https://mylabeln.com/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
        body: 'not json',
      });
      const response = await registerHandler(createMockContext(request, env));
      expect(response.status).toBe(400);
    });

    it('指定プランがバリデーションされる', async () => {
      const env = createMockEnv();
      const request = new Request('https://mylabeln.com/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
        body: JSON.stringify({ email: 'plan@example.com', password: 'password123', plan: 'invalid_plan' }),
      });
      const response = await registerHandler(createMockContext(request, env));
      const { data } = await parseResponse(response);
      // 無効なプランはfreeにフォールバック
      expect(data.user.plan).toBe('free');
    });
  });

  // ─── POST /api/auth/login ───
  describe('POST /api/auth/login', () => {
    it('メール・パスワード未送信で400を返す', async () => {
      const env = createMockEnv();
      const request = new Request('https://mylabeln.com/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
        body: JSON.stringify({}),
      });
      const response = await loginHandler(createMockContext(request, env));
      expect(response.status).toBe(400);
    });

    it('存在しないユーザーで401を返す', async () => {
      const env = createMockEnv();
      const request = new Request('https://mylabeln.com/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
        body: JSON.stringify({ email: 'nouser@example.com', password: 'password123' }),
      });
      const response = await loginHandler(createMockContext(request, env));
      expect(response.status).toBe(401);
    });

    it('不正なJSONで400を返す', async () => {
      const env = createMockEnv();
      const request = new Request('https://mylabeln.com/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
        body: 'invalid',
      });
      const response = await loginHandler(createMockContext(request, env));
      expect(response.status).toBe(400);
    });
  });

  // ─── GET /api/auth/me ───
  describe('GET /api/auth/me', () => {
    it('トークンなしで401を返す', async () => {
      const env = createMockEnv();
      const request = new Request('https://mylabeln.com/api/auth/me', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
      });
      const response = await meHandler(createMockContext(request, env));
      expect(response.status).toBe(401);
    });

    it('有効なトークンでユーザーが見つからない場合404を返す', async () => {
      const env = createMockEnv();
      const token = await createTestJWT('nonexistent-user', 'a@b.com', env.JWT_SECRET);
      const request = new Request('https://mylabeln.com/api/auth/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
      });
      const response = await meHandler(createMockContext(request, env));
      expect(response.status).toBe(404);
    });

    it('有効なトークンとDBにユーザーが存在する場合200を返す', async () => {
      const userId = 'user-test-123';
      const env = createMockEnv();
      // DBにユーザーを追加
      env.DB._tables.users.push({
        id: userId,
        email: 'me@example.com',
        plan: 'lite',
        stripe_customer_id: null,
        created_at: '2025-01-01T00:00:00Z',
      });

      const token = await createTestJWT(userId, 'me@example.com', env.JWT_SECRET);
      const request = new Request('https://mylabeln.com/api/auth/me', {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
      });
      const response = await meHandler(createMockContext(request, env));
      const { status, data } = await parseResponse(response);

      expect(status).toBe(200);
      expect(data.id).toBe(userId);
      expect(data.email).toBe('me@example.com');
      expect(data.plan).toBe('lite');
    });
  });

  // ─── PUT /api/auth/password ───
  describe('PUT /api/auth/password', () => {
    it('トークンなしで401を返す', async () => {
      const env = createMockEnv();
      const request = new Request('https://mylabeln.com/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
        body: JSON.stringify({ current_password: 'old', new_password: 'newpassword1' }),
      });
      const response = await passwordHandler(createMockContext(request, env));
      expect(response.status).toBe(401);
    });

    it('必須パラメータ不足で400を返す', async () => {
      const env = createMockEnv();
      const token = await createTestJWT('user-1', 'a@b.com', env.JWT_SECRET);
      const request = new Request('https://mylabeln.com/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
        body: JSON.stringify({}),
      });
      const response = await passwordHandler(createMockContext(request, env));
      expect(response.status).toBe(400);
    });

    it('新パスワードが8文字未満で400を返す', async () => {
      const env = createMockEnv();
      const token = await createTestJWT('user-1', 'a@b.com', env.JWT_SECRET);
      const request = new Request('https://mylabeln.com/api/auth/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
        body: JSON.stringify({ current_password: 'oldpass', new_password: 'short' }),
      });
      const response = await passwordHandler(createMockContext(request, env));
      expect(response.status).toBe(400);
    });
  });

  // ─── DELETE /api/auth/account ───
  describe('DELETE /api/auth/account', () => {
    it('トークンなしで401を返す', async () => {
      const env = createMockEnv();
      const request = new Request('https://mylabeln.com/api/auth/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
        body: JSON.stringify({ password: 'test' }),
      });
      const response = await deleteAccountHandler(createMockContext(request, env));
      expect(response.status).toBe(401);
    });

    it('パスワード未送信で400を返す', async () => {
      const env = createMockEnv();
      const token = await createTestJWT('user-1', 'a@b.com', env.JWT_SECRET);
      const request = new Request('https://mylabeln.com/api/auth/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
        body: JSON.stringify({}),
      });
      const response = await deleteAccountHandler(createMockContext(request, env));
      expect(response.status).toBe(400);
    });
  });
});
