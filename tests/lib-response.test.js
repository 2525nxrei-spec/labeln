/**
 * functions/lib/response.js のユニットテスト
 */

import { describe, it, expect } from 'vitest';
import { errorResponse, jsonResponse, withCORS } from '../functions/lib/response.js';

describe('response.js ユーティリティ', () => {
  // ─── errorResponse ───
  describe('errorResponse', () => {
    it('デフォルトで400を返す', async () => {
      const res = errorResponse('Bad request');
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Bad request');
      expect(body.code).toBe(400);
    });

    it('カスタムステータスコードを返す', async () => {
      const res = errorResponse('Not found', 404);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.code).toBe(404);
    });

    it('Content-Typeがapplication/jsonである', () => {
      const res = errorResponse('error');
      expect(res.headers.get('Content-Type')).toBe('application/json');
    });
  });

  // ─── jsonResponse ───
  describe('jsonResponse', () => {
    it('デフォルトで200を返す', async () => {
      const res = jsonResponse({ ok: true });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
    });

    it('カスタムステータスコード201を返す', () => {
      const res = jsonResponse({ created: true }, 201);
      expect(res.status).toBe(201);
    });
  });

  // ─── withCORS ───
  describe('withCORS', () => {
    it('許可されたオリジン（本番）に対してCORSヘッダーを設定する', () => {
      const base = new Response('ok');
      const res = withCORS(base, 'https://mylabeln.com');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://mylabeln.com');
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
    });

    it('ローカル開発オリジンを許可する', () => {
      const res = withCORS(new Response('ok'), 'http://localhost:8788');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:8788');
    });

    it('Cloudflare PagesプレビューURLを許可する', () => {
      const res = withCORS(new Response('ok'), 'https://abc123.labelun.pages.dev');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://abc123.labelun.pages.dev');
    });

    it('許可されていないオリジンにはデフォルトオリジンを設定する', () => {
      const res = withCORS(new Response('ok'), 'https://evil.com');
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://mylabeln.com');
    });

    it('originがnullの場合デフォルトオリジンを設定する', () => {
      const res = withCORS(new Response('ok'), null);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://mylabeln.com');
    });

    it('セキュリティヘッダーが設定される', () => {
      const res = withCORS(new Response('ok'), 'https://mylabeln.com');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
      expect(res.headers.get('Strict-Transport-Security')).toContain('max-age');
    });
  });
});
