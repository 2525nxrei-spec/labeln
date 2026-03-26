/**
 * ラベルン - Cloudflare Workers APIハンドラー
 * 製品ラベル多言語化サブスクリプションサービス
 *
 * エンドポイント一覧:
 *   POST /api/auth/register, /api/auth/login, GET /api/auth/me
 *   POST /api/translate
 *   POST /api/labels, GET /api/labels, GET /api/labels/:id, DELETE /api/labels/:id
 *   POST /api/labels/:id/pdf
 *   GET  /api/usage
 *   POST /api/stripe/checkout, /api/stripe/webhook, /api/stripe/portal
 *   GET  /api/plans
 */

// ==========================================
// ユーティリティ: レスポンス生成
// ==========================================

/** 統一エラーレスポンス */
function errorResponse(message, code = 400) {
  return new Response(JSON.stringify({ error: message, code }), {
    status: code,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 成功レスポンス */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** CORSヘッダーを付与 */
function withCORS(response, origin) {
  const allowedOrigin = 'https://mylabeln.com';
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', allowedOrigin);
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  headers.set('Access-Control-Max-Age', '86400');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// ==========================================
// ユーティリティ: 暗号・認証
// ==========================================

/** PBKDF2によるパスワードハッシュ生成 */
async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: encoder.encode(salt),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  // ArrayBufferをhex文字列に変換
  return Array.from(new Uint8Array(derivedBits))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** ランダムなソルト生成 */
function generateSalt() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** UUID生成 */
function generateId() {
  return crypto.randomUUID();
}

/** Base64URL エンコード */
function base64urlEncode(data) {
  if (typeof data === 'string') {
    data = new TextEncoder().encode(data);
  }
  const base64 = btoa(String.fromCharCode(...new Uint8Array(data)));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Base64URL デコード */
function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** HMAC-SHA256署名でJWTを生成 */
async function createJWT(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
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

/** JWTを検証しペイロードを返す（無効ならnull） */
async function verifyJWT(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const signatureBytes = base64urlDecode(encodedSignature);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      encoder.encode(signingInput)
    );

    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(encodedPayload)));

    // 有効期限チェック
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/** AuthorizationヘッダーからユーザーIDを取得 */
async function authenticateRequest(request, env) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice(7);
  const secret = env.JWT_SECRET || 'labelun-dev-secret-do-not-use-in-production';
  const payload = await verifyJWT(token, secret);
  return payload;
}

// ==========================================
// ユーティリティ: バリデーション
// ==========================================

/** メールアドレスの簡易バリデーション */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** パスワードの最低要件チェック（8文字以上） */
function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 8;
}

// ==========================================
// レート制限
// ==========================================

/**
 * IPベースのレート制限チェック
 * D1にリクエスト記録を保存し、制限を超えていたらtrueを返す
 */
async function isRateLimited(ip, env, limit = 60, windowSec = 60) {
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

// ==========================================
// ルーター
// ==========================================

/**
 * シンプルなパターンマッチルーター
 * :param 形式の動的セグメントに対応
 */
function matchRoute(method, pathname, routes) {
  for (const route of routes) {
    if (route.method !== method) continue;

    const routeParts = route.path.split('/').filter(Boolean);
    const pathParts = pathname.split('/').filter(Boolean);

    if (routeParts.length !== pathParts.length) continue;

    const params = {};
    let matched = true;

    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(':')) {
        // 動的パラメータ
        params[routeParts[i].slice(1)] = pathParts[i];
      } else if (routeParts[i] !== pathParts[i]) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return { handler: route.handler, params };
    }
  }
  return null;
}

// ==========================================
// ハンドラー: 認証
// ==========================================

/** ユーザー登録 */
async function handleRegister(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return errorResponse('リクエストボディが不正です', 400);

  const { email, password } = body;

  if (!email || !isValidEmail(email)) {
    return errorResponse('有効なメールアドレスを入力してください', 400);
  }
  if (!password || !isValidPassword(password)) {
    return errorResponse('パスワードは8文字以上で入力してください', 400);
  }

  // 既存ユーザーチェック
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) {
    return errorResponse('このメールアドレスは既に登録されています', 409);
  }

  // パスワードハッシュ化
  const salt = generateSalt();
  const passwordHash = await hashPassword(password, salt);
  const userId = generateId();
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, salt, plan, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'free', ?, ?)`
  )
    .bind(userId, email, passwordHash, salt, now, now)
    .run();

  // JWT発行
  const secret = env.JWT_SECRET || 'labelun-dev-secret-do-not-use-in-production';
  const token = await createJWT(
    {
      sub: userId,
      email,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7日間有効
    },
    secret
  );

  return jsonResponse({ token, user: { id: userId, email, plan: 'free' } }, 201);
}

/** ログイン */
async function handleLogin(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return errorResponse('リクエストボディが不正です', 400);

  const { email, password } = body;
  if (!email || !password) {
    return errorResponse('メールアドレスとパスワードを入力してください', 400);
  }

  // ユーザー検索
  const user = await env.DB.prepare('SELECT id, email, password_hash, salt, plan FROM users WHERE email = ?')
    .bind(email)
    .first();

  if (!user) {
    return errorResponse('メールアドレスまたはパスワードが正しくありません', 401);
  }

  // パスワード照合
  const inputHash = await hashPassword(password, user.salt);
  if (inputHash !== user.password_hash) {
    return errorResponse('メールアドレスまたはパスワードが正しくありません', 401);
  }

  // JWT発行
  const secret = env.JWT_SECRET || 'labelun-dev-secret-do-not-use-in-production';
  const token = await createJWT(
    {
      sub: user.id,
      email: user.email,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    },
    secret
  );

  return jsonResponse({
    token,
    user: { id: user.id, email: user.email, plan: user.plan },
  });
}

/** ユーザー情報取得 */
async function handleGetMe(request, env) {
  const payload = await authenticateRequest(request, env);
  if (!payload) return errorResponse('認証が必要です', 401);

  const user = await env.DB.prepare(
    'SELECT id, email, plan, stripe_customer_id, created_at FROM users WHERE id = ?'
  )
    .bind(payload.sub)
    .first();

  if (!user) return errorResponse('ユーザーが見つかりません', 404);

  return jsonResponse({
    id: user.id,
    email: user.email,
    plan: user.plan,
    stripe_customer_id: user.stripe_customer_id,
    created_at: user.created_at,
  });
}

// ==========================================
// ハンドラー: 翻訳
// ==========================================

/** 対応言語一覧（18言語） */
const SUPPORTED_LANGUAGES = [
  'ja', 'en', 'zh-CN', 'zh-TW', 'ko', 'fr', 'de', 'es', 'pt', 'it',
  'ru', 'ar', 'th', 'vi', 'id', 'ms', 'hi', 'nl',
];

/** 言語コードから言語名へのマッピング */
const LANGUAGE_NAMES = {
  ja: '日本語', en: 'English', 'zh-CN': '简体中文', 'zh-TW': '繁體中文',
  ko: '한국어', fr: 'Français', de: 'Deutsch', es: 'Español',
  pt: 'Português', it: 'Italiano', ru: 'Русский', ar: 'العربية',
  th: 'ภาษาไทย', vi: 'Tiếng Việt', id: 'Bahasa Indonesia',
  ms: 'Bahasa Melayu', hi: 'हिन्दी', nl: 'Nederlands',
};

/**
 * Gemini Flash APIを呼び出して翻訳を実行
 * API未設定時はモックレスポンスを返却
 */
async function handleTranslate(request, env) {
  const payload = await authenticateRequest(request, env);
  if (!payload) return errorResponse('認証が必要です', 401);

  const body = await request.json().catch(() => null);
  if (!body) return errorResponse('リクエストボディが不正です', 400);

  const { texts, source_lang, target_langs, context } = body;

  // バリデーション
  if (!texts || !Array.isArray(texts) || texts.length === 0) {
    return errorResponse('翻訳対象テキスト（texts配列）が必要です', 400);
  }
  if (texts.length > 50) {
    return errorResponse('一度に翻訳できるテキストは50件までです', 400);
  }
  if (!source_lang || !SUPPORTED_LANGUAGES.includes(source_lang)) {
    return errorResponse(`対応していないソース言語です: ${source_lang}`, 400);
  }
  if (!target_langs || !Array.isArray(target_langs) || target_langs.length === 0) {
    return errorResponse('翻訳先言語（target_langs配列）が必要です', 400);
  }
  for (const lang of target_langs) {
    if (!SUPPORTED_LANGUAGES.includes(lang)) {
      return errorResponse(`対応していない翻訳先言語です: ${lang}`, 400);
    }
  }

  // 利用量チェック
  const usageOk = await checkUsageLimit(payload.sub, env);
  if (!usageOk) {
    return errorResponse('今月の翻訳上限に達しました。プランをアップグレードしてください。', 429);
  }

  // Gemini API未設定時はモック返却
  if (!env.GEMINI_API_KEY) {
    const mockTranslations = {};
    for (const lang of target_langs) {
      mockTranslations[lang] = texts.map(
        (text) => `[MOCK:${lang}] ${text}`
      );
    }
    return jsonResponse({ translations: mockTranslations, mock: true });
  }

  // Gemini Flash API呼び出し
  try {
    const translations = {};

    for (const lang of target_langs) {
      const prompt = buildTranslationPrompt(texts, source_lang, lang, context);

      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.1, // 翻訳は正確性重視で低温度
              maxOutputTokens: 4096,
            },
          }),
        }
      );

      if (!geminiResponse.ok) {
        const errText = await geminiResponse.text();
        console.error(`Gemini API error for ${lang}:`, errText);
        return errorResponse(`翻訳API呼び出しに失敗しました（${lang}）`, 502);
      }

      const geminiData = await geminiResponse.json();
      const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // JSONレスポンスをパース
      translations[lang] = parseTranslationResponse(rawText, texts.length);
    }

    return jsonResponse({ translations, mock: false });
  } catch (err) {
    console.error('Translation error:', err);
    return errorResponse('翻訳処理中にエラーが発生しました', 500);
  }
}

/** 翻訳プロンプトを構築 */
function buildTranslationPrompt(texts, sourceLang, targetLang, context) {
  const sourceName = LANGUAGE_NAMES[sourceLang] || sourceLang;
  const targetName = LANGUAGE_NAMES[targetLang] || targetLang;
  const contextNote = context
    ? `\n製品カテゴリ: ${context.category || '一般'}\n追加コンテキスト: ${context.note || 'なし'}`
    : '';

  return `あなたは製品ラベルの専門翻訳者です。食品・化粧品等の製品ラベルに記載される情報を正確に翻訳してください。
${contextNote}

以下の${sourceName}テキストを${targetName}に翻訳してください。
各行を1つのテキストとして、JSON配列で結果を返してください。
法定表示用語がある場合は、対象国の公式な表記に従ってください。

翻訳対象:
${texts.map((t, i) => `${i + 1}. ${t}`).join('\n')}

レスポンス形式（JSON配列のみ、他のテキストは不要）:
["翻訳1", "翻訳2", ...]`;
}

/** Geminiの翻訳レスポンスをパースしてstring配列に変換 */
function parseTranslationResponse(rawText, expectedCount) {
  try {
    // JSON部分を抽出（コードブロック内にある場合も対応）
    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed) && parsed.length === expectedCount) {
        return parsed;
      }
    }
  } catch {
    // パース失敗時はフォールバック
  }
  // フォールバック: 行分割
  const lines = rawText.split('\n').filter((l) => l.trim());
  return lines.slice(0, expectedCount);
}

// ==========================================
// ハンドラー: ラベル管理
// ==========================================

/** ラベル保存（新規作成） */
async function handleCreateLabel(request, env) {
  const payload = await authenticateRequest(request, env);
  if (!payload) return errorResponse('認証が必要です', 401);

  const body = await request.json().catch(() => null);
  if (!body) return errorResponse('リクエストボディが不正です', 400);

  const { product_name, category, ingredients, allergens, nutrition, label_settings, translations } = body;

  if (!product_name || typeof product_name !== 'string') {
    return errorResponse('製品名（product_name）は必須です', 400);
  }

  const labelId = generateId();
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO labels (id, user_id, product_name, category, ingredients_json, allergens_json, nutrition_json, label_settings_json, translations_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      labelId,
      payload.sub,
      product_name,
      category || null,
      JSON.stringify(ingredients || []),
      JSON.stringify(allergens || []),
      JSON.stringify(nutrition || {}),
      JSON.stringify(label_settings || {}),
      JSON.stringify(translations || {}),
      now,
      now
    )
    .run();

  // 利用量カウントをインクリメント
  await incrementUsage(payload.sub, env);

  return jsonResponse({ id: labelId, product_name, created_at: now }, 201);
}

/** ラベル一覧取得 */
async function handleListLabels(request, env) {
  const payload = await authenticateRequest(request, env);
  if (!payload) return errorResponse('認証が必要です', 401);

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10)));
  const offset = (page - 1) * limit;

  // 総件数
  const countResult = await env.DB.prepare('SELECT COUNT(*) as total FROM labels WHERE user_id = ?')
    .bind(payload.sub)
    .first();

  // ラベル一覧（翻訳データを除く軽量版）
  const labels = await env.DB.prepare(
    `SELECT id, product_name, category, created_at, updated_at
     FROM labels WHERE user_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?`
  )
    .bind(payload.sub, limit, offset)
    .all();

  return jsonResponse({
    labels: labels.results || [],
    total: countResult?.total || 0,
    page,
    limit,
  });
}

/** ラベル詳細取得 */
async function handleGetLabel(request, env, params) {
  const payload = await authenticateRequest(request, env);
  if (!payload) return errorResponse('認証が必要です', 401);

  const label = await env.DB.prepare('SELECT * FROM labels WHERE id = ? AND user_id = ?')
    .bind(params.id, payload.sub)
    .first();

  if (!label) return errorResponse('ラベルが見つかりません', 404);

  // JSON文字列をオブジェクトにパース
  return jsonResponse({
    id: label.id,
    user_id: label.user_id,
    product_name: label.product_name,
    category: label.category,
    ingredients: JSON.parse(label.ingredients_json || '[]'),
    allergens: JSON.parse(label.allergens_json || '[]'),
    nutrition: JSON.parse(label.nutrition_json || '{}'),
    label_settings: JSON.parse(label.label_settings_json || '{}'),
    translations: JSON.parse(label.translations_json || '{}'),
    created_at: label.created_at,
    updated_at: label.updated_at,
  });
}

/** ラベル削除 */
async function handleDeleteLabel(request, env, params) {
  const payload = await authenticateRequest(request, env);
  if (!payload) return errorResponse('認証が必要です', 401);

  // 所有権チェック付き削除
  const result = await env.DB.prepare('DELETE FROM labels WHERE id = ? AND user_id = ?')
    .bind(params.id, payload.sub)
    .run();

  if (!result.meta?.changes || result.meta.changes === 0) {
    return errorResponse('ラベルが見つかりません', 404);
  }

  // R2からPDFも削除（存在すれば）
  try {
    const objects = await env.STORAGE.list({ prefix: `labels/${params.id}/` });
    for (const obj of objects.objects || []) {
      await env.STORAGE.delete(obj.key);
    }
  } catch {
    // R2削除失敗は致命的でないためスルー
  }

  return jsonResponse({ deleted: true });
}

// ==========================================
// ハンドラー: PDF生成
// ==========================================

/**
 * PDF生成リクエスト
 * 実際のPDF生成はフロントエンド側（jsPDF等）で行い、
 * このエンドポイントは生成済みPDFバイナリをR2に保存する
 */
async function handleGeneratePdf(request, env, params) {
  const payload = await authenticateRequest(request, env);
  if (!payload) return errorResponse('認証が必要です', 401);

  // ラベル所有権チェック
  const label = await env.DB.prepare('SELECT id, product_name FROM labels WHERE id = ? AND user_id = ?')
    .bind(params.id, payload.sub)
    .first();

  if (!label) return errorResponse('ラベルが見つかりません', 404);

  // Content-Typeチェック
  const contentType = request.headers.get('Content-Type') || '';

  if (contentType.includes('application/pdf')) {
    // PDFバイナリを直接受け取る場合
    const pdfBuffer = await request.arrayBuffer();
    if (pdfBuffer.byteLength === 0) {
      return errorResponse('PDFデータが空です', 400);
    }
    if (pdfBuffer.byteLength > 10 * 1024 * 1024) {
      return errorResponse('PDFファイルサイズが上限（10MB）を超えています', 413);
    }

    const key = `labels/${params.id}/${Date.now()}.pdf`;

    await env.STORAGE.put(key, pdfBuffer, {
      httpMetadata: { contentType: 'application/pdf' },
      customMetadata: {
        userId: payload.sub,
        labelId: params.id,
        productName: label.product_name,
      },
    });

    return jsonResponse({
      key,
      size: pdfBuffer.byteLength,
      url: `/api/files/${key}`,
    }, 201);
  }

  // JSON形式でPDF生成パラメータを受け取る場合（将来のサーバーサイドPDF生成用）
  return errorResponse('Content-Type: application/pdf でPDFバイナリを送信してください', 415);
}

// ==========================================
// ハンドラー: 利用量管理
// ==========================================

/** プラン別の月間ラベル上限 */
const PLAN_LIMITS = {
  free: 3,
  lite: 30,
  standard: 100,
  pro: 500,
};

/** 現在月のYYYY-MM文字列を取得 */
function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** 利用量チェック（上限内ならtrue） */
async function checkUsageLimit(userId, env) {
  const month = getCurrentMonth();

  // ユーザーのプラン取得
  const user = await env.DB.prepare('SELECT plan FROM users WHERE id = ?').bind(userId).first();
  const plan = user?.plan || 'free';
  const limit = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

  // 今月の利用量取得
  const usage = await env.DB.prepare(
    'SELECT label_count FROM usage WHERE user_id = ? AND month = ?'
  )
    .bind(userId, month)
    .first();

  const currentCount = usage?.label_count || 0;
  return currentCount < limit;
}

/** 利用量カウントをインクリメント */
async function incrementUsage(userId, env) {
  const month = getCurrentMonth();
  const now = new Date().toISOString();

  // UPSERT: 存在すればインクリメント、なければ新規作成
  const existing = await env.DB.prepare(
    'SELECT id, label_count FROM usage WHERE user_id = ? AND month = ?'
  )
    .bind(userId, month)
    .first();

  if (existing) {
    await env.DB.prepare('UPDATE usage SET label_count = label_count + 1 WHERE id = ?')
      .bind(existing.id)
      .run();
  } else {
    await env.DB.prepare(
      'INSERT INTO usage (id, user_id, month, label_count, created_at) VALUES (?, ?, ?, 1, ?)'
    )
      .bind(generateId(), userId, month, now)
      .run();
  }
}

/** 利用量取得 */
async function handleGetUsage(request, env) {
  const payload = await authenticateRequest(request, env);
  if (!payload) return errorResponse('認証が必要です', 401);

  const month = getCurrentMonth();

  const user = await env.DB.prepare('SELECT plan FROM users WHERE id = ?').bind(payload.sub).first();
  const plan = user?.plan || 'free';
  const limit = PLAN_LIMITS[plan] || PLAN_LIMITS.free;

  const usage = await env.DB.prepare(
    'SELECT label_count FROM usage WHERE user_id = ? AND month = ?'
  )
    .bind(payload.sub, month)
    .first();

  const currentCount = usage?.label_count || 0;

  return jsonResponse({
    month,
    plan,
    label_count: currentCount,
    label_limit: limit,
    remaining: Math.max(0, limit - currentCount),
  });
}

// ==========================================
// ハンドラー: Stripe決済
// ==========================================

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

/** プラン情報取得（対応決済方法を含む） */
async function handleGetPlans() {
  return jsonResponse({
    plans: PLANS,
    payment_methods: [
      { type: 'card', label: 'クレジットカード / Apple Pay / Google Pay' },
      { type: 'paypay', label: 'PayPay' },
    ],
  });
}

/** Stripe Checkout Session作成 */
async function handleStripeCheckout(request, env) {
  const payload = await authenticateRequest(request, env);
  if (!payload) return errorResponse('認証が必要です', 401);

  const body = await request.json().catch(() => null);
  if (!body) return errorResponse('リクエストボディが不正です', 400);

  const { plan } = body;
  if (!plan || !['lite', 'standard', 'pro'].includes(plan)) {
    return errorResponse('有効なプランを指定してください（lite / standard / pro）', 400);
  }

  // Stripe未設定時のモック
  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse({
      url: `/app.html?mock_checkout=true&plan=${plan}`,
      session_id: `mock_cs_${generateId()}`,
      mock: true,
      payment_methods: ['card', 'paypay'],
    });
  }

  // Price IDマッピング
  const priceIdMap = {
    lite: env.STRIPE_PRICE_LITE,
    standard: env.STRIPE_PRICE_STANDARD,
    pro: env.STRIPE_PRICE_PRO,
  };

  const priceId = priceIdMap[plan];
  if (!priceId) {
    return errorResponse(`プラン「${plan}」のStripe Price IDが未設定です`, 500);
  }

  // ユーザーのStripe Customer ID取得（なければ作成）
  const user = await env.DB.prepare('SELECT email, stripe_customer_id FROM users WHERE id = ?')
    .bind(payload.sub)
    .first();

  let customerId = user?.stripe_customer_id;

  if (!customerId) {
    // Stripe Customer作成
    const customerResponse = await stripeRequest('POST', '/v1/customers', {
      email: user.email,
      metadata: { user_id: payload.sub },
    }, env.STRIPE_SECRET_KEY);

    if (!customerResponse.ok) {
      return errorResponse('Stripe顧客の作成に失敗しました', 502);
    }

    const customer = await customerResponse.json();
    customerId = customer.id;

    // DB更新
    await env.DB.prepare('UPDATE users SET stripe_customer_id = ?, updated_at = ? WHERE id = ?')
      .bind(customerId, new Date().toISOString(), payload.sub)
      .run();
  }

  // Checkout Session作成
  // payment_method_types を指定しない → Stripeダッシュボードで有効化した決済方法が全て自動表示
  // （card=クレカ/Apple Pay/Google Pay、paypay、konbini 等）
  const origin = new URL(request.url).origin;
  const sessionResponse = await stripeRequest('POST', '/v1/checkout/sessions', {
    customer: customerId,
    mode: 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    success_url: `${origin}/app.html?checkout=success`,
    cancel_url: `${origin}/app.html?checkout=cancel`,
    metadata: { user_id: payload.sub, plan },
    locale: 'ja',
  }, env.STRIPE_SECRET_KEY);

  if (!sessionResponse.ok) {
    const errText = await sessionResponse.text();
    console.error('Stripe Checkout error:', errText);
    return errorResponse('Stripe Checkout Sessionの作成に失敗しました', 502);
  }

  const session = await sessionResponse.json();
  return jsonResponse({ url: session.url, session_id: session.id });
}

/** Stripe Webhook処理 */
async function handleStripeWebhook(request, env) {
  // Stripe未設定時はスキップ
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) {
    return jsonResponse({ received: true, mock: true });
  }

  const body = await request.text();
  const signature = request.headers.get('Stripe-Signature');

  if (!signature) {
    return errorResponse('Stripe-Signatureヘッダーがありません', 400);
  }

  // Webhook署名検証
  const isValid = await verifyStripeSignature(body, signature, env.STRIPE_WEBHOOK_SECRET);
  if (!isValid) {
    return errorResponse('Webhook署名が無効です', 401);
  }

  const event = JSON.parse(body);

  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      await handleSubscriptionUpdate(subscription, env);
      break;
    }
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      await handleSubscriptionDeleted(subscription, env);
      break;
    }
    default:
      // 未処理のイベントは無視
      break;
  }

  return jsonResponse({ received: true });
}

/** サブスクリプション更新処理 */
async function handleSubscriptionUpdate(subscription, env) {
  const customerId = subscription.customer;
  const now = new Date().toISOString();

  // Customer IDからユーザーを特定
  const user = await env.DB.prepare('SELECT id FROM users WHERE stripe_customer_id = ?')
    .bind(customerId)
    .first();

  if (!user) {
    console.error('User not found for Stripe customer:', customerId);
    return;
  }

  // Price IDからプランを判定
  const priceId = subscription.items?.data?.[0]?.price?.id;
  const plan = determinePlanFromPrice(priceId, env);
  const status = subscription.status;
  const periodEnd = new Date(subscription.current_period_end * 1000).toISOString();

  // subscriptionsテーブルをUPSERT
  const existing = await env.DB.prepare(
    'SELECT id FROM subscriptions WHERE stripe_subscription_id = ?'
  )
    .bind(subscription.id)
    .first();

  if (existing) {
    await env.DB.prepare(
      `UPDATE subscriptions SET plan = ?, status = ?, current_period_end = ?, updated_at = ?
       WHERE stripe_subscription_id = ?`
    )
      .bind(plan, status, periodEnd, now, subscription.id)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO subscriptions (id, user_id, stripe_subscription_id, plan, status, current_period_end, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(generateId(), user.id, subscription.id, plan, status, periodEnd, now, now)
      .run();
  }

  // アクティブなサブスクリプションならユーザーのプランを更新
  if (status === 'active' || status === 'trialing') {
    await env.DB.prepare('UPDATE users SET plan = ?, updated_at = ? WHERE id = ?')
      .bind(plan, now, user.id)
      .run();
  }
}

/** サブスクリプション削除（キャンセル）処理 */
async function handleSubscriptionDeleted(subscription, env) {
  const customerId = subscription.customer;
  const now = new Date().toISOString();

  const user = await env.DB.prepare('SELECT id FROM users WHERE stripe_customer_id = ?')
    .bind(customerId)
    .first();

  if (!user) return;

  // サブスクリプションをcanceledに更新
  await env.DB.prepare(
    `UPDATE subscriptions SET status = 'canceled', updated_at = ? WHERE stripe_subscription_id = ?`
  )
    .bind(now, subscription.id)
    .run();

  // ユーザーをフリープランに戻す
  await env.DB.prepare("UPDATE users SET plan = 'free', updated_at = ? WHERE id = ?")
    .bind(now, user.id)
    .run();
}

/** Price IDからプラン名を判定 */
function determinePlanFromPrice(priceId, env) {
  if (priceId === env.STRIPE_PRICE_LITE) return 'lite';
  if (priceId === env.STRIPE_PRICE_STANDARD) return 'standard';
  if (priceId === env.STRIPE_PRICE_PRO) return 'pro';
  return 'lite'; // フォールバック
}

/** Stripe Customer Portal */
async function handleStripePortal(request, env) {
  const payload = await authenticateRequest(request, env);
  if (!payload) return errorResponse('認証が必要です', 401);

  // Stripe未設定時のモック
  if (!env.STRIPE_SECRET_KEY) {
    return jsonResponse({
      url: '/app.html?mock_portal=true',
      mock: true,
    });
  }

  const user = await env.DB.prepare('SELECT stripe_customer_id FROM users WHERE id = ?')
    .bind(payload.sub)
    .first();

  if (!user?.stripe_customer_id) {
    return errorResponse('Stripeアカウントが未連携です', 400);
  }

  const origin = new URL(request.url).origin;
  const portalResponse = await stripeRequest('POST', '/v1/billing_portal/sessions', {
    customer: user.stripe_customer_id,
    return_url: `${origin}/app.html`,
  }, env.STRIPE_SECRET_KEY);

  if (!portalResponse.ok) {
    return errorResponse('Customer Portalの作成に失敗しました', 502);
  }

  const portal = await portalResponse.json();
  return jsonResponse({ url: portal.url });
}

/** Stripe APIリクエストヘルパー */
async function stripeRequest(method, path, params, secretKey) {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      body.append(key, String(value));
    }
  }

  return fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: method === 'GET' ? undefined : body.toString(),
  });
}

/**
 * Stripe Webhook署名を検証
 * Stripe-Signature: t=timestamp,v1=signature 形式
 */
async function verifyStripeSignature(payload, signatureHeader, secret) {
  try {
    const elements = signatureHeader.split(',');
    const timestamp = elements.find((e) => e.startsWith('t='))?.slice(2);
    const signature = elements.find((e) => e.startsWith('v1='))?.slice(3);

    if (!timestamp || !signature) return false;

    // タイムスタンプの鮮度チェック（5分以内）
    const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
    if (age > 300) return false;

    // 署名検証
    const signedPayload = `${timestamp}.${payload}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
    const expectedSignature = Array.from(new Uint8Array(mac))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    return expectedSignature === signature;
  } catch {
    return false;
  }
}

// ==========================================
// メインエントリポイント
// ==========================================

/** 全ルート定義 */
const routes = [
  // 認証
  { method: 'POST', path: '/api/auth/register', handler: handleRegister },
  { method: 'POST', path: '/api/auth/login', handler: handleLogin },
  { method: 'GET', path: '/api/auth/me', handler: handleGetMe },

  // 翻訳
  { method: 'POST', path: '/api/translate', handler: handleTranslate },

  // ラベル管理
  { method: 'POST', path: '/api/labels', handler: handleCreateLabel },
  { method: 'GET', path: '/api/labels', handler: handleListLabels },
  { method: 'GET', path: '/api/labels/:id', handler: handleGetLabel },
  { method: 'DELETE', path: '/api/labels/:id', handler: handleDeleteLabel },

  // PDF生成
  { method: 'POST', path: '/api/labels/:id/pdf', handler: handleGeneratePdf },

  // 利用量
  { method: 'GET', path: '/api/usage', handler: handleGetUsage },

  // Stripe
  { method: 'POST', path: '/api/stripe/checkout', handler: handleStripeCheckout },
  { method: 'POST', path: '/api/stripe/webhook', handler: handleStripeWebhook },
  { method: 'POST', path: '/api/stripe/portal', handler: handleStripePortal },

  // プラン
  { method: 'GET', path: '/api/plans', handler: handleGetPlans },
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return withCORS(new Response(null, { status: 204 }), request.headers.get('Origin'));
    }

    // レート制限チェック（Webhookは除外）
    if (!pathname.startsWith('/api/stripe/webhook')) {
      const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';
      const limited = await isRateLimited(clientIP, env);
      if (limited) {
        return withCORS(
          errorResponse('リクエスト数が上限を超えました。しばらく待ってから再試行してください。', 429),
          request.headers.get('Origin')
        );
      }
    }

    // ルートマッチング
    const match = matchRoute(method, pathname, routes);

    if (match) {
      try {
        const response = await match.handler(request, env, match.params);
        return withCORS(response, request.headers.get('Origin'));
      } catch (err) {
        console.error(`Error in ${method} ${pathname}:`, err);
        return withCORS(
          errorResponse('サーバー内部エラーが発生しました', 500),
          request.headers.get('Origin')
        );
      }
    }

    // 404
    return withCORS(errorResponse('エンドポイントが見つかりません', 404), request.headers.get('Origin'));
  },
};
