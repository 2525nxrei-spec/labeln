/* ============================================
   ラベルン - 法定表示処理エンジン (legal-display.js)
   各国の食品表示規制に準拠したラベル生成
   ============================================ */

/**
 * 法定表示処理エンジン
 *
 * - legal-rules.json を読み込み、国ごとの法定表示ルールを適用
 * - nutrition-formats.json で栄養成分表の国別フォーマットを取得
 * - アレルゲン表示（国ごとの形式差異に対応）
 * - 栄養成分表（国ごとの必須項目・表示順序・単位）
 * - フォントサイズ最小値チェック
 * - 必須表示項目の欠落チェック
 */
const LegalDisplayEngine = {
  /* legal-rules.json のデータ */
  rules: null,

  /* nutrition-formats.json のデータ */
  nutritionFormats: null,

  /* フォールバック用アレルゲン辞書（TranslationEngine経由でも可） */
  allergenDB: null,

  /* ============================================
     初期化
     ============================================ */

  async init() {

    await Promise.all([
      this._loadRules(),
      this._loadNutritionFormats(),
    ]);

  },

  /**
   * legal-rules.json を読み込み
   */
  async _loadRules() {
    try {
      const res = await fetch('./data/legal-rules.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.rules = await res.json();

    } catch (err) {
      console.warn('[LegalDisplayEngine] legal-rules.json 読み込みスキップ:', err.message);
      this.rules = this._getFallbackRules();
    }
  },

  /**
   * nutrition-formats.json を読み込み
   */
  async _loadNutritionFormats() {
    try {
      const res = await fetch('./data/nutrition-formats.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.nutritionFormats = await res.json();

    } catch (err) {
      console.warn('[LegalDisplayEngine] nutrition-formats.json 読み込みスキップ:', err.message);
      this.nutritionFormats = this._getFallbackNutritionFormats();
    }
  },

  /* ============================================
     フォールバックデータ
     ============================================ */

  /**
   * legal-rules.json が無い場合のフォールバック
   * 主要国の基本ルールを内蔵
   */
  _getFallbackRules() {
    return {
      JP: {
        name: '日本',
        requiredFields: ['productName', 'ingredients', 'allergens', 'manufacturer', 'origin', 'weight', 'expiry', 'storage', 'nutrition'],
        allergenFormat: 'parentheses',  // 括弧書き形式
        ingredientOrder: 'descending',  // 配合量の多い順
        minFontSize: 5.5,              // pt単位（食品表示基準: 5.5pt以上）
        nutritionRequired: true,
        dateFormat: 'YYYY年MM月DD日',
        languageRequired: 'ja',
      },
      US: {
        name: 'アメリカ',
        requiredFields: ['productName', 'ingredients', 'allergens', 'manufacturer', 'weight', 'nutrition'],
        allergenFormat: 'contains',     // "Contains:" 形式
        ingredientOrder: 'descending',
        minFontSize: 6,                // FDA: 最小6pt
        nutritionRequired: true,
        dateFormat: 'MM/DD/YYYY',
        languageRequired: 'en',
      },
      CN: {
        name: '中国',
        requiredFields: ['productName', 'ingredients', 'allergens', 'manufacturer', 'origin', 'weight', 'expiry', 'storage', 'nutrition'],
        allergenFormat: 'contains',
        ingredientOrder: 'descending',
        minFontSize: 5,
        nutritionRequired: true,
        dateFormat: 'YYYY年MM月DD日',
        languageRequired: 'zh-CN',
      },
      TW: {
        name: '台湾',
        requiredFields: ['productName', 'ingredients', 'allergens', 'manufacturer', 'origin', 'weight', 'expiry', 'nutrition'],
        allergenFormat: 'contains',
        ingredientOrder: 'descending',
        minFontSize: 5,
        nutritionRequired: true,
        dateFormat: 'YYYY年MM月DD日',
        languageRequired: 'zh-TW',
      },
      KR: {
        name: '韓国',
        requiredFields: ['productName', 'ingredients', 'allergens', 'manufacturer', 'origin', 'weight', 'expiry', 'nutrition'],
        allergenFormat: 'contains',
        ingredientOrder: 'descending',
        minFontSize: 6,
        nutritionRequired: true,
        dateFormat: 'YYYY.MM.DD',
        languageRequired: 'ko',
      },
      TH: {
        name: 'タイ',
        requiredFields: ['productName', 'ingredients', 'allergens', 'manufacturer', 'weight', 'expiry', 'nutrition'],
        allergenFormat: 'contains',
        ingredientOrder: 'descending',
        minFontSize: 5,
        nutritionRequired: true,
        dateFormat: 'DD/MM/YYYY',
        languageRequired: 'th',
      },
      VN: {
        name: 'ベトナム',
        requiredFields: ['productName', 'ingredients', 'manufacturer', 'weight', 'expiry', 'storage'],
        allergenFormat: 'contains',
        ingredientOrder: 'descending',
        minFontSize: 5,
        nutritionRequired: false,
        dateFormat: 'DD/MM/YYYY',
        languageRequired: 'vi',
      },
      ID: {
        name: 'インドネシア',
        requiredFields: ['productName', 'ingredients', 'manufacturer', 'weight', 'expiry', 'nutrition'],
        allergenFormat: 'contains',
        ingredientOrder: 'descending',
        minFontSize: 5,
        nutritionRequired: true,
        dateFormat: 'DD/MM/YYYY',
        languageRequired: 'id',
      },
      MY: {
        name: 'マレーシア',
        requiredFields: ['productName', 'ingredients', 'allergens', 'manufacturer', 'weight', 'expiry', 'nutrition'],
        allergenFormat: 'contains',
        ingredientOrder: 'descending',
        minFontSize: 5,
        nutritionRequired: true,
        dateFormat: 'DD/MM/YYYY',
        languageRequired: 'ms',
      },
      FR: {
        name: 'フランス',
        requiredFields: ['productName', 'ingredients', 'allergens', 'manufacturer', 'origin', 'weight', 'expiry', 'storage', 'nutrition'],
        allergenFormat: 'bold',         // EU方式: アレルゲンを太字強調
        ingredientOrder: 'descending',
        minFontSize: 6.5,              // EU: 1.2mm x-height ≒ 6.5pt
        nutritionRequired: true,
        dateFormat: 'DD/MM/YYYY',
        languageRequired: 'fr',
      },
      DE: {
        name: 'ドイツ',
        requiredFields: ['productName', 'ingredients', 'allergens', 'manufacturer', 'origin', 'weight', 'expiry', 'storage', 'nutrition'],
        allergenFormat: 'bold',
        ingredientOrder: 'descending',
        minFontSize: 6.5,
        nutritionRequired: true,
        dateFormat: 'DD.MM.YYYY',
        languageRequired: 'de',
      },
      ES: {
        name: 'スペイン',
        requiredFields: ['productName', 'ingredients', 'allergens', 'manufacturer', 'origin', 'weight', 'expiry', 'nutrition'],
        allergenFormat: 'bold',
        ingredientOrder: 'descending',
        minFontSize: 6.5,
        nutritionRequired: true,
        dateFormat: 'DD/MM/YYYY',
        languageRequired: 'es',
      },
      BR: {
        name: 'ブラジル',
        requiredFields: ['productName', 'ingredients', 'allergens', 'manufacturer', 'weight', 'expiry', 'nutrition'],
        allergenFormat: 'contains_bold',
        ingredientOrder: 'descending',
        minFontSize: 5,
        nutritionRequired: true,
        dateFormat: 'DD/MM/YYYY',
        languageRequired: 'pt',
      },
      IT: {
        name: 'イタリア',
        requiredFields: ['productName', 'ingredients', 'allergens', 'manufacturer', 'origin', 'weight', 'expiry', 'nutrition'],
        allergenFormat: 'bold',
        ingredientOrder: 'descending',
        minFontSize: 6.5,
        nutritionRequired: true,
        dateFormat: 'DD/MM/YYYY',
        languageRequired: 'it',
      },
      SA: {
        name: 'サウジアラビア',
        requiredFields: ['productName', 'ingredients', 'allergens', 'manufacturer', 'origin', 'weight', 'expiry', 'nutrition'],
        allergenFormat: 'contains',
        ingredientOrder: 'descending',
        minFontSize: 6,
        nutritionRequired: true,
        dateFormat: 'DD/MM/YYYY',
        languageRequired: 'ar',
        direction: 'rtl',
      },
      IN: {
        name: 'インド',
        requiredFields: ['productName', 'ingredients', 'allergens', 'manufacturer', 'weight', 'expiry', 'nutrition'],
        allergenFormat: 'contains',
        ingredientOrder: 'descending',
        minFontSize: 5,
        nutritionRequired: true,
        dateFormat: 'DD/MM/YYYY',
        languageRequired: 'hi',
      },
      RU: {
        name: 'ロシア',
        requiredFields: ['productName', 'ingredients', 'manufacturer', 'origin', 'weight', 'expiry', 'storage', 'nutrition'],
        allergenFormat: 'contains',
        ingredientOrder: 'descending',
        minFontSize: 5.5,
        nutritionRequired: true,
        dateFormat: 'DD.MM.YYYY',
        languageRequired: 'ru',
      },
      NL: {
        name: 'オランダ',
        requiredFields: ['productName', 'ingredients', 'allergens', 'manufacturer', 'origin', 'weight', 'expiry', 'nutrition'],
        allergenFormat: 'bold',
        ingredientOrder: 'descending',
        minFontSize: 6.5,
        nutritionRequired: true,
        dateFormat: 'DD/MM/YYYY',
        languageRequired: 'nl',
      },
    };
  },

  /**
   * nutrition-formats.json が無い場合のフォールバック
   */
  _getFallbackNutritionFormats() {
    return {
      JP: {
        title: '栄養成分表示',
        perLabel: '100gあたり',
        required: ['energy', 'protein', 'fat', 'carbohydrate', 'sodium'],
        order: ['energy', 'protein', 'fat', 'carbohydrate', 'sodium'],
        units: { energy: 'kcal', protein: 'g', fat: 'g', carbohydrate: 'g', sodium: 'g' },
        style: 'vertical',
      },
      US: {
        title: 'Nutrition Facts',
        perLabel: 'Per Serving',
        required: ['energy', 'fat', 'saturated_fat', 'trans_fat', 'cholesterol', 'sodium_mg', 'carbohydrate', 'fiber', 'sugars', 'protein', 'vitamin_d', 'calcium', 'iron', 'potassium'],
        order: ['energy', 'fat', 'saturated_fat', 'trans_fat', 'cholesterol', 'sodium_mg', 'carbohydrate', 'fiber', 'sugars', 'protein'],
        units: { energy: 'Cal', fat: 'g', saturated_fat: 'g', trans_fat: 'g', cholesterol: 'mg', sodium_mg: 'mg', carbohydrate: 'g', fiber: 'g', sugars: 'g', protein: 'g' },
        style: 'us_standard',
      },
      EU: {
        title: 'Nutrition Information',
        perLabel: 'Per 100g',
        required: ['energy_kj', 'energy_kcal', 'fat', 'saturated_fat', 'carbohydrate', 'sugars', 'protein', 'salt'],
        order: ['energy_kj', 'energy_kcal', 'fat', 'saturated_fat', 'carbohydrate', 'sugars', 'protein', 'salt'],
        units: { energy_kj: 'kJ', energy_kcal: 'kcal', fat: 'g', saturated_fat: 'g', carbohydrate: 'g', sugars: 'g', protein: 'g', salt: 'g' },
        style: 'eu_standard',
      },
    };
  },

  /* ============================================
     ラベル生成メイン
     ============================================ */

  /**
   * 法定表示に準拠したラベルHTMLを生成
   *
   * @param {object} data - { product, translation, settings }
   * @param {string} country - 国コード (JP, US, CN, ...)
   * @param {string} lang - 言語コード (ja, en, zh-CN, ...)
   * @returns {{ html: string, warnings: string[], layout: object }}
   */
  generateLabel(data, country, lang) {
    const rule = this._getRule(country);
    const warnings = [];

    // コンプライアンスチェック（法定表示の欠落確認）
    const complianceWarnings = this.checkCompliance(data.product, country);
    warnings.push(...complianceWarnings);

    // フォントサイズチェック
    const fontSizeWarning = this._checkFontSize(data.settings, rule);
    if (fontSizeWarning) warnings.push(fontSizeWarning);

    // 翻訳データ（翻訳済み or 原文フォールバック）
    const t = data.translation || {};
    const labels = t.labels || {};

    // 各セクションHTML生成
    const productNameHtml = this._generateProductNameSection(data, t);
    const ingredientHtml = this._generateIngredientSection(data, t, labels, rule, lang);
    const allergenHtml = this.generateAllergenDisplay(data.product.allergens || [], country, lang, t);
    const nutritionHtml = this.generateNutritionTable(data.product.nutritionFacts || [], country, lang, t);
    const metaHtml = this._generateMetaSection(data, t, labels, rule);

    // テキスト方向（RTL対応）
    const dir = (rule.direction === 'rtl') ? 'rtl' : 'ltr';

    // ラベルHTML組み立て
    const html = `
      <div class="legal-label" dir="${dir}" style="
        width: ${Math.max(data.settings.width * 3.78, 300)}px;
        min-height: ${data.settings.height * 3.78}px;
        max-width: 100%;
        overflow-x: auto;
        background: ${data.settings.backgroundColor || '#ffffff'};
        color: ${data.settings.textColor || '#000000'};
        border: 1px ${data.settings.borderStyle || 'solid'} #333;
        padding: 10px;
        font-size: ${this._calcFontSize(data.settings, rule)}pt;
        font-family: 'Noto Sans JP', 'Noto Sans SC', 'Noto Sans TC', 'Noto Sans KR', 'Noto Sans Thai', 'Noto Sans Arabic', 'Noto Sans Devanagari', sans-serif;
        line-height: 1.4;
        direction: ${dir};
      ">
        ${data.settings.logoBase64 ? `<div class="legal-label__logo"><img src="${data.settings.logoBase64}" alt="logo" style="max-width:80px;max-height:40px;margin-bottom:6px;" /></div>` : ''}
        ${productNameHtml}
        ${ingredientHtml}
        ${allergenHtml}
        ${nutritionHtml}
        ${metaHtml}
      </div>
    `;

    return {
      html,
      warnings,
      layout: {
        width: data.settings.width,
        height: data.settings.height,
        fontSize: this._calcFontSize(data.settings, rule),
        direction: dir,
      },
    };
  },

  /* ============================================
     各セクションの生成
     ============================================ */

  /**
   * 製品名セクション
   */
  _generateProductNameSection(data, translation) {
    const name = translation.productName || data.product.productName || '';
    return `<div class="legal-label__product-name" style="font-weight:bold;font-size:1.2em;margin-bottom:6px;">${this._esc(name)}</div>`;
  },

  /**
   * 原材料名セクション
   * 国によって配合量順 or 指定順で並べる
   */
  _generateIngredientSection(data, translation, labels, rule, lang) {
    const ingredients = translation.ingredients || data.product.ingredients.map(i => i.name);
    if (ingredients.length === 0) return '';

    // 配合量順ソート（descending の場合）
    let sortedIngredients = ingredients;
    if (rule.ingredientOrder === 'descending' && data.product.ingredients.length === ingredients.length) {
      // 原文の配合量データでソート用インデックスを作り、翻訳済みリストに適用
      const indexed = data.product.ingredients.map((orig, i) => ({ amount: orig.amount || 0, translated: ingredients[i] }));
      indexed.sort((a, b) => b.amount - a.amount);
      sortedIngredients = indexed.map(item => item.translated);
    }

    const title = labels.ingredients || '原材料名';
    return `
      <div class="legal-label__ingredients" style="margin-bottom:6px;">
        <span style="font-weight:bold;">${this._esc(title)}: </span>
        <span>${sortedIngredients.map(i => this._esc(i)).join(', ')}</span>
      </div>
    `;
  },

  /**
   * アレルゲン表示を生成（国ごとの形式に対応）
   *
   * @param {string[]} allergenIds - 選択されたアレルゲンID
   * @param {string} country - 国コード
   * @param {string} lang - 言語コード
   * @param {object} translation - 翻訳データ
   */
  generateAllergenDisplay(allergenIds, country, lang, translation) {
    if (!allergenIds || allergenIds.length === 0) return '';

    const rule = this._getRule(country);
    const allergenNames = translation?.allergens || allergenIds.map(id => {
      const a = (typeof ALLERGEN_LIST !== 'undefined') ? ALLERGEN_LIST.find(al => al.id === id) : null;
      return a ? a.name : id;
    });

    const labels = translation?.labels || {};
    const format = rule.allergenFormat || 'contains';

    switch (format) {
      case 'parentheses':
        // 日本方式: 「（一部に○○・○○を含む）」
        return `<div class="legal-label__allergens" style="margin-bottom:6px;">
          <span>（一部に${allergenNames.join('・')}を含む）</span>
        </div>`;

      case 'bold':
        // EU方式: 成分リスト中でアレルゲンを太字にする（ここでは別枠表示）
        return `<div class="legal-label__allergens" style="margin-bottom:6px;">
          <span style="font-weight:bold;">${this._esc(labels.allergens || 'Allergens')}: </span>
          <span>${allergenNames.map(n => `<strong>${this._esc(n)}</strong>`).join(', ')}</span>
        </div>`;

      case 'contains_bold':
        // ブラジル方式: "CONTÉM:" + 太字
        return `<div class="legal-label__allergens" style="margin-bottom:6px;border:1px solid #333;padding:4px;">
          <span style="font-weight:bold;text-transform:uppercase;">${this._esc(labels.contains || 'Contains')}: </span>
          <span style="font-weight:bold;">${allergenNames.map(n => this._esc(n)).join(', ')}</span>
        </div>`;

      case 'contains':
      default:
        // "Contains:" 形式（US、アジア各国等）
        return `<div class="legal-label__allergens" style="margin-bottom:6px;">
          <span style="font-weight:bold;">${this._esc(labels.contains || 'Contains:')} </span>
          <span>${allergenNames.map(n => this._esc(n)).join(', ')}</span>
        </div>`;
    }
  },

  /**
   * 栄養成分表を生成（国ごとのフォーマット）
   *
   * @param {Array<{name, per100g, unit}>} nutritionFacts - 栄養成分データ
   * @param {string} country - 国コード
   * @param {string} lang - 言語コード
   * @param {object} translation - 翻訳データ
   */
  generateNutritionTable(nutritionFacts, country, lang, translation) {
    if (!nutritionFacts || nutritionFacts.length === 0) return '';

    const format = this._getNutritionFormat(country);
    const labels = translation?.labels || {};
    const translatedNames = translation?.nutritionNames || nutritionFacts.map(n => n.name);

    const title = labels.nutrition || format.title || '栄養成分表示';
    const perLabel = format.perLabel || '100gあたり';

    // テーブル行を生成
    const rows = nutritionFacts.map((fact, i) => {
      const name = translatedNames[i] || fact.name;
      return `<tr>
        <td style="padding:2px 4px;border-bottom:1px solid #ddd;">${this._esc(name)}</td>
        <td style="padding:2px 4px;border-bottom:1px solid #ddd;text-align:right;">${fact.per100g}${this._esc(fact.unit)}</td>
      </tr>`;
    }).join('');

    return `
      <div class="legal-label__nutrition" style="margin-bottom:6px;">
        <table style="width:100%;border-collapse:collapse;font-size:0.9em;">
          <thead>
            <tr style="border-bottom:2px solid #333;">
              <th colspan="2" style="padding:2px 4px;text-align:left;font-weight:bold;">${this._esc(title)}</th>
            </tr>
            <tr style="border-bottom:1px solid #999;">
              <td colspan="2" style="padding:2px 4px;font-size:0.85em;color:#666;">${this._esc(perLabel)}</td>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  },

  /**
   * メタ情報セクション（製造者、原産国、内容量、賞味期限、保存方法）
   */
  _generateMetaSection(data, translation, labels, rule) {
    const p = data.product;
    const t = translation;
    const parts = [];

    // 製造者
    if (p.manufacturer) {
      parts.push(`<div><span style="font-weight:bold;">${this._esc(labels.manufacturer || '製造者')}: </span>${this._esc(t.manufacturer || p.manufacturer)}</div>`);
    }

    // 原産国
    if (p.origin) {
      parts.push(`<div><span style="font-weight:bold;">${this._esc(labels.origin || '原産国')}: </span>${this._esc(t.origin || p.origin)}</div>`);
    }

    // 内容量
    if (p.weight) {
      parts.push(`<div><span style="font-weight:bold;">内容量: </span>${this._esc(p.weight)}${this._esc(p.weightUnit)}</div>`);
    }

    // 賞味期限
    if (p.expiryFormat) {
      parts.push(`<div><span style="font-weight:bold;">${this._esc(labels.expiry || '賞味期限')}: </span>${this._esc(p.expiryFormat)}</div>`);
    }

    // 保存方法
    if (p.storageInstructions) {
      parts.push(`<div><span style="font-weight:bold;">${this._esc(labels.storage || '保存方法')}: </span>${this._esc(t.storageInstructions || p.storageInstructions)}</div>`);
    }

    // 追加情報
    if (p.additionalInfo) {
      parts.push(`<div style="margin-top:4px;font-size:0.85em;">${this._esc(t.additionalInfo || p.additionalInfo)}</div>`);
    }

    if (parts.length === 0) return '';

    return `<div class="legal-label__meta" style="margin-top:6px;font-size:0.9em;">${parts.join('')}</div>`;
  },

  /* ============================================
     コンプライアンスチェック
     ============================================ */

  /**
   * 法定表示の必須項目欠落をチェック
   *
   * @param {object} productData - 製品データ
   * @param {string} country - 国コード
   * @returns {string[]} 警告メッセージの配列
   */
  checkCompliance(productData, country) {
    const rule = this._getRule(country);
    const warnings = [];
    const required = rule.requiredFields || [];

    const fieldMap = {
      productName: { value: productData.productName, label: '製品名' },
      ingredients: { value: (productData.ingredients || []).length > 0, label: '原材料名' },
      allergens: { value: (productData.allergens || []).length >= 0, label: 'アレルゲン' }, // 0でもOK（該当なし）
      manufacturer: { value: productData.manufacturer, label: '製造者' },
      origin: { value: productData.origin, label: '原産国' },
      weight: { value: productData.weight, label: '内容量' },
      expiry: { value: productData.expiryFormat, label: '賞味期限' },
      storage: { value: productData.storageInstructions, label: '保存方法' },
      nutrition: { value: (productData.nutritionFacts || []).length > 0, label: '栄養成分表示' },
    };

    for (const field of required) {
      const info = fieldMap[field];
      if (info && !info.value) {
        warnings.push(`${rule.name || country}: ${info.label}は法定表示の必須項目です。`);
      }
    }

    return warnings;
  },

  /* ============================================
     フォントサイズ チェック
     ============================================ */

  /**
   * フォントサイズが法定最小値を満たしているかチェック
   */
  _checkFontSize(settings, rule) {
    if (!rule.minFontSize) return null;

    const currentSize = this._calcFontSize(settings, rule);
    if (currentSize < rule.minFontSize) {
      return `フォントサイズ(${currentSize}pt)が法定最小値(${rule.minFontSize}pt)を下回っています。`;
    }
    return null;
  },

  /**
   * フォントサイズを計算
   * auto の場合は法定最小値を使用
   */
  _calcFontSize(settings, rule) {
    if (settings.fontSize && settings.fontSize !== 'auto') {
      return parseFloat(settings.fontSize) || 7;
    }
    // auto → 法定最小値（余裕を持って +0.5pt）
    return (rule.minFontSize || 5.5) + 0.5;
  },

  /* ============================================
     ヘルパー
     ============================================ */

  /**
   * 国コードから法定表示ルールを取得
   */
  _getRule(country) {
    if (!this.rules) return {};

    // 直接マッチ
    if (this.rules[country]) return this.rules[country];

    // EU諸国のフォールバック
    const euCountries = ['FR', 'DE', 'ES', 'IT', 'NL', 'AT', 'BE', 'PT'];
    if (euCountries.includes(country) && this.rules.FR) {
      return { ...this.rules.FR, ...this.rules[country] };
    }

    // デフォルト（日本ルール）
    return this.rules.JP || {};
  },

  /**
   * 国コードから栄養成分フォーマットを取得
   */
  _getNutritionFormat(country) {
    if (!this.nutritionFormats) return {};

    if (this.nutritionFormats[country]) return this.nutritionFormats[country];

    // EU諸国はEUフォーマットをフォールバック
    const euCountries = ['FR', 'DE', 'ES', 'IT', 'NL'];
    if (euCountries.includes(country) && this.nutritionFormats.EU) {
      return this.nutritionFormats.EU;
    }

    return this.nutritionFormats.JP || {};
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
