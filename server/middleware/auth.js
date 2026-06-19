/* ================================================================
   Auth Middleware — reads X-User header set by the frontend
================================================================ */

function _decodeUser(raw) {
  if (!raw) return null;
  try { return decodeURIComponent(raw); } catch { return raw; }
}

function requireUser(req, res, next) {
  const user = _decodeUser(req.headers['x-user']);
  if (!user) return res.status(401).json({ error: '未登录，请先登录' });
  req.user = user;
  next();
}

/** Attach user from header (no 401 if missing) */
function attachUser(req, res, next) {
  req.user = _decodeUser(req.headers['x-user']) || 'anonymous';
  next();
}

module.exports = { requireUser, attachUser };
