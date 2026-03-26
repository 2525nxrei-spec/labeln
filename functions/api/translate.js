/**
 * POST /api/translate - 翻訳処理
 */

import { withMiddleware } from '../lib/middleware.js';
import { errorResponse, jsonResponse } from '../lib/response.js';
import { authenticateRequest } from '../lib/auth.js';
import { checkUsageLimit } from '../lib/usage.js';

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
  const lines = rawText.split('\n').filter((l) => l.trim());
  return lines.slice(0, expectedCount);
}

async function handler({ request, env }) {
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
              temperature: 0.1,
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

      translations[lang] = parseTranslationResponse(rawText, texts.length);
    }

    return jsonResponse({ translations, mock: false });
  } catch (err) {
    console.error('Translation error:', err);
    return errorResponse('翻訳処理中にエラーが発生しました', 500);
  }
}

export const onRequestPost = withMiddleware(handler);
export const onRequestOptions = withMiddleware(handler);
