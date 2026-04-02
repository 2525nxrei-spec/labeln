/**
 * Stripe関連ユーティリティ
 */

/** Stripe APIリクエストヘルパー */
export async function stripeRequest(method, path, params, secretKey) {
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
export async function verifyStripeSignature(payload, signatureHeader, secret) {
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

    // タイミングセーフ比較（サイドチャネル攻撃防止）
    if (expectedSignature.length !== signature.length) return false;
    let mismatch = 0;
    for (let i = 0; i < expectedSignature.length; i++) {
      mismatch |= expectedSignature.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return mismatch === 0;
  } catch {
    return false;
  }
}

/** Price IDからプラン名を判定 */
export function determinePlanFromPrice(priceId, env) {
  if (priceId === env.STRIPE_PRICE_LITE) return 'lite';
  if (priceId === env.STRIPE_PRICE_STANDARD) return 'standard';
  if (priceId === env.STRIPE_PRICE_PRO) return 'pro';
  return 'lite'; // フォールバック
}
