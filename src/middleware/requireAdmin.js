const logger = require("../util/logger");
const { authenticate } = require("./authenticate");

function requireAdmin(req, res, next) {
  return authenticate(req, res, () => {
    if (!req.user.is_admin && !req.user.is_manager) {
      logger.warn("auth.admin_access_denied", {
        method: req.method,
        path: req.originalUrl,
        userId: req.user.id,
      });
      return res.status(403).json({ message: "Admin access required." });
    }

    if (req.user.is_manager) {
      const path = String(req.originalUrl || "").split("?")[0].replace(/\/+$/, "");
      const canSearchCustomers =
        ["GET", "HEAD", "OPTIONS"].includes(req.method) &&
        path === "/api/admin/users";

      if (canSearchCustomers) {
        req.adminId = req.user.id;
        return next();
      }

      logger.warn("auth.manager_scope_denied", {
        method: req.method,
        path: req.originalUrl,
        userId: req.user.id,
      });
      return res.status(403).json({
        code: "MANAGER_SCOPE_DENIED",
        message: "Managers can only search for and view customer accounts.",
      });
    }

    req.adminId = req.user.id;
    return next();
  });
}

module.exports = { requireAdmin };
