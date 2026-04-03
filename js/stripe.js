/* ============================================
   ラベルン - Stripe決済モジュール (stripe.js)
   サブスクリプション決済管理
   ============================================ */

/**
 * Workers API エンドポイント
 */
const STRIPE_API_ENDPOINTS = {
  CREATE_CHECKOUT: '/api/stripe/checkout',
  MANAGE_BILLING: '/api/stripe/portal',
  CANCEL: '/api/stripe/cancel',
  PAYMENT_HISTORY: '/api/stripe/payments',
  WEBHOOK_STATUS: '/api/stripe/status',
};

/**
 * Stripe 決済プラン定義
 * Price ID はサーバー側で環境変数から解決する（フロントには持たない）
 */
const STRIPE_PLANS = {
  lite: {
    id: 'lite',
    name: 'ライトプラン',
    price: 300,
    currency: 'jpy',
    interval: 'month',
    description: '月10ラベル / 5言語',
  },
  standard: {
    id: 'standard',
    name: 'スタンダードプラン',
    price: 500,
    currency: 'jpy',
    interval: 'month',
    description: '月50ラベル / 18言語',
  },
  pro: {
    id: 'pro',
    name: 'プロプラン',
    price: 2000,
    currency: 'jpy',
    interval: 'month',
    description: '無制限ラベル / API連携',
    comingSoon: true,
  },
};

/**
 * Stripe 決済モジュール
 */
const StripePayment = {
  /* Stripe.js インスタンス */
  stripe: null,

  /* Stripe利用可能フラグ */
  _stripeAvailable: false,

  /* Payment Request API（Apple Pay / Google Pay）*/
  _paymentRequest: null,
  _paymentRequestAvailable: false,

  /* ============================================
     初期化
     ============================================ */

  async init() {
    console.log('[StripePayment] 初期化開始');

    // Stripe.js がまだ読み込まれていなければ最大5秒待つ
    if (typeof Stripe === 'undefined') {
      await this._waitForStripe(5000);
    }

    // Stripe.js の存在チェック
    if (typeof Stripe !== 'undefined') {
      await this._initStripe();
    } else {
      console.warn('[StripePayment] Stripe.js 未検出（モックモードで動作）');
      this._stripeAvailable = false;
    }

    // Workers API からプラン情報を取得
    await this._fetchPlanInfo();

    // Payment Request API（Apple Pay / Google Pay）の初期化
    await this.initPaymentRequest();

    console.log('[StripePayment] 初期化完了', this._stripeAvailable ? '(Stripe有効)' : '(モックモード)');
  },

  /**
   * Stripe.js CDN の読み込み完了を待つ（defer/async対策）
   * @param {number} timeout - 最大待機時間(ms)
   */
  _waitForStripe(timeout) {
    return new Promise((resolve) => {
      const start = Date.now();
      const check = () => {
        if (typeof Stripe !== 'undefined') return resolve();
        if (Date.now() - start > timeout) return resolve();
        setTimeout(check, 100);
      };
      check();
    });
  },

  /**
   * Stripe設定状況を確認（リダイレクト型のためStripe.jsインスタンスは不要）
   */
  async _initStripe() {
    try {
      // Workers API からStripe設定状況を確認
      const res = await fetch(STRIPE_API_ENDPOINTS.WEBHOOK_STATUS);

      if (res.ok) {
        const data = await res.json();
        if (data.publishableKey || data.configured) {
          this._stripeAvailable = true;
          console.log('[StripePayment] Stripe設定確認完了（リダイレクト型）');
          return;
        }
      }
    } catch (err) {
      console.warn('[StripePayment] Stripe設定確認に失敗:', err.message);
    }

    this._stripeAvailable = false;
  },

  /**
   * Workers API からプラン情報を取得（Price IDはサーバー側で管理）
   */
  async _fetchPlanInfo() {
    try {
      const res = await fetch(STRIPE_API_ENDPOINTS.WEBHOOK_STATUS);
      if (!res.ok) return;

      const data = await res.json();
      if (data.plans) {
        // サーバー側でプランが設定済みかどうかのみ確認
        this._serverPlansAvailable = true;
        console.log('[StripePayment] プラン情報取得完了');
      }
    } catch (err) {
      // 取得失敗はモックモードで継続
      console.warn('[StripePayment] プラン情報取得スキップ');
    }
  },

  /* ============================================
     Payment Request API（Apple Pay / Google Pay）
     ============================================ */

  /**
   * Payment Request API を初期化
   * Safari: Apple Pay / Android Chrome: Google Pay を自動検出
   */
  async initPaymentRequest() {
    if (!this._stripeAvailable || !this.stripe) return;

    try {
      const paymentRequest = this.stripe.paymentRequest({
        country: 'JP',
        currency: 'jpy',
        total: {
          label: 'ラベルン サブスクリプション',
          amount: 300, // デフォルト（後から更新）
        },
        requestPayerName: true,
        requestPayerEmail: true,
      });

      // ブラウザがPayment Request APIに対応しているかチェック
      const result = await paymentRequest.canMakePayment();
      if (result) {
        this._paymentRequest = paymentRequest;
        this._paymentRequestAvailable = true;
        console.log('[StripePayment] Payment Request API利用可能:', result);
        // Apple Pay: result.applePay === true
        // Google Pay: result.googlePay === true
      } else {
        console.log('[StripePayment] Payment Request API非対応');
      }
    } catch (err) {
      console.warn('[StripePayment] Payment Request API初期化エラー:', err.message);
    }
  },

  /**
   * Payment Request Button をレンダリング
   * Apple Pay / Google Pay が利用可能な環境でネイティブボタンを表示
   *
   * @param {string} containerId - マウント先のDOM要素ID
   * @param {string} planId - プランID
   * @returns {boolean} レンダリング成功可否
   */
  renderPaymentRequestButton(containerId, planId) {
    const container = document.getElementById(containerId);
    if (!container || !this._paymentRequest) return false;

    const plan = STRIPE_PLANS[planId];
    if (!plan) return false;

    // 金額を更新
    this._paymentRequest.update({
      total: {
        label: plan.name,
        amount: plan.price,
      },
    });

    const elements = this.stripe.elements();
    const prButton = elements.create('paymentRequestButton', {
      paymentRequest: this._paymentRequest,
      style: {
        paymentRequestButton: {
          type: 'default',
          theme: 'dark',
          height: '48px',
        },
      },
    });

    container.innerHTML = '';
    prButton.mount('#' + containerId);

    return true;
  },

  /* ============================================
     決済方法バッジ表示
     ============================================ */

  /**
   * 対応決済方法のバッジを表示
   * カード / PayPay / Apple Pay / Google Pay
   *
   * @param {string} containerId - 表示先のDOM要素ID
   */
  renderPaymentMethodBadges(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:12px;">
        <span style="display:inline-flex;align-items:center;gap:4px;padding:4px 12px;background:#f1f5f9;border-radius:20px;font-size:12px;font-weight:500;">
          <svg width="20" height="14" viewBox="0 0 20 14"><rect width="20" height="14" rx="2" fill="#1a1f71"/><text x="10" y="10" text-anchor="middle" fill="white" font-size="7" font-weight="bold">VISA</text></svg>
          カード
        </span>
        <span style="display:inline-flex;align-items:center;gap:4px;padding:4px 12px;background:#f1f5f9;border-radius:20px;font-size:12px;font-weight:500;">
          <span style="color:#ff0033;font-weight:700;">PayPay</span>
        </span>
        <span style="display:inline-flex;align-items:center;gap:4px;padding:4px 12px;background:#f1f5f9;border-radius:20px;font-size:12px;font-weight:500;">
           Apple Pay
        </span>
        <span style="display:inline-flex;align-items:center;gap:4px;padding:4px 12px;background:#f1f5f9;border-radius:20px;font-size:12px;font-weight:500;">
          Google Pay
        </span>
        <span style="display:inline-flex;align-items:center;gap:4px;padding:4px 12px;background:#f1f5f9;border-radius:20px;font-size:12px;font-weight:500;">
          コンビニ払い
        </span>
      </div>
    `;
  },

  /* ============================================
     Checkout（決済開始）
     ============================================ */

  /**
   * リダイレクト型 Stripe Checkout で決済ページに遷移
   *
   * @param {string} planId - プランID ('lite' | 'standard' | 'pro')
   */
  async checkout(planId, triggerBtn) {
    const plan = STRIPE_PLANS[planId];
    if (!plan) {
      throw new Error('無効なプランが選択されました。');
    }

    // Coming Soon プランのチェック
    if (plan.comingSoon) {
      this._showMessage('プロプランは近日公開予定です。今しばらくお待ちください。');
      return;
    }

    // ログインチェック
    if (typeof Auth !== 'undefined' && !Auth.isLoggedIn()) {
      this._showMessage('決済にはログインが必要です。');
      return;
    }

    // ボタンをdisabled+処理中表示
    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.dataset.originalText = triggerBtn.textContent;
      triggerBtn.textContent = '処理中...';
      triggerBtn.classList.add('is-loading');
    }

    // Stripe利用不可 → モックUI
    if (!this._stripeAvailable) {
      if (triggerBtn) {
        triggerBtn.disabled = false;
        triggerBtn.textContent = triggerBtn.dataset.originalText || 'このプランで始める';
        triggerBtn.classList.remove('is-loading');
      }
      this.showMockCheckout(planId);
      return;
    }

    try {
      this._showLoading('決済ページに移動中...');

      // Workers API で Checkout Session 作成
      const res = await fetch(STRIPE_API_ENDPOINTS.CREATE_CHECKOUT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(typeof Auth !== 'undefined' && Auth.token ? { Authorization: `Bearer ${Auth.token}` } : {}),
        },
        body: JSON.stringify({
          planId: planId,
        }),
      });

      if (!res.ok) {
        throw new Error('Checkout Session の作成に失敗しました。');
      }

      const data = await res.json();
      this._hideLoading();

      // モックレスポンスの場合
      if (data.mock) {
        if (triggerBtn) {
          triggerBtn.disabled = false;
          triggerBtn.textContent = triggerBtn.dataset.originalText || 'このプランで始める';
          triggerBtn.classList.remove('is-loading');
        }
        this.showMockCheckout(planId);
        return;
      }

      // リダイレクト型: Stripe Checkout URLに遷移
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error('決済URLの取得に失敗しました。');
      }
    } catch (err) {
      console.error('[StripePayment] Checkout エラー:', err);
      this._hideLoading();

      // ボタンを元に戻す
      if (triggerBtn) {
        triggerBtn.disabled = false;
        triggerBtn.textContent = triggerBtn.dataset.originalText || 'このプランで始める';
        triggerBtn.classList.remove('is-loading');
      }

      // APIエラー → モックにフォールバック
      this.showMockCheckout(planId);
    }
  },

  /* ============================================
     サブスクリプション管理
     ============================================ */

  /**
   * Stripe Billing Portal を開く（プラン変更・解約）
   */
  async manageBilling() {
    if (!this._stripeAvailable) {
      this._showMessage('現在モックモードで動作中です。本番環境ではStripeの請求ポータルが表示されます。');
      return;
    }

    try {
      this._showLoading('請求管理ポータルを準備中...');

      const res = await fetch(STRIPE_API_ENDPOINTS.MANAGE_BILLING, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(typeof Auth !== 'undefined' && Auth.token ? { Authorization: `Bearer ${Auth.token}` } : {}),
        },
        body: JSON.stringify({
          returnUrl: window.location.href,
        }),
      });

      if (!res.ok) throw new Error('ポータルの作成に失敗しました。');

      const data = await res.json();
      this._hideLoading();

      if (data.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      console.error('[StripePayment] Billing Portal エラー:', err);
      this._hideLoading();
      this._showMessage('請求管理ポータルを開けませんでした。');
    }
  },

  /**
   * サブスクリプション解約
   */
  async cancelSubscription() {
    // 確認ダイアログ
    const confirmed = confirm('サブスクリプションを解約しますか？\n現在の請求期間の終了まではサービスをご利用いただけます。');
    if (!confirmed) return;

    if (!this._stripeAvailable) {
      // モック解約
      if (typeof Auth !== 'undefined' && Auth.currentUser) {
        Auth.currentUser.plan = 'free';
        Auth._saveSession();
        Auth._updateUI();
      }
      this._showMessage('（モック）解約処理が完了しました。無料プランに変更されました。');
      return;
    }

    try {
      this._showLoading('解約処理中...');

      const res = await fetch(STRIPE_API_ENDPOINTS.CANCEL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(typeof Auth !== 'undefined' && Auth.token ? { Authorization: `Bearer ${Auth.token}` } : {}),
        },
      });

      this._hideLoading();

      if (!res.ok) throw new Error('解約に失敗しました。');

      const data = await res.json();

      // ユーザー情報を更新
      if (typeof Auth !== 'undefined' && Auth.currentUser) {
        Auth.currentUser.plan = 'free';
        Auth._saveSession();
        Auth._updateUI();
      }

      this._showMessage('解約が完了しました。現在の請求期間の終了までサービスをご利用いただけます。');
    } catch (err) {
      console.error('[StripePayment] 解約エラー:', err);
      this._hideLoading();
      this._showMessage('解約処理に失敗しました。しばらくしてからお試しください。');
    }
  },

  /* ============================================
     支払い履歴
     ============================================ */

  /**
   * 支払い履歴を取得して表示
   *
   * @param {string} containerId - 表示先のDOM要素ID
   */
  async renderPaymentHistory(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!this._stripeAvailable) {
      // モック履歴
      container.innerHTML = this._renderMockPaymentHistory();
      return;
    }

    try {
      const res = await fetch(STRIPE_API_ENDPOINTS.PAYMENT_HISTORY, {
        headers: {
          ...(typeof Auth !== 'undefined' && Auth.token ? { Authorization: `Bearer ${Auth.token}` } : {}),
        },
      });

      if (!res.ok) throw new Error('支払い履歴の取得に失敗しました。');

      const data = await res.json();
      const payments = data.payments || [];

      if (payments.length === 0) {
        container.innerHTML = '<p class="text-muted">支払い履歴はありません。</p>';
        return;
      }

      container.innerHTML = `
        <table class="table table--striped">
          <thead>
            <tr>
              <th>日付</th>
              <th>プラン</th>
              <th>金額</th>
              <th>ステータス</th>
            </tr>
          </thead>
          <tbody>
            ${payments.map(p => `
              <tr>
                <td>${new Date(p.date).toLocaleDateString('ja-JP')}</td>
                <td>${this._esc(p.planName || '')}</td>
                <td>&yen;${p.amount?.toLocaleString() || '0'}</td>
                <td>${p.status === 'succeeded' ? '<span class="badge badge--success">完了</span>' : '<span class="badge badge--warning">' + this._esc(p.status) + '</span>'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } catch (err) {
      console.error('[StripePayment] 支払い履歴取得エラー:', err);
      container.innerHTML = '<p class="text-muted">支払い履歴を取得できませんでした。</p>';
    }
  },

  /**
   * モック用支払い履歴
   */
  _renderMockPaymentHistory() {
    const currentPlan = (typeof Auth !== 'undefined') ? Auth.getPlan() : 'free';
    if (currentPlan === 'free') {
      return '<p class="text-muted">無料プランのため支払い履歴はありません。</p>';
    }

    return `
      <div class="payment-history-mock">
        <p class="text-muted">（デモモード）実際のStripe連携時に支払い履歴が表示されます。</p>
        <table class="table table--striped">
          <thead>
            <tr><th>日付</th><th>プラン</th><th>金額</th><th>ステータス</th></tr>
          </thead>
          <tbody>
            <tr>
              <td>${new Date().toLocaleDateString('ja-JP')}</td>
              <td>${STRIPE_PLANS[currentPlan]?.name || currentPlan}</td>
              <td>&yen;${STRIPE_PLANS[currentPlan]?.price?.toLocaleString() || '0'}</td>
              <td><span class="badge badge--success">完了（デモ）</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  },

  /* ============================================
     モックCheckout UI
     ============================================ */

  /**
   * Stripe未設定時のテスト決済UI
   * 実際の課金は行わない
   */
  showMockCheckout(planId) {
    const plan = STRIPE_PLANS[planId];
    if (!plan) return;

    // 既存モーダルがあれば削除
    const existingModal = document.getElementById('mock-checkout-modal');
    if (existingModal) existingModal.remove();

    // モーダル生成
    const modal = document.createElement('div');
    modal.id = 'mock-checkout-modal';
    modal.style.cssText = `
      position:fixed;top:0;left:0;width:100%;height:100%;
      background:rgba(0,0,0,0.5);display:flex;align-items:center;
      justify-content:center;z-index:10000;
    `;

    modal.innerHTML = `
      <div style="
        background:#fff;border-radius:12px;padding:32px;
        max-width:420px;width:90%;text-align:center;
        box-shadow:0 20px 60px rgba(0,0,0,0.3);
      ">
        <div style="font-size:14px;color:#0f766e;font-weight:600;margin-bottom:8px;">テスト決済（デモモード）</div>
        <h3 style="font-size:20px;margin-bottom:4px;">${this._esc(plan.name)}</h3>
        <p style="font-size:14px;color:#64748b;margin-bottom:16px;">${this._esc(plan.description)}</p>
        <div style="font-size:36px;font-weight:800;color:#0f766e;margin-bottom:4px;">
          &yen;${plan.price.toLocaleString()}<span style="font-size:14px;font-weight:400;color:#64748b;">/月</span>
        </div>

        <!-- 決済方法選択 -->
        <div style="text-align:left;margin-bottom:20px;">
          <p style="font-size:13px;font-weight:600;color:#334155;margin-bottom:10px;">決済方法を選択</p>
          <label style="display:flex;align-items:center;gap:10px;padding:12px;border:2px solid #0f766e;border-radius:8px;margin-bottom:6px;cursor:pointer;min-height:48px;">
            <input type="radio" name="mock-payment-method" value="card" checked style="width:18px;height:18px;accent-color:#0f766e;">
            <svg width="28" height="20" viewBox="0 0 28 20"><rect width="28" height="20" rx="3" fill="#1a1f71"/><text x="14" y="14" text-anchor="middle" fill="white" font-size="9" font-weight="bold">VISA</text></svg>
            <span style="font-size:14px;font-weight:500;">クレジットカード</span>
          </label>
          <label style="display:flex;align-items:center;gap:10px;padding:12px;border:2px solid #e2e8f0;border-radius:8px;margin-bottom:6px;cursor:pointer;min-height:48px;">
            <input type="radio" name="mock-payment-method" value="paypay" style="width:18px;height:18px;accent-color:#0f766e;">
            <span style="font-size:16px;font-weight:800;color:#ff0033;letter-spacing:-0.5px;">PayPay</span>
          </label>
          <label style="display:flex;align-items:center;gap:10px;padding:12px;border:2px solid #e2e8f0;border-radius:8px;margin-bottom:6px;cursor:pointer;min-height:48px;">
            <input type="radio" name="mock-payment-method" value="applepay" style="width:18px;height:18px;accent-color:#0f766e;">
            <svg width="20" height="20" viewBox="0 0 20 20"><path d="M14.94 10.37c-.02-2.17 1.77-3.22 1.85-3.27-1.01-1.47-2.57-1.67-3.13-1.7-1.33-.13-2.6.79-3.27.79-.68 0-1.72-.77-2.83-.75-1.45.02-2.8.85-3.55 2.15-1.52 2.63-.39 6.52 1.09 8.65.72 1.04 1.58 2.22 2.72 2.18 1.09-.04 1.5-.71 2.82-.71 1.31 0 1.68.71 2.83.68 1.17-.02 1.92-1.06 2.63-2.11.83-1.21 1.17-2.38 1.19-2.44-.03-.01-2.28-.88-2.31-3.47zM12.83 3.82c.6-.73 1.01-1.73.9-2.74-.87.04-1.92.58-2.54 1.3-.56.64-1.05 1.67-.92 2.66.97.07 1.96-.49 2.56-1.22z" fill="#000"/></svg>
            <span style="font-size:14px;font-weight:500;">Apple Pay</span>
          </label>
          <label style="display:flex;align-items:center;gap:10px;padding:12px;border:2px solid #e2e8f0;border-radius:8px;cursor:pointer;min-height:48px;">
            <input type="radio" name="mock-payment-method" value="googlepay" style="width:18px;height:18px;accent-color:#0f766e;">
            <svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="9" fill="none" stroke="#4285F4" stroke-width="1.5"/><path d="M10.2 10.1V12h3.27c-.14.87-.52 1.6-1.1 2.1l1.78 1.38c1.04-.96 1.64-2.37 1.64-4.05 0-.39-.03-.76-.1-1.12H10.2z" fill="#4285F4"/><path d="M6.58 11.58l-.4.3-1.42 1.1C5.96 15.2 7.8 16.5 10 16.5c1.65 0 3.03-.54 4.04-1.47l-1.78-1.38c-.54.36-1.23.58-2.03.58-1.56 0-2.88-1.05-3.35-2.47l-.3-.18z" fill="#34A853"/><path d="M4.76 7.02A6.47 6.47 0 004.25 10c0 1.08.18 2.1.51 2.98l1.82-1.4A3.87 3.87 0 016.25 10c0-.56.1-1.1.33-1.58L4.76 7.02z" fill="#FBBC05"/><path d="M10 6.17c.88 0 1.67.3 2.29.9l1.72-1.72C12.81 4.25 11.52 3.5 10 3.5c-2.2 0-4.04 1.3-4.89 3.17L6.93 8.1C7.4 6.72 8.6 6.17 10 6.17z" fill="#EA4335"/></svg>
            <span style="font-size:14px;font-weight:500;">Google Pay</span>
          </label>
        </div>

        <p style="font-size:12px;color:#94a3b8;margin-bottom:16px;">
          ※ これはテスト画面です。実際の課金は発生しません。
        </p>
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button id="mock-checkout-confirm" style="
            background:#0f766e;color:#fff;border:none;padding:14px;
            border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;
            min-height:48px;
          ">テスト決済を完了する</button>
          <button id="mock-checkout-cancel" style="
            background:transparent;color:#64748b;border:1px solid #e2e8f0;
            padding:12px;border-radius:8px;font-size:14px;cursor:pointer;
            min-height:48px;
          ">キャンセル</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // ラジオボタンのボーダー連動（選択中を強調）
    modal.querySelectorAll('input[name="mock-payment-method"]').forEach(radio => {
      radio.addEventListener('change', () => {
        modal.querySelectorAll('input[name="mock-payment-method"]').forEach(r => {
          r.closest('label').style.borderColor = r.checked ? '#0f766e' : '#e2e8f0';
        });
      });
    });

    // 確認ボタン
    document.getElementById('mock-checkout-confirm').addEventListener('click', () => {
      // 選択された決済方法を取得
      const selectedMethod = modal.querySelector('input[name="mock-payment-method"]:checked')?.value || 'card';
      const methodNames = { card: 'クレジットカード', paypay: 'PayPay', applepay: 'Apple Pay', googlepay: 'Google Pay' };
      console.log('[StripePayment] モック決済方法:', selectedMethod);

      // モックプラン変更
      if (typeof Auth !== 'undefined' && Auth.currentUser) {
        Auth.currentUser.plan = planId;
        Auth._saveSession();
        Auth._updateUI();
      }

      modal.remove();
      this._showMessage(`${plan.name}のテスト決済が完了しました（${methodNames[selectedMethod]}・デモモード）。`);

      // 利用量表示を更新
      if (typeof LabelunApp !== 'undefined') {
        LabelunApp._renderUsageCount();
      }
    });

    // キャンセルボタン
    document.getElementById('mock-checkout-cancel').addEventListener('click', () => {
      modal.remove();
    });

    // オーバーレイクリックで閉じる
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
  },

  /* ============================================
     無料枠管理
     ============================================ */

  /**
   * 無料枠の残数を取得
   */
  getFreeRemaining() {
    if (typeof Auth !== 'undefined') {
      const usage = Auth.checkUsageLimit();
      if (Auth.getPlan() === 'free') {
        return usage.remaining;
      }
    }
    return 0;
  },

  /**
   * 無料枠のプログレスバーを描画
   */
  renderFreeUsageBar(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (typeof Auth === 'undefined' || Auth.getPlan() !== 'free') {
      container.style.display = 'none';
      return;
    }

    const usage = Auth.checkUsageLimit();
    const percentage = Math.min(100, (usage.current / usage.limit) * 100);

    container.style.display = 'block';
    container.innerHTML = `
      <div class="free-usage-bar">
        <div class="free-usage-bar__label">無料枠: ${usage.current} / ${usage.limit} ラベル</div>
        <div class="free-usage-bar__track">
          <div class="free-usage-bar__fill" style="width:${percentage}%;background:${percentage >= 100 ? '#dc2626' : percentage >= 70 ? '#eab308' : '#16a34a'};"></div>
        </div>
        ${usage.current >= usage.limit ? '<p class="free-usage-bar__warning">無料枠を使い切りました。プランをアップグレードしてください。</p>' : ''}
      </div>
    `;
  },

  /* ============================================
     決済結果ハンドリング
     ============================================ */

  /**
   * URLパラメータから決済結果を判定
   * app.html?payment=success or ?payment=cancel
   */
  handlePaymentResult() {
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get('payment');

    if (!paymentStatus) return;

    switch (paymentStatus) {
      case 'success':
        this._showMessage('決済が完了しました。プランがアップグレードされました。');
        // URLパラメータをクリーンアップ
        window.history.replaceState({}, '', window.location.pathname);
        break;
      case 'cancel':
        this._showMessage('決済がキャンセルされました。');
        window.history.replaceState({}, '', window.location.pathname);
        break;
    }
  },

  /* ============================================
     ヘルパー
     ============================================ */

  _showMessage(message) {
    // 専用のメッセージエリアがあればそこに表示
    const msgArea = document.getElementById('stripe-message');
    if (msgArea) {
      msgArea.textContent = message;
      msgArea.style.display = 'block';
      setTimeout(() => { msgArea.style.display = 'none'; }, 5000);
    } else {
      alert(message);
    }
  },

  _showLoading(message) {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
      const text = overlay.querySelector('.loading-text');
      if (text) text.textContent = message || '処理中...';
      overlay.style.display = 'flex';
    }
  },

  _hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.style.display = 'none';
  },

  /**
   * HTMLエスケープ
   */
  _esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(String(str)));
    return div.innerHTML;
  },
};

/* ============================================
   ページロード時に決済結果をチェック
   ============================================ */
document.addEventListener('DOMContentLoaded', () => {
  StripePayment.handlePaymentResult();
});
