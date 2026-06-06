const pool = require("../../config/db");

const FEATURE_KEYS = [
  "dashboard",
  "customer_switch",
  "appointments",
  "tickets",
  "projects",
  "logs",
  "stream_notifications",
];

function roleFor(user = {}) {
  if (user.is_superadmin) return "superadmin";
  if (user.is_admin) return "admin";
  if (user.is_manager) return "manager";
  return "customer";
}

async function isFeatureEnabledForUser(user, featureKey) {
  if (!featureKey) return true;

  const userId = user?.id || user?.user_id;
  if (userId) {
    const { rows } = await pool.query(
      `SELECT enabled
       FROM user_feature_access
       WHERE user_id = $1 AND feature_key = $2
       LIMIT 1`,
      [userId, featureKey],
    );
    if (rows[0]) return rows[0].enabled !== false;
  }

  const role = roleFor(user);

  const { rows } = await pool.query(
    `SELECT enabled
     FROM role_feature_access
     WHERE role_name = $1 AND feature_key = $2
     LIMIT 1`,
    [role, featureKey],
  );

  return rows[0]?.enabled !== false;
}

module.exports = {
  FEATURE_KEYS,
  STAFF_FEATURES: FEATURE_KEYS,
  isFeatureEnabledForUser,
  roleFor,
};
