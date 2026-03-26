/**
 * ラベルン - Service Worker
 *
 * キャッシュ戦略:
 *   - 静的ファイル（HTML, CSS, JS, 画像）: Cache First
 *   - データファイル（data/ 配下のJSON）: Cache First
 *   - API リクエスト: Network First（オフライン時はキャッシュ）
 *   - 外部リソース: Network Only
 */

const CACHE_VERSION = 'v1.0.0';
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
          .map((name) => {
            console.log(`旧キャッシュを削除: ${name}`);
            return caches.delete(name);
          })
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

  // データファイル → Cache First（バックグラウンドで更新）
  if (url.pathname.startsWith('/data/')) {
    event.respondWith(cacheFirstWithRefresh(request, DATA_CACHE));
    return;
  }

  // 静的ファイル → Cache First
  event.respondWith(cacheFirst(request, STATIC_CACHE));
});

// ==========================================
// キャッシュ戦略の実装
// ==========================================

/**
 * Cache First: キャッシュにあればキャッシュから返す。
 * なければネットワークから取得してキャッシュに保存。
 * 両方失敗したらオフラインフォールバック。
 */
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    return offlineFallback(request);
  }
}

/**
 * Cache First + バックグラウンドリフレッシュ
 * キャッシュがあれば即座に返しつつ、裏でネットワークからの更新を試みる
 */
async function cacheFirstWithRefresh(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(request);

  // バックグラウンドでキャッシュ更新（結果を待たない）
  const fetchPromise = fetch(request)
    .then((networkResponse) => {
      if (networkResponse.ok) {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(() => null);

  // キャッシュがあればすぐ返す
  if (cachedResponse) {
    return cachedResponse;
  }

  // キャッシュがなければネットワーク応答を待つ
  const networkResponse = await fetchPromise;
  if (networkResponse) {
    return networkResponse;
  }

  return offlineFallback(request);
}

/**
 * Network First: ネットワークを優先し、失敗時にキャッシュにフォールバック。
 * ネットワーク成功時はキャッシュを更新。
 */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
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
