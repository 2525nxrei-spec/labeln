-- リクエスト・フィードバックテーブル（マイグレーション）
-- 実行: wrangler d1 execute labelun-db --file=./migration.sql

CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL CHECK (category IN ('feature', 'bug', 'other')),
  message TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_requests_created_at ON requests (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requests_category ON requests (category);
