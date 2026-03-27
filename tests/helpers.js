/**
 * テスト用ヘルパー・モック
 * Cloudflare Workers/Pages環境をシミュレートする
 */

// ──────────────────────────────────────────
// D1 モック（インメモリ SQLite 風）
// ──────────────────────────────────────────

/**
 * D1データベースモック
 * prepare().bind().first() / run() / all() をシミュレート
 */
export function createMockDB(initialData = {}) {
  // テーブルごとにデータを保持
  const tables = {
    users: [],
    labels: [],
    usage: [],
    subscriptions: [],
    rate_limits: [],
    requests: [],
    ...initialData,
  };

  /** SQLとバインドパラメータからテーブル名・操作を簡易解析 */
  function parseSql(sql) {
    const normalized = sql.trim().toUpperCase();
    if (normalized.startsWith('SELECT')) return 'SELECT';
    if (normalized.startsWith('INSERT')) return 'INSERT';
    if (normalized.startsWith('UPDATE')) return 'UPDATE';
    if (normalized.startsWith('DELETE')) return 'DELETE';
    return 'UNKNOWN';
  }

  function getTableName(sql) {
    const match = sql.match(/(?:FROM|INTO|UPDATE)\s+(\w+)/i);
    return match ? match[1] : null;
  }

  return {
    _tables: tables,
    prepare(sql) {
      let boundParams = [];
      return {
        bind(...params) {
          boundParams = params;
          return this;
        },
        async first() {
          const op = parseSql(sql);
          const table = getTableName(sql);

          if (op === 'SELECT' && table && tables[table]) {
            // WHERE句の簡易マッチング
            const rows = tables[table];
            if (boundParams.length === 0) return rows[0] || null;

            // COUNT(*)
            if (sql.toUpperCase().includes('COUNT(*)')) {
              return { count: rows.length, total: rows.length };
            }

            // 簡易WHERE: 最初のバインドパラメータでidまたはemailを検索
            const result = rows.find((r) => {
              return Object.values(r).some((v) => boundParams.includes(v));
            });
            return result || null;
          }
          return null;
        },
        async run() {
          const op = parseSql(sql);
          const table = getTableName(sql);

          if (op === 'INSERT' && table && tables[table]) {
            // 簡易INSERT: カラム名を抽出してオブジェクト作成
            const colMatch = sql.match(/\(([^)]+)\)\s*VALUES/i);
            if (colMatch) {
              const cols = colMatch[1].split(',').map((c) => c.trim());
              const row = {};
              cols.forEach((col, i) => {
                row[col] = boundParams[i] !== undefined ? boundParams[i] : null;
              });
              tables[table].push(row);
            }
            return { meta: { changes: 1 } };
          }

          if (op === 'UPDATE') {
            return { meta: { changes: 1 } };
          }

          if (op === 'DELETE' && table && tables[table]) {
            const before = tables[table].length;
            // 簡易DELETE: バインドパラメータに一致するレコードを削除
            tables[table] = tables[table].filter((r) => {
              return !Object.values(r).some((v) => boundParams.includes(v));
            });
            const changes = before - tables[table].length;
            return { meta: { changes: changes || 1 } };
          }

          return { meta: { changes: 0 } };
        },
        async all() {
          const table = getTableName(sql);
          if (table && tables[table]) {
            return { results: tables[table] };
          }
          return { results: [] };
        },
      };
    },
  };
}

// ──────────────────────────────────────────
// R2 モック
// ──────────────────────────────────────────

export function createMockR2() {
  const storage = new Map();
  return {
    async put(key, value, options = {}) {
      storage.set(key, { value, ...options });
      return { key };
    },
    async get(key) {
      return storage.get(key) || null;
    },
    async delete(key) {
      storage.delete(key);
    },
    async list({ prefix } = {}) {
      const objects = [];
      for (const [key] of storage) {
        if (!prefix || key.startsWith(prefix)) {
          objects.push({ key });
        }
      }
      return { objects };
    },
  };
}

// ──────────────────────────────────────────
// env モック
// ──────────────────────────────────────────

export function createMockEnv(overrides = {}) {
  return {
    DB: createMockDB(),
    STORAGE: createMockR2(),
    JWT_SECRET: 'test-jwt-secret-key-for-ci',
    GEMINI_API_KEY: '', // テストでは空（モック翻訳）
    STRIPE_SECRET_KEY: '', // テストでは空（モック決済）
    STRIPE_WEBHOOK_SECRET: '',
    STRIPE_PRICE_LITE: 'price_test_lite',
    STRIPE_PRICE_STANDARD: 'price_test_standard',
    STRIPE_PRICE_PRO: 'price_test_pro',
    STRIPE_PUBLISHABLE_KEY: 'pk_test_xxx',
    ENVIRONMENT: 'test',
    ...overrides,
  };
}

// ──────────────────────────────────────────
// Request モック
// ──────────────────────────────────────────

export function createMockRequest(method, url, options = {}) {
  const { body, headers = {}, token } = options;

  const requestHeaders = new Headers(headers);
  requestHeaders.set('CF-Connecting-IP', '127.0.0.1');

  if (token) {
    requestHeaders.set('Authorization', `Bearer ${token}`);
  }

  if (body && !requestHeaders.has('Content-Type')) {
    requestHeaders.set('Content-Type', 'application/json');
  }

  const init = {
    method,
    headers: requestHeaders,
  };

  if (body && method !== 'GET') {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  return new Request(url, init);
}

// ──────────────────────────────────────────
// Context モック（Pages Functions用）
// ──────────────────────────────────────────

export function createMockContext(request, env, params = {}) {
  return {
    request,
    env,
    params,
    waitUntil: () => {},
    passThroughOnException: () => {},
  };
}

// ──────────────────────────────────────────
// JWT テスト用ヘルパー
// ──────────────────────────────────────────

/**
 * テスト用JWTを生成する（functions/lib/auth.jsのcreateJWTを利用）
 */
export async function createTestJWT(userId, email, secret) {
  // Base64URL エンコード
  function base64urlEncode(data) {
    if (typeof data === 'string') {
      data = new TextEncoder().encode(data);
    }
    const base64 = btoa(String.fromCharCode(...new Uint8Array(data)));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: userId,
    email,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
  };

  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(signingInput));
  const encodedSignature = base64urlEncode(signature);

  return `${signingInput}.${encodedSignature}`;
}

// ──────────────────────────────────────────
// レスポンスパーサー
// ──────────────────────────────────────────

export async function parseResponse(response) {
  const text = await response.text();
  try {
    return { status: response.status, data: JSON.parse(text), headers: response.headers };
  } catch {
    return { status: response.status, data: text, headers: response.headers };
  }
}
