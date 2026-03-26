/**
 * IPベースのレート制限
 */

/**
 * レート制限チェック
 * D1にリクエスト記録を保存し、制限を超えていたらtrueを返す
 */
export async function isRateLimited(ip, env, limit = 60, windowSec = 60) {
  try {
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - windowSec;

    // 古いレコードを削除
    await env.DB.prepare('DELETE FROM rate_limits WHERE timestamp < ?').bind(windowStart).run();

    // 現在のウィンドウ内のリクエスト数を取得
    const result = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM rate_limits WHERE ip = ? AND timestamp >= ?'
    )
      .bind(ip, windowStart)
      .first();

    if (result && result.count >= limit) {
      return true;
    }

    // リクエストを記録
    await env.DB.prepare('INSERT INTO rate_limits (ip, timestamp) VALUES (?, ?)').bind(ip, now).run();

    return false;
  } catch {
    // レート制限テーブルが存在しない場合等はスルー（サービス停止しない）
    return false;
  }
}
