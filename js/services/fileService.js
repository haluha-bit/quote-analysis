/* ================================================================
   File Service — upload to server, build download/view URLs
================================================================ */

import { api }     from '../data/api.js';
import { loading } from './_loading.js';

export const fileService = {
  /** Upload a File object; returns { file_id, normalized } from server AI extraction. */
  async upload(file) {
    loading.start('file.upload');
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await api.upload('/files/upload', form);
      return { file_id: res.file_id, normalized: res.normalized ?? {} };
    } catch (err) {
      throw new Error(`文件上传失败：${err.message}`);
    } finally {
      loading.end('file.upload');
    }
  },

  /** Build the full URL to open/download a stored file. */
  url(fileId) {
    return api.fileUrl(fileId);
  },
};
