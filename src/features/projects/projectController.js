// controllers/projectController.js

const pool = require("../../config/db");
const logger = require("../../util/logger");

/* ──────────────────────────────────────────────────────────────
   Get All Projects By User ID
────────────────────────────────────────────────────────────── */
const getProjectsByUserId = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        message: "userId is required.",
      });
    }
    if (!req.user?.isAdmin && String(req.user?.id) !== String(userId)) {
      return res.status(403).json({ message: "Forbidden." });
    }

    const result = await pool.query(
      `
      SELECT
        id,
        user_id,
        project_name,
        photourl,
        created_at,
        updated_at
      FROM projects
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [userId],
    );

    return res.json({
      success: true,
      count: result.rows.length,
      projects: result.rows,
    });
  } catch (err) {
    logger.error("projects.list_failed", err, { userId: req.params.userId });

    return res.status(500).json({
      success: false,
      message: "Could not fetch projects.",
    });
  }
};

module.exports = {
  getProjectsByUserId,
};
