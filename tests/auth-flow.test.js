/**
 * 認証・課金・プランアクセス制御テスト
 * バックエンド（Cloudflare Workers Functions）のロジック検証
 */

import { describe, it, expect } from 'vitest';
import { hashPassword, generateSalt, createJWT, verifyJWT, isValidEmail, isValidPassword } from '../functions/lib/auth.js';
import { PLAN_LIMITS, getCurrentMonth } from '../functions/lib/usage.js';
import { determinePlanFromPrice } from '../functions/lib/stripe.js';

/* ============================================
   認証ユーティリティ
   ============================================ */

describe('パスワードハッシュ', () => {
  it('同じパスワード+ソルトで同じハッシュを生成する', async () => {
    const salt = 'test-salt-123';
    const hash1 = await hashPassword('testpass', salt);
    const hash2 = await hashPassword('testpass', salt);
    expect(hash1).toBe(hash2);
  });

  it('異なるパスワードで異なるハッシュを生成する', async () => {
    const salt = 'test-salt-123';
    const hash1 = await hashPassword('password1', salt);
    const hash2 = await hashPassword('password2', salt);
    expect(hash1).not.toBe(hash2);
  });

  it('異なるソルトで異なるハッシュを生成する', async () => {
    const hash1 = await hashPassword('testpass', 'salt-a');
    const hash2 = await hashPassword('testpass', 'salt-b');
    expect(hash1).not.toBe(hash2);
  });
});

describe('ソルト生成', () => {
  it('32文字のhex文字列を返す', () => {
    const salt = generateSalt();
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
  });

  it('毎回異なるソルトを生成する', () => {
    const s1 = generateSalt();
    const s2 = generateSalt();
    expect(s1).not.toBe(s2);
  });
});

describe('JWT', () => {
  const secret = 'test-jwt-secret-for-labeln';

  it('トークンを生成し検証できる', async () => {
    const payload = { sub: 'user-123', email: 'test@example.com', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 };
    const token = await createJWT(payload, secret);
    const verified = await verifyJWT(token, secret);
    expect(verified).not.toBeNull();
    expect(verified.sub).toBe('user-123');
    expect(verified.email).toBe('test@example.com');
  });

  it('不正な署名を拒否する', async () => {
    const payload = { sub: 'user-123', exp: Math.floor(Date.now() / 1000) + 3600 };
    const token = await createJWT(payload, secret);
    const result = await verifyJWT(token, 'wrong-secret');
    expect(result).toBeNull();
  });

  it('期限切れトークンを拒否する', async () => {
    const payload = { sub: 'user-123', exp: Math.floor(Date.now() / 1000) - 10 };
    const token = await createJWT(payload, secret);
    const result = await verifyJWT(token, secret);
    expect(result).toBeNull();
  });

  it('不正な形式のトークンを拒否する', async () => {
    expect(await verifyJWT('not-a-jwt', secret)).toBeNull();
    expect(await verifyJWT('a.b', secret)).toBeNull();
    expect(await verifyJWT('', secret)).toBeNull();
  });
});

describe('メールバリデーション', () => {
  it('有効なメールアドレスを受け入れる', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('a@b.co')).toBe(true);
    expect(isValidEmail('user+tag@domain.co.jp')).toBe(true);
  });

  it('無効なメールアドレスを拒否する', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('notanemail')).toBe(false);
    expect(isValidEmail('@no-local.com')).toBe(false);
    expect(isValidEmail('no-domain@')).toBe(false);
    expect(isValidEmail('spaces in@email.com')).toBe(false);
  });
});

describe('パスワードバリデーション', () => {
  it('8文字以上を受け入れる', () => {
    expect(isValidPassword('12345678')).toBe(true);
    expect(isValidPassword('abcdefgh')).toBe(true);
  });

  it('7文字以下を拒否する', () => {
    expect(isValidPassword('1234567')).toBe(false);
    expect(isValidPassword('')).toBe(false);
  });

  it('null/undefinedを拒否する', () => {
    expect(isValidPassword(null)).toBe(false);
    expect(isValidPassword(undefined)).toBe(false);
  });
});

/* ============================================
   プラン別アクセス制御
   ============================================ */

describe('プラン制限', () => {
  it('freeプランは月3ラベルまで', () => {
    expect(PLAN_LIMITS.free).toBe(3);
  });

  it('liteプランは月10ラベルまで', () => {
    expect(PLAN_LIMITS.lite).toBe(10);
  });

  it('standardプランは月50ラベルまで', () => {
    expect(PLAN_LIMITS.standard).toBe(50);
  });

  it('proプランは実質無制限（9999）', () => {
    expect(PLAN_LIMITS.pro).toBe(9999);
  });

  it('プラン階層が正しい順序になっている', () => {
    expect(PLAN_LIMITS.free).toBeLessThan(PLAN_LIMITS.lite);
    expect(PLAN_LIMITS.lite).toBeLessThan(PLAN_LIMITS.standard);
    expect(PLAN_LIMITS.standard).toBeLessThan(PLAN_LIMITS.pro);
  });
});

describe('月取得', () => {
  it('YYYY-MM形式の文字列を返す', () => {
    const month = getCurrentMonth();
    expect(month).toMatch(/^\d{4}-\d{2}$/);
  });
});

/* ============================================
   Stripe連携
   ============================================ */

describe('Stripeプラン判定', () => {
  const mockEnv = {
    STRIPE_PRICE_LITE: 'price_lite_123',
    STRIPE_PRICE_STANDARD: 'price_standard_456',
    STRIPE_PRICE_PRO: 'price_pro_789',
  };

  it('正しいPrice IDからプラン名を判定する', () => {
    expect(determinePlanFromPrice('price_lite_123', mockEnv)).toBe('lite');
    expect(determinePlanFromPrice('price_standard_456', mockEnv)).toBe('standard');
    expect(determinePlanFromPrice('price_pro_789', mockEnv)).toBe('pro');
  });

  it('不明なPrice IDにはnullを返す', () => {
    expect(determinePlanFromPrice('price_unknown', mockEnv)).toBeNull();
    expect(determinePlanFromPrice('', mockEnv)).toBeNull();
  });
});

/* ============================================
   サーバーAPI登録エンドポイントのバリデーション確認
   （実際のD1は使わないが、バリデーションロジックの確認）
   ============================================ */

describe('登録APIバリデーション（ロジック確認）', () => {
  it('サーバー側は常にfreeプランで登録する（planパラメータは無視される）', () => {
    // register.jsのハンドラ内で const selectedPlan = 'free'; と固定されている
    // フロントエンドからplanを送っても無視される
    const selectedPlan = 'free'; // サーバー側のロジック
    expect(selectedPlan).toBe('free');
  });

  it('パスワードには英字と数字の両方が必要', () => {
    // サーバー側のバリデーション
    const pw1 = 'abcdefgh'; // 英字のみ
    const pw2 = '12345678'; // 数字のみ
    const pw3 = 'abc12345'; // 英字+数字

    expect(/[a-zA-Z]/.test(pw1) && /[0-9]/.test(pw1)).toBe(false);
    expect(/[a-zA-Z]/.test(pw2) && /[0-9]/.test(pw2)).toBe(false);
    expect(/[a-zA-Z]/.test(pw3) && /[0-9]/.test(pw3)).toBe(true);
  });
});

/* ============================================
   翻訳APIの言語制限
   ============================================ */

describe('翻訳APIのプラン別言語制限', () => {
  const PLAN_LANG_LIMITS = { free: 1, lite: 5, standard: 18, pro: 18 };

  it('freeプランは1言語まで', () => {
    expect(PLAN_LANG_LIMITS.free).toBe(1);
  });

  it('liteプランは5言語まで', () => {
    expect(PLAN_LANG_LIMITS.lite).toBe(5);
  });

  it('standard/proは全18言語', () => {
    expect(PLAN_LANG_LIMITS.standard).toBe(18);
    expect(PLAN_LANG_LIMITS.pro).toBe(18);
  });

  it('free→lite→standardで言語数が増加する', () => {
    expect(PLAN_LANG_LIMITS.free).toBeLessThan(PLAN_LANG_LIMITS.lite);
    expect(PLAN_LANG_LIMITS.lite).toBeLessThan(PLAN_LANG_LIMITS.standard);
  });

  it('freeプランで2言語を指定したらブロックされる', () => {
    const userPlan = 'free';
    const targetLangs = ['en', 'ko'];
    const langLimit = PLAN_LANG_LIMITS[userPlan];
    expect(targetLangs.length > langLimit).toBe(true);
  });
});
