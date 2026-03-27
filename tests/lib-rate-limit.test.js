/**
 * functions/lib/rate-limit.js のユニットテスト
 */

import { describe, it, expect } from 'vitest';
import { isRateLimited } from '../functions/lib/rate-limit.js';
import { createMockDB } from './helpers.js';

describe('rate-limit.js', () => {
  describe('isRateLimited', () => {
    it('制限内ならfalseを返す', async () => {
      const env = { DB: createMockDB() };
      const result = await isRateLimited('127.0.0.1', env, 60, 60);
      expect(result).toBe(false);
    });

    it('DBエラー時はfalseを返す（サービスを止めない）', async () => {
      const env = {
        DB: {
          prepare() {
            return {
              bind() {
                return {
                  async run() { throw new Error('DB error'); },
                  async first() { throw new Error('DB error'); },
                };
              },
            };
          },
        },
      };
      const result = await isRateLimited('127.0.0.1', env, 60, 60);
      expect(result).toBe(false);
    });
  });
});
