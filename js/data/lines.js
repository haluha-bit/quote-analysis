/* ================================================================
   DEPRECATED — logic has moved to js/services/lineService.js
   This file exists only as a compatibility shim.
================================================================ */

import { lineService } from '../services/lineService.js';

export const getAllLines  = ()         => lineService.getAll();
export const getLineById = (_store, id) => lineService.getById(id);
export const seedLines   = ()         => Promise.resolve();
export const addLine     = line       => lineService.add(line);
export const updateLine  = (id, patch) => lineService.update(id, patch);
export const deleteLine  = id         => lineService.remove(id);
