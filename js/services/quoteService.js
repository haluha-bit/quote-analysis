/* ================================================================
   Quote Service — all quote CRUD and client-side query helpers
================================================================ */

import { api }     from '../data/api.js';
import { loading } from './_loading.js';

export const quoteService = {
  /* ── Remote operations ───────────────────────────────────── */

  async getAll() {
    loading.start('quotes.getAll');
    try {
      return await api.get('/quotes');
    } catch (err) {
      throw new Error(`加载报价列表失败：${err.message}`);
    } finally {
      loading.end('quotes.getAll');
    }
  },

  async getById(id) {
    loading.start(`quotes.get.${id}`);
    try {
      return await api.get(`/quotes/${id}`);
    } catch (err) {
      throw new Error(`加载报价失败：${err.message}`);
    } finally {
      loading.end(`quotes.get.${id}`);
    }
  },

  async create(data) {
    loading.start('quotes.create');
    try {
      return await api.post('/quotes', data);
    } catch (err) {
      throw new Error(`创建报价失败：${err.message}`);
    } finally {
      loading.end('quotes.create');
    }
  },

  async remove(id) {
    loading.start(`quotes.delete.${id}`);
    try {
      return await api.delete(`/quotes/${id}`);
    } catch (err) {
      throw new Error(`删除报价失败：${err.message}`);
    } finally {
      loading.end(`quotes.delete.${id}`);
    }
  },

  /* ── Client-side query helpers (no extra round-trip) ─────── */

  async filter({ supplier, lineId, equipment } = {}) {
    const all = await this.getAll();
    return all.filter(q => {
      if (supplier  && q.supplier !== supplier)                    return false;
      if (lineId    && q.line_id  !== lineId)                      return false;
      if (equipment && !(q.equipment ?? []).includes(equipment))   return false;
      return true;
    });
  },

  async getSuppliers() {
    const all = await this.getAll();
    return [...new Set(all.map(q => q.supplier).filter(Boolean))].sort();
  },
};
