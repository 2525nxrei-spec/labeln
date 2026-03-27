/**
 * functions/api/plans.js のテスト
 */

import { describe, it, expect } from 'vitest';
import { createMockEnv, createMockContext, parseResponse } from './helpers.js';
import { onRequestGet } from '../functions/api/plans.js';

describe('GET /api/plans', () => {
  it('プラン一覧を返す（200）', async () => {
    const env = createMockEnv();
    const request = new Request('https://mylabeln.com/api/plans', {
      method: 'GET',
      headers: { 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
    });
    const response = await onRequestGet(createMockContext(request, env));
    const { status, data } = await parseResponse(response);

    expect(status).toBe(200);
    expect(data.plans).toBeDefined();
    expect(data.plans).toHaveLength(4);

    // 各プランのid確認
    const planIds = data.plans.map((p) => p.id);
    expect(planIds).toContain('free');
    expect(planIds).toContain('lite');
    expect(planIds).toContain('standard');
    expect(planIds).toContain('pro');

    // 支払い方法
    expect(data.payment_methods).toBeDefined();
    expect(data.payment_methods.length).toBeGreaterThan(0);
  });

  it('freeプランの価格が0である', async () => {
    const env = createMockEnv();
    const request = new Request('https://mylabeln.com/api/plans', {
      method: 'GET',
      headers: { 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
    });
    const response = await onRequestGet(createMockContext(request, env));
    const { data } = await parseResponse(response);
    const freePlan = data.plans.find((p) => p.id === 'free');
    expect(freePlan.price).toBe(0);
  });
});
