const logger = require("../util/logger");
const { authenticate } = require("./authenticate");

function requireSession(req, res, next) {
  return authenticate(req, res, () => {
    if (
      req.user.is_manager &&
      !["GET", "HEAD", "OPTIONS"].includes(req.method)
    ) {
      logger.warn("auth.manager_readonly_denied", {
        method: req.method,
        path: req.originalUrl,
        userId: req.user.id,
        viewAsUserId: req.headers["x-view-as-user-id"],
      });
      return res.status(403).json({
        message: "Manager view is read-only for customer accounts.",
      });
    }

    return next();
  });
}

module.exports = { requireSession };
