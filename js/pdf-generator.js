/* ============================================
   ラベルン - PDF生成エンジン (pdf-generator.js)
   jsPDF を使用した多言語ラベルPDF出力
   ============================================ */

/**
 * PDF生成エンジン
 *
 * - jsPDF（CDN読み込み前提）を使用
 * - 印刷用高解像度（300DPI相当）
 * - 多言語フォント対応（Noto Sans系）
 * - RTL（アラビア語）対応
 * - ラベルサイズに正確にフィット
 * - 一括/個別ダウンロード
 * - プレビューキャンバス描画
 */
const PDFGenerator = {
  /* jsPDF が利用可能か */
  _jspdfLoaded: false,

  /* フォントキャッシュ */
  _fontCache: {},

  /* ============================================
     初期化
     ============================================ */

  async init() {
    console.log('[PDFGenerator] 初期化開始');

    // jsPDF の存在チェック
    if (typeof window.jspdf !== 'undefined' || typeof window.jsPDF !== 'undefined') {
      this._jspdfLoaded = true;
      console.log('[PDFGenerator] jsPDF 検出済み');
    } else {
      console.warn('[PDFGenerator] jsPDF 未検出。CDN読み込みを確認してください。');
      // jsPDF が後からロードされる可能性があるのでエラーにしない
    }

    console.log('[PDFGenerator] 初期化完了');
  },

  /**
   * jsPDF インスタンスを取得
   * window.jspdf.jsPDF or window.jsPDF のどちらでも対応
   */
  _getJsPDFClass() {
    if (typeof window.jspdf !== 'undefined' && window.jspdf.jsPDF) {
      return window.jspdf.jsPDF;
    }
    if (typeof window.jsPDF !== 'undefined') {
      return window.jsPDF;
    }
    return null;
  },

  /* ============================================
     PDF生成（1言語分）
     ============================================ */

  /**
   * 1言語分のPDFを生成してダウンロード
   *
   * @param {object} labelData - { product, translation, settings, lang, country }
   * @param {object} settings - ラベル設定
   */
  async generatePDF(labelData, settings) {
    const JsPDF = this._getJsPDFClass();

    if (!JsPDF) {
      console.warn('[PDFGenerator] jsPDF未読み込み、HTML2Canvas フォールバックを試行');
      await this._fallbackDownload(labelData);
      return;
    }

    try {
      const doc = this._createDocument(settings);

      // フォント設定
      await this._setupFonts(doc, labelData.lang);

      // ラベル描画
      this._drawLabel(doc, labelData, settings);

      // ファイル名生成
      const fileName = this._generateFileName(labelData);

      // ダウンロード
      doc.save(fileName);

      console.log(`[PDFGenerator] PDF生成完了: ${fileName}`);
    } catch (err) {
      console.error('[PDFGenerator] PDF生成エラー:', err);
      // フォールバック
      await this._fallbackDownload(labelData);
    }
  },

  /* ============================================
     PDF生成（全言語一括）
     ============================================ */

  /**
   * 全言語を1つのPDFにまとめて生成
   *
   * @param {object[]} allLabels - 各言語のラベルデータ配列
   * @param {object} settings - ラベル設定
   */
  async generateBulkPDF(allLabels, settings) {
    const JsPDF = this._getJsPDFClass();

    if (!JsPDF) {
      console.warn('[PDFGenerator] jsPDF未読み込み、個別フォールバック');
      for (const label of allLabels) {
        await this._fallbackDownload(label);
      }
      return;
    }

    try {
      const doc = this._createDocument(settings);

      for (let i = 0; i < allLabels.length; i++) {
        if (i > 0) {
          doc.addPage([settings.width, settings.height], settings.width > settings.height ? 'landscape' : 'portrait');
        }

        const labelData = allLabels[i];
        await this._setupFonts(doc, labelData.lang);
        this._drawLabel(doc, labelData, settings);
      }

      // ファイル名
      const productName = allLabels[0]?.product?.productName || 'label';
      const fileName = `${productName}_all_${allLabels.length}lang.pdf`;

      doc.save(fileName);
      console.log(`[PDFGenerator] 一括PDF生成完了: ${fileName} (${allLabels.length}言語)`);
    } catch (err) {
      console.error('[PDFGenerator] 一括PDF生成エラー:', err);
      throw err;
    }
  },

  /* ============================================
     jsPDF ドキュメント作成
     ============================================ */

  /**
   * jsPDF ドキュメントを作成
   * ラベルサイズに合わせた用紙設定
   */
  _createDocument(settings) {
    const JsPDF = this._getJsPDFClass();
    const width = settings.width || 80;
    const height = settings.height || 50;

    // mm単位でカスタムサイズ指定
    const orientation = width > height ? 'landscape' : 'portrait';

    const doc = new JsPDF({
      orientation: orientation,
      unit: 'mm',
      format: [width, height],
      compress: true,
    });

    return doc;
  },

  /* ============================================
     フォント設定
     ============================================ */

  /**
   * 言語に応じたフォントを設定
   * Noto Sans系フォントを使用（埋め込み or 標準フォント）
   *
   * 注: jsPDF のフォント埋め込みは容量が大きいため、
   * 実運用では Workers 側でフォントを提供するか、
   * html2canvas + jsPDF の組み合わせを使う
   */
  async _setupFonts(doc, lang) {
    // jsPDF 標準フォントで対応できる言語
    const standardFontLangs = ['en', 'fr', 'de', 'es', 'pt', 'it', 'nl'];

    if (standardFontLangs.includes(lang)) {
      doc.setFont('helvetica', 'normal');
      return;
    }

    // CJK・タイ・アラビア等は追加フォントが必要
    // 実装時はフォントファイルを base64 で埋め込むか、
    // サーバーサイドPDF生成に切り替える
    //
    // 現在はフォールバックとして helvetica を使用
    // （CJK文字は表示されないが、PDF構造は正しく生成される）
    try {
      const fontData = await this._loadFont(lang);
      if (fontData) {
        doc.addFileToVFS(fontData.fileName, fontData.base64);
        doc.addFont(fontData.fileName, fontData.fontName, 'normal');
        doc.setFont(fontData.fontName, 'normal');
        console.log(`[PDFGenerator] フォント設定: ${fontData.fontName}`);
        return;
      }
    } catch (err) {
      console.warn(`[PDFGenerator] フォントロード失敗 (${lang}):`, err.message);
    }

    // フォールバック
    doc.setFont('helvetica', 'normal');
  },

  /**
   * 言語用フォントをロード
   * Workers API経由でフォントデータを取得
   * 取得できない場合は null を返す
   */
  async _loadFont(lang) {
    // キャッシュ確認
    if (this._fontCache[lang]) return this._fontCache[lang];

    // フォントマッピング
    const fontMap = {
      ja: { fontName: 'NotoSansJP', fileName: 'NotoSansJP-Regular.ttf' },
      'zh-CN': { fontName: 'NotoSansSC', fileName: 'NotoSansSC-Regular.ttf' },
      'zh-TW': { fontName: 'NotoSansTC', fileName: 'NotoSansTC-Regular.ttf' },
      ko: { fontName: 'NotoSansKR', fileName: 'NotoSansKR-Regular.ttf' },
      th: { fontName: 'NotoSansThai', fileName: 'NotoSansThai-Regular.ttf' },
      ar: { fontName: 'NotoSansArabic', fileName: 'NotoSansArabic-Regular.ttf' },
      hi: { fontName: 'NotoSansDevanagari', fileName: 'NotoSansDevanagari-Regular.ttf' },
      ru: { fontName: 'NotoSans', fileName: 'NotoSans-Regular.ttf' },
      vi: { fontName: 'NotoSans', fileName: 'NotoSans-Regular.ttf' },
      id: { fontName: 'NotoSans', fileName: 'NotoSans-Regular.ttf' },
      ms: { fontName: 'NotoSans', fileName: 'NotoSans-Regular.ttf' },
    };

    const mapping = fontMap[lang];
    if (!mapping) return null;

    try {
      // Workers API からフォントデータを取得
      const res = await fetch(`/api/font/${mapping.fileName}`);
      if (!res.ok) return null;

      const blob = await res.blob();
      const base64 = await this._blobToBase64(blob);

      const fontData = {
        fontName: mapping.fontName,
        fileName: mapping.fileName,
        base64: base64,
      };

      // キャッシュ
      this._fontCache[lang] = fontData;
      return fontData;
    } catch (err) {
      return null;
    }
  },

  /* ============================================
     ラベル描画
     ============================================ */

  /**
   * jsPDF にラベルを描画
   */
  _drawLabel(doc, labelData, settings) {
    const width = settings.width || 80;
    const height = settings.height || 50;
    const margin = 3; // mm
    const t = labelData.translation || {};
    const p = labelData.product || {};
    const lang = labelData.lang || 'ja';

    // 背景色
    if (settings.backgroundColor && settings.backgroundColor !== '#ffffff') {
      const rgb = this._hexToRgb(settings.backgroundColor);
      doc.setFillColor(rgb.r, rgb.g, rgb.b);
      doc.rect(0, 0, width, height, 'F');
    }

    // テキスト色
    const textRgb = this._hexToRgb(settings.textColor || '#000000');
    doc.setTextColor(textRgb.r, textRgb.g, textRgb.b);

    // 描画位置管理
    let y = margin;
    const contentWidth = width - margin * 2;

    // ロゴ描画
    if (settings.logoBase64) {
      try {
        const logoWidth = 15;
        const logoHeight = 8;
        doc.addImage(settings.logoBase64, 'PNG', margin, y, logoWidth, logoHeight);
        y += logoHeight + 1;
      } catch (err) {
        console.warn('[PDFGenerator] ロゴ描画スキップ:', err.message);
      }
    }

    // 製品名（太字・大きめ）
    const productName = t.productName || p.productName || '';
    if (productName) {
      doc.setFontSize(this._calcPdfFontSize(settings, 'title'));
      const nameLines = doc.splitTextToSize(productName, contentWidth);
      doc.text(nameLines, margin, y + 3);
      y += nameLines.length * 3.5 + 1;
    }

    // 区切り線
    doc.setDrawColor(100, 100, 100);
    doc.setLineWidth(0.2);
    doc.line(margin, y, width - margin, y);
    y += 1.5;

    // 原材料名
    const ingredients = t.ingredients || p.ingredients?.map(i => i.name) || [];
    if (ingredients.length > 0) {
      doc.setFontSize(this._calcPdfFontSize(settings, 'body'));
      const labels = t.labels || {};
      const ingredientTitle = labels.ingredients || '原材料名';
      const ingredientText = `${ingredientTitle}: ${ingredients.join(', ')}`;
      const ingLines = doc.splitTextToSize(ingredientText, contentWidth);
      doc.text(ingLines, margin, y + 2.5);
      y += ingLines.length * 2.5 + 1;
    }

    // アレルゲン
    const allergens = t.allergens || [];
    if (allergens.length > 0) {
      doc.setFontSize(this._calcPdfFontSize(settings, 'body'));
      const allergenText = this._formatAllergenForPDF(allergens, labelData.country, t.labels);
      const allergenLines = doc.splitTextToSize(allergenText, contentWidth);
      doc.text(allergenLines, margin, y + 2.5);
      y += allergenLines.length * 2.5 + 1;
    }

    // 栄養成分表
    if (p.nutritionFacts && p.nutritionFacts.length > 0) {
      y = this._drawNutritionTable(doc, p.nutritionFacts, t.nutritionNames || [], t.labels || {}, margin, y, contentWidth, settings);
    }

    // 製造者・原産国等
    doc.setFontSize(this._calcPdfFontSize(settings, 'small'));
    const metaLines = [];
    if (p.manufacturer) {
      const mfLabel = t.labels?.manufacturer || '製造者';
      metaLines.push(`${mfLabel}: ${t.manufacturer || p.manufacturer}`);
    }
    if (p.origin) {
      const orLabel = t.labels?.origin || '原産国';
      metaLines.push(`${orLabel}: ${t.origin || p.origin}`);
    }
    if (p.weight) {
      metaLines.push(`${p.weight}${p.weightUnit}`);
    }
    if (p.expiryFormat) {
      const exLabel = t.labels?.expiry || '賞味期限';
      metaLines.push(`${exLabel}: ${p.expiryFormat}`);
    }
    if (p.storageInstructions) {
      const stLabel = t.labels?.storage || '保存方法';
      metaLines.push(`${stLabel}: ${t.storageInstructions || p.storageInstructions}`);
    }

    for (const line of metaLines) {
      if (y + 3 > height - margin) break; // 領域超えたら打ち切り
      const wrapped = doc.splitTextToSize(line, contentWidth);
      doc.text(wrapped, margin, y + 2.5);
      y += wrapped.length * 2.2 + 0.5;
    }
  },

  /**
   * 栄養成分表をPDFに描画
   */
  _drawNutritionTable(doc, facts, translatedNames, labels, x, startY, width, settings) {
    let y = startY;
    const title = labels.nutrition || '栄養成分表示';
    const fontSize = this._calcPdfFontSize(settings, 'small');

    doc.setFontSize(fontSize);

    // タイトル
    doc.setFont(undefined, 'bold');
    doc.text(title, x, y + 2.5);
    y += 3;

    // 区切り線
    doc.setLineWidth(0.3);
    doc.line(x, y, x + width, y);
    y += 1;

    doc.setFont(undefined, 'normal');

    // 各栄養素
    for (let i = 0; i < facts.length; i++) {
      const name = translatedNames[i] || facts[i].name;
      const value = `${facts[i].per100g}${facts[i].unit}`;

      doc.text(name, x + 1, y + 2);
      doc.text(value, x + width - 1, y + 2, { align: 'right' });

      doc.setLineWidth(0.1);
      doc.line(x, y + 3, x + width, y + 3);
      y += 3;
    }

    y += 1;
    return y;
  },

  /**
   * アレルゲンのPDF用テキストをフォーマット
   */
  _formatAllergenForPDF(allergenNames, country, labels) {
    // 国ごとのフォーマット
    const rule = (typeof LegalDisplayEngine !== 'undefined' && LegalDisplayEngine.rules)
      ? (LegalDisplayEngine.rules[country] || {})
      : {};

    switch (rule.allergenFormat) {
      case 'parentheses':
        return `（一部に${allergenNames.join('・')}を含む）`;
      case 'bold':
      case 'contains':
      case 'contains_bold':
      default:
        return `${labels?.contains || 'Contains:'} ${allergenNames.join(', ')}`;
    }
  },

  /* ============================================
     プレビューキャンバス描画
     ============================================ */

  /**
   * プレビュー用にキャンバスに描画
   * HTMLプレビューの代替として使用可能
   *
   * @param {object} labelData - ラベルデータ
   * @param {HTMLCanvasElement} canvasElement - 描画先Canvas
   */
  renderPreview(labelData, canvasElement) {
    if (!canvasElement) return;

    const settings = labelData.settings || {};
    const scale = 3; // 表示スケール（300DPI相当）

    const width = (settings.width || 80) * scale;
    const height = (settings.height || 50) * scale;

    canvasElement.width = width;
    canvasElement.height = height;

    const ctx = canvasElement.getContext('2d');
    if (!ctx) return;

    // 背景
    ctx.fillStyle = settings.backgroundColor || '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // 枠線
    ctx.strokeStyle = '#333333';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, width, height);

    // テキスト描画
    ctx.fillStyle = settings.textColor || '#000000';
    const fontSize = Math.max(12, Math.round(width / 25));
    ctx.font = `${fontSize}px "Noto Sans JP", sans-serif`;

    const t = labelData.translation || {};
    const p = labelData.product || {};
    const padding = 10;
    let y = padding + fontSize;

    // RTL対応
    const lang = labelData.lang || 'ja';
    const isRTL = (typeof SUPPORTED_LANGUAGES !== 'undefined' && SUPPORTED_LANGUAGES[lang]?.dir === 'rtl');
    if (isRTL) {
      ctx.direction = 'rtl';
      ctx.textAlign = 'right';
    }

    const xPos = isRTL ? width - padding : padding;

    // 製品名
    const productName = t.productName || p.productName || '';
    if (productName) {
      ctx.font = `bold ${fontSize * 1.2}px "Noto Sans JP", sans-serif`;
      ctx.fillText(productName, xPos, y);
      y += fontSize * 1.5;
    }

    ctx.font = `${fontSize * 0.8}px "Noto Sans JP", sans-serif`;
    const smallFont = fontSize * 0.8;

    // 原材料
    const ingredients = t.ingredients || p.ingredients?.map(i => i.name) || [];
    if (ingredients.length > 0) {
      const text = `${t.labels?.ingredients || '原材料名'}: ${ingredients.join(', ')}`;
      const maxWidth = width - padding * 2;
      const lines = this._wrapCanvasText(ctx, text, maxWidth);
      for (const line of lines) {
        if (y + smallFont > height - padding) break;
        ctx.fillText(line, xPos, y);
        y += smallFont * 1.3;
      }
    }

    // アレルゲン
    const allergens = t.allergens || [];
    if (allergens.length > 0) {
      const text = this._formatAllergenForPDF(allergens, labelData.country, t.labels);
      ctx.fillText(text, xPos, y);
      y += smallFont * 1.3;
    }

    // 栄養成分（簡易表示）
    if (p.nutritionFacts && p.nutritionFacts.length > 0) {
      y += smallFont * 0.5;
      ctx.font = `bold ${smallFont}px "Noto Sans JP", sans-serif`;
      ctx.fillText(t.labels?.nutrition || '栄養成分表示', xPos, y);
      y += smallFont * 1.2;

      ctx.font = `${smallFont * 0.9}px "Noto Sans JP", sans-serif`;
      for (let i = 0; i < p.nutritionFacts.length; i++) {
        if (y + smallFont > height - padding) break;
        const name = (t.nutritionNames || [])[i] || p.nutritionFacts[i].name;
        const val = `${p.nutritionFacts[i].per100g}${p.nutritionFacts[i].unit}`;
        ctx.fillText(`${name}  ${val}`, xPos, y);
        y += smallFont * 1.1;
      }
    }

    // メタ情報
    y += smallFont * 0.5;
    ctx.font = `${smallFont * 0.85}px "Noto Sans JP", sans-serif`;
    if (p.manufacturer && y + smallFont < height - padding) {
      ctx.fillText(`${t.labels?.manufacturer || '製造者'}: ${t.manufacturer || p.manufacturer}`, xPos, y);
      y += smallFont;
    }
    if (p.origin && y + smallFont < height - padding) {
      ctx.fillText(`${t.labels?.origin || '原産国'}: ${t.origin || p.origin}`, xPos, y);
    }
  },

  /* ============================================
     フォールバックダウンロード
     ============================================ */

  /**
   * jsPDF が使えない場合のフォールバック
   * HTML → Blob → ダウンロードリンク生成
   */
  async _fallbackDownload(labelData) {
    // LegalDisplayEngine でHTMLを生成
    let html = '';

    if (typeof LegalDisplayEngine !== 'undefined') {
      try {
        const result = LegalDisplayEngine.generateLabel(
          { product: labelData.product, translation: labelData.translation, settings: labelData.settings },
          labelData.country,
          labelData.lang
        );
        html = result.html;
      } catch (err) {
        console.warn('[PDFGenerator] フォールバックHTML生成エラー:', err);
      }
    }

    if (!html) {
      html = `<div style="padding:20px;"><h2>${labelData.product?.productName || ''}</h2><p>PDF生成にはjsPDFライブラリが必要です。</p></div>`;
    }

    // HTML文書として構成
    const fullHtml = `<!DOCTYPE html>
<html lang="${labelData.lang || 'ja'}">
<head>
  <meta charset="UTF-8">
  <title>${labelData.product?.productName || 'Label'} - ${labelData.lang || ''}</title>
  <style>
    @media print {
      @page { size: ${labelData.settings?.width || 80}mm ${labelData.settings?.height || 50}mm; margin: 0; }
      body { margin: 0; }
    }
    body { font-family: "Noto Sans JP", sans-serif; margin: 0; padding: 0; }
  </style>
</head>
<body>${html}</body>
</html>`;

    // Blobダウンロード
    const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this._generateFileName(labelData).replace('.pdf', '.html');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    console.log('[PDFGenerator] フォールバック: HTML形式でダウンロード');
  },

  /* ============================================
     ユーティリティ
     ============================================ */

  /**
   * ファイル名を生成
   */
  _generateFileName(labelData) {
    const productName = (labelData.product?.productName || 'label').replace(/[\\/:*?"<>|]/g, '_');
    const lang = labelData.lang || 'unknown';
    const date = new Date().toISOString().slice(0, 10);
    return `${productName}_${lang}_${date}.pdf`;
  },

  /**
   * PDFフォントサイズを計算
   * @param {object} settings - ラベル設定
   * @param {string} type - 'title' | 'body' | 'small'
   */
  _calcPdfFontSize(settings, type) {
    // ラベルサイズに応じてフォントサイズを調整
    const area = (settings.width || 80) * (settings.height || 50);
    const baseSize = Math.max(5, Math.min(12, area / 800));

    switch (type) {
      case 'title': return Math.round(baseSize * 1.4);
      case 'body': return Math.round(baseSize);
      case 'small': return Math.round(baseSize * 0.85);
      default: return Math.round(baseSize);
    }
  },

  /**
   * 16進カラーをRGBに変換
   */
  _hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (result) {
      return {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      };
    }
    return { r: 0, g: 0, b: 0 };
  },

  /**
   * Blob を base64 文字列に変換
   */
  _blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  },

  /**
   * Canvas用テキスト折り返し
   */
  _wrapCanvasText(ctx, text, maxWidth) {
    const words = text.split('');
    const lines = [];
    let currentLine = '';

    for (const char of words) {
      const testLine = currentLine + char;
      const metrics = ctx.measureText(testLine);

      if (metrics.width > maxWidth && currentLine.length > 0) {
        lines.push(currentLine);
        currentLine = char;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) lines.push(currentLine);

    return lines;
  },
};
