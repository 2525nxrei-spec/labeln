/**
 * functions/api/translate.js のテスト
 * Gemini APIはモック（GEMINI_API_KEY未設定でモック返却される設計）
 */

import { describe, it, expect } from 'vitest';
import { createMockEnv, createMockContext, createTestJWT, parseResponse } from './helpers.js';
import { onRequestPost } from '../functions/api/translate.js';

describe('POST /api/translate', () => {
  it('認証なしで401を返す', async () => {
    const env = createMockEnv();
    const request = new Request('https://mylabeln.com/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
      body: JSON.stringify({ texts: ['テスト'], source_lang: 'ja', target_langs: ['en'] }),
    });
    const response = await onRequestPost(createMockContext(request, env));
    expect(response.status).toBe(401);
  });

  it('GEMINI_API_KEY未設定時にモック翻訳を返す', async () => {
    const env = createMockEnv();
    // 利用量チェック用にユーザーとusageデータを追加
    env.DB._tables.users.push({ id: 'user-1', email: 'a@b.com', plan: 'standard' });

    const token = await createTestJWT('user-1', 'a@b.com', env.JWT_SECRET);
    const request = new Request('https://mylabeln.com/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
      body: JSON.stringify({
        texts: ['原材料名', 'アレルゲン'],
        source_lang: 'ja',
        target_langs: ['en', 'ko'],
      }),
    });
    const response = await onRequestPost(createMockContext(request, env));
    const { status, data } = await parseResponse(response);

    expect(status).toBe(200);
    expect(data.mock).toBe(true);
    expect(data.translations.en).toHaveLength(2);
    expect(data.translations.ko).toHaveLength(2);
    expect(data.translations.en[0]).toContain('[MOCK:en]');
  });

  it('texts配列が空の場合400を返す', async () => {
    const env = createMockEnv();
    const token = await createTestJWT('user-1', 'a@b.com', env.JWT_SECRET);
    const request = new Request('https://mylabeln.com/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
      body: JSON.stringify({ texts: [], source_lang: 'ja', target_langs: ['en'] }),
    });
    const response = await onRequestPost(createMockContext(request, env));
    expect(response.status).toBe(400);
  });

  it('textsが50件を超える場合400を返す', async () => {
    const env = createMockEnv();
    const token = await createTestJWT('user-1', 'a@b.com', env.JWT_SECRET);
    const texts = Array(51).fill('テスト');
    const request = new Request('https://mylabeln.com/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
      body: JSON.stringify({ texts, source_lang: 'ja', target_langs: ['en'] }),
    });
    const response = await onRequestPost(createMockContext(request, env));
    expect(response.status).toBe(400);
  });

  it('対応していない言語で400を返す', async () => {
    const env = createMockEnv();
    const token = await createTestJWT('user-1', 'a@b.com', env.JWT_SECRET);
    const request = new Request('https://mylabeln.com/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
      body: JSON.stringify({ texts: ['test'], source_lang: 'xx', target_langs: ['en'] }),
    });
    const response = await onRequestPost(createMockContext(request, env));
    expect(response.status).toBe(400);
  });

  it('target_langsが空配列で400を返す', async () => {
    const env = createMockEnv();
    const token = await createTestJWT('user-1', 'a@b.com', env.JWT_SECRET);
    const request = new Request('https://mylabeln.com/api/translate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
      body: JSON.stringify({ texts: ['test'], source_lang: 'ja', target_langs: [] }),
    });
    const response = await onRequestPost(createMockContext(request, env));
    expect(response.status).toBe(400);
  });
});
