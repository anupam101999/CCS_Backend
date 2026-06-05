const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const pool = require("../../config/db");

const ACCESS_TOKEN_MINUTES = Math.min(
  Math.max(Number(process.env.JWT_ACCESS_TOKEN_MINUTES) || 15, 5),
  60,
);
const SESSION_INACTIVITY_DAYS = 30;
const JWT_ISSUER = process.env.JWT_ISSUER || "calcutta-canvas-space";
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "calcutta-canvas-web";

function requireSecret(name) {
  const value = String(process.env[name] || "");
  if (value.length < 32) {
    throw new Error(`${name} must be configured with at least 32 characters.`);
  }
  return value;
}

function accessSecret() {
  return requireSecret("JWT_ACCESS_SECRET");
}

function refreshSecret() {
  return requireSecret("JWT_REFRESH_SECRET");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function roleFor(user) {
  if (user.is_superadmin === true) return "superadmin";
  if (user.is_admin === true) return "admin";
  if (user.is_manager === true) return "manager";
  return "customer";
}

function signAccessToken(user, sessionId) {
  const userId = user.id ?? user.user_id;
  const role = roleFor(user);
  return jwt.sign(
    {
      type: "access",
      sid: sessionId,
      userId: String(userId),
      role,
      email: user.email,
    },
    accessSecret(),
    {
      algorithm: "HS256",
      audience: JWT_AUDIENCE,
      issuer: JWT_ISSUER,
      subject: String(userId),
      jwtid: crypto.randomUUID(),
      expiresIn: `${ACCESS_TOKEN_MINUTES}m`,
      keyid: "access-v1",
    },
  );
}

function signRefreshToken(userId, sessionId) {
  return jwt.sign(
    { type: "refresh", sid: sessionId },
    refreshSecret(),
    {
      algorithm: "HS256",
      audience: JWT_AUDIENCE,
      issuer: JWT_ISSUER,
      subject: String(userId),
      jwtid: crypto.randomUUID(),
      keyid: "refresh-v1",
    },
  );
}

function verifyAccessToken(token) {
  const payload = jwt.verify(token, accessSecret(), {
    algorithms: ["HS256"],
    audience: JWT_AUDIENCE,
    issuer: JWT_ISSUER,
  });
  if (
    payload.type !== "access" ||
    !payload.sid ||
    !payload.userId ||
    String(payload.userId) !== String(payload.sub)
  ) {
    throw new Error("Invalid access token.");
  }
  return payload;
}

function verifyRefreshToken(token) {
  const payload = jwt.verify(token, refreshSecret(), {
    algorithms: ["HS256"],
    audience: JWT_AUDIENCE,
    issuer: JWT_ISSUER,
  });
  if (payload.type !== "refresh" || !payload.sid) {
    throw new Error("Invalid refresh token.");
  }
  return payload;
}

function validateAuthConfig() {
  accessSecret();
  refreshSecret();
}

async function createAuthSession(client, user) {
  const sessionId = crypto.randomUUID();
  const refreshToken = signRefreshToken(user.id, sessionId);

  await client.query(
    `INSERT INTO auth_sessions (session_id, user_id, refresh_token_hash)
     VALUES ($1, $2, $3)`,
    [sessionId, user.id, hashToken(refreshToken)],
  );

  return {
    accessToken: signAccessToken(user, sessionId),
    refreshToken,
    expiresInSeconds: ACCESS_TOKEN_MINUTES * 60,
  };
}

async function refreshAuthSession(refreshToken) {
  const payload = verifyRefreshToken(refreshToken);
  const { rows } = await pool.query(
    `SELECT s.session_id, s.user_id, u.email, u.is_superadmin, u.is_admin, u.is_manager
     FROM auth_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.session_id = $1
       AND s.user_id = $2
       AND s.refresh_token_hash = $3
       AND s.last_active_at > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata') - ($4 || ' days')::INTERVAL
     LIMIT 1`,
    [payload.sid, payload.sub, hashToken(refreshToken), SESSION_INACTIVITY_DAYS],
  );
  const session = rows[0];

  if (!session) {
    const err = new Error("Refresh session invalid or expired.");
    err.code = "INVALID_REFRESH";
    throw err;
  }

  return {
    accessToken: signAccessToken(session, session.session_id),
    expiresInSeconds: ACCESS_TOKEN_MINUTES * 60,
  };
}

async function deleteRefreshSession(refreshToken) {
  if (!refreshToken) return;

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    return;
  }

  await pool.query(
    `DELETE FROM auth_sessions
     WHERE session_id = $1 AND user_id = $2 AND refresh_token_hash = $3`,
    [payload.sid, payload.sub, hashToken(refreshToken)],
  );
}

async function deleteUserSessions(client, userId) {
  await client.query(`DELETE FROM auth_sessions WHERE user_id = $1`, [userId]);
}

async function deleteOtherUserSessions(client, userId, currentSessionId) {
  await client.query(
    `DELETE FROM auth_sessions WHERE user_id = $1 AND session_id <> $2`,
    [userId, currentSessionId],
  );
}

module.exports = {
  ACCESS_TOKEN_MINUTES,
  SESSION_INACTIVITY_DAYS,
  createAuthSession,
  deleteOtherUserSessions,
  deleteRefreshSession,
  deleteUserSessions,
  refreshAuthSession,
  validateAuthConfig,
  verifyAccessToken,
};
