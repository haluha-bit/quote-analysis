/* ================================================================
   Line Service — production line CRUD
================================================================ */

import { api }     from '../data/api.js';
import { loading } from './_loading.js';

export const lineService = {
  async getAll() {
    loading.start('lines.getAll');
    try {
      return await api.get('/lines');
    } catch (err) {
      throw new Error(`加载产线失败：${err.message}`);
    } finally {
      loading.end('lines.getAll');
    }
  },

  async getById(id) {
    const lines = await this.getAll();
    return lines.find(l => l.id === id) ?? null;
  },

  async add(line) {
    loading.start('lines.add');
    try {
      return await api.post('/lines', line);
    } catch (err) {
      throw new Error(`新增产线失败：${err.message}`);
    } finally {
      loading.end('lines.add');
    }
  },

  async update(id, patch) {
    loading.start(`lines.update.${id}`);
    try {
      return await api.put(`/lines/${id}`, patch);
    } catch (err) {
      throw new Error(`更新产线失败：${err.message}`);
    } finally {
      loading.end(`lines.update.${id}`);
    }
  },

  async remove(id) {
    loading.start(`lines.delete.${id}`);
    try {
      return await api.delete(`/lines/${id}`);
    } catch (err) {
      throw new Error(`删除产线失败：${err.message}`);
    } finally {
      loading.end(`lines.delete.${id}`);
    }
  },
};
