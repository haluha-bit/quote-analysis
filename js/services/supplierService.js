/* ================================================================
   Supplier Service — supplier registry CRUD
================================================================ */

import { api }     from '../data/api.js';
import { loading } from './_loading.js';

export const supplierService = {
  async getAll() {
    loading.start('suppliers.getAll');
    try {
      return await api.get('/suppliers');
    } catch (err) {
      throw new Error(`加载供应商列表失败：${err.message}`);
    } finally {
      loading.end('suppliers.getAll');
    }
  },

  async ensure(name) {
    const trimmed = (name ?? '').trim();
    if (!trimmed) return null;
    loading.start('suppliers.ensure');
    try {
      return await api.post('/suppliers', { name: trimmed });
    } catch (err) {
      throw new Error(`注册供应商失败：${err.message}`);
    } finally {
      loading.end('suppliers.ensure');
    }
  },
};
