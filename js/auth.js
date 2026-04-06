/* ============================================
   ラベルン - 認証モジュール (auth.js)
   メール/パスワード認証 + プラン管理
   ============================================ */

/**
 * Workers API エンドポイント
 */
const AUTH_API_ENDPOINTS = {
  LOGIN: '/api/auth/login',
  REGISTER: '/api/auth/register',
  LOGOUT: '/api/auth/logout',
  ME: '/api/auth/me',
  USAGE: '/api/usage',
};

/**
 * プラン定義
 */
const PLANS = {
  free: {
    id: 'free',
    name: '無料プラン',
    price: 0,
    monthlyLabels: 3,
    maxLanguages: 1,
    features: ['月3ラベル', '1言語まで', '基本テンプレート'],
  },
  lite: {
    id: 'lite',
    name: 'ライトプラン',
    price: 300,
    monthlyLabels: 10,
    maxLanguages: 5,
    features: ['月10ラベル', '5言語まで', 'PDF出力（150dpi）', '法定表示自動生成'],
  },
  standard: {
    id: 'standard',
    name: 'スタンダードプラン',
    price: 500,
    monthlyLabels: 50,
    maxLanguages: 18,
    features: ['月50ラベル', '18言語対応', 'PDF出力（300dpi）', 'CSVインポート'],
  },
  pro: {
    id: 'pro',
    name: 'プロプラン',
    price: 2000,
    monthlyLabels: 9999,
    maxLanguages: 18,
    features: ['ラベル数無制限', '18言語対応', 'API連携', '優先サポート'],
    comingSoon: true,
  },
};

/**
 * ローカルストレージキー
 */
const AUTH_STORAGE_KEYS = {
  TOKEN: 'labelun_auth_token',
  USER: 'labelun_auth_user',
};

/**
 * 認証モジュール
 */
const Auth = {
  /* 現在のユーザー情報 */
  currentUser: null,

  /* JWT トークン */
  token: null,

  /* API利用可能フラグ */
  _apiAvailable: null,


  /* ============================================
     初期化
     ============================================ */

  async init() {
    // ローカルストレージからトークン復元
    this._restoreSession();

    // API接続テスト
    await this._checkAPIAvailability();

    // トークンが有効か検証
    if (this.token && this._apiAvailable) {
      await this._validateToken();
    }

    // UI更新
    this._updateUI();

  },

  /* ============================================
     ログイン / 登録 / ログアウト
     ============================================ */

  /**
   * メール+パスワードでログイン
   */
  async login(email, password) {
    if (!email || !password) {
      throw new Error('メールアドレスとパスワードを入力してください。');
    }

    try {
      const res = await fetch(AUTH_API_ENDPOINTS.LOGIN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const serverMsg = errorData.error || errorData.message || '';
        // ユーザーフレンドリーなエラーメッセージに変換
        throw new Error(this._friendlyLoginError(res.status, serverMsg));
      }

      const data = await res.json();

      this.token = data.token;
      this.currentUser = data.user;

      this._saveSession();
      this._updateUI();


      return { success: true };
    } catch (err) {
      // ネットワークエラーの場合はわかりやすいメッセージに
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error('サーバーに接続できません。インターネット接続を確認してください。');
      }
      console.error('[Auth] ログインエラー:', err);
      throw err;
    }
  },

  /**
   * 新規登録
   */
  async register(email, password, plan) {
    if (!email || !password) {
      throw new Error('メールアドレスとパスワードを入力してください。');
    }

    // メールアドレスの簡易バリデーション
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error('有効なメールアドレスを入力してください。');
    }

    // パスワードの最低要件
    if (password.length < 8) {
      throw new Error('パスワードは8文字以上にしてください。');
    }

    const selectedPlan = plan || 'free';

    try {
      const res = await fetch(AUTH_API_ENDPOINTS.REGISTER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, plan: selectedPlan }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const serverMsg = errorData.error || errorData.message || '';
        throw new Error(this._friendlyRegisterError(res.status, serverMsg));
      }

      const data = await res.json();

      this.token = data.token;
      this.currentUser = data.user;

      this._saveSession();
      this._updateUI();


      return { success: true };
    } catch (err) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error('サーバーに接続できません。インターネット接続を確認してください。');
      }
      console.error('[Auth] 登録エラー:', err);
      throw err;
    }
  },

  /**
   * ログアウト
   */
  logout() {
    // サーバー側にもログアウト通知（非同期・結果を待たない）
    if (this._apiAvailable && this.token) {
      fetch(AUTH_API_ENDPOINTS.LOGOUT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
      }).catch(() => { /* 無視 */ });
    }

    this.currentUser = null;
    this.token = null;

    localStorage.removeItem(AUTH_STORAGE_KEYS.TOKEN);
    localStorage.removeItem(AUTH_STORAGE_KEYS.USER);

    this._updateUI();

  },

  /* ============================================
     状態チェック
     ============================================ */

  /**
   * ログイン済みか
   */
  isLoggedIn() {
    return this.currentUser !== null;
  },

  /**
   * 現在のプランを取得
   * @returns {string} プランID ('free' | 'lite' | 'standard' | 'pro')
   */
  getPlan() {
    return this.currentUser?.plan || 'free';
  },

  /**
   * プラン詳細を取得
   */
  getPlanDetails() {
    return PLANS[this.getPlan()] || PLANS.free;
  },

  /**
   * 利用量チェック
   * 月間ラベル数が上限に達しているかチェック
   *
   * @returns {{ allowed: boolean, current: number, limit: number, remaining: number }}
   */
  checkUsageLimit() {
    const planDetails = this.getPlanDetails();
    const limit = planDetails.monthlyLabels;

    // ローカルストレージから今月の利用数を取得
    let current = 0;
    try {
      const raw = localStorage.getItem('labelun_usage');
      if (raw) {
        const usage = JSON.parse(raw);
        const now = new Date();
        const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        current = usage[monthKey] || 0;
      }
    } catch {
      current = 0;
    }

    return {
      allowed: current < limit,
      current,
      limit,
      remaining: Math.max(0, limit - current),
    };
  },

  /**
   * 言語選択数の制限チェック
   *
   * @param {number} selectedCount - 選択した言語数
   * @returns {{ allowed: boolean, max: number }}
   */
  checkLanguageLimit(selectedCount) {
    const planDetails = this.getPlanDetails();
    return {
      allowed: selectedCount <= planDetails.maxLanguages,
      max: planDetails.maxLanguages,
    };
  },

  /* ============================================
     セッション管理
     ============================================ */

  /**
   * セッションをローカルストレージに保存
   */
  _saveSession() {
    try {
      if (this.token) {
        localStorage.setItem(AUTH_STORAGE_KEYS.TOKEN, this.token);
      }
      if (this.currentUser) {
        localStorage.setItem(AUTH_STORAGE_KEYS.USER, JSON.stringify(this.currentUser));
      }
    } catch (err) {
      console.warn('[Auth] セッション保存失敗:', err);
    }
  },

  /**
   * セッションをローカルストレージから復元
   */
  _restoreSession() {
    try {
      this.token = localStorage.getItem(AUTH_STORAGE_KEYS.TOKEN) || null;
      const userRaw = localStorage.getItem(AUTH_STORAGE_KEYS.USER);
      this.currentUser = userRaw ? JSON.parse(userRaw) : null;
    } catch (err) {
      console.warn('[Auth] セッション復元失敗:', err);
      this.token = null;
      this.currentUser = null;
    }
  },

  /**
   * トークンの有効性をサーバーに確認
   */
  async _validateToken() {
    try {
      const res = await fetch(AUTH_API_ENDPOINTS.ME, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.token}`,
        },
      });

      if (res.ok) {
        const data = await res.json();
        // /api/auth/me は { id, email, plan, ... } を直接返す（userラッパーなし）
        this.currentUser = data.user || data;
        this._saveSession();
      } else {
        // トークン無効 → セッションクリア
        console.warn('[Auth] トークン無効、セッションクリア');
        this.logout();
      }
    } catch (err) {
      // ネットワークエラーはスキップ（オフラインでも使えるように）
      console.warn('[Auth] トークン検証スキップ:', err.message);
    }
  },

  /* ============================================
     API接続テスト
     ============================================ */

  async _checkAPIAvailability() {
    try {
      const res = await fetch(AUTH_API_ENDPOINTS.ME, {
        method: 'GET',
        headers: { 'X-Ping': 'true' },
      });
      // 401（未認証）でもサーバーは生きている
      this._apiAvailable = res.status !== 0;
    } catch (err) {
      this._apiAvailable = false;
    }

  },

  /* ============================================
     UI制御
     ============================================ */

  /**
   * ログイン状態に応じてUIを更新
   * ヘッダーの表示切り替え等
   */
  _updateUI() {
    // ログインフォーム / ユーザー情報の切り替え
    const loginSection = document.getElementById('auth-login-section');
    const userSection = document.getElementById('auth-user-section');
    const userNameEl = document.getElementById('auth-user-name');
    const userPlanEl = document.getElementById('auth-user-plan');

    if (this.isLoggedIn()) {
      if (loginSection) loginSection.style.display = 'none';
      if (userSection) userSection.style.display = 'flex';
      if (userNameEl) userNameEl.textContent = this.currentUser.name || this.currentUser.email;
      if (userPlanEl) {
        const planInfo = this.getPlanDetails();
        userPlanEl.textContent = planInfo.name;
      }
    } else {
      if (loginSection) loginSection.style.display = 'flex';
      if (userSection) userSection.style.display = 'none';
    }

    // ヘッダーのログイン/ログアウトボタン
    const loginBtn = document.getElementById('header-login-btn');
    const logoutBtn = document.getElementById('header-logout-btn');

    if (this.isLoggedIn()) {
      if (loginBtn) loginBtn.style.display = 'none';
      if (logoutBtn) logoutBtn.style.display = 'inline-flex';
    } else {
      if (loginBtn) loginBtn.style.display = 'inline-flex';
      if (logoutBtn) logoutBtn.style.display = 'none';
    }

    // 利用量表示（LabelunApp と連携）
    if (typeof LabelunApp !== 'undefined') {
      LabelunApp._renderUsageCount();
    }
  },

  /* ============================================
     ログインフォーム イベント
     ============================================ */

  /**
   * ログインフォームの送信ハンドラ
   * HTML側で onsubmit="Auth.handleLoginSubmit(event)" で呼ぶ
   */
  async handleLoginSubmit(e) {
    if (e) e.preventDefault();

    const email = document.getElementById('login-email')?.value;
    const password = document.getElementById('login-password')?.value;
    const errorEl = document.getElementById('login-error');

    if (errorEl) errorEl.style.display = 'none';

    try {
      await this.login(email, password);
      // 成功 → フォームを閉じる or ダッシュボードへ
      const modal = document.getElementById('login-modal');
      if (modal) modal.style.display = 'none';
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
      }
    }
  },

  /**
   * 登録フォームの送信ハンドラ
   */
  async handleRegisterSubmit(e) {
    if (e) e.preventDefault();

    const email = document.getElementById('register-email')?.value;
    const password = document.getElementById('register-password')?.value;
    const plan = document.getElementById('register-plan')?.value || 'free';
    const errorEl = document.getElementById('register-error');

    if (errorEl) errorEl.style.display = 'none';

    try {
      await this.register(email, password, plan);
      const modal = document.getElementById('register-modal');
      if (modal) modal.style.display = 'none';
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = err.message;
        errorEl.style.display = 'block';
      }
    }
  },

  /**
   * ログアウトボタンのハンドラ
   */
  handleLogout() {
    this.logout();
  },

  /* ============================================
     エラーメッセージ変換（ユーザーフレンドリー）
     ============================================ */

  /**
   * ログインエラーをユーザーフレンドリーなメッセージに変換
   */
  _friendlyLoginError(status, serverMsg) {
    if (status === 401 || serverMsg.includes('password') || serverMsg.includes('unauthorized')) {
      return 'メールアドレスまたはパスワードが正しくありません。入力内容をご確認ください。';
    }
    if (status === 404) {
      return 'このメールアドレスのアカウントが見つかりません。新規登録をお試しください。';
    }
    if (status === 429) {
      return 'ログイン試行回数が上限に達しました。しばらく時間をおいてからお試しください。';
    }
    if (status >= 500) {
      return 'サーバーで一時的な問題が発生しています。しばらくしてから再度お試しください。';
    }
    return serverMsg || 'ログインに失敗しました。入力内容を確認して再度お試しください。';
  },

  /**
   * 登録エラーをユーザーフレンドリーなメッセージに変換
   */
  _friendlyRegisterError(status, serverMsg) {
    if (status === 409 || serverMsg.includes('already') || serverMsg.includes('exists')) {
      return 'このメールアドレスは既に登録されています。ログインをお試しください。';
    }
    if (status === 400) {
      return '入力内容に問題があります。メールアドレスの形式やパスワードの長さをご確認ください。';
    }
    if (status === 429) {
      return '登録試行回数が上限に達しました。しばらく時間をおいてからお試しください。';
    }
    if (status >= 500) {
      return 'サーバーで一時的な問題が発生しています。しばらくしてから再度お試しください。';
    }
    return serverMsg || '登録に失敗しました。入力内容を確認して再度お試しください。';
  },
};

/* ============================================
   グローバルUXユーティリティ
   ============================================ */

/**
 * ボタンの二重送信防止 + ローディング + 成功フィードバック
 * @param {HTMLButtonElement} btn - 対象ボタン
 * @param {Function} asyncFn - 実行する非同期関数
 * @param {Object} options - { loadingText, successText }
 */
async function withButtonFeedback(btn, asyncFn, options = {}) {
  if (!btn || btn.disabled || btn.classList.contains('is-loading')) return;

  const originalText = btn.querySelector('.btn-label')?.textContent || btn.textContent;
  const loadingText = options.loadingText || '処理中...';
  const successText = options.successText || '完了';

  // ローディング状態に
  btn.disabled = true;
  btn.classList.add('is-loading');
  if (btn.querySelector('.btn-label')) {
    btn.querySelector('.btn-label').textContent = loadingText;
  }

  try {
    await asyncFn();

    // 成功フィードバック
    btn.classList.remove('is-loading');
    btn.classList.add('is-success');
    if (btn.querySelector('.btn-label')) {
      btn.querySelector('.btn-label').textContent = successText;
    }

    // 1.5秒後に元に戻す
    setTimeout(() => {
      btn.classList.remove('is-success');
      btn.disabled = false;
      if (btn.querySelector('.btn-label')) {
        btn.querySelector('.btn-label').textContent = originalText;
      }
    }, 1500);
  } catch (err) {
    // エラー時は即座に戻す
    btn.classList.remove('is-loading');
    btn.disabled = false;
    if (btn.querySelector('.btn-label')) {
      btn.querySelector('.btn-label').textContent = originalText;
    }
    throw err;
  }
}

/* オフライン検知・通知 */
(function() {
  function showOfflineBanner() {
    var banner = document.getElementById('offline-banner');
    if (banner) banner.classList.add('is-visible');
  }
  function hideOfflineBanner() {
    var banner = document.getElementById('offline-banner');
    if (banner) banner.classList.remove('is-visible');
  }
  window.addEventListener('offline', showOfflineBanner);
  window.addEventListener('online', hideOfflineBanner);
  // ページ読み込み時にもチェック
  if (!navigator.onLine) showOfflineBanner();
})();
