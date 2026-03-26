-- ラベルン D1データベーススキーマ
-- 実行: wrangler d1 execute labelun-db --file=./schema.sql

-- ユーザーテーブル
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'lite', 'standard', 'pro')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  cancel_at_period_end INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- メール検索用インデックス
CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);

-- Stripe Customer ID検索用インデックス
CREATE INDEX IF NOT EXISTS idx_users_stripe_customer_id ON users (stripe_customer_id);

-- ラベルテーブル
CREATE TABLE IF NOT EXISTS labels (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  category TEXT,
  ingredients_json TEXT NOT NULL DEFAULT '[]',
  allergens_json TEXT NOT NULL DEFAULT '[]',
  nutrition_json TEXT NOT NULL DEFAULT '{}',
  label_settings_json TEXT NOT NULL DEFAULT '{}',
  translations_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- ユーザーごとのラベル一覧取得用インデックス
CREATE INDEX IF NOT EXISTS idx_labels_user_id ON labels (user_id, updated_at DESC);

-- 利用量テーブル（月間ラベル作成数）
CREATE TABLE IF NOT EXISTS usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  month TEXT NOT NULL,
  label_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  UNIQUE (user_id, month)
);

-- ユーザー×月で利用量を高速検索
CREATE INDEX IF NOT EXISTS idx_usage_user_month ON usage (user_id, month);

-- サブスクリプションテーブル（Stripe連携）
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL CHECK (plan IN ('lite', 'standard', 'pro')),
  status TEXT NOT NULL DEFAULT 'active',
  current_period_end TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- サブスクリプション検索用インデックス
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_id ON subscriptions (stripe_subscription_id);

-- レート制限テーブル（IPベース）
CREATE TABLE IF NOT EXISTS rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);

-- IP×タイムスタンプで高速検索・削除
CREATE INDEX IF NOT EXISTS idx_rate_limits_ip_ts ON rate_limits (ip, timestamp);
