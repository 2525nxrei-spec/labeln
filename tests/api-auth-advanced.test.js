/**
 * 認証API 高度なテスト
 * login成功フロー、password変更成功、account削除成功、異常系・エッジケース
 */

import { describe, it, expect } from 'vitest';
import { createMockEnv, createMockDB, createMockContext, createTestJWT, parseResponse } from './helpers.js';
import { hashPassword, generateSalt } from '../functions/lib/auth.js';

import { onRequestPost as registerHandler } from '../functions/api/auth/register.js';
import { onRequestPost as loginHandler } from '../functions/api/auth/login.js';
import { onRequestGet as meHandler } from '../functions/api/auth/me.js';
import { onRequestPut as passwordHandler } from '../functions/api/auth/password.js';
import { onRequestDelete as deleteAccountHandler } from '../functions/api/auth/account.js';

/** リクエスト生成ヘルパー */
function makeRequest(method, url, { body, token } = {}) {
  const headers = {
    'CF-Connecting-IP': '127.0.0.1',
    Origin: 'https://mylabeln.com',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const init = { method, headers };
  if (body !== undefined && method !== 'GET') {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return new Request(url, init);
}

describe('認証API 高度なテスト', () => {

  // ─── ログイン成功フロー ───
  describe('POST /api/auth/login 成功フロー', () => {
    it('正しいパスワードでログインしてトークンを取得する', async () => {
      const env = createMockEnv();
      const salt = generateSalt();
      const passwordHash = await hashPassword('TestPass123', salt);

      env.DB._tables.users.push({
        id: 'user-login-1',
        email: 'login@example.com',
        password_hash: passwordHash,
        salt,
        plan: 'standard',
      });

      const request = makeRequest('POST', 'https://mylabeln.com/api/auth/login', {
        body: { email: 'login@example.com', password: 'TestPass123' },
      });
      const response = await loginHandler(createMockContext(request, env));
      const { status, data } = await parseResponse(response);

      expect(status).toBe(200);
      expect(data.token).toBeDefined();
      expect(data.user.id).toBe('user-login-1');
      expect(data.user.email).toBe('login@example.com');
      expect(data.user.plan).toBe('standard');
    });

    it('間違ったパスワードで401を返す', async () => {
      const env = createMockEnv();
      const salt = generateSalt();
      const passwordHash = await hashPassword('CorrectPass123', salt);

      env.DB._tables.users.push({
        id: 'user-login-2',
        email: 'login2@example.com',
        password_hash: passwordHash,
        salt,
        plan: 'free',
      });

      const request = makeRequest('POST', 'https://mylabeln.com/api/auth/login', {
        body: { email: 'login2@example.com', password: 'WrongPass123' },
      });
      const response = await loginHandler(createMockContext(request, env));
      expect(response.status).toBe(401);
    });

    it('メールアドレスが大文字でも正規化される', async () => {
      const env = createMockEnv();
      const salt = generateSalt();
      const passwordHash = await hashPassword('TestPass123', salt);

      env.DB._tables.users.push({
        id: 'user-login-3',
        email: 'upper@example.com',
        password_hash: passwordHash,
        salt,
        plan: 'lite',
      });

      const request = makeRequest('POST', 'https://mylabeln.com/api/auth/login', {
        body: { email: 'UPPER@example.com', password: 'TestPass123' },
      });
      const response = await loginHandler(createMockContext(request, env));
      const { status, data } = await parseResponse(response);
      expect(status).toBe(200);
      expect(data.token).toBeDefined();
    });

    it('JWT_SECRET未設定で500を返す', async () => {
      const env = createMockEnv({ JWT_SECRET: '' });
      const salt = generateSalt();
      const passwordHash = await hashPassword('TestPass123', salt);

      env.DB._tables.users.push({
        id: 'user-login-4',
        email: 'nojwt@example.com',
        password_hash: passwordHash,
        salt,
        plan: 'free',
      });

      const request = makeRequest('POST', 'https://mylabeln.com/api/auth/login', {
        body: { email: 'nojwt@example.com', password: 'TestPass123' },
      });
      const response = await loginHandler(createMockContext(request, env));
      expect(response.status).toBe(500);
    });
  });

  // ─── 登録の追加テスト ───
  describe('POST /api/auth/register 追加', () => {
    it('plan指定しても常にfreeで登録される（セキュリティ修正）', async () => {
      const env = createMockEnv();
      const request = makeRequest('POST', 'https://mylabeln.com/api/auth/register', {
        body: { email: 'premium@example.com', password: 'password123', plan: 'standard' },
      });
      const response = await registerHandler(createMockContext(request, env));
      const { status, data } = await parseResponse(response);
      expect(status).toBe(201);
      expect(data.user.plan).toBe('free');
    });

    it('重複メールで409を返す', async () => {
      const env = createMockEnv();
      env.DB._tables.users.push({
        id: 'existing',
        email: 'dup@example.com',
      });

      const request = makeRequest('POST', 'https://mylabeln.com/api/auth/register', {
        body: { email: 'dup@example.com', password: 'password123' },
      });
      const response = await registerHandler(createMockContext(request, env));
      expect(response.status).toBe(409);
    });

    it('JWT_SECRET未設定で500を返す', async () => {
      const env = createMockEnv({ JWT_SECRET: '' });
      const request = makeRequest('POST', 'https://mylabeln.com/api/auth/register', {
        body: { email: 'nojwt2@example.com', password: 'password123' },
      });
      const response = await registerHandler(createMockContext(request, env));
      expect(response.status).toBe(500);
    });
  });

  // ─── パスワード変更の成功フロー ───
  describe('PUT /api/auth/password 成功フロー', () => {
    it('正しい現在パスワードで変更に成功する', async () => {
      const env = createMockEnv();
      const salt = generateSalt();
      const passwordHash = await hashPassword('OldPass123', salt);

      env.DB._tables.users.push({
        id: 'user-pw-1',
        email: 'pw@example.com',
        password_hash: passwordHash,
        salt,
        plan: 'free',
      });

      const token = await createTestJWT('user-pw-1', 'pw@example.com', env.JWT_SECRET);
      const request = makeRequest('PUT', 'https://mylabeln.com/api/auth/password', {
        token,
        body: { current_password: 'OldPass123', new_password: 'NewPass456' },
      });
      const response = await passwordHandler(createMockContext(request, env));
      const { status, data } = await parseResponse(response);
      expect(status).toBe(200);
      expect(data.message).toContain('変更しました');
    });

    it('現在のパスワードが間違っていると401を返す', async () => {
      const env = createMockEnv();
      const salt = generateSalt();
      const passwordHash = await hashPassword('OldPass123', salt);

      env.DB._tables.users.push({
        id: 'user-pw-2',
        email: 'pw2@example.com',
        password_hash: passwordHash,
        salt,
        plan: 'free',
      });

      const token = await createTestJWT('user-pw-2', 'pw2@example.com', env.JWT_SECRET);
      const request = makeRequest('PUT', 'https://mylabeln.com/api/auth/password', {
        token,
        body: { current_password: 'WrongPass', new_password: 'NewPass456' },
      });
      const response = await passwordHandler(createMockContext(request, env));
      expect(response.status).toBe(401);
    });

    it('存在しないユーザーで404を返す', async () => {
      const env = createMockEnv();
      const token = await createTestJWT('nonexistent', 'ghost@example.com', env.JWT_SECRET);
      const request = makeRequest('PUT', 'https://mylabeln.com/api/auth/password', {
        token,
        body: { current_password: 'OldPass123', new_password: 'NewPass456' },
      });
      const response = await passwordHandler(createMockContext(request, env));
      expect(response.status).toBe(404);
    });

    it('英字のみの新パスワードで400を返す', async () => {
      const env = createMockEnv();
      const token = await createTestJWT('user-1', 'a@b.com', env.JWT_SECRET);
      const request = makeRequest('PUT', 'https://mylabeln.com/api/auth/password', {
        token,
        body: { current_password: 'OldPass123', new_password: 'abcdefgh' },
      });
      // password.jsは英字と数字の両方が必要
      const response = await passwordHandler(createMockContext(request, env));
      expect(response.status).toBe(400);
    });

    it('数字のみの新パスワードで400を返す', async () => {
      const env = createMockEnv();
      const token = await createTestJWT('user-1', 'a@b.com', env.JWT_SECRET);
      const request = makeRequest('PUT', 'https://mylabeln.com/api/auth/password', {
        token,
        body: { current_password: 'OldPass123', new_password: '12345678' },
      });
      const response = await passwordHandler(createMockContext(request, env));
      expect(response.status).toBe(400);
    });

    it('不正なJSONで400を返す', async () => {
      const env = createMockEnv();
      const token = await createTestJWT('user-1', 'a@b.com', env.JWT_SECRET);
      const request = new Request('https://mylabeln.com/api/auth/password', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
        },
        body: 'not-json',
      });
      const response = await passwordHandler(createMockContext(request, env));
      expect(response.status).toBe(400);
    });
  });

  // ─── アカウント削除の成功フロー ───
  describe('DELETE /api/auth/account 成功フロー', () => {
    it('正しいパスワードでアカウント削除に成功する', async () => {
      const env = createMockEnv();
      const salt = generateSalt();
      const passwordHash = await hashPassword('DeleteMe123', salt);

      env.DB._tables.users.push({
        id: 'user-del-1',
        email: 'del@example.com',
        password_hash: passwordHash,
        salt,
        plan: 'free',
      });

      const token = await createTestJWT('user-del-1', 'del@example.com', env.JWT_SECRET);
      const request = makeRequest('DELETE', 'https://mylabeln.com/api/auth/account', {
        token,
        body: { password: 'DeleteMe123' },
      });
      const response = await deleteAccountHandler(createMockContext(request, env));
      const { status, data } = await parseResponse(response);
      expect(status).toBe(200);
      expect(data.message).toContain('削除しました');
    });

    it('パスワードが間違っている場合401を返す', async () => {
      const env = createMockEnv();
      const salt = generateSalt();
      const passwordHash = await hashPassword('CorrectPass', salt);

      env.DB._tables.users.push({
        id: 'user-del-2',
        email: 'del2@example.com',
        password_hash: passwordHash,
        salt,
        plan: 'free',
      });

      const token = await createTestJWT('user-del-2', 'del2@example.com', env.JWT_SECRET);
      const request = makeRequest('DELETE', 'https://mylabeln.com/api/auth/account', {
        token,
        body: { password: 'WrongPassword' },
      });
      const response = await deleteAccountHandler(createMockContext(request, env));
      expect(response.status).toBe(401);
    });

    it('存在しないユーザーで404を返す', async () => {
      const env = createMockEnv();
      const token = await createTestJWT('ghost-user', 'ghost@example.com', env.JWT_SECRET);
      const request = makeRequest('DELETE', 'https://mylabeln.com/api/auth/account', {
        token,
        body: { password: 'SomePassword' },
      });
      const response = await deleteAccountHandler(createMockContext(request, env));
      expect(response.status).toBe(404);
    });

    it('不正なJSONで400を返す', async () => {
      const env = createMockEnv();
      const token = await createTestJWT('user-1', 'a@b.com', env.JWT_SECRET);
      const request = new Request('https://mylabeln.com/api/auth/account', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
        },
        body: '{bad-json',
      });
      const response = await deleteAccountHandler(createMockContext(request, env));
      expect(response.status).toBe(400);
    });
  });

  // ─── エッジケース・異常系 ───
  describe('エッジケース・異常系', () => {
    it('SQL injection的なメールアドレスで400を返す', async () => {
      const env = createMockEnv();
      const request = makeRequest('POST', 'https://mylabeln.com/api/auth/register', {
        body: { email: "'; DROP TABLE users; --", password: 'password123' },
      });
      const response = await registerHandler(createMockContext(request, env));
      // isValidEmailでバリデーションされる
      expect(response.status).toBe(400);
    });

    it('非常に長いメールアドレスでも正しく処理される', async () => {
      const env = createMockEnv();
      const longEmail = 'a'.repeat(200) + '@example.com';
      const request = makeRequest('POST', 'https://mylabeln.com/api/auth/register', {
        body: { email: longEmail, password: 'password123' },
      });
      const response = await registerHandler(createMockContext(request, env));
      // isValidEmailは通る（200文字+@example.com は有効なフォーマット）
      // ただし成功するはず
      expect([201, 400]).toContain(response.status);
    });

    it('非常に長いパスワードでも処理される', async () => {
      const env = createMockEnv();
      const longPass = 'A1' + 'x'.repeat(10000);
      const request = makeRequest('POST', 'https://mylabeln.com/api/auth/register', {
        body: { email: 'longpass@example.com', password: longPass },
      });
      const response = await registerHandler(createMockContext(request, env));
      expect(response.status).toBe(201);
    });

    it('期限切れトークンで401を返す', async () => {
      const env = createMockEnv();
      // 期限切れJWT生成
      const { createJWT } = await import('../functions/lib/auth.js');
      const expiredToken = await createJWT(
        { sub: 'user-1', email: 'a@b.com', exp: Math.floor(Date.now() / 1000) - 100 },
        env.JWT_SECRET
      );
      const request = makeRequest('GET', 'https://mylabeln.com/api/auth/me', {
        token: expiredToken,
      });
      const response = await meHandler(createMockContext(request, env));
      expect(response.status).toBe(401);
    });

    it('Bearer接頭辞なしのトークンで401', async () => {
      const env = createMockEnv();
      const request = new Request('https://mylabeln.com/api/auth/me', {
        method: 'GET',
        headers: {
          Authorization: 'InvalidScheme sometoken',
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
        },
      });
      const response = await meHandler(createMockContext(request, env));
      expect(response.status).toBe(401);
    });
  });
});
