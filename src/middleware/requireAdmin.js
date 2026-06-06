const logger = require("../util/logger");
const { authenticate } = require("./authenticate");
const { requireFeatureAccess } = require("./requireFeatureAccess");

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
    const feature = featureForPath(req);
    if (!feature) return next();
    return requireFeatureAccess(feature)(req, res, next);
  });
}

module.exports = { requireAdmin };
