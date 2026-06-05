const pool = require("../config/db");
const logger = require("../util/logger");
const {
  SESSION_INACTIVITY_DAYS,
  verifyAccessToken,
} = require("../core/security/authTokens");

function bearerToken(req) {
  const header = String(req.headers.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

async function authenticate(req, res, next) {
  const token = bearerToken(req);
  if (!token) {
    return res.status(401).json({ code: "ACCESS_TOKEN_MISSING", message: "Unauthorized." });
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    const expired = err?.name === "TokenExpiredError";
    logger.warn("auth.access_token_rejected", {
      reason: expired ? "expired" : "invalid",
      path: req.originalUrl,
    });
    return res.status(401).json({
      code: expired ? "ACCESS_TOKEN_EXPIRED" : "ACCESS_TOKEN_INVALID",
      message: expired ? "Access token expired." : "Unauthorized.",
    });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE auth_sessions s
       SET last_active_at = NOW()
       FROM users u
       WHERE s.session_id = $1
         AND s.user_id = $2
         AND u.id = s.user_id
         AND s.last_active_at > NOW() - ($3 || ' days')::INTERVAL
       RETURNING s.session_id, s.user_id, u.email, u.is_admin, u.is_manager`,
      [payload.sid, payload.sub, SESSION_INACTIVITY_DAYS],
    );
    const session = rows[0];

    if (!session) {
      return res.status(401).json({
        code: "SESSION_INVALID",
        message: "Session invalid or expired.",
      });
    }

    const isAdmin = session.is_admin === true;
    req.sessionId = session.session_id;
    req.auth = payload;
    req.user = {
      id: session.user_id,
      email: session.email,
      is_admin: isAdmin,
      is_manager: !isAdmin && session.is_manager === true,
    };
    return next();
  } catch (err) {
    logger.error("auth.session_lookup_failed", err, {
      path: req.originalUrl,
    });
    return res.status(503).json({
      code: "AUTH_SERVICE_UNAVAILABLE",
      message: "Authentication service is temporarily unavailable.",
    });
  }
}

module.exports = { authenticate };
