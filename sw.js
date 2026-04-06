/**
 * ラベルン - Service Worker
 *
 * キャッシュ戦略:
 *   - 全リクエスト: Network First（オフライン時のみキャッシュから応答）
 *   - 外部リソース: Network Only
 */

const CACHE_VERSION = 'v1.0.3';
const STATIC_CACHE = `labelun-static-${CACHE_VERSION}`;
const DATA_CACHE = `labelun-data-${CACHE_VERSION}`;
const API_CACHE = `labelun-api-${CACHE_VERSION}`;

/** アプリシェル（必ずキャッシュする静的ファイル） */
const APP_SHELL = [
  '/',
  '/app.html',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json',
];

/** データファイル（辞書、法定表示ルール等） */
const DATA_FILES = [
  '/data/dictionary.json',
  '/data/legal-rules.json',
  '/data/allergens.json',
  '/data/nutrition-formats.json',
];

/** オフライン時のフォールバックHTML */
const OFFLINE_HTML = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>オフライン - ラベルン</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
      background: #fef7f0;
      color: #333;
    }
    .container {
      text-align: center;
      padding: 2rem;
    }
    h1 { color: #0f766e; font-size: 1.5rem; }
    p { color: #666; line-height: 1.6; }
    button {
      margin-top: 1rem;
      padding: 0.75rem 2rem;
      background: #0f766e;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      cursor: pointer;
    }
    button:hover { background: #0d6359; }
  </style>
</head>
<body>
  <div class="container">
    <h1>オフラインです</h1>
    <p>インターネット接続を確認して、再試行してください。<br>
    キャッシュ済みのラベルデータは引き続き閲覧できます。</p>
    <button onclick="location.reload()">再試行</button>
  </div>
</body>
</html>`;

// ==========================================
// インストール: アプリシェルとデータをプリキャッシュ
// ==========================================
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // 静的ファイルのキャッシュ
      const staticCache = await caches.open(STATIC_CACHE);
      await staticCache.addAll(APP_SHELL).catch((err) => {
        console.warn('一部の静的ファイルのキャッシュに失敗:', err);
      });

      // データファイルのキャッシュ（存在しないファイルがあってもスキップ）
      const dataCache = await caches.open(DATA_CACHE);
      for (const file of DATA_FILES) {
        try {
          await dataCache.add(file);
        } catch {
          console.warn(`データファイルのキャッシュをスキップ: ${file}`);
        }
      }

      // 新しいSWを即座にアクティブにする
      self.skipWaiting();
    })()
  );
});

// ==========================================
// アクティベーション: 旧バージョンのキャッシュを削除
// ==========================================
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      const validCaches = [STATIC_CACHE, DATA_CACHE, API_CACHE];

      await Promise.all(
        cacheNames
          .filter((name) => name.startsWith('labelun-') && !validCaches.includes(name))
          .map((name) => caches.delete(name))
      );

      // 即座に全クライアントを制御下に置く
      self.clients.claim();
    })()
  );
});

// ==========================================
// フェッチ: リクエストタイプに応じたキャッシュ戦略
// ==========================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 同一オリジンのリクエストのみ処理
  if (url.origin !== self.location.origin) return;

  // POSTリクエストはキャッシュしない
  if (request.method !== 'GET') return;

  // APIリクエスト → Network First
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // データファイル → Network First（オフライン時はキャッシュ）
  if (url.pathname.startsWith('/data/')) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  // HTMLナビゲーション → Network First（リダイレクト問題を回避）
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, STATIC_CACHE));
    return;
  }

  // 静的ファイル（CSS, JS, 画像等） → Network First（デプロイ後の即時反映を保証）
  event.respondWith(networkFirst(request, STATIC_CACHE));
});

// ==========================================
// キャッシュ戦略の実装
// ==========================================

/**
 * Network First: ネットワークを優先し、失敗時にキャッシュにフォールバック。
 * ネットワーク成功時はキャッシュを更新。
 */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const networkResponse = await fetch(request);
    // リダイレクトレスポンスはキャッシュしない
    if (networkResponse.ok && !networkResponse.redirected) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    return offlineFallback(request);
  }
}

/**
 * オフラインフォールバック
 * HTMLリクエストにはオフラインページを返し、それ以外は503を返す
 */
function offlineFallback(request) {
  const acceptHeader = request.headers.get('Accept') || '';

  if (acceptHeader.includes('text/html')) {
    return new Response(OFFLINE_HTML, {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  return new Response(JSON.stringify({ error: 'オフラインです', code: 503 }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
}
