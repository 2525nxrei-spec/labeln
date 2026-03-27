/**
 * functions/lib/middleware.js のユニットテスト
 */

import { describe, it, expect } from 'vitest';
import { withMiddleware } from '../functions/lib/middleware.js';
import { createMockDB } from './helpers.js';

describe('middleware.js', () => {
  const mockEnv = { DB: createMockDB() };

  describe('withMiddleware', () => {
    it('OPTIONSリクエストに204とCORSヘッダーを返す', async () => {
      const handler = async () => new Response('ok');
      const wrapped = withMiddleware(handler);

      const request = new Request('https://mylabeln.com/api/test', {
        method: 'OPTIONS',
        headers: { Origin: 'https://mylabeln.com' },
      });

      const response = await wrapped({ request, env: mockEnv });
      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://mylabeln.com');
    });

    it('ハンドラーのレスポンスにCORSヘッダーを付与する', async () => {
      const handler = async () => new Response(JSON.stringify({ ok: true }), { status: 200 });
      const wrapped = withMiddleware(handler);

      const request = new Request('https://mylabeln.com/api/test', {
        method: 'GET',
        headers: { Origin: 'https://mylabeln.com', 'CF-Connecting-IP': '127.0.0.1' },
      });

      const response = await wrapped({ request, env: mockEnv });
      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://mylabeln.com');
    });

    it('ハンドラーがエラーを投げた場合500を返す', async () => {
      const handler = async () => { throw new Error('Unexpected'); };
      const wrapped = withMiddleware(handler);

      const request = new Request('https://mylabeln.com/api/test', {
        method: 'GET',
        headers: { Origin: 'https://mylabeln.com', 'CF-Connecting-IP': '127.0.0.1' },
      });

      const response = await wrapped({ request, env: mockEnv });
      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body.error).toContain('サーバー内部エラー');
    });

    it('skipRateLimitオプションでレート制限をスキップする', async () => {
      const handler = async () => new Response('ok');
      const wrapped = withMiddleware(handler, { skipRateLimit: true });

      const request = new Request('https://mylabeln.com/api/test', {
        method: 'GET',
        headers: { Origin: 'https://mylabeln.com' },
      });

      const response = await wrapped({ request, env: mockEnv });
      expect(response.status).toBe(200);
    });
  });
});
