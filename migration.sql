-- マイグレーション: usersテーブルにカラム追加
-- 実行: wrangler d1 execute labelun-db --file=./migration.sql

-- サブスクリプションIDカラム追加
ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT;

-- 解約予約フラグカラム追加
ALTER TABLE users ADD COLUMN cancel_at_period_end INTEGER DEFAULT 0;
