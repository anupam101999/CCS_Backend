const pool = require("../config/db");

const requireSession = async (req, res, next) => {
  try {
    const token = req.headers["authorization"]?.replace("Bearer ", "").trim();

    if (!token) return res.status(401).json({ message: "Unauthorized." });

    const { rows } = await pool.query(
      `SELECT session_id FROM user_sessions
       WHERE session_token = $1
         AND is_active = TRUE
       LIMIT 1`,
      [token]
    );

    if (!rows[0]) {
      return res.status(401).json({ message: "Session invalid or expired." });
    }

    next();
  } catch (err) {
    console.error("requireSession error:", err.message);
    return res.status(500).json({ message: "Internal server error." });
  }
};

module.exports = { requireSession };