/**
 * 利用量管理ユーティリティ
 */

import { generateId } from './auth.js';

/** プラン別の月間ラベル上限 */
export const PLAN_LIMITS = {
  free: 3,
  lite: 10,
  standard: 50,
  pro: 9999,
};

/** 現在月のYYYY-MM文字列を取得 */
export function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** 利用量チェック（上限内ならtrue） */
export async function checkUsageLimit(userId, env) {
  const month = getCurrentMonth();

  const user = await env.DB.prepare('SELECT plan FROM users WHERE id = ?').bind(userId).first();
  const plan = user?.plan || 'free';
  const limit = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

  const usage = await env.DB.prepare(
    'SELECT label_count FROM usage WHERE user_id = ? AND month = ?'
  )
    .bind(userId, month)
    .first();

  const currentCount = usage?.label_count || 0;
  return currentCount < limit;
}

/** 利用量カウントをインクリメント */
export async function incrementUsage(userId, env) {
  const month = getCurrentMonth();
  const now = new Date().toISOString();

  const existing = await env.DB.prepare(
    'SELECT id, label_count FROM usage WHERE user_id = ? AND month = ?'
  )
    .bind(userId, month)
    .first();

  if (existing) {
    await env.DB.prepare('UPDATE usage SET label_count = label_count + 1 WHERE id = ?')
      .bind(existing.id)
      .run();
  } else {
    await env.DB.prepare(
      'INSERT INTO usage (id, user_id, month, label_count, created_at) VALUES (?, ?, ?, 1, ?)'
    )
      .bind(generateId(), userId, month, now)
      .run();
  }
}
