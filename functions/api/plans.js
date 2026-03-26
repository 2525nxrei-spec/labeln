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
    max_languages: 1,
    features: ['3ラベル/月', '1言語まで', 'PDF出力（150dpi）'],
  },
  {
    id: 'lite',
    name: 'ライト',
    price: 300,
    labels_per_month: 10,
    max_languages: 5,
    features: ['10ラベル/月', '5言語まで', 'PDF出力（150dpi）', '法定表示自動生成'],
  },
  {
    id: 'standard',
    name: 'スタンダード',
    price: 500,
    labels_per_month: 50,
    max_languages: 18,
    features: ['50ラベル/月', '18言語対応', 'PDF出力（300dpi）', '法定表示自動生成', 'CSVインポート'],
  },
  {
    id: 'pro',
    name: 'プロ',
    price: 2000,
    labels_per_month: 9999,
    max_languages: 18,
    features: ['ラベル数無制限', '18言語対応', 'PDF出力（300dpi）', 'API連携', '優先サポート'],
    coming_soon: true,
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
