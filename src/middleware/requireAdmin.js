const pool = require("../config/db");

const requireAdmin = async (req, res, next) => {
  try {
    const token = req.headers["authorization"]?.replace("Bearer ", "").trim();
    if (!token) return res.status(401).json({ message: "Unauthorized." });

    const { rows } = await pool.query(
      `SELECT u.id, u.isadmin
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.session_token = $1
         AND s.is_active = TRUE
       LIMIT 1`,
      [token]
    );

    if (!rows[0] || !rows[0].isadmin) {
      return res.status(403).json({ message: "Admin access required." });
    }

    req.adminId = rows[0].id;
    next();
  } catch (err) {
    console.error("requireAdmin error:", err.message);
    return res.status(500).json({ message: "Internal server error." });
  }
};

module.exports = { requireAdmin };