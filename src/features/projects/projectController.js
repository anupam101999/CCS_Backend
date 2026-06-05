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
      logger.warn("projects.list_rejected", { reason: "missing_user_id", requesterId: req.user?.id });
      return res.status(400).json({
        message: "userId is required.",
      });
    }
    if (!req.user?.is_admin && !req.user?.is_manager && String(req.user?.id) !== String(userId)) {
      logger.warn("projects.list_denied", {
        requesterId: req.user?.id,
        requestedUserId: userId,
      });
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

    logger.info("projects.listed", {
      requesterId: req.user?.id,
      requestedUserId: userId,
      resultCount: result.rows.length,
    });

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
