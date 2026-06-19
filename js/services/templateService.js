/* ================================================================
   Template Service — per-supplier learned defaults
================================================================ */

import { api } from '../data/api.js';

export const templateService = {
  async get(supplier) {
    try {
      return await api.get(`/templates/${encodeURIComponent(supplier)}`);
    } catch {
      return null;
    }
  },

  async save(supplier, data) {
    try {
      await api.post('/templates', { supplier, ...data });
    } catch {
      // non-critical — silently ignore
    }
  },
};
