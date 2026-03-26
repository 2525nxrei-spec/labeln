/**
 * GET /api/plans - プラン情報取得
 */

import { withMiddleware } from '../lib/middleware.js';
import { jsonResponse } from '../lib/response.js';

/** プラン情報 */
const PLANS = [
  {
    id: 'free',
    name: 'フリー',
    price: 0,
    labels_per_month: 3,
    features: ['3ラベル/月', '基本18言語対応', 'PDF出力'],
  },
  {
    id: 'lite',
    name: 'ライト',
    price: 980,
    labels_per_month: 30,
    features: ['30ラベル/月', '基本18言語対応', 'PDF出力', '優先翻訳'],
  },
  {
    id: 'standard',
    name: 'スタンダード',
    price: 2980,
    labels_per_month: 100,
    features: ['100ラベル/月', '基本18言語対応', 'PDF出力', '優先翻訳', 'ラベルテンプレート'],
  },
  {
    id: 'pro',
    name: 'プロ',
    price: 7980,
    labels_per_month: 500,
    features: ['500ラベル/月', '全18言語対応', 'PDF出力', '最優先翻訳', 'カスタムテンプレート', 'API連携'],
  },
];

async function handler() {
  return jsonResponse({
    plans: PLANS,
    payment_methods: [
      { type: 'card', label: 'クレジットカード / Apple Pay / Google Pay' },
      { type: 'paypay', label: 'PayPay' },
    ],
  });
}

export const onRequestGet = withMiddleware(handler);
export const onRequestOptions = withMiddleware(handler);
