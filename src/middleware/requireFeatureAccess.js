const logger = require("../util/logger");
const {
  isFeatureEnabledForUser,
  roleFor,
} = require("../core/security/featureAccess");

function requireFeatureAccess(featureKey) {
  return async (req, res, next) => {
    try {
      const enabled = await isFeatureEnabledForUser(req.user, featureKey);
      if (!enabled) {
        logger.warn("auth.feature_access_denied", {
          userId: req.user?.id,
          role: roleFor(req.user),
          feature: featureKey,
          path: req.originalUrl,
        });
        return res.status(403).json({
          code: "FEATURE_ACCESS_DENIED",
          message: "This feature is not enabled for this account.",
        });
      }

      return next();
    } catch (err) {
      logger.error("auth.feature_access_check_failed", err, {
        userId: req.user?.id,
        feature: featureKey,
      });
      return res.status(503).json({
        code: "FEATURE_ACCESS_UNAVAILABLE",
        message: "Feature access check is temporarily unavailable.",
      });
    }
  };
}

module.exports = { requireFeatureAccess };
