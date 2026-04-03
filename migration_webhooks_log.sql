-- webhooks_log テーブル追加マイグレーション
-- 実行: wrangler d1 execute labelun-db --file=./migration_webhooks_log.sql

-- Webhook冪等性ログテーブル（Stripe Webhook重複処理防止）
CREATE TABLE IF NOT EXISTS webhooks_log (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  stripe_event_id TEXT NOT NULL UNIQUE,
  payload TEXT,
  processed_at TEXT NOT NULL
);

-- Stripe Event ID検索用インデックス
CREATE INDEX IF NOT EXISTS idx_webhooks_log_stripe_event_id ON webhooks_log (stripe_event_id);
