const logger = require("../util/logger");
const { authenticate } = require("./authenticate");

function requireAdmin(req, res, next) {
  return authenticate(req, res, () => {
    if (!req.user.is_superadmin && !req.user.is_admin && !req.user.is_manager) {
      logger.warn("auth.admin_access_denied", {
        method: req.method,
        path: req.originalUrl,
        userId: req.user.id,
      });
      return res.status(403).json({ message: "Admin access required." });
    }

    req.adminId = req.user.id;
    return next();
  });
}

module.exports = { requireAdmin };
