/**
 * functions/api/usage.js のテスト
 */

import { describe, it, expect } from 'vitest';
import { createMockEnv, createMockContext, createTestJWT, parseResponse } from './helpers.js';
import { onRequestGet } from '../functions/api/usage.js';

describe('GET /api/usage', () => {
  const userId = 'user-usage-test';
  const email = 'usage@example.com';

  it('認証なしで401を返す', async () => {
    const env = createMockEnv();
    const request = new Request('https://mylabeln.com/api/usage', {
      method: 'GET',
      headers: { 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
    });
    const response = await onRequestGet(createMockContext(request, env));
    expect(response.status).toBe(401);
  });

  it('認証済みで利用量情報を返す', async () => {
    const env = createMockEnv();
    env.DB._tables.users.push({ id: userId, email, plan: 'lite' });

    const token = await createTestJWT(userId, email, env.JWT_SECRET);
    const request = new Request('https://mylabeln.com/api/usage', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'CF-Connecting-IP': '127.0.0.1',
        Origin: 'https://mylabeln.com',
      },
    });
    const response = await onRequestGet(createMockContext(request, env));
    const { status, data } = await parseResponse(response);

    expect(status).toBe(200);
    expect(data.month).toMatch(/^\d{4}-\d{2}$/);
    expect(data.plan).toBe('lite');
    expect(data.label_limit).toBe(10);
    expect(data.label_count).toBe(0);
    expect(data.remaining).toBe(10);
  });
});
