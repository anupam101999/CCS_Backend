const logger = require("../util/logger");
const { authenticate } = require("./authenticate");
const { isFeatureEnabledForUser, roleFor } = require("../core/security/featureAccess");

function featureForPath(req) {
  const path = String(req.originalUrl || "").split("?")[0].replace(/\/+$/, "");
  if (path === "/api/admin/stats") return "dashboard";
  if (path === "/api/admin/users") return "customer_switch";
  if (path.includes("/appointments")) return "appointments";
  if (path.includes("/tickets")) return "tickets";
  if (path.includes("/projects") || path.includes("/project-photo")) return "projects";
  if (path === "/api/admin/logs") return "logs";
  return "";
}

function requireAdmin(req, res, next) {
  return authenticate(req, res, async () => {
    if (!req.user.is_superadmin && !req.user.is_admin && !req.user.is_manager) {
      logger.warn("auth.admin_access_denied", {
        method: req.method,
        path: req.originalUrl,
        userId: req.user.id,
      });
      return res.status(403).json({ message: "Admin access required." });
    }

    req.adminId = req.user.id;
    const feature = featureForPath(req);
    if (!feature || req.user.is_superadmin) return next();

    try {
      const enabled = await isFeatureEnabledForUser(req.user, feature);
      if (!enabled) {
        logger.warn("auth.feature_access_denied", {
          userId: req.user.id,
          role: roleFor(req.user),
          feature,
          path: req.originalUrl,
        });
        return res.status(403).json({
          code: "FEATURE_ACCESS_DENIED",
          message: "This feature is not enabled for your role.",
        });
      }
      return next();
    } catch (err) {
      logger.error("auth.feature_access_check_failed", err, {
        userId: req.user.id,
        feature,
      });
      return res.status(503).json({
        code: "FEATURE_ACCESS_UNAVAILABLE",
        message: "Feature access check is temporarily unavailable.",
      });
    }
  });
}

module.exports = { requireAdmin };
