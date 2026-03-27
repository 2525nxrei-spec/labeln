/**
 * functions/lib/auth.js のユニットテスト
 * 暗号ユーティリティ・JWT・バリデーション
 */

import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  generateSalt,
  generateId,
  base64urlEncode,
  base64urlDecode,
  createJWT,
  verifyJWT,
  authenticateRequest,
  isValidEmail,
  isValidPassword,
} from '../functions/lib/auth.js';

describe('auth.js ユーティリティ', () => {
  // ─── パスワードハッシュ ───
  describe('hashPassword', () => {
    it('同じパスワード＋ソルトで同じハッシュを返す', async () => {
      const hash1 = await hashPassword('test-password', 'salt123');
      const hash2 = await hashPassword('test-password', 'salt123');
      expect(hash1).toBe(hash2);
    });

    it('異なるソルトで異なるハッシュを返す', async () => {
      const hash1 = await hashPassword('test-password', 'salt-a');
      const hash2 = await hashPassword('test-password', 'salt-b');
      expect(hash1).not.toBe(hash2);
    });

    it('ハッシュは64文字のhex文字列（256bit）', async () => {
      const hash = await hashPassword('password', 'salt');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // ─── ソルト生成 ───
  describe('generateSalt', () => {
    it('32文字のhex文字列を返す（16バイト）', () => {
      const salt = generateSalt();
      expect(salt).toMatch(/^[0-9a-f]{32}$/);
    });

    it('呼び出しごとに異なる値を返す', () => {
      const s1 = generateSalt();
      const s2 = generateSalt();
      expect(s1).not.toBe(s2);
    });
  });

  // ─── UUID生成 ───
  describe('generateId', () => {
    it('UUID v4形式を返す', () => {
      const id = generateId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
  });

  // ─── Base64URL ───
  describe('base64urlEncode / base64urlDecode', () => {
    it('文字列をBase64URLエンコード・デコードできる', () => {
      const original = '{"sub":"user-123","email":"test@example.com"}';
      const encoded = base64urlEncode(original);
      // +, /, = が含まれないこと
      expect(encoded).not.toMatch(/[+/=]/);
      // デコードして元に戻ること
      const decoded = new TextDecoder().decode(base64urlDecode(encoded));
      expect(decoded).toBe(original);
    });
  });

  // ─── JWT ───
  describe('createJWT / verifyJWT', () => {
    const secret = 'test-secret-key';

    it('JWTを生成して検証できる', async () => {
      const payload = { sub: 'user-1', email: 'test@example.com', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
      const token = await createJWT(payload, secret);

      expect(token.split('.')).toHaveLength(3);

      const verified = await verifyJWT(token, secret);
      expect(verified).not.toBeNull();
      expect(verified.sub).toBe('user-1');
      expect(verified.email).toBe('test@example.com');
    });

    it('異なるシークレットで検証失敗する', async () => {
      const payload = { sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 3600 };
      const token = await createJWT(payload, secret);
      const verified = await verifyJWT(token, 'wrong-secret');
      expect(verified).toBeNull();
    });

    it('期限切れのJWTを拒否する', async () => {
      const payload = { sub: 'user-1', exp: Math.floor(Date.now() / 1000) - 100 };
      const token = await createJWT(payload, secret);
      const verified = await verifyJWT(token, secret);
      expect(verified).toBeNull();
    });

    it('不正な形式のトークンを拒否する', async () => {
      expect(await verifyJWT('invalid-token', secret)).toBeNull();
      expect(await verifyJWT('a.b', secret)).toBeNull();
      expect(await verifyJWT('', secret)).toBeNull();
    });
  });

  // ─── authenticateRequest ───
  describe('authenticateRequest', () => {
    const secret = 'test-secret';

    it('有効なBearerトークンからペイロードを返す', async () => {
      const payload = { sub: 'user-1', email: 'a@b.com', exp: Math.floor(Date.now() / 1000) + 3600 };
      const token = await createJWT(payload, secret);

      const request = new Request('https://example.com', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const env = { JWT_SECRET: secret };

      const result = await authenticateRequest(request, env);
      expect(result).not.toBeNull();
      expect(result.sub).toBe('user-1');
    });

    it('Authorizationヘッダーなしでnullを返す', async () => {
      const request = new Request('https://example.com');
      const result = await authenticateRequest(request, { JWT_SECRET: secret });
      expect(result).toBeNull();
    });

    it('JWT_SECRET未設定でnullを返す', async () => {
      const token = await createJWT({ sub: '1', exp: Math.floor(Date.now() / 1000) + 3600 }, secret);
      const request = new Request('https://example.com', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await authenticateRequest(request, {});
      expect(result).toBeNull();
    });
  });

  // ─── バリデーション ───
  describe('isValidEmail', () => {
    it('有効なメールアドレスを受け入れる', () => {
      expect(isValidEmail('test@example.com')).toBe(true);
      expect(isValidEmail('user+tag@domain.co.jp')).toBe(true);
    });

    it('無効なメールアドレスを拒否する', () => {
      expect(isValidEmail('')).toBe(false);
      expect(isValidEmail('not-email')).toBe(false);
      expect(isValidEmail('@domain.com')).toBe(false);
      expect(isValidEmail('user@')).toBe(false);
    });
  });

  describe('isValidPassword', () => {
    it('8文字以上を受け入れる', () => {
      expect(isValidPassword('12345678')).toBe(true);
      expect(isValidPassword('abcdefghij')).toBe(true);
    });

    it('8文字未満を拒否する', () => {
      expect(isValidPassword('1234567')).toBe(false);
      expect(isValidPassword('')).toBe(false);
    });

    it('文字列以外を拒否する', () => {
      expect(isValidPassword(null)).toBe(false);
      expect(isValidPassword(undefined)).toBe(false);
      expect(isValidPassword(12345678)).toBe(false);
    });
  });
});
