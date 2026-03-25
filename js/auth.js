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
  USAGE: '/api/auth/usage',
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
    monthlyLabels: 30,
    maxLanguages: 5,
    features: ['月30ラベル', '5言語まで', '全テンプレート', 'PDF一括出力'],
  },
  standard: {
    id: 'standard',
    name: 'スタンダードプラン',
    price: 500,
    monthlyLabels: 100,
    maxLanguages: 18,
    features: ['月100ラベル', '18言語対応', '全テンプレート', 'PDF一括出力', '優先サポート'],
  },
  pro: {
    id: 'pro',
    name: 'プロプラン',
    price: 2000,
    monthlyLabels: 9999,
    maxLanguages: 18,
    features: ['無制限ラベル', '18言語対応', 'API連携', '専任サポート', 'カスタムテンプレート'],
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
    console.log('[Auth] 初期化開始');

    // ローカルストレージからトークン復元
    this._restoreSession();

    // API接続テスト
    await this._checkAPIAvailability();

    // API利用不可 → モックモードでデモユーザーログイン
    if (!this._apiAvailable && !this.currentUser) {
      this.mockLogin();
    }

    // トークンが有効か検証
    if (this.token && this._apiAvailable) {
      await this._validateToken();
    }

    // UI更新
    this._updateUI();

    console.log('[Auth] 初期化完了', this.isLoggedIn() ? `(${this.currentUser.email})` : '(未ログイン)');
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

    // API利用不可 → モック
    if (!this._apiAvailable) {
      this.mockLogin(email);
      return { success: true, mock: true };
    }

    try {
      const res = await fetch(AUTH_API_ENDPOINTS.LOGIN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || 'ログインに失敗しました。');
      }

      const data = await res.json();

      this.token = data.token;
      this.currentUser = data.user;

      this._saveSession();
      this._updateUI();

      console.log('[Auth] ログイン成功:', email);
      return { success: true };
    } catch (err) {
      console.error('[Auth] ログインエラー:', err);

      // APIエラー → モックにフォールバック
      if (err.message.includes('fetch') || err.message.includes('NetworkError')) {
        this.mockLogin(email);
        return { success: true, mock: true };
      }

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

    // API利用不可 → モック
    if (!this._apiAvailable) {
      this.mockLogin(email, selectedPlan);
      return { success: true, mock: true };
    }

    try {
      const res = await fetch(AUTH_API_ENDPOINTS.REGISTER, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, plan: selectedPlan }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || '登録に失敗しました。');
      }

      const data = await res.json();

      this.token = data.token;
      this.currentUser = data.user;

      this._saveSession();
      this._updateUI();

      console.log('[Auth] 登録成功:', email, selectedPlan);
      return { success: true };
    } catch (err) {
      console.error('[Auth] 登録エラー:', err);

      if (err.message.includes('fetch') || err.message.includes('NetworkError')) {
        this.mockLogin(email, selectedPlan);
        return { success: true, mock: true };
      }

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
    console.log('[Auth] ログアウト完了');
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
    } catch (err) {
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
     モックモード
     ============================================ */

  /**
   * デモユーザーで自動ログイン
   * API未設定時に全機能を試用可能にする
   */
  mockLogin(email, plan) {
    this.currentUser = {
      id: 'demo_user_001',
      email: email || 'demo@labelun.jp',
      name: 'デモユーザー',
      plan: plan || 'standard',
      createdAt: new Date().toISOString(),
      isMock: true,
    };
    this.token = 'mock_token_' + Date.now();

    this._saveSession();
    this._updateUI();

    console.log('[Auth] モックログイン:', this.currentUser.email, `(${this.currentUser.plan}プラン)`);
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
        this.currentUser = data.user;
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
    console.log(`[Auth] API利用可能: ${this._apiAvailable}`);
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
        // モックモード表示
        if (this.currentUser.isMock) {
          userPlanEl.textContent += '（デモ）';
        }
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
};
