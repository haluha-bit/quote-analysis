/* ================================================================
   DEPRECATED — logic has moved to js/services/quoteService.js
   This file exists only as a compatibility shim.
================================================================ */

import { quoteService } from '../services/quoteService.js';

export const getAllQuotes  = ()       => quoteService.getAll();
export const getQuote      = id       => quoteService.getById(id);
export const createQuote   = data     => quoteService.create(data);
export const deleteQuote   = id       => quoteService.remove(id);
export const filterQuotes  = filters  => quoteService.filter(filters);
export const getSuppliers  = ()       => quoteService.getSuppliers();
