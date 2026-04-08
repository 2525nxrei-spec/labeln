/* ============================================
   ラベルン - 翻訳エンジン (translation.js)
   辞書引き優先 + Gemini Flash API 翻訳
   ============================================ */

/**
 * Workers API のエンドポイント
 * .env 未設定時はモックモードで動作
 */
const TRANSLATION_API_ENDPOINT = '/api/translate';

/**
 * 翻訳エンジン
 *
 * パイプライン:
 *  1. 成分名・アレルゲン名 → dictionary.json で辞書引き（API不要）
 *  2. 辞書にない語句のみ → Gemini Flash API（Workers経由）
 *  3. 結果をマージして返す
 *
 * モックモード:
 *  API未設定時（Workers未デプロイ or APIキー未設定）→ ダミー翻訳を返す
 *  ただし辞書にある語はモックでも正確に翻訳
 */
const TranslationEngine = {
  /* 辞書データ（dictionary.json の中身） */
  dictionary: null,

  /* 翻訳キャッシュ: "原文::言語コード" → 翻訳結果 */
  cache: new Map(),

  /* API利用可能フラグ（初回通信で判定） */
  _apiAvailable: null,

  /* プログレスコールバック */
  _onProgress: null,

  /* ============================================
     初期化
     ============================================ */

  /**
   * 辞書ファイルをロードして初期化
   */
  async init() {
    // 辞書をロード
    await this._loadDictionary();

    // API接続テスト（バックグラウンド）
    this._checkAPIAvailability();


  },

  /**
   * dictionary.json を読み込み
   * 読めなくてもエラーにせず空辞書でフォールバック
   */
  async _loadDictionary() {
    try {
      const res = await fetch('./data/dictionary.json');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.dictionary = await res.json();

    } catch (err) {
      console.warn('[TranslationEngine] 辞書ファイル読み込みスキップ:', err.message);
      // フォールバック辞書（最低限のアレルゲン名）
      this.dictionary = this._getFallbackDictionary();
    }
  },

  /**
   * dictionary.json が無い場合のフォールバック辞書
   * アレルゲン28品目の主要言語翻訳
   */
  _getFallbackDictionary() {
    return {
      allergens: {
        egg:         { ja: '卵', en: 'Egg', 'zh-CN': '鸡蛋', 'zh-TW': '雞蛋', ko: '달걀', fr: 'Œuf', de: 'Ei', es: 'Huevo', pt: 'Ovo', it: 'Uovo', th: 'ไข่', vi: 'Trứng', id: 'Telur', ms: 'Telur', ar: 'بيض', hi: 'अंडा', ru: 'Яйцо', nl: 'Ei' },
        milk:        { ja: '乳', en: 'Milk', 'zh-CN': '牛奶', 'zh-TW': '牛奶', ko: '우유', fr: 'Lait', de: 'Milch', es: 'Leche', pt: 'Leite', it: 'Latte', th: 'นม', vi: 'Sữa', id: 'Susu', ms: 'Susu', ar: 'حليب', hi: 'दूध', ru: 'Молоко', nl: 'Melk' },
        wheat:       { ja: '小麦', en: 'Wheat', 'zh-CN': '小麦', 'zh-TW': '小麥', ko: '밀', fr: 'Blé', de: 'Weizen', es: 'Trigo', pt: 'Trigo', it: 'Grano', th: 'ข้าวสาลี', vi: 'Lúa mì', id: 'Gandum', ms: 'Gandum', ar: 'قمح', hi: 'गेहूं', ru: 'Пшеница', nl: 'Tarwe' },
        buckwheat:   { ja: 'そば', en: 'Buckwheat', 'zh-CN': '荞麦', 'zh-TW': '蕎麥', ko: '메밀', fr: 'Sarrasin', de: 'Buchweizen', es: 'Trigo sarraceno', pt: 'Trigo sarraceno', it: 'Grano saraceno', th: 'บัควีท', vi: 'Kiều mạch', id: 'Soba', ms: 'Soba', ar: 'الحنطة السوداء', hi: 'कुट्टू', ru: 'Гречка', nl: 'Boekweit' },
        peanut:      { ja: '落花生', en: 'Peanut', 'zh-CN': '花生', 'zh-TW': '花生', ko: '땅콩', fr: 'Arachide', de: 'Erdnuss', es: 'Cacahuete', pt: 'Amendoim', it: 'Arachide', th: 'ถั่วลิสง', vi: 'Đậu phộng', id: 'Kacang tanah', ms: 'Kacang tanah', ar: 'فول سوداني', hi: 'मूंगफली', ru: 'Арахис', nl: 'Pinda' },
        shrimp:      { ja: 'えび', en: 'Shrimp', 'zh-CN': '虾', 'zh-TW': '蝦', ko: '새우', fr: 'Crevette', de: 'Garnele', es: 'Camarón', pt: 'Camarão', it: 'Gambero', th: 'กุ้ง', vi: 'Tôm', id: 'Udang', ms: 'Udang', ar: 'جمبري', hi: 'झींगा', ru: 'Креветка', nl: 'Garnaal' },
        crab:        { ja: 'かに', en: 'Crab', 'zh-CN': '螃蟹', 'zh-TW': '螃蟹', ko: '게', fr: 'Crabe', de: 'Krabbe', es: 'Cangrejo', pt: 'Caranguejo', it: 'Granchio', th: 'ปู', vi: 'Cua', id: 'Kepiting', ms: 'Ketam', ar: 'سلطعون', hi: 'केकड़ा', ru: 'Краб', nl: 'Krab' },
        walnut:      { ja: 'くるみ', en: 'Walnut', 'zh-CN': '核桃', 'zh-TW': '核桃', ko: '호두', fr: 'Noix', de: 'Walnuss', es: 'Nuez', pt: 'Noz', it: 'Noce', th: 'วอลนัท', vi: 'Quả óc chó', id: 'Kenari', ms: 'Walnut', ar: 'جوز', hi: 'अखरोट', ru: 'Грецкий орех', nl: 'Walnoot' },
        soybean:     { ja: '大豆', en: 'Soybean', 'zh-CN': '大豆', 'zh-TW': '大豆', ko: '대두', fr: 'Soja', de: 'Soja', es: 'Soja', pt: 'Soja', it: 'Soia', th: 'ถั่วเหลือง', vi: 'Đậu nành', id: 'Kedelai', ms: 'Kacang soya', ar: 'فول الصويا', hi: 'सोयाबीन', ru: 'Соя', nl: 'Soja' },
        almond:      { ja: 'アーモンド', en: 'Almond', 'zh-CN': '杏仁', 'zh-TW': '杏仁', ko: '아몬드', fr: 'Amande', de: 'Mandel', es: 'Almendra', pt: 'Amêndoa', it: 'Mandorla', th: 'อัลมอนด์', vi: 'Hạnh nhân', id: 'Almond', ms: 'Badam', ar: 'لوز', hi: 'बादाम', ru: 'Миндаль', nl: 'Amandel' },
        sesame:      { ja: 'ごま', en: 'Sesame', 'zh-CN': '芝麻', 'zh-TW': '芝麻', ko: '참깨', fr: 'Sésame', de: 'Sesam', es: 'Sésamo', pt: 'Gergelim', it: 'Sesamo', th: 'งา', vi: 'Mè', id: 'Wijen', ms: 'Bijan', ar: 'سمسم', hi: 'तिल', ru: 'Кунжут', nl: 'Sesam' },
        gelatin:     { ja: 'ゼラチン', en: 'Gelatin', 'zh-CN': '明胶', 'zh-TW': '明膠', ko: '젤라틴', fr: 'Gélatine', de: 'Gelatine', es: 'Gelatina', pt: 'Gelatina', it: 'Gelatina', th: 'เจลาติน', vi: 'Gelatin', id: 'Gelatin', ms: 'Gelatin', ar: 'جيلاتين', hi: 'जिलेटिन', ru: 'Желатин', nl: 'Gelatine' },
      },
      ingredients: {},
      labels: {
        ingredients:    { ja: '原材料名', en: 'Ingredients', 'zh-CN': '配料', 'zh-TW': '成分', ko: '원재료명', fr: 'Ingrédients', de: 'Zutaten', es: 'Ingredientes', pt: 'Ingredientes', it: 'Ingredienti', th: 'ส่วนผสม', vi: 'Thành phần', id: 'Komposisi', ms: 'Ramuan', ar: 'المكونات', hi: 'सामग्री', ru: 'Состав', nl: 'Ingrediënten' },
        allergens:      { ja: 'アレルゲン', en: 'Allergens', 'zh-CN': '过敏原', 'zh-TW': '過敏原', ko: '알레르겐', fr: 'Allergènes', de: 'Allergene', es: 'Alérgenos', pt: 'Alérgenos', it: 'Allergeni', th: 'สารก่อภูมิแพ้', vi: 'Chất gây dị ứng', id: 'Alergen', ms: 'Alergen', ar: 'مسببات الحساسية', hi: 'एलर्जी कारक', ru: 'Аллергены', nl: 'Allergenen' },
        nutrition:      { ja: '栄養成分表示', en: 'Nutrition Facts', 'zh-CN': '营养成分表', 'zh-TW': '營養標示', ko: '영양성분', fr: 'Informations nutritionnelles', de: 'Nährwertinformationen', es: 'Información nutricional', pt: 'Informação nutricional', it: 'Informazioni nutrizionali', th: 'ข้อมูลโภชนาการ', vi: 'Thông tin dinh dưỡng', id: 'Informasi Nilai Gizi', ms: 'Maklumat Pemakanan', ar: 'القيمة الغذائية', hi: 'पोषण तथ्य', ru: 'Пищевая ценность', nl: 'Voedingswaarde' },
        manufacturer:   { ja: '製造者', en: 'Manufacturer', 'zh-CN': '制造商', 'zh-TW': '製造商', ko: '제조자', fr: 'Fabricant', de: 'Hersteller', es: 'Fabricante', pt: 'Fabricante', it: 'Produttore', th: 'ผู้ผลิต', vi: 'Nhà sản xuất', id: 'Produsen', ms: 'Pengilang', ar: 'الشركة المصنعة', hi: 'निर्माता', ru: 'Производитель', nl: 'Fabrikant' },
        origin:         { ja: '原産国', en: 'Country of Origin', 'zh-CN': '原产国', 'zh-TW': '原產國', ko: '원산지', fr: "Pays d'origine", de: 'Herkunftsland', es: 'País de origen', pt: 'País de origem', it: 'Paese di origine', th: 'ประเทศต้นกำเนิด', vi: 'Xuất xứ', id: 'Negara asal', ms: 'Negara asal', ar: 'بلد المنشأ', hi: 'मूल देश', ru: 'Страна происхождения', nl: 'Land van herkomst' },
        storage:        { ja: '保存方法', en: 'Storage', 'zh-CN': '保存方法', 'zh-TW': '保存方法', ko: '보관방법', fr: 'Conservation', de: 'Lagerung', es: 'Conservación', pt: 'Conservação', it: 'Conservazione', th: 'วิธีเก็บรักษา', vi: 'Bảo quản', id: 'Penyimpanan', ms: 'Penyimpanan', ar: 'التخزين', hi: 'भंडारण', ru: 'Хранение', nl: 'Bewaring' },
        expiry:         { ja: '賞味期限', en: 'Best Before', 'zh-CN': '保质期', 'zh-TW': '有效日期', ko: '유통기한', fr: 'À consommer de préférence avant', de: 'Mindestens haltbar bis', es: 'Consumir preferentemente antes de', pt: 'Consumir de preferência antes de', it: 'Da consumarsi preferibilmente entro', th: 'ควรบริโภคก่อน', vi: 'Hạn sử dụng', id: 'Baik digunakan sebelum', ms: 'Terbaik sebelum', ar: 'يفضل استخدامه قبل', hi: 'इस तारीख से पहले उपयोग करें', ru: 'Годен до', nl: 'Ten minste houdbaar tot' },
        contains:       { ja: '（一部に○○を含む）', en: 'Contains:', 'zh-CN': '含有：', 'zh-TW': '含有：', ko: '함유:', fr: 'Contient :', de: 'Enthält:', es: 'Contiene:', pt: 'Contém:', it: 'Contiene:', th: 'ประกอบด้วย:', vi: 'Chứa:', id: 'Mengandung:', ms: 'Mengandungi:', ar: 'يحتوي على:', hi: 'इसमें शामिल है:', ru: 'Содержит:', nl: 'Bevat:' },
        energy:         { ja: 'エネルギー', en: 'Energy', 'zh-CN': '能量', 'zh-TW': '熱量', ko: '열량', fr: 'Énergie', de: 'Energie', es: 'Energía', pt: 'Energia', it: 'Energia', th: 'พลังงาน', vi: 'Năng lượng', id: 'Energi', ms: 'Tenaga', ar: 'الطاقة', hi: 'ऊर्जा', ru: 'Энергетическая ценность', nl: 'Energie' },
        protein:        { ja: 'たんぱく質', en: 'Protein', 'zh-CN': '蛋白质', 'zh-TW': '蛋白質', ko: '단백질', fr: 'Protéines', de: 'Eiweiß', es: 'Proteínas', pt: 'Proteínas', it: 'Proteine', th: 'โปรตีน', vi: 'Chất đạm', id: 'Protein', ms: 'Protein', ar: 'بروتين', hi: 'प्रोटीन', ru: 'Белки', nl: 'Eiwitten' },
        fat:            { ja: '脂質', en: 'Fat', 'zh-CN': '脂肪', 'zh-TW': '脂肪', ko: '지방', fr: 'Matières grasses', de: 'Fett', es: 'Grasas', pt: 'Gorduras', it: 'Grassi', th: 'ไขมัน', vi: 'Chất béo', id: 'Lemak', ms: 'Lemak', ar: 'دهون', hi: 'वसा', ru: 'Жиры', nl: 'Vetten' },
        carbohydrate:   { ja: '炭水化物', en: 'Carbohydrate', 'zh-CN': '碳水化合物', 'zh-TW': '碳水化合物', ko: '탄수화물', fr: 'Glucides', de: 'Kohlenhydrate', es: 'Hidratos de carbono', pt: 'Carboidratos', it: 'Carboidrati', th: 'คาร์โบไฮเดรต', vi: 'Carbohydrate', id: 'Karbohidrat', ms: 'Karbohidrat', ar: 'كربوهيدرات', hi: 'कार्बोहाइड्रेट', ru: 'Углеводы', nl: 'Koolhydraten' },
        sodium:         { ja: '食塩相当量', en: 'Salt equivalent', 'zh-CN': '钠（食盐当量）', 'zh-TW': '鈉（食鹽當量）', ko: '나트륨(식염상당량)', fr: 'Sel', de: 'Salz', es: 'Sal', pt: 'Sal', it: 'Sale', th: 'โซเดียม', vi: 'Muối', id: 'Garam', ms: 'Garam', ar: 'ملح', hi: 'नमक', ru: 'Соль', nl: 'Zout' },
      },
    };
  },

  /* ============================================
     API接続テスト
     ============================================ */

  /**
   * Workers API が利用可能か非同期チェック
   * 利用不可ならモックモードへフォールバック
   */
  async _checkAPIAvailability() {
    try {
      const res = await fetch(TRANSLATION_API_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ping: true }),
      });

      if (res.ok) {
        const data = await res.json();
        this._apiAvailable = data.available === true;
      } else {
        this._apiAvailable = false;
      }
    } catch (err) {
      // ネットワークエラー = API未デプロイ → モックモード
      this._apiAvailable = false;
    }

  },

  /* ============================================
     メイン翻訳メソッド
     ============================================ */

  /**
   * テキスト群を翻訳
   *
   * @param {object} payload - 翻訳対象テキスト群
   *   { productName, ingredients[], allergens[], manufacturer, origin, storageInstructions, additionalInfo, nutritionNames[] }
   * @param {string[]} targetLangs - 対象言語コード配列
   * @param {string} category - 'label' | 'ingredient' | 'allergen'
   * @returns {object} 言語コードをキーとした翻訳結果オブジェクト
   */
  async translate(payload, targetLangs, category) {
    const results = {};

    for (const lang of targetLangs) {
      results[lang] = await this._translateForLang(payload, lang, category);
    }

    return results;
  },

  /**
   * 1言語分の翻訳処理
   * 辞書引き → APIが必要な分だけ翻訳 → マージ
   */
  async _translateForLang(payload, lang, category) {
    const result = {
      productName: '',
      ingredients: [],
      allergens: [],
      manufacturer: '',
      origin: '',
      storageInstructions: '',
      additionalInfo: '',
      nutritionNames: [],
      labels: {},  // UIラベル翻訳
    };

    // --- UIラベルの辞書引き（常に辞書から取れる） ---
    result.labels = this._getLabelsForLang(lang);

    // --- アレルゲン名の辞書引き ---
    result.allergens = (payload.allergens || []).map(name => {
      const dictResult = this.lookupDictionary(name, lang, 'allergen');
      return dictResult || name;
    });

    // --- 成分名の辞書引き ---
    const ingredientsFromDict = [];
    const ingredientsNeedAPI = [];

    (payload.ingredients || []).forEach((name, idx) => {
      const dictResult = this.lookupDictionary(name, lang, 'ingredient');
      if (dictResult) {
        ingredientsFromDict.push({ idx, name: dictResult });
      } else {
        ingredientsNeedAPI.push({ idx, name });
      }
    });

    // --- 栄養素名の辞書引き ---
    const nutritionFromDict = [];
    const nutritionNeedAPI = [];

    (payload.nutritionNames || []).forEach((name, idx) => {
      const dictResult = this.lookupDictionary(name, lang, 'nutrition');
      if (dictResult) {
        nutritionFromDict.push({ idx, name: dictResult });
      } else {
        nutritionNeedAPI.push({ idx, name });
      }
    });

    // --- API翻訳が必要なテキストを収集 ---
    const textsForAPI = [];
    if (payload.productName) textsForAPI.push({ key: 'productName', text: payload.productName });
    if (payload.manufacturer) textsForAPI.push({ key: 'manufacturer', text: payload.manufacturer });
    if (payload.origin) textsForAPI.push({ key: 'origin', text: payload.origin });
    if (payload.storageInstructions) textsForAPI.push({ key: 'storageInstructions', text: payload.storageInstructions });
    if (payload.additionalInfo) textsForAPI.push({ key: 'additionalInfo', text: payload.additionalInfo });

    ingredientsNeedAPI.forEach(item => {
      textsForAPI.push({ key: `ingredient_${item.idx}`, text: item.name });
    });

    nutritionNeedAPI.forEach(item => {
      textsForAPI.push({ key: `nutrition_${item.idx}`, text: item.name });
    });

    // --- API翻訳 or モック翻訳 ---
    let apiResults = {};

    if (textsForAPI.length > 0) {
      apiResults = await this._translateTextsViaAPI(textsForAPI, lang);
    }

    // --- 結果をマージ ---
    result.productName = apiResults.productName || this.getMockTranslationSingle(payload.productName, lang);
    result.manufacturer = apiResults.manufacturer || this.getMockTranslationSingle(payload.manufacturer, lang);
    result.origin = apiResults.origin || this.getMockTranslationSingle(payload.origin, lang);
    result.storageInstructions = apiResults.storageInstructions || this.getMockTranslationSingle(payload.storageInstructions, lang);
    result.additionalInfo = apiResults.additionalInfo || this.getMockTranslationSingle(payload.additionalInfo, lang);

    // 成分リスト再構築
    const allIngredients = new Array((payload.ingredients || []).length);
    ingredientsFromDict.forEach(item => { allIngredients[item.idx] = item.name; });
    ingredientsNeedAPI.forEach(item => {
      allIngredients[item.idx] = apiResults[`ingredient_${item.idx}`] || this.getMockTranslationSingle(item.name, lang);
    });
    result.ingredients = allIngredients.filter(Boolean);

    // 栄養素名再構築
    const allNutrition = new Array((payload.nutritionNames || []).length);
    nutritionFromDict.forEach(item => { allNutrition[item.idx] = item.name; });
    nutritionNeedAPI.forEach(item => {
      allNutrition[item.idx] = apiResults[`nutrition_${item.idx}`] || this.getMockTranslationSingle(item.name, lang);
    });
    result.nutritionNames = allNutrition.filter(Boolean);

    return result;
  },

  /* ============================================
     辞書引き
     ============================================ */

  /**
   * 辞書から翻訳を検索
   *
   * @param {string} term - 検索語（日本語）
   * @param {string} targetLang - 対象言語コード
   * @param {string} category - 'allergen' | 'ingredient' | 'nutrition' | 'label'
   * @returns {string|null} 辞書にあれば翻訳文字列、なければ null
   */
  lookupDictionary(term, targetLang, category) {
    if (!this.dictionary) return null;

    // カテゴリ別に辞書を検索
    const section = this._getDictionarySection(category);
    if (!section) return null;

    // term をキーにして検索（完全一致 or 日本語名一致）
    for (const [key, translations] of Object.entries(section)) {
      if (!translations) continue;

      // キーが一致、または日本語名が一致
      if (key === term || translations.ja === term) {
        return translations[targetLang] || null;
      }
    }

    return null;
  },

  /**
   * カテゴリに対応する辞書セクションを返す
   */
  _getDictionarySection(category) {
    if (!this.dictionary) return null;

    switch (category) {
      case 'allergen':
        return this.dictionary.allergens || {};
      case 'ingredient':
        return this.dictionary.ingredients || {};
      case 'nutrition':
        // 栄養素はlabelsセクションに含める設計
        return { ...this.dictionary.labels || {}, ...this.dictionary.nutrition || {} };
      case 'label':
        return this.dictionary.labels || {};
      default:
        return {};
    }
  },

  /**
   * UIラベル翻訳を取得
   */
  _getLabelsForLang(lang) {
    const labels = {};
    const section = this.dictionary?.labels || {};

    for (const [key, translations] of Object.entries(section)) {
      labels[key] = translations[lang] || translations.en || translations.ja || key;
    }

    return labels;
  },

  /* ============================================
     API翻訳
     ============================================ */

  /**
   * 複数テキストをまとめてAPI翻訳
   *
   * @param {Array<{key: string, text: string}>} texts - 翻訳対象
   * @param {string} targetLang - 対象言語
   * @returns {object} key → 翻訳結果のマッピング
   */
  async _translateTextsViaAPI(texts, targetLang) {
    const results = {};

    // まずキャッシュを確認
    const uncached = [];
    for (const item of texts) {
      const cacheKey = `${item.text}::${targetLang}`;
      if (this.cache.has(cacheKey)) {
        results[item.key] = this.cache.get(cacheKey);
      } else {
        uncached.push(item);
      }
    }

    // 全てキャッシュヒットなら終了
    if (uncached.length === 0) return results;

    // APIが利用不可 → モックで返す
    if (this._apiAvailable === false) {
      for (const item of uncached) {
        const mock = this.getMockTranslationSingle(item.text, targetLang);
        results[item.key] = mock;
        this.cache.set(`${item.text}::${targetLang}`, mock);
      }
      return results;
    }

    // API翻訳リクエスト
    try {
      const apiResult = await this.callGeminiAPI(uncached, targetLang);

      for (const item of uncached) {
        const translated = apiResult[item.key] || this.getMockTranslationSingle(item.text, targetLang);
        results[item.key] = translated;
        // キャッシュに保存
        this.cache.set(`${item.text}::${targetLang}`, translated);
      }
    } catch (err) {
      console.error(`[TranslationEngine] API翻訳エラー (${targetLang}):`, err);

      // APIエラー → モックにフォールバック
      for (const item of uncached) {
        const mock = this.getMockTranslationSingle(item.text, targetLang);
        results[item.key] = mock;
        this.cache.set(`${item.text}::${targetLang}`, mock);
      }
    }

    return results;
  },

  /**
   * Gemini Flash API を Workers 経由で呼ぶ
   *
   * @param {Array<{key: string, text: string}>} texts - 翻訳対象
   * @param {string} targetLang - 対象言語コード
   * @returns {object} key → 翻訳テキスト
   */
  async callGeminiAPI(texts, targetLang) {
    const langName = (typeof SUPPORTED_LANGUAGES !== 'undefined' && SUPPORTED_LANGUAGES[targetLang])
      ? SUPPORTED_LANGUAGES[targetLang].name
      : targetLang;

    const requestBody = {
      texts: texts.map(t => ({ key: t.key, text: t.text })),
      targetLang: targetLang,
      targetLangName: langName,
      context: 'product_label', // 製品ラベルの翻訳であることをコンテキストとして伝える
    };

    const res = await fetch(TRANSLATION_API_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 認証トークンがあれば付与
        ...(typeof Auth !== 'undefined' && Auth.token ? { Authorization: `Bearer ${Auth.token}` } : {}),
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      throw new Error(`API応答エラー: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();

    // Workers API のレスポンス形式: { translations: { key: translatedText, ... } }
    return data.translations || {};
  },

  /* ============================================
     モック翻訳
     ============================================ */

  /**
   * モック翻訳（1テキスト）
   * API未設定時のダミー。"[言語: 原文]" 形式で返す。
   * ただし辞書にある語はモックでも正確に翻訳する。
   */
  getMockTranslationSingle(text, targetLang) {
    if (!text) return '';

    // 辞書にある語は正確に返す（カテゴリ横断検索）
    for (const cat of ['allergen', 'ingredient', 'nutrition', 'label']) {
      const dictResult = this.lookupDictionary(text, targetLang, cat);
      if (dictResult) return dictResult;
    }

    // 辞書に無い → ダミー翻訳
    const langName = (typeof SUPPORTED_LANGUAGES !== 'undefined' && SUPPORTED_LANGUAGES[targetLang])
      ? SUPPORTED_LANGUAGES[targetLang].name
      : targetLang;
    return `[${langName}: ${text}]`;
  },

  /**
   * モック翻訳（ペイロード全体）
   * LabelunApp から直接呼ばれるフォールバック用
   */
  getMockTranslation(payload, targetLang) {
    return {
      productName: this.getMockTranslationSingle(payload.productName, targetLang),
      ingredients: (payload.ingredients || []).map(name => this.getMockTranslationSingle(name, targetLang)),
      allergens: (payload.allergens || []).map(name => this.getMockTranslationSingle(name, targetLang)),
      manufacturer: this.getMockTranslationSingle(payload.manufacturer, targetLang),
      origin: this.getMockTranslationSingle(payload.origin, targetLang),
      storageInstructions: this.getMockTranslationSingle(payload.storageInstructions, targetLang),
      additionalInfo: this.getMockTranslationSingle(payload.additionalInfo, targetLang),
      nutritionNames: (payload.nutritionNames || []).map(name => this.getMockTranslationSingle(name, targetLang)),
      labels: this._getLabelsForLang(targetLang),
    };
  },

  /* ============================================
     キャッシュ管理
     ============================================ */

  /**
   * キャッシュをクリア
   */
  clearCache() {
    this.cache.clear();

  },

  /**
   * キャッシュ件数を返す
   */
  getCacheSize() {
    return this.cache.size;
  },

  /* ============================================
     プログレスコールバック
     ============================================ */

  /**
   * プログレス表示用のコールバックを登録
   * @param {function} callback - (current, total, langName) => void
   */
  onProgress(callback) {
    this._onProgress = callback;
  },

  _reportProgress(current, total, langName) {
    if (typeof this._onProgress === 'function') {
      try {
        this._onProgress(current, total, langName);
      } catch (e) {
        // コールバックエラーは無視
      }
    }
  },
};
