/**
 * functions/lib/usage.js のユニットテスト
 */

import { describe, it, expect } from 'vitest';
import { PLAN_LIMITS, getCurrentMonth } from '../functions/lib/usage.js';

describe('usage.js ユーティリティ', () => {
  // ─── PLAN_LIMITS ───
  describe('PLAN_LIMITS', () => {
    it('freeプランは3', () => {
      expect(PLAN_LIMITS.free).toBe(3);
    });

    it('liteプランは10', () => {
      expect(PLAN_LIMITS.lite).toBe(10);
    });

    it('standardプランは50', () => {
      expect(PLAN_LIMITS.standard).toBe(50);
    });

    it('proプランは9999', () => {
      expect(PLAN_LIMITS.pro).toBe(9999);
    });
  });

  // ─── getCurrentMonth ───
  describe('getCurrentMonth', () => {
    it('YYYY-MM形式を返す', () => {
      const month = getCurrentMonth();
      expect(month).toMatch(/^\d{4}-\d{2}$/);
    });

    it('現在の年月を返す', () => {
      const now = new Date();
      const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      expect(getCurrentMonth()).toBe(expected);
    });
  });
});
