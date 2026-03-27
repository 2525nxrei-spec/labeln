/* ============================================
   ラベルン - メインアプリケーション (app.js)
   製品ラベル多言語化サブスク
   ============================================ */

/**
 * 対応18言語の定義
 * コード → 表示名 のマッピング
 */
const SUPPORTED_LANGUAGES = {
  ja: { name: '日本語', flag: '🇯🇵', dir: 'ltr' },
  en: { name: 'English', flag: '🇺🇸', dir: 'ltr' },
  'zh-CN': { name: '简体中文', flag: '🇨🇳', dir: 'ltr' },
  'zh-TW': { name: '繁體中文', flag: '🇹🇼', dir: 'ltr' },
  ko: { name: '한국어', flag: '🇰🇷', dir: 'ltr' },
  th: { name: 'ภาษาไทย', flag: '🇹🇭', dir: 'ltr' },
  vi: { name: 'Tiếng Việt', flag: '🇻🇳', dir: 'ltr' },
  id: { name: 'Bahasa Indonesia', flag: '🇮🇩', dir: 'ltr' },
  ms: { name: 'Bahasa Melayu', flag: '🇲🇾', dir: 'ltr' },
  fr: { name: 'Français', flag: '🇫🇷', dir: 'ltr' },
  de: { name: 'Deutsch', flag: '🇩🇪', dir: 'ltr' },
  es: { name: 'Español', flag: '🇪🇸', dir: 'ltr' },
  pt: { name: 'Português', flag: '🇧🇷', dir: 'ltr' },
  it: { name: 'Italiano', flag: '🇮🇹', dir: 'ltr' },
  ar: { name: 'العربية', flag: '🇸🇦', dir: 'rtl' },
  hi: { name: 'हिन्दी', flag: '🇮🇳', dir: 'ltr' },
  ru: { name: 'Русский', flag: '🇷🇺', dir: 'ltr' },
  nl: { name: 'Nederlands', flag: '🇳🇱', dir: 'ltr' },
};

/**
 * ラベルサイズプリセット
 * 一般的な製品ラベルサイズ (mm)
 */
const LABEL_SIZE_PRESETS = {
  small: { name: '小型（50×30mm）', width: 50, height: 30 },
  medium: { name: '中型（80×50mm）', width: 80, height: 50 },
  large: { name: '大型（100×70mm）', width: 100, height: 70 },
  wide: { name: 'ワイド（120×50mm）', width: 120, height: 50 },
  bottle: { name: 'ボトル用（90×120mm）', width: 90, height: 120 },
  box: { name: '箱用（100×100mm）', width: 100, height: 100 },
  custom: { name: 'カスタムサイズ', width: 0, height: 0 },
};

/**
 * アレルゲン一覧（日本の特定原材料等28品目ベース）
 */
const ALLERGEN_LIST = [
  // 特定原材料（表示義務）
  { id: 'egg', name: '卵', mandatory: true },
  { id: 'milk', name: '乳', mandatory: true },
  { id: 'wheat', name: '小麦', mandatory: true },
  { id: 'buckwheat', name: 'そば', mandatory: true },
  { id: 'peanut', name: '落花生', mandatory: true },
  { id: 'shrimp', name: 'えび', mandatory: true },
  { id: 'crab', name: 'かに', mandatory: true },
  { id: 'walnut', name: 'くるみ', mandatory: true },
  // 特定原材料に準ずるもの（表示推奨）
  { id: 'almond', name: 'アーモンド', mandatory: false },
  { id: 'abalone', name: 'あわび', mandatory: false },
  { id: 'squid', name: 'いか', mandatory: false },
  { id: 'salmon_roe', name: 'いくら', mandatory: false },
  { id: 'orange', name: 'オレンジ', mandatory: false },
  { id: 'cashew', name: 'カシューナッツ', mandatory: false },
  { id: 'kiwi', name: 'キウイフルーツ', mandatory: false },
  { id: 'beef', name: '牛肉', mandatory: false },
  { id: 'sesame', name: 'ごま', mandatory: false },
  { id: 'salmon', name: 'さけ', mandatory: false },
  { id: 'mackerel', name: 'さば', mandatory: false },
  { id: 'soybean', name: '大豆', mandatory: false },
  { id: 'chicken', name: '鶏肉', mandatory: false },
  { id: 'banana', name: 'バナナ', mandatory: false },
  { id: 'pork', name: '豚肉', mandatory: false },
  { id: 'matsutake', name: 'まつたけ', mandatory: false },
  { id: 'peach', name: 'もも', mandatory: false },
  { id: 'yam', name: 'やまいも', mandatory: false },
  { id: 'apple', name: 'りんご', mandatory: false },
  { id: 'gelatin', name: 'ゼラチン', mandatory: false },
];

/**
 * ローカルストレージキー定数
 */
const STORAGE_KEYS = {
  DRAFT: 'labelun_draft',
  HISTORY: 'labelun_history',
  USAGE: 'labelun_usage',
  SETTINGS: 'labelun_settings',
};

/**
 * メインアプリケーションオブジェクト
 */
const LabelunApp = {
  /* --- 状態管理 --- */
  currentStep: 1,
  maxSteps: 4,

  /* 製品データ（ステップ1で入力） */
  productData: {
    productName: '',
    productCategory: '',        // food / cosmetic / supplement
    ingredients: [],             // 成分リスト [{name, amount, unit}]
    allergens: [],               // 選択されたアレルゲンIDリスト
    nutritionFacts: [],          // 栄養成分 [{name, per100g, unit}]
    manufacturer: '',
    origin: '',
    weight: '',
    weightUnit: 'g',
    expiryFormat: '',            // YYYY/MM/DD 等
    storageInstructions: '',
    additionalInfo: '',
  },

  /* ラベル設定（ステップ2で設定） */
  labelSettings: {
    sizePreset: 'medium',
    width: 80,
    height: 50,
    logoBase64: null,
    logoFileName: '',
    backgroundColor: '#ffffff',
    textColor: '#000000',
    borderStyle: 'solid',
    fontSize: 'auto',            // auto で法定最小に合わせる
  },

  /* 翻訳関連（ステップ3） */
  selectedLanguages: [],
  translationResults: {},

  /* 成分辞書（dictionary.json） */
  ingredientDictionary: [],

  /* UI要素キャッシュ */
  _elements: {},

  /* 初期化済みフラグ */
  _initialized: false,

  /* ============================================
     初期化
     ============================================ */

  /**
   * アプリケーション初期化
   * DOMContentLoaded 後に呼ぶ
   */
  async init() {
    if (this._initialized) return;
    console.log('[LabelunApp] 初期化開始');

    try {
      // UIの要素をキャッシュ
      this._cacheElements();

      // 成分辞書をロード
      await this._loadIngredientDictionary();

      // ローカルストレージから下書き復元
      this._restoreDraft();

      // イベントリスナー設定
      this._setupEventListeners();

      // ステップ表示を初期化
      this._renderStep(this.currentStep);

      // ダッシュボードの履歴表示
      this._renderHistory();

      // 利用量表示
      this._renderUsageCount();

      // 翻訳エンジン初期化（translation.jsが読み込まれている場合）
      if (typeof TranslationEngine !== 'undefined') {
        await TranslationEngine.init();
      }

      // 法定表示エンジン初期化（legal-display.jsが読み込まれている場合）
      if (typeof LegalDisplayEngine !== 'undefined') {
        await LegalDisplayEngine.init();
      }

      // PDF生成エンジン初期化
      if (typeof PDFGenerator !== 'undefined') {
        await PDFGenerator.init();
      }

      this._initialized = true;
      console.log('[LabelunApp] 初期化完了');
    } catch (err) {
      console.error('[LabelunApp] 初期化エラー:', err);
      this._showError('アプリケーションの初期化に失敗しました。ページを再読み込みしてください。');
    }
  },

  /* ============================================
     ステップ管理
     ============================================ */

  /**
   * 次のステップへ進む
   * バリデーション後、問題なければ進む
   */
  nextStep() {
    if (this.currentStep >= this.maxSteps) return;

    const errors = this.validateStep(this.currentStep);
    if (errors.length > 0) {
      this._showValidationErrors(errors);
      return;
    }

    // 現在のステップのデータを収集
    this._collectStepData(this.currentStep);

    // 下書き保存
    this._saveDraft();

    this.currentStep++;
    this._renderStep(this.currentStep);
    this._updateStepIndicator();

    // ステップ3（翻訳）に入ったら翻訳を実行
    if (this.currentStep === 3) {
      this._onEnterTranslationStep();
    }

    // ステップ4（プレビュー）に入ったらプレビュー生成
    if (this.currentStep === 4) {
      this._onEnterPreviewStep();
    }

    // ページトップへスクロール
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  /**
   * 前のステップへ戻る
   */
  prevStep() {
    if (this.currentStep <= 1) return;

    this._collectStepData(this.currentStep);
    this._saveDraft();

    this.currentStep--;
    this._renderStep(this.currentStep);
    this._updateStepIndicator();

    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  /**
   * 特定ステップへジャンプ（完了済みステップのみ）
   */
  goToStep(step) {
    if (step < 1 || step > this.maxSteps) return;
    if (step > this.currentStep) return; // 未到達ステップには飛べない

    this._collectStepData(this.currentStep);
    this._saveDraft();

    this.currentStep = step;
    this._renderStep(this.currentStep);
    this._updateStepIndicator();
  },

  /**
   * ステップバリデーション
   * @param {number} step - バリデーション対象ステップ番号
   * @returns {string[]} エラーメッセージの配列（空なら問題なし）
   */
  validateStep(step) {
    const errors = [];

    switch (step) {
      case 1: // 製品情報入力
        if (!this.productData.productName.trim()) {
          errors.push('製品名を入力してください。');
        }
        if (!this.productData.productCategory) {
          errors.push('製品カテゴリを選択してください。');
        }
        if (this.productData.ingredients.length === 0) {
          errors.push('成分を1つ以上入力してください。');
        }
        if (!this.productData.manufacturer.trim()) {
          errors.push('製造者名を入力してください。');
        }
        break;

      case 2: // ラベル設定
        if (this.labelSettings.sizePreset === 'custom') {
          if (!this.labelSettings.width || this.labelSettings.width <= 0) {
            errors.push('ラベル幅を正しく入力してください。');
          }
          if (!this.labelSettings.height || this.labelSettings.height <= 0) {
            errors.push('ラベル高さを正しく入力してください。');
          }
        }
        break;

      case 3: // 言語選択
        if (this.selectedLanguages.length === 0) {
          errors.push('翻訳先言語を1つ以上選択してください。');
        }
        break;

      case 4: // プレビュー（特にバリデーション不要）
        break;
    }

    return errors;
  },

  /* ============================================
     データ収集
     ============================================ */

  /**
   * 各ステップのフォームデータを収集して内部状態に反映
   */
  _collectStepData(step) {
    switch (step) {
      case 1:
        this._collectProductData();
        break;
      case 2:
        this._collectLabelSettings();
        break;
      case 3:
        this._collectLanguageSelection();
        break;
    }
  },

  /**
   * ステップ1: 製品データ収集
   */
  _collectProductData() {
    const el = this._elements;

    this.productData.productName = this._val('product-name');
    this.productData.productCategory = this._val('product-category');
    this.productData.manufacturer = this._val('manufacturer');
    this.productData.origin = this._val('origin');
    this.productData.weight = this._val('product-weight');
    this.productData.weightUnit = this._val('weight-unit');
    this.productData.expiryFormat = this._val('expiry-format');
    this.productData.storageInstructions = this._val('storage-instructions');
    this.productData.additionalInfo = this._val('additional-info');

    // 成分リスト収集
    this.productData.ingredients = this._collectIngredientList();

    // アレルゲン収集
    this.productData.allergens = this._collectAllergenSelection();

    // 栄養成分収集
    this.productData.nutritionFacts = this._collectNutritionFacts();
  },

  /**
   * ステップ2: ラベル設定収集
   */
  _collectLabelSettings() {
    this.labelSettings.sizePreset = this._val('label-size-preset');
    this.labelSettings.backgroundColor = this._val('label-bg-color') || '#ffffff';
    this.labelSettings.textColor = this._val('label-text-color') || '#000000';
    this.labelSettings.borderStyle = this._val('label-border-style') || 'solid';
    this.labelSettings.fontSize = this._val('label-font-size') || 'auto';

    if (this.labelSettings.sizePreset === 'custom') {
      this.labelSettings.width = parseFloat(this._val('label-width')) || 80;
      this.labelSettings.height = parseFloat(this._val('label-height')) || 50;
    } else {
      const preset = LABEL_SIZE_PRESETS[this.labelSettings.sizePreset];
      if (preset) {
        this.labelSettings.width = preset.width;
        this.labelSettings.height = preset.height;
      }
    }
  },

  /**
   * ステップ3: 言語選択収集
   */
  _collectLanguageSelection() {
    const checkboxes = document.querySelectorAll('.language-checkbox:checked');
    this.selectedLanguages = Array.from(checkboxes).map(cb => cb.value);
  },

  /* ============================================
     成分入力 - 自動補完 & 動的追加/削除
     ============================================ */

  /**
   * 成分辞書をロード
   * dictionary.json が無い場合は空配列でフォールバック
   */
  async _loadIngredientDictionary() {
    try {
      const res = await fetch('./data/dictionary.json');
      if (res.ok) {
        const data = await res.json();
        this.ingredientDictionary = data.ingredients || data || [];
        console.log(`[LabelunApp] 成分辞書ロード完了: ${this.ingredientDictionary.length}件`);
      } else {
        throw new Error('辞書ファイルが見つかりません');
      }
    } catch (err) {
      console.warn('[LabelunApp] 辞書ファイル読み込みスキップ（モックモード）:', err.message);
      this.ingredientDictionary = [];
    }
  },

  /**
   * 成分入力行を追加
   */
  addIngredientRow() {
    const container = document.getElementById('ingredient-list');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'ingredient-row';
    row.innerHTML = `
      <div class="ingredient-row__fields">
        <input type="text" class="ingredient-name" placeholder="成分名" autocomplete="off" />
        <input type="number" class="ingredient-amount" placeholder="含有量" min="0" step="0.01" />
        <select class="ingredient-unit">
          <option value="g">g</option>
          <option value="mg">mg</option>
          <option value="ml">ml</option>
          <option value="%">%</option>
        </select>
        <button type="button" class="btn btn--sm btn--ghost ingredient-remove" title="削除">✕</button>
      </div>
      <div class="ingredient-autocomplete" style="display:none;"></div>
    `;

    container.appendChild(row);

    // 自動補完イベントを設定
    const nameInput = row.querySelector('.ingredient-name');
    this._setupAutocomplete(nameInput, row.querySelector('.ingredient-autocomplete'));

    // 削除ボタン
    row.querySelector('.ingredient-remove').addEventListener('click', () => {
      row.remove();
    });
  },

  /**
   * 成分入力の自動補完を設定
   * dictionary.json の成分名で候補を表示
   */
  _setupAutocomplete(inputEl, dropdownEl) {
    let debounceTimer = null;

    inputEl.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const query = inputEl.value.trim().toLowerCase();
        if (query.length < 1) {
          dropdownEl.style.display = 'none';
          return;
        }

        // 辞書から候補を検索（部分一致、最大10件）
        const matches = this.ingredientDictionary.filter(item => {
          const name = (item.ja || item.name || '').toLowerCase();
          return name.includes(query);
        }).slice(0, 10);

        if (matches.length === 0) {
          dropdownEl.style.display = 'none';
          return;
        }

        dropdownEl.innerHTML = matches.map(item => {
          const displayName = item.ja || item.name || '';
          return `<div class="autocomplete-item" data-name="${this._escapeHtml(displayName)}">${this._escapeHtml(displayName)}</div>`;
        }).join('');
        dropdownEl.style.display = 'block';

        // 候補クリック
        dropdownEl.querySelectorAll('.autocomplete-item').forEach(el => {
          el.addEventListener('click', () => {
            inputEl.value = el.dataset.name;
            dropdownEl.style.display = 'none';
          });
        });
      }, 200);
    });

    // フォーカス外れたら閉じる（少し遅延してクリックを拾う）
    inputEl.addEventListener('blur', () => {
      setTimeout(() => { dropdownEl.style.display = 'none'; }, 200);
    });
  },

  /**
   * 成分リストを収集
   */
  _collectIngredientList() {
    const rows = document.querySelectorAll('.ingredient-row');
    const list = [];
    rows.forEach(row => {
      const name = (row.querySelector('.ingredient-name') || {}).value || '';
      const amount = (row.querySelector('.ingredient-amount') || {}).value || '';
      const unit = (row.querySelector('.ingredient-unit') || {}).value || 'g';
      if (name.trim()) {
        list.push({ name: name.trim(), amount: parseFloat(amount) || 0, unit });
      }
    });
    return list;
  },

  /* ============================================
     アレルゲン チェックボックス制御
     ============================================ */

  /**
   * アレルゲンチェックボックスを生成
   */
  renderAllergenCheckboxes(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // 義務表示と推奨表示を分けて表示
    const mandatoryHtml = ALLERGEN_LIST
      .filter(a => a.mandatory)
      .map(a => this._allergenCheckboxHtml(a, true))
      .join('');

    const optionalHtml = ALLERGEN_LIST
      .filter(a => !a.mandatory)
      .map(a => this._allergenCheckboxHtml(a, false))
      .join('');

    container.innerHTML = `
      <div class="allergen-group">
        <h4 class="allergen-group__title">特定原材料（表示義務）</h4>
        <div class="allergen-grid">${mandatoryHtml}</div>
      </div>
      <div class="allergen-group">
        <h4 class="allergen-group__title">特定原材料に準ずるもの（表示推奨）</h4>
        <div class="allergen-grid">${optionalHtml}</div>
      </div>
    `;
  },

  _allergenCheckboxHtml(allergen, isMandatory) {
    const checked = this.productData.allergens.includes(allergen.id) ? 'checked' : '';
    const badge = isMandatory ? '<span class="badge badge--warning">義務</span>' : '';
    return `
      <label class="allergen-item">
        <input type="checkbox" class="allergen-checkbox" value="${allergen.id}" ${checked} />
        <span class="allergen-item__name">${this._escapeHtml(allergen.name)}</span>
        ${badge}
      </label>
    `;
  },

  /**
   * 選択中のアレルゲンIDを収集
   */
  _collectAllergenSelection() {
    const checkboxes = document.querySelectorAll('.allergen-checkbox:checked');
    return Array.from(checkboxes).map(cb => cb.value);
  },

  /* ============================================
     栄養成分 動的フォーム
     ============================================ */

  /**
   * 基本的な栄養成分の初期行を生成
   */
  initNutritionForm(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // デフォルト栄養項目
    const defaults = [
      { name: 'エネルギー', unit: 'kcal' },
      { name: 'たんぱく質', unit: 'g' },
      { name: '脂質', unit: 'g' },
      { name: '炭水化物', unit: 'g' },
      { name: '食塩相当量', unit: 'g' },
    ];

    container.innerHTML = '';
    defaults.forEach(item => {
      this._addNutritionRow(container, item.name, '', item.unit, false);
    });
  },

  /**
   * 栄養成分行を追加
   * @param {boolean} removable - 削除ボタンを表示するか
   */
  addNutritionRow() {
    const container = document.getElementById('nutrition-list');
    if (!container) return;
    this._addNutritionRow(container, '', '', 'g', true);
  },

  _addNutritionRow(container, name, value, unit, removable) {
    const row = document.createElement('div');
    row.className = 'nutrition-row';
    row.innerHTML = `
      <input type="text" class="nutrition-name" value="${this._escapeHtml(name)}" placeholder="栄養素名" />
      <input type="number" class="nutrition-value" value="${this._escapeHtml(String(value))}" placeholder="100gあたり" min="0" step="0.01" />
      <select class="nutrition-unit">
        <option value="kcal" ${unit === 'kcal' ? 'selected' : ''}>kcal</option>
        <option value="g" ${unit === 'g' ? 'selected' : ''}>g</option>
        <option value="mg" ${unit === 'mg' ? 'selected' : ''}>mg</option>
        <option value="μg" ${unit === 'μg' ? 'selected' : ''}>μg</option>
        <option value="%" ${unit === '%' ? 'selected' : ''}>%</option>
      </select>
      ${removable ? '<button type="button" class="btn btn--sm btn--ghost nutrition-remove" title="削除">✕</button>' : '<div style="width:32px;"></div>'}
    `;

    if (removable) {
      row.querySelector('.nutrition-remove').addEventListener('click', () => {
        row.remove();
      });
    }

    container.appendChild(row);
  },

  /**
   * 栄養成分データを収集
   */
  _collectNutritionFacts() {
    const rows = document.querySelectorAll('.nutrition-row');
    const list = [];
    rows.forEach(row => {
      const name = (row.querySelector('.nutrition-name') || {}).value || '';
      const value = (row.querySelector('.nutrition-value') || {}).value || '';
      const unit = (row.querySelector('.nutrition-unit') || {}).value || 'g';
      if (name.trim()) {
        list.push({ name: name.trim(), per100g: parseFloat(value) || 0, unit });
      }
    });
    return list;
  },

  /* ============================================
     ラベルサイズプリセット管理
     ============================================ */

  /**
   * サイズプリセット変更時
   */
  onSizePresetChange(presetKey) {
    const preset = LABEL_SIZE_PRESETS[presetKey];
    if (!preset) return;

    this.labelSettings.sizePreset = presetKey;

    const widthInput = document.getElementById('label-width');
    const heightInput = document.getElementById('label-height');

    if (presetKey === 'custom') {
      // カスタムの場合は入力を有効化
      if (widthInput) widthInput.disabled = false;
      if (heightInput) heightInput.disabled = false;
    } else {
      // プリセットの場合は値を設定して無効化
      if (widthInput) { widthInput.value = preset.width; widthInput.disabled = true; }
      if (heightInput) { heightInput.value = preset.height; heightInput.disabled = true; }
      this.labelSettings.width = preset.width;
      this.labelSettings.height = preset.height;
    }
  },

  /* ============================================
     ロゴ画像アップロード
     ============================================ */

  /**
   * ロゴファイル選択ハンドラ
   */
  handleLogoUpload(fileInput) {
    const file = fileInput.files[0];
    if (!file) return;

    // ファイルサイズチェック（2MB上限）
    if (file.size > 2 * 1024 * 1024) {
      this._showError('ロゴ画像は2MB以下にしてください。');
      fileInput.value = '';
      return;
    }

    // 画像形式チェック
    if (!file.type.startsWith('image/')) {
      this._showError('画像ファイルを選択してください。');
      fileInput.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      this.labelSettings.logoBase64 = e.target.result;
      this.labelSettings.logoFileName = file.name;

      // プレビュー表示
      const preview = document.getElementById('logo-preview');
      if (preview) {
        preview.innerHTML = `<img src="${e.target.result}" alt="ロゴプレビュー" style="max-width:120px;max-height:60px;" />
          <span class="logo-filename">${this._escapeHtml(file.name)}</span>
          <button type="button" class="btn btn--sm btn--ghost" onclick="LabelunApp.removeLogo()">削除</button>`;
      }
      console.log('[LabelunApp] ロゴアップロード完了');
    };
    reader.onerror = () => {
      this._showError('画像の読み込みに失敗しました。');
    };
    reader.readAsDataURL(file);
  },

  /**
   * ロゴを削除
   */
  removeLogo() {
    this.labelSettings.logoBase64 = null;
    this.labelSettings.logoFileName = '';
    const preview = document.getElementById('logo-preview');
    if (preview) preview.innerHTML = '';
    const fileInput = document.getElementById('logo-upload');
    if (fileInput) fileInput.value = '';
  },

  /* ============================================
     翻訳トリガー（ステップ3）
     ============================================ */

  /**
   * ステップ3に入った時の処理
   */
  async _onEnterTranslationStep() {
    if (typeof TranslationEngine === 'undefined') {
      console.warn('[LabelunApp] TranslationEngine未読み込み');
      return;
    }

    // 選択言語がなければ待機
    if (this.selectedLanguages.length === 0) return;

    await this.triggerTranslation();
  },

  /**
   * 翻訳を実行
   */
  async triggerTranslation() {
    if (typeof TranslationEngine === 'undefined') {
      console.warn('[LabelunApp] TranslationEngine未読み込み、スキップ');
      return;
    }

    const statusEl = document.getElementById('translation-status');
    if (statusEl) statusEl.textContent = '翻訳中...';

    try {
      // 翻訳対象テキストを構築
      const textsToTranslate = this._buildTranslationPayload();

      // 各言語ごとに翻訳
      const totalLangs = this.selectedLanguages.length;
      let completed = 0;

      for (const lang of this.selectedLanguages) {
        if (statusEl) {
          statusEl.textContent = `翻訳中... (${completed + 1}/${totalLangs}) - ${SUPPORTED_LANGUAGES[lang]?.name || lang}`;
        }

        try {
          const result = await TranslationEngine.translate(
            textsToTranslate,
            [lang],
            'label'
          );
          this.translationResults[lang] = result[lang] || result;
        } catch (langErr) {
          console.error(`[LabelunApp] ${lang} 翻訳エラー:`, langErr);
          // エラーでもモック結果で続行
          this.translationResults[lang] = TranslationEngine.getMockTranslation
            ? TranslationEngine.getMockTranslation(textsToTranslate, lang)
            : { error: true };
        }

        completed++;
      }

      if (statusEl) statusEl.textContent = '翻訳完了';
      console.log('[LabelunApp] 翻訳完了:', Object.keys(this.translationResults));
    } catch (err) {
      console.error('[LabelunApp] 翻訳処理エラー:', err);
      if (statusEl) statusEl.textContent = '翻訳でエラーが発生しましたが、モックデータで続行できます。';
    }
  },

  /**
   * 翻訳対象のペイロードを構築
   */
  _buildTranslationPayload() {
    return {
      productName: this.productData.productName,
      ingredients: this.productData.ingredients.map(i => i.name),
      allergens: this.productData.allergens.map(id => {
        const a = ALLERGEN_LIST.find(al => al.id === id);
        return a ? a.name : id;
      }),
      manufacturer: this.productData.manufacturer,
      origin: this.productData.origin,
      storageInstructions: this.productData.storageInstructions,
      additionalInfo: this.productData.additionalInfo,
      nutritionNames: this.productData.nutritionFacts.map(n => n.name),
    };
  },

  /* ============================================
     プレビュー レンダリング（ステップ4）
     ============================================ */

  /**
   * ステップ4に入った時の処理
   */
  async _onEnterPreviewStep() {
    this.renderAllPreviews();
  },

  /**
   * 全言語のラベルプレビューを描画
   */
  renderAllPreviews() {
    const container = document.getElementById('preview-container');
    if (!container) return;

    container.innerHTML = '';

    // 翻訳済みの各言語でプレビューを生成
    for (const lang of this.selectedLanguages) {
      const previewWrapper = document.createElement('div');
      previewWrapper.className = 'label-preview-wrapper';

      const langInfo = SUPPORTED_LANGUAGES[lang] || { name: lang, flag: '' };
      previewWrapper.innerHTML = `
        <div class="label-preview-header">
          <span class="label-preview-header__flag">${langInfo.flag}</span>
          <span class="label-preview-header__name">${this._escapeHtml(langInfo.name)}</span>
          <button type="button" class="btn btn--sm btn--outline" onclick="LabelunApp.downloadSinglePDF('${lang}')">PDF</button>
        </div>
        <div class="label-preview-canvas" id="preview-${lang}"></div>
      `;
      container.appendChild(previewWrapper);

      // 法定表示エンジンで描画
      this._renderSinglePreview(lang, `preview-${lang}`);
    }
  },

  /**
   * 1言語分のプレビューを描画
   */
  _renderSinglePreview(lang, elementId) {
    const el = document.getElementById(elementId);
    if (!el) return;

    // 法定表示エンジンが使える場合
    if (typeof LegalDisplayEngine !== 'undefined' && LegalDisplayEngine.rules) {
      try {
        const result = LegalDisplayEngine.generateLabel(
          {
            product: this.productData,
            translation: this.translationResults[lang] || {},
            settings: this.labelSettings,
          },
          this._langToCountry(lang),
          lang
        );

        el.innerHTML = result.html || '<p>プレビュー生成中...</p>';

        // 警告があれば表示
        if (result.warnings && result.warnings.length > 0) {
          const warningHtml = result.warnings.map(w =>
            `<div class="label-warning">${this._escapeHtml(w)}</div>`
          ).join('');
          el.insertAdjacentHTML('afterend', `<div class="label-warnings">${warningHtml}</div>`);
        }
        return;
      } catch (err) {
        console.warn(`[LabelunApp] ${lang} 法定表示生成エラー:`, err);
      }
    }

    // フォールバック: 簡易プレビュー
    el.innerHTML = this._buildFallbackPreview(lang);
  },

  /**
   * 法定表示エンジンが無い場合のフォールバックプレビュー
   */
  _buildFallbackPreview(lang) {
    const t = this.translationResults[lang] || {};
    const p = this.productData;
    const langInfo = SUPPORTED_LANGUAGES[lang] || {};
    const dir = langInfo.dir || 'ltr';

    return `
      <div class="label-preview" style="
        width:${Math.max(this.labelSettings.width * 3.78, 300)}px;
        min-height:${this.labelSettings.height * 3.78}px;
        max-width:100%;
        overflow-x:auto;
        background:${this.labelSettings.backgroundColor};
        color:${this.labelSettings.textColor};
        border:1px ${this.labelSettings.borderStyle} #333;
        padding:12px;
        font-size:11px;
        direction:${dir};
      ">
        ${this.labelSettings.logoBase64 ? `<img src="${this.labelSettings.logoBase64}" alt="logo" style="max-width:60px;max-height:30px;margin-bottom:4px;" />` : ''}
        <div style="font-weight:bold;font-size:13px;margin-bottom:4px;">
          ${this._escapeHtml(t.productName || p.productName)}
        </div>
        <div style="margin-bottom:4px;">
          <strong>${lang === 'ja' ? '原材料名' : 'Ingredients'}:</strong>
          ${this._escapeHtml((t.ingredients || p.ingredients.map(i => i.name)).join(', '))}
        </div>
        ${p.allergens.length > 0 ? `<div style="margin-bottom:4px;">
          <strong>${lang === 'ja' ? 'アレルゲン' : 'Allergens'}:</strong>
          ${this._escapeHtml((t.allergens || p.allergens.map(id => { const a = ALLERGEN_LIST.find(al => al.id === id); return a ? a.name : id; })).join(', '))}
        </div>` : ''}
        <div style="margin-bottom:4px;">
          <strong>${lang === 'ja' ? '製造者' : 'Manufacturer'}:</strong>
          ${this._escapeHtml(t.manufacturer || p.manufacturer)}
        </div>
        ${p.origin ? `<div><strong>${lang === 'ja' ? '原産国' : 'Origin'}:</strong> ${this._escapeHtml(t.origin || p.origin)}</div>` : ''}
        ${p.weight ? `<div>${this._escapeHtml(p.weight)}${this._escapeHtml(p.weightUnit)}</div>` : ''}
      </div>
    `;
  },

  /**
   * 言語コード → 国コードのマッピング（法定表示用）
   */
  _langToCountry(lang) {
    const map = {
      ja: 'JP', en: 'US', 'zh-CN': 'CN', 'zh-TW': 'TW',
      ko: 'KR', th: 'TH', vi: 'VN', id: 'ID', ms: 'MY',
      fr: 'FR', de: 'DE', es: 'ES', pt: 'BR', it: 'IT',
      ar: 'SA', hi: 'IN', ru: 'RU', nl: 'NL',
    };
    return map[lang] || 'JP';
  },

  /* ============================================
     PDF出力トリガー
     ============================================ */

  /**
   * 1言語のPDFをダウンロード
   */
  async downloadSinglePDF(lang) {
    if (typeof PDFGenerator === 'undefined') {
      this._showError('PDF生成モジュールが読み込まれていません。');
      return;
    }

    try {
      this._showLoading('PDF生成中...');

      const labelData = {
        product: this.productData,
        translation: this.translationResults[lang] || {},
        settings: this.labelSettings,
        lang: lang,
        country: this._langToCountry(lang),
      };

      await PDFGenerator.generatePDF(labelData, this.labelSettings);

      this._hideLoading();
      this._incrementUsageCount();
      console.log(`[LabelunApp] PDF生成完了: ${lang}`);
    } catch (err) {
      console.error('[LabelunApp] PDF生成エラー:', err);
      this._hideLoading();
      this._showError('PDFの生成に失敗しました。もう一度お試しください。');
    }
  },

  /**
   * 全言語一括PDF（まとめて or ZIP）
   */
  async downloadAllPDF(mode) {
    if (typeof PDFGenerator === 'undefined') {
      this._showError('PDF生成モジュールが読み込まれていません。');
      return;
    }

    try {
      this._showLoading('全言語PDF生成中...');

      const allLabels = this.selectedLanguages.map(lang => ({
        product: this.productData,
        translation: this.translationResults[lang] || {},
        settings: this.labelSettings,
        lang: lang,
        country: this._langToCountry(lang),
      }));

      if (mode === 'combined') {
        await PDFGenerator.generateBulkPDF(allLabels, this.labelSettings);
      } else {
        // 個別ダウンロード
        for (const labelData of allLabels) {
          await PDFGenerator.generatePDF(labelData, this.labelSettings);
        }
      }

      this._hideLoading();
      this._incrementUsageCount();
      console.log('[LabelunApp] 全言語PDF生成完了');
    } catch (err) {
      console.error('[LabelunApp] 一括PDF生成エラー:', err);
      this._hideLoading();
      this._showError('PDF一括生成に失敗しました。');
    }
  },

  /* ============================================
     ローカルストレージ - 下書き保存 / 復元
     ============================================ */

  /**
   * 作業データを下書き保存
   */
  _saveDraft() {
    try {
      const draft = {
        currentStep: this.currentStep,
        productData: this.productData,
        labelSettings: {
          ...this.labelSettings,
          logoBase64: this.labelSettings.logoBase64 ? '(saved)' : null, // base64はサイズが大きいので別キーで保存
        },
        selectedLanguages: this.selectedLanguages,
        savedAt: new Date().toISOString(),
      };
      localStorage.setItem(STORAGE_KEYS.DRAFT, JSON.stringify(draft));

      // ロゴは別途保存（サイズ制限に注意）
      if (this.labelSettings.logoBase64 && this.labelSettings.logoBase64 !== '(saved)') {
        try {
          localStorage.setItem(STORAGE_KEYS.DRAFT + '_logo', this.labelSettings.logoBase64);
        } catch (logoErr) {
          console.warn('[LabelunApp] ロゴ保存スキップ（サイズ超過）');
        }
      }

      console.log('[LabelunApp] 下書き保存完了');
    } catch (err) {
      console.warn('[LabelunApp] 下書き保存失敗:', err);
    }
  },

  /**
   * 下書きを復元
   */
  _restoreDraft() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.DRAFT);
      if (!raw) return;

      const draft = JSON.parse(raw);
      if (!draft) return;

      // データ復元
      this.productData = { ...this.productData, ...draft.productData };
      if (draft.labelSettings) {
        this.labelSettings = { ...this.labelSettings, ...draft.labelSettings };
      }
      this.selectedLanguages = draft.selectedLanguages || [];

      // ロゴ復元
      const logo = localStorage.getItem(STORAGE_KEYS.DRAFT + '_logo');
      if (logo) {
        this.labelSettings.logoBase64 = logo;
      }

      console.log('[LabelunApp] 下書き復元完了 (ステップ:', draft.currentStep, ')');
    } catch (err) {
      console.warn('[LabelunApp] 下書き復元失敗:', err);
    }
  },

  /**
   * 下書きをクリア
   */
  clearDraft() {
    localStorage.removeItem(STORAGE_KEYS.DRAFT);
    localStorage.removeItem(STORAGE_KEYS.DRAFT + '_logo');
    console.log('[LabelunApp] 下書きクリア');
  },

  /* ============================================
     ダッシュボード: 履歴管理
     ============================================ */

  /**
   * ラベル作成完了時に履歴へ追加
   */
  _addToHistory(labelInfo) {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.HISTORY);
      const history = raw ? JSON.parse(raw) : [];

      history.unshift({
        id: Date.now(),
        productName: labelInfo.productName,
        languages: labelInfo.languages,
        createdAt: new Date().toISOString(),
        category: labelInfo.category,
      });

      // 最新100件のみ保持
      if (history.length > 100) history.length = 100;

      localStorage.setItem(STORAGE_KEYS.HISTORY, JSON.stringify(history));
    } catch (err) {
      console.warn('[LabelunApp] 履歴保存失敗:', err);
    }
  },

  /**
   * 履歴一覧を描画
   */
  _renderHistory() {
    const container = document.getElementById('history-list');
    if (!container) return;

    try {
      const raw = localStorage.getItem(STORAGE_KEYS.HISTORY);
      const history = raw ? JSON.parse(raw) : [];

      if (history.length === 0) {
        container.innerHTML = '<p class="text-muted">まだ作成したラベルはありません。</p>';
        return;
      }

      container.innerHTML = history.slice(0, 20).map(item => {
        const date = new Date(item.createdAt).toLocaleDateString('ja-JP');
        const langs = (item.languages || []).map(l =>
          (SUPPORTED_LANGUAGES[l] || {}).flag || l
        ).join(' ');
        return `
          <div class="history-item">
            <div class="history-item__name">${this._escapeHtml(item.productName)}</div>
            <div class="history-item__langs">${langs}</div>
            <div class="history-item__date">${date}</div>
          </div>
        `;
      }).join('');
    } catch (err) {
      console.warn('[LabelunApp] 履歴表示エラー:', err);
    }
  },

  /* ============================================
     利用量カウント（月間ラベル数）
     ============================================ */

  /**
   * 今月のラベル作成数を取得
   */
  _getMonthlyUsageCount() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.USAGE);
      if (!raw) return 0;
      const usage = JSON.parse(raw);

      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      return usage[currentMonth] || 0;
    } catch (err) {
      return 0;
    }
  },

  /**
   * 利用量をインクリメント
   */
  _incrementUsageCount() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.USAGE);
      const usage = raw ? JSON.parse(raw) : {};

      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      usage[currentMonth] = (usage[currentMonth] || 0) + 1;

      localStorage.setItem(STORAGE_KEYS.USAGE, JSON.stringify(usage));
      this._renderUsageCount();

      // 履歴にも追加
      this._addToHistory({
        productName: this.productData.productName,
        languages: this.selectedLanguages,
        category: this.productData.productCategory,
      });
    } catch (err) {
      console.warn('[LabelunApp] 利用量カウント更新失敗:', err);
    }
  },

  /**
   * 利用量を画面に表示
   */
  _renderUsageCount() {
    const el = document.getElementById('usage-count');
    if (!el) return;

    const count = this._getMonthlyUsageCount();

    // プランに応じた上限を取得
    let limit = 3; // 無料プラン
    if (typeof Auth !== 'undefined' && Auth.isLoggedIn()) {
      const plan = Auth.getPlan();
      const planLimits = { free: 3, lite: 10, standard: 50, pro: 9999 };
      limit = planLimits[plan] || 3;
    }

    el.textContent = `今月の利用: ${count} / ${limit} ラベル`;

    // 上限に近づいたら警告色
    if (count >= limit) {
      el.classList.add('usage-count--exceeded');
    } else if (count >= limit * 0.8) {
      el.classList.add('usage-count--warning');
    }
  },

  /* ============================================
     UI ヘルパー
     ============================================ */

  /**
   * DOM要素をキャッシュ
   */
  _cacheElements() {
    // 要素が存在しない場合もエラーにしない
    this._elements = {};
  },

  /**
   * input/selectの値を取得（要素が無ければ空文字）
   */
  _val(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
  },

  /**
   * ステップ表示を切り替え
   */
  _renderStep(step) {
    // 全ステップを非表示
    for (let i = 1; i <= this.maxSteps; i++) {
      const panel = document.getElementById(`step-${i}`);
      if (panel) {
        panel.style.display = (i === step) ? 'block' : 'none';
        panel.classList.toggle('is-active', i === step);
      }
    }

    // ステップ固有の初期化処理
    switch (step) {
      case 1:
        this._populateStep1Form();
        break;
      case 2:
        this._populateStep2Form();
        break;
      case 3:
        this._populateStep3Form();
        break;
    }
  },

  /**
   * ステップ1のフォームにデータを埋める
   */
  _populateStep1Form() {
    this._setVal('product-name', this.productData.productName);
    this._setVal('product-category', this.productData.productCategory);
    this._setVal('manufacturer', this.productData.manufacturer);
    this._setVal('origin', this.productData.origin);
    this._setVal('product-weight', this.productData.weight);
    this._setVal('weight-unit', this.productData.weightUnit);
    this._setVal('expiry-format', this.productData.expiryFormat);
    this._setVal('storage-instructions', this.productData.storageInstructions);
    this._setVal('additional-info', this.productData.additionalInfo);

    // 成分リスト復元
    const ingredientContainer = document.getElementById('ingredient-list');
    if (ingredientContainer && this.productData.ingredients.length > 0) {
      ingredientContainer.innerHTML = '';
      this.productData.ingredients.forEach(item => {
        this.addIngredientRow();
        const rows = ingredientContainer.querySelectorAll('.ingredient-row');
        const lastRow = rows[rows.length - 1];
        if (lastRow) {
          const nameInput = lastRow.querySelector('.ingredient-name');
          const amountInput = lastRow.querySelector('.ingredient-amount');
          const unitSelect = lastRow.querySelector('.ingredient-unit');
          if (nameInput) nameInput.value = item.name;
          if (amountInput) amountInput.value = item.amount || '';
          if (unitSelect) unitSelect.value = item.unit || 'g';
        }
      });
    }

    // アレルゲンチェックボックス
    this.renderAllergenCheckboxes('allergen-container');

    // 栄養成分フォーム
    if (this.productData.nutritionFacts.length > 0) {
      const nutritionContainer = document.getElementById('nutrition-list');
      if (nutritionContainer) {
        nutritionContainer.innerHTML = '';
        this.productData.nutritionFacts.forEach(item => {
          this._addNutritionRow(nutritionContainer, item.name, item.per100g, item.unit, true);
        });
      }
    } else {
      this.initNutritionForm('nutrition-list');
    }
  },

  /**
   * ステップ2のフォームにデータを埋める
   */
  _populateStep2Form() {
    this._setVal('label-size-preset', this.labelSettings.sizePreset);
    this._setVal('label-width', this.labelSettings.width);
    this._setVal('label-height', this.labelSettings.height);
    this._setVal('label-bg-color', this.labelSettings.backgroundColor);
    this._setVal('label-text-color', this.labelSettings.textColor);
    this._setVal('label-border-style', this.labelSettings.borderStyle);
    this._setVal('label-font-size', this.labelSettings.fontSize);

    // サイズプリセットに応じた入力制御
    this.onSizePresetChange(this.labelSettings.sizePreset);

    // ロゴプレビュー復元
    if (this.labelSettings.logoBase64) {
      const preview = document.getElementById('logo-preview');
      if (preview) {
        preview.innerHTML = `<img src="${this.labelSettings.logoBase64}" alt="ロゴ" style="max-width:120px;max-height:60px;" />
          <span class="logo-filename">${this._escapeHtml(this.labelSettings.logoFileName)}</span>
          <button type="button" class="btn btn--sm btn--ghost" onclick="LabelunApp.removeLogo()">削除</button>`;
      }
    }
  },

  /**
   * ステップ3のフォームにデータを埋める
   */
  _populateStep3Form() {
    // 言語チェックボックスの状態を復元
    document.querySelectorAll('.language-checkbox').forEach(cb => {
      cb.checked = this.selectedLanguages.includes(cb.value);
    });
  },

  /**
   * input/selectに値をセット
   */
  _setVal(id, value) {
    const el = document.getElementById(id);
    if (el && value !== undefined && value !== null) {
      el.value = value;
    }
  },

  /**
   * ステップインジケータの表示を更新
   */
  _updateStepIndicator() {
    for (let i = 1; i <= this.maxSteps; i++) {
      const indicator = document.querySelector(`.step-indicator[data-step="${i}"]`);
      if (!indicator) continue;

      indicator.classList.remove('is-active', 'is-completed');

      if (i === this.currentStep) {
        indicator.classList.add('is-active');
      } else if (i < this.currentStep) {
        indicator.classList.add('is-completed');
      }
    }
  },

  /**
   * イベントリスナーを設定
   */
  _setupEventListeners() {
    // 次へ/戻るボタン
    document.querySelectorAll('[data-action="next-step"]').forEach(btn => {
      btn.addEventListener('click', () => this.nextStep());
    });
    document.querySelectorAll('[data-action="prev-step"]').forEach(btn => {
      btn.addEventListener('click', () => this.prevStep());
    });

    // ステップインジケータクリック
    document.querySelectorAll('.step-indicator').forEach(el => {
      el.addEventListener('click', () => {
        const step = parseInt(el.dataset.step, 10);
        if (step) this.goToStep(step);
      });
    });

    // 成分追加ボタン
    const addIngredientBtn = document.getElementById('add-ingredient');
    if (addIngredientBtn) {
      addIngredientBtn.addEventListener('click', () => this.addIngredientRow());
    }

    // 栄養成分追加ボタン
    const addNutritionBtn = document.getElementById('add-nutrition');
    if (addNutritionBtn) {
      addNutritionBtn.addEventListener('click', () => this.addNutritionRow());
    }

    // ラベルサイズプリセット変更
    const presetSelect = document.getElementById('label-size-preset');
    if (presetSelect) {
      presetSelect.addEventListener('change', (e) => this.onSizePresetChange(e.target.value));
    }

    // ロゴアップロード
    const logoInput = document.getElementById('logo-upload');
    if (logoInput) {
      logoInput.addEventListener('change', () => this.handleLogoUpload(logoInput));
    }

    // 言語チェックボックス変更で翻訳トリガー
    document.querySelectorAll('.language-checkbox').forEach(cb => {
      cb.addEventListener('change', () => {
        this._collectLanguageSelection();
      });
    });

    // 翻訳ボタン（手動翻訳トリガー）
    const translateBtn = document.getElementById('translate-btn');
    if (translateBtn) {
      translateBtn.addEventListener('click', () => this.triggerTranslation());
    }

    // PDF一括ダウンロード
    const downloadAllBtn = document.getElementById('download-all-pdf');
    if (downloadAllBtn) {
      downloadAllBtn.addEventListener('click', () => this.downloadAllPDF('combined'));
    }

    // 新規作成ボタン（リセット）
    const newLabelBtn = document.getElementById('new-label');
    if (newLabelBtn) {
      newLabelBtn.addEventListener('click', () => this.resetAll());
    }

    // ページ離脱時に下書き保存
    window.addEventListener('beforeunload', () => {
      this._collectStepData(this.currentStep);
      this._saveDraft();
    });
  },

  /**
   * 全データをリセットして最初から
   */
  resetAll() {
    this.currentStep = 1;
    this.productData = {
      productName: '', productCategory: '', ingredients: [],
      allergens: [], nutritionFacts: [], manufacturer: '',
      origin: '', weight: '', weightUnit: 'g',
      expiryFormat: '', storageInstructions: '', additionalInfo: '',
    };
    this.labelSettings = {
      sizePreset: 'medium', width: 80, height: 50,
      logoBase64: null, logoFileName: '',
      backgroundColor: '#ffffff', textColor: '#000000',
      borderStyle: 'solid', fontSize: 'auto',
    };
    this.selectedLanguages = [];
    this.translationResults = {};

    this.clearDraft();
    this._renderStep(1);
    this._updateStepIndicator();
  },

  /* ============================================
     エラー / ローディング表示
     ============================================ */

  _showValidationErrors(errors) {
    const msg = errors.join('\n');
    // 専用エラー表示エリアがあればそこに出す
    const errorArea = document.getElementById('validation-errors');
    if (errorArea) {
      errorArea.innerHTML = errors.map(e =>
        `<div class="validation-error">${this._escapeHtml(e)}</div>`
      ).join('');
      errorArea.style.display = 'block';
      // 3秒後に非表示
      setTimeout(() => { errorArea.style.display = 'none'; }, 5000);
    } else {
      alert(msg);
    }
  },

  _showError(message) {
    const errorArea = document.getElementById('global-error');
    if (errorArea) {
      errorArea.textContent = message;
      errorArea.style.display = 'block';
      setTimeout(() => { errorArea.style.display = 'none'; }, 5000);
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

  /* ============================================
     ユーティリティ
     ============================================ */

  /**
   * HTMLエスケープ
   */
  _escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(String(str)));
    return div.innerHTML;
  },
};

/* ============================================
   DOM準備完了後に初期化
   ============================================ */
document.addEventListener('DOMContentLoaded', () => {
  LabelunApp.init();
});
