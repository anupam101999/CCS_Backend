const router = require("express").Router();
const pool = require("../../config/db");
const logger = require("../../util/logger");
const {
  SESSION_INACTIVITY_DAYS,
  verifyAccessToken,
} = require("../../core/security/authTokens");
const { isFeatureEnabledForUser } = require("../../core/security/featureAccess");
const { addNotificationClient } = require("../../services/notificationEvents");

async function authenticateStream(req, res, next) {
  const authHeader = String(req.headers.authorization || "");
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    return res.status(401).json({ code: "ACCESS_TOKEN_MISSING", message: "Unauthorized." });
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    const expired = err?.name === "TokenExpiredError";
    logger.warn("notifications.stream_token_rejected", {
      reason: expired ? "expired" : "invalid",
    });
    return res.status(401).json({
      code: expired ? "ACCESS_TOKEN_EXPIRED" : "ACCESS_TOKEN_INVALID",
      message: expired ? "Access token expired." : "Unauthorized.",
    });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE auth_sessions s
       SET last_active_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
       FROM users u
       WHERE s.session_id = $1
         AND s.user_id = $2
         AND u.id = s.user_id
         AND u.access_disabled = FALSE
         AND s.last_active_at > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata') - ($3 || ' days')::INTERVAL
       RETURNING s.user_id, u.email, u.is_superadmin, u.is_admin, u.is_manager`,
      [payload.sid, payload.sub, SESSION_INACTIVITY_DAYS],
    );
    const session = rows[0];

    if (!session) {
      return res.status(401).json({
        code: "SESSION_INVALID",
        message: "Session invalid or expired.",
      });
    }

    const isSuperadmin = session.is_superadmin === true;
    const isAdmin = !isSuperadmin && session.is_admin === true;
    req.user = {
      id: session.user_id,
      email: session.email,
      is_superadmin: isSuperadmin,
      is_admin: isAdmin,
      is_manager: !isSuperadmin && !isAdmin && session.is_manager === true,
    };
    const streamEnabled = await isFeatureEnabledForUser(req.user, "stream_notifications");
    if (!streamEnabled) {
      return res.status(403).json({
        code: "FEATURE_ACCESS_DENIED",
        message: "Stream notifications are not enabled for this account.",
      });
    }
    return next();
  } catch (err) {
    logger.error("notifications.stream_auth_failed", err);
    return res.status(503).json({
      code: "AUTH_SERVICE_UNAVAILABLE",
      message: "Authentication service is temporarily unavailable.",
    });
  }
}

router.get("/notifications/stream", authenticateStream, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  addNotificationClient(req.user.id, res);
});

module.exports = router;
