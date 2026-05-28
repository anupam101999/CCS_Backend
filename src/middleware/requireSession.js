const pool = require("../config/db");
const logger = require("../util/logger");

const requireSession = async (req, res, next) => {
  try {
    const token = req.headers["authorization"]?.replace("Bearer ", "").trim();

    if (!token) {
      logger.warn("auth.session_missing", {
        method: req.method,
        path: req.originalUrl,
        ip: req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress,
      });
      return res.status(401).json({ message: "Unauthorized." });
    }

    const { rows } = await pool.query(
      `SELECT s.session_id, s.session_token, s.user_id, u.email, u.is_admin
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.session_token = $1
         AND s.is_active = TRUE
         AND s.token_refresh_time >= NOW() - INTERVAL '7 days'
       LIMIT 1`,
      [token]
    );

    if (!rows[0]) {
      logger.warn("auth.session_invalid", {
        method: req.method,
        path: req.originalUrl,
        ip: req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress,
      });
      return res.status(401).json({ message: "Session invalid or expired." });
    }

    req.sessionToken = token;
    req.sessionId = rows[0].session_id;
    req.user = {
      id: rows[0].user_id,
      email: rows[0].email,
      isAdmin: rows[0].is_admin === true,
    };

    next();
  } catch (err) {
    logger.error("auth.require_session_failed", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

module.exports = { requireSession };
