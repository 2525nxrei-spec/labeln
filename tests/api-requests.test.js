/**
 * POST /api/requests のテスト
 * リクエスト・フィードバック送信エンドポイント
 */

import { describe, it, expect } from 'vitest';
import { createMockEnv, createMockContext, parseResponse } from './helpers.js';
import { onRequestPost as requestHandler } from '../functions/api/requests.js';

function createRequest(body) {
  return new Request('https://mylabeln.com/api/requests', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '127.0.0.1',
      Origin: 'https://mylabeln.com',
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/requests', () => {
  it('正常な送信で201を返す（全項目入力）', async () => {
    const env = createMockEnv();
    const request = createRequest({
      name: 'テスト太郎',
      email: 'test@example.com',
      category: 'feature',
      message: '多言語の一括編集機能がほしいです。',
    });
    const response = await requestHandler(createMockContext(request, env));
    const { status, data } = await parseResponse(response);

    expect(status).toBe(201);
    expect(data.success).toBe(true);
    expect(data.id).toBeDefined();
  });

  it('名前・メール省略でも送信できる', async () => {
    const env = createMockEnv();
    const request = createRequest({
      category: 'bug',
      message: 'PDF出力時にフォントが崩れます。',
    });
    const response = await requestHandler(createMockContext(request, env));
    const { status, data } = await parseResponse(response);

    expect(status).toBe(201);
    expect(data.success).toBe(true);
  });

  it('カテゴリ未指定で400を返す', async () => {
    const env = createMockEnv();
    const request = createRequest({
      message: 'テストメッセージ',
    });
    const response = await requestHandler(createMockContext(request, env));
    expect(response.status).toBe(400);
  });

  it('無効なカテゴリで400を返す', async () => {
    const env = createMockEnv();
    const request = createRequest({
      category: 'invalid',
      message: 'テスト',
    });
    const response = await requestHandler(createMockContext(request, env));
    expect(response.status).toBe(400);
  });

  it('内容が空で400を返す', async () => {
    const env = createMockEnv();
    const request = createRequest({
      category: 'feature',
      message: '',
    });
    const response = await requestHandler(createMockContext(request, env));
    expect(response.status).toBe(400);
  });

  it('内容がスペースのみで400を返す', async () => {
    const env = createMockEnv();
    const request = createRequest({
      category: 'feature',
      message: '   ',
    });
    const response = await requestHandler(createMockContext(request, env));
    expect(response.status).toBe(400);
  });

  it('5000文字超で400を返す', async () => {
    const env = createMockEnv();
    const request = createRequest({
      category: 'other',
      message: 'あ'.repeat(5001),
    });
    const response = await requestHandler(createMockContext(request, env));
    expect(response.status).toBe(400);
  });

  it('不正なメールアドレスで400を返す', async () => {
    const env = createMockEnv();
    const request = createRequest({
      email: 'invalid-email',
      category: 'feature',
      message: 'テスト',
    });
    const response = await requestHandler(createMockContext(request, env));
    expect(response.status).toBe(400);
  });

  it('不正なリクエストボディで400を返す', async () => {
    const env = createMockEnv();
    const request = new Request('https://mylabeln.com/api/requests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
      body: 'invalid json',
    });
    const response = await requestHandler(createMockContext(request, env));
    expect(response.status).toBe(400);
  });

  it('カテゴリ「other」で送信できる', async () => {
    const env = createMockEnv();
    const request = createRequest({
      category: 'other',
      message: 'その他のフィードバック',
    });
    const response = await requestHandler(createMockContext(request, env));
    expect(response.status).toBe(201);
  });
});
