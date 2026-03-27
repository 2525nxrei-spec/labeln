/**
 * functions/api/labels/ 全エンドポイントのテスト
 * POST /api/labels, GET /api/labels, GET /api/labels/:id, DELETE /api/labels/:id, POST /api/labels/:id/pdf
 */

import { describe, it, expect } from 'vitest';
import { createMockEnv, createMockContext, createTestJWT, parseResponse } from './helpers.js';

import { onRequestPost as createLabel, onRequestGet as listLabels } from '../functions/api/labels/index.js';
import { onRequestGet as getLabel, onRequestDelete as deleteLabel } from '../functions/api/labels/[id]/index.js';
import { onRequestPost as uploadPdf } from '../functions/api/labels/[id]/pdf.js';

describe('ラベルAPI', () => {
  const userId = 'user-label-test';
  const email = 'label@example.com';

  // ─── POST /api/labels ───
  describe('POST /api/labels（ラベル作成）', () => {
    it('認証なしで401を返す', async () => {
      const env = createMockEnv();
      const request = new Request('https://mylabeln.com/api/labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
        body: JSON.stringify({ product_name: 'テスト商品' }),
      });
      const response = await createLabel(createMockContext(request, env));
      expect(response.status).toBe(401);
    });

    it('有効な入力でラベルを作成する（201）', async () => {
      const env = createMockEnv();
      env.DB._tables.users.push({ id: userId, email, plan: 'standard' });

      const token = await createTestJWT(userId, email, env.JWT_SECRET);
      const request = new Request('https://mylabeln.com/api/labels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
        },
        body: JSON.stringify({
          product_name: 'テスト醤油',
          category: '調味料',
          ingredients: ['大豆', '小麦', '食塩'],
          allergens: ['大豆', '小麦'],
          nutrition: { calories: 15, protein: 1.3 },
        }),
      });
      const response = await createLabel(createMockContext(request, env));
      const { status, data } = await parseResponse(response);

      expect(status).toBe(201);
      expect(data.id).toBeDefined();
      expect(data.product_name).toBe('テスト醤油');
    });

    it('freeプランで月間上限超過時に403を返す', async () => {
      const env = createMockEnv();
      env.DB._tables.users.push({ id: userId, email, plan: 'free' });
      // freeプランは月3件まで → 既に3件使用済みにする
      const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
      env.DB._tables.usage.push({ id: 'usage-1', user_id: userId, month, label_count: 3 });

      const token = await createTestJWT(userId, email, env.JWT_SECRET);
      const request = new Request('https://mylabeln.com/api/labels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
        },
        body: JSON.stringify({ product_name: '上限テスト商品' }),
      });
      const response = await createLabel(createMockContext(request, env));
      expect(response.status).toBe(403);
    });

    it('product_name未設定で400を返す', async () => {
      const env = createMockEnv();
      env.DB._tables.users.push({ id: userId, email, plan: 'standard' });

      const token = await createTestJWT(userId, email, env.JWT_SECRET);
      const request = new Request('https://mylabeln.com/api/labels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
        },
        body: JSON.stringify({ category: '調味料' }),
      });
      const response = await createLabel(createMockContext(request, env));
      expect(response.status).toBe(400);
    });
  });

  // ─── GET /api/labels ───
  describe('GET /api/labels（ラベル一覧）', () => {
    it('認証なしで401を返す', async () => {
      const env = createMockEnv();
      const request = new Request('https://mylabeln.com/api/labels', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
      });
      const response = await listLabels(createMockContext(request, env));
      expect(response.status).toBe(401);
    });

    it('認証済みで空の一覧を返す', async () => {
      const env = createMockEnv();
      const token = await createTestJWT(userId, email, env.JWT_SECRET);
      const request = new Request('https://mylabeln.com/api/labels?page=1&limit=20', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
        },
      });
      const response = await listLabels(createMockContext(request, env));
      const { status, data } = await parseResponse(response);

      expect(status).toBe(200);
      expect(data.labels).toBeDefined();
      expect(data.page).toBe(1);
    });
  });

  // ─── GET /api/labels/:id ───
  describe('GET /api/labels/:id（ラベル詳細）', () => {
    it('認証なしで401を返す', async () => {
      const env = createMockEnv();
      const request = new Request('https://mylabeln.com/api/labels/label-1', {
        method: 'GET',
        headers: { 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
      });
      const response = await getLabel(createMockContext(request, env, { id: 'label-1' }));
      expect(response.status).toBe(401);
    });

    it('存在しないラベルIDで404を返す', async () => {
      const env = createMockEnv();
      const token = await createTestJWT(userId, email, env.JWT_SECRET);
      const request = new Request('https://mylabeln.com/api/labels/nonexistent', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
        },
      });
      const response = await getLabel(createMockContext(request, env, { id: 'nonexistent' }));
      expect(response.status).toBe(404);
    });

    it('存在するラベルを取得する（200）', async () => {
      const env = createMockEnv();
      env.DB._tables.labels.push({
        id: 'label-abc',
        user_id: userId,
        product_name: '醤油ラベル',
        category: '調味料',
        ingredients_json: '["大豆"]',
        allergens_json: '["大豆"]',
        nutrition_json: '{}',
        label_settings_json: '{}',
        translations_json: '{}',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      });

      const token = await createTestJWT(userId, email, env.JWT_SECRET);
      const request = new Request('https://mylabeln.com/api/labels/label-abc', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
        },
      });
      const response = await getLabel(createMockContext(request, env, { id: 'label-abc' }));
      const { status, data } = await parseResponse(response);

      expect(status).toBe(200);
      expect(data.product_name).toBe('醤油ラベル');
      expect(data.ingredients).toEqual(['大豆']);
    });
  });

  // ─── DELETE /api/labels/:id ───
  describe('DELETE /api/labels/:id（ラベル削除）', () => {
    it('認証なしで401を返す', async () => {
      const env = createMockEnv();
      const request = new Request('https://mylabeln.com/api/labels/label-1', {
        method: 'DELETE',
        headers: { 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
      });
      const response = await deleteLabel(createMockContext(request, env, { id: 'label-1' }));
      expect(response.status).toBe(401);
    });

    it('ラベル削除が成功する', async () => {
      const env = createMockEnv();
      env.DB._tables.labels.push({ id: 'label-del', user_id: userId });

      const token = await createTestJWT(userId, email, env.JWT_SECRET);
      const request = new Request('https://mylabeln.com/api/labels/label-del', {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
        },
      });
      const response = await deleteLabel(createMockContext(request, env, { id: 'label-del' }));
      const { status, data } = await parseResponse(response);
      expect(status).toBe(200);
      expect(data.deleted).toBe(true);
    });
  });

  // ─── POST /api/labels/:id/pdf ───
  describe('POST /api/labels/:id/pdf（PDF保存）', () => {
    it('認証なしで401を返す', async () => {
      const env = createMockEnv();
      const request = new Request('https://mylabeln.com/api/labels/label-1/pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf', 'CF-Connecting-IP': '127.0.0.1', Origin: 'https://mylabeln.com' },
        body: new ArrayBuffer(10),
      });
      const response = await uploadPdf(createMockContext(request, env, { id: 'label-1' }));
      expect(response.status).toBe(401);
    });

    it('ラベルが存在しない場合404を返す', async () => {
      const env = createMockEnv();
      const token = await createTestJWT(userId, email, env.JWT_SECRET);
      const request = new Request('https://mylabeln.com/api/labels/nonexistent/pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/pdf',
          Authorization: `Bearer ${token}`,
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
        },
        body: new ArrayBuffer(10),
      });
      const response = await uploadPdf(createMockContext(request, env, { id: 'nonexistent' }));
      expect(response.status).toBe(404);
    });

    it('PDFバイナリを正常にアップロードする（201）', async () => {
      const env = createMockEnv();
      env.DB._tables.labels.push({ id: 'label-pdf', user_id: userId, product_name: 'テスト' });

      const token = await createTestJWT(userId, email, env.JWT_SECRET);
      const pdfData = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // %PDF-1.4
      const request = new Request('https://mylabeln.com/api/labels/label-pdf/pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/pdf',
          Authorization: `Bearer ${token}`,
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
        },
        body: pdfData.buffer,
      });
      const response = await uploadPdf(createMockContext(request, env, { id: 'label-pdf' }));
      const { status, data } = await parseResponse(response);

      expect(status).toBe(201);
      expect(data.key).toContain('labels/label-pdf/');
      expect(data.size).toBe(8);
    });

    it('不正なContent-Typeで415を返す', async () => {
      const env = createMockEnv();
      env.DB._tables.labels.push({ id: 'label-pdf2', user_id: userId, product_name: 'テスト' });

      const token = await createTestJWT(userId, email, env.JWT_SECRET);
      const request = new Request('https://mylabeln.com/api/labels/label-pdf2/pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'CF-Connecting-IP': '127.0.0.1',
          Origin: 'https://mylabeln.com',
        },
        body: JSON.stringify({ data: 'test' }),
      });
      const response = await uploadPdf(createMockContext(request, env, { id: 'label-pdf2' }));
      expect(response.status).toBe(415);
    });
  });
});
