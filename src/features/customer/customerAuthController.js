const crypto = require("crypto");
const pool = require("../../config/db");
const logger = require("../../util/logger");
const { localTimestamp } = require("../../util/time");
const {
  hashPassword,
  isHashedPassword,
  verifyPassword,
} = require("../../core/security/password");
const {
  createAuthSession,
  deleteRefreshSession,
  deleteUserSessions,
  refreshAuthSession,
} = require("../../core/security/authTokens");
const { sendSessionRevokedToUser } = require("../../services/notificationEvents");
const {
  PASSWORD_RESET_TOKEN_MINUTES,
  REGISTRATION_VERIFICATION_CODE_MINUTES,
  normalizeEmail,
  isGmail,
  hashResetToken,
  hashVerificationCode,
  generateVerificationCode,
  mapUser,
  getClientOrigin,
  deliverRegistrationVerificationCode,
  deliverPasswordResetLink,
} = require("./customerUtils");

const register = async (req, res) => {
  try {
    const { fullName, email, phone, dob, address, password, avatarurl } =
      req.body;
    const normalizedEmail = normalizeEmail(email);

    if (!fullName || !email || !password || !dob || !address) {
      logger.warn("registration.rejected", { reason: "missing_required_fields", email: normalizedEmail });
      return res.status(400).json({ message: "All fields are required." });
    }
    if (password.length < 6) {
      logger.warn("registration.rejected", { reason: "short_password", email: normalizedEmail });
      return res.status(400).json({ message: "Password must be at least 6 characters." });
    }

    const normalizedDob = String(dob).trim();

    const { rows: existing } = await pool.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [normalizedEmail],
    );
    if (existing.length > 0) {
      logger.warn("registration.rejected", { reason: "email_exists", email: normalizedEmail });
      return res
        .status(409)
        .json({ message: "An account with this email already exists." });
    }

    const requestId = crypto.randomUUID();
    const code = generateVerificationCode();
    const codeHash = hashVerificationCode(requestId, code);
    const passwordHash = await hashPassword(password);

    await pool.query(
      `DELETE FROM pending_registrations WHERE LOWER(email) = LOWER($1)`,
      [normalizedEmail],
    );

    await pool.query(
      `INSERT INTO pending_registrations
        (request_id, full_name, email, phone, dob, address, password_hash, avatarurl, code_hash, expires_at)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata') + ($10 || ' minutes')::INTERVAL)`,
      [
        requestId,
        fullName.trim(),
        normalizedEmail,
        phone?.trim() || null,
        normalizedDob,
        address || null,
        passwordHash,
        avatarurl || null,
        codeHash,
        REGISTRATION_VERIFICATION_CODE_MINUTES,
      ],
    );

    const delivered = await deliverRegistrationVerificationCode(normalizedEmail, code);
    if (!delivered && process.env.EMAIL_VERIFICATION_DEV_CODE !== "true") {
      logger.warn("registration.verification_not_configured", { email: normalizedEmail });
      return res.status(503).json({
        message: "Email verification is not configured yet.",
      });
    }

    logger.info("registration.verification_requested", {
      email: normalizedEmail,
      delivered,
      devCodeReturned: process.env.EMAIL_VERIFICATION_DEV_CODE === "true",
    });

    return res.status(201).json({
      message: "Verification code sent to your Gmail address.",
      verificationId: requestId,
      ...(process.env.EMAIL_VERIFICATION_DEV_CODE === "true" ? { verificationCode: code } : {}),
    });
  } catch (err) {
    logger.error("user.register_failed", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const verifyRegistrationEmail = async (req, res) => {
  let client;

  try {
    client = await pool.connect();
    const { verificationId, code } = req.body;

    if (!verificationId || !code) {
      logger.warn("registration.verification_rejected", { reason: "missing_code" });
      return res.status(400).json({ message: "Verification code is required." });
    }

    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT *
       FROM pending_registrations
       WHERE request_id = $1
         AND code_hash = $2
         AND expires_at > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
       LIMIT 1`,
      [verificationId, hashVerificationCode(verificationId, String(code).trim())],
    );

    const pending = rows[0];
    if (!pending) {
      await client.query("ROLLBACK");
      logger.warn("registration.verification_failed", { reason: "invalid_or_expired" });
      return res.status(400).json({ message: "Verification code is invalid or expired." });
    }

    const { rows: existing } = await client.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [pending.email],
    );

    if (existing.length > 0) {
      await client.query("ROLLBACK");
      logger.warn("registration.verification_rejected", { reason: "email_exists", email: pending.email });
      return res
        .status(409)
        .json({ message: "An account with this email already exists." });
    }

    const { rows: inserted } = await client.query(
      `INSERT INTO users (full_name, email, phone, dob, address, password, avatarurl)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, full_name, email, phone, dob, address, is_superadmin, is_admin, is_manager, access_disabled, avatarurl`,
      [
        pending.full_name,
        pending.email,
        pending.phone,
        pending.dob,
        pending.address,
        pending.password_hash,
        pending.avatarurl,
      ],
    );

    await client.query(
      `DELETE FROM pending_registrations WHERE LOWER(email) = LOWER($1)`,
      [pending.email],
    );
    const auth = await createAuthSession(client, inserted[0]);
    await client.query("COMMIT");

    logger.info("user.registered", { userId: inserted[0].id, email: inserted[0].email });
    return res.status(201).json({
      message: "Email verified. Account created successfully.",
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
      expiresInSeconds: auth.expiresInSeconds,
      user: mapUser(inserted[0]),
    });
  } catch (err) {
    await client?.query("ROLLBACK").catch(() => {});
    logger.error("registration.verification_error", err);
    return res.status(500).json({ message: "Internal server error." });
  } finally {
    client?.release();
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);

    if (!email || !password) {
      logger.warn("auth.login_rejected", { reason: "missing_credentials" });
      return res
        .status(400)
        .json({ message: "Email and password are required." });
    }
    if (!isGmail(normalizedEmail)) {
      logger.warn("auth.login_rejected", { reason: "invalid_email", email: normalizedEmail });
      return res.status(400).json({ message: "Enter a valid Gmail address." });
    }
    if (password.length < 6) {
      logger.warn("auth.login_rejected", { reason: "short_password", email: normalizedEmail });
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters." });
    }

    const { rows } = await pool.query(
      `SELECT id, full_name, email, phone, dob, address, password, is_superadmin, is_admin, is_manager, access_disabled, avatarurl
       FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [normalizedEmail],
    );

    const user = rows[0];

    if (!user) {
      logger.warn("auth.login_failed", { reason: "invalid_credentials" });
      return res.status(401).json({ message: "Invalid email or password." });
    }
    if (user.access_disabled === true) {
      logger.warn("auth.login_failed", { reason: "access_disabled", userId: user.id });
      return res.status(403).json({ message: "Your account access is disabled. Please contact support." });
    }
    const passwordMatches = await verifyPassword(password, user.password);
    if (!passwordMatches) {
      logger.warn("auth.login_failed", { reason: "invalid_credentials" });
      return res.status(401).json({ message: "Invalid email or password." });
    }

    if (!isHashedPassword(user.password)) {
      await pool.query(`UPDATE users SET password = $1 WHERE id = $2`, [
        await hashPassword(password),
        user.id,
      ]);
    }

    const auth = await createAuthSession(pool, user);
    sendSessionRevokedToUser(user.id, {
      message: "Another device logged in. Please sign in again.",
    });

    logger.info("auth.login_success", {
      userId: user.id,
      is_admin: user.is_admin === true,
      is_manager: user.is_superadmin !== true && user.is_admin !== true && user.is_manager === true,
      is_superadmin: user.is_superadmin === true,
    });
    return res.json({
      accessToken: auth.accessToken,
      refreshToken: auth.refreshToken,
      expiresInSeconds: auth.expiresInSeconds,
      user: mapUser(user),
    });
  } catch (err) {
    logger.error("auth.login_error", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const requestPasswordReset = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);

    if (!isGmail(email)) {
      logger.warn("password_reset.rejected", { reason: "invalid_email", email });
      return res.status(400).json({ message: "Enter a valid Gmail address." });
    }

    const response = {
      message:
        "If that Gmail address is registered, a password reset link will be sent.",
    };
    const clientOrigin = getClientOrigin();

    if (!clientOrigin) {
      logger.error(
        "password_reset.origin_not_configured",
        new Error("FRONTEND_URL or FRONTEND_ORIGINS must be configured."),
      );
      return res.status(503).json({
        message: "Password reset is temporarily unavailable.",
      });
    }

    const { rows } = await pool.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email],
    );

    if (!rows[0]) {
      logger.warn("password_reset.requested", { result: "not_found" });
      return res.json(response);
    }

    const userId = rows[0].id;
    const resetToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashResetToken(resetToken);

    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata') + ($3 || ' minutes')::INTERVAL)`,
      [userId, tokenHash, PASSWORD_RESET_TOKEN_MINUTES],
    );

    const resetUrl = `${clientOrigin}/forgot-password?token=${resetToken}`;
    const delivered = await deliverPasswordResetLink(email, resetUrl);

    logger.info("password_reset.requested", {
      userId,
      delivered,
      devTokenReturned: process.env.PASSWORD_RESET_DEV_TOKEN === "true",
    });

    if (process.env.PASSWORD_RESET_DEV_TOKEN === "true") {
      response.resetToken = resetToken;
    }

    return res.json(response);
  } catch (err) {
    logger.error("password_reset.request_failed", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const resetPassword = async (req, res) => {
  let client;

  try {
    client = await pool.connect();
    const { token, password } = req.body;

    if (!token || typeof token !== "string") {
      logger.warn("password_reset.rejected", { reason: "missing_token" });
      return res.status(400).json({ message: "Reset token is required." });
    }

    if (!password || password.length < 6) {
      logger.warn("password_reset.rejected", { reason: "short_password" });
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters." });
    }

    const { rows } = await client.query(
      `SELECT id, user_id
       FROM password_reset_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
       LIMIT 1`,
      [hashResetToken(token)],
    );

    if (!rows[0]) {
      logger.warn("password_reset.invalid_token");
      return res.status(400).json({ message: "Reset link is invalid or expired." });
    }

    const passwordHash = await hashPassword(password);

    await client.query("BEGIN");
    await client.query(`UPDATE users SET password = $1 WHERE id = $2`, [
      passwordHash,
      rows[0].user_id,
    ]);
    await client.query(
      `UPDATE password_reset_tokens SET used_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata') WHERE id = $1`,
      [rows[0].id],
    );
    await deleteUserSessions(client, rows[0].user_id);
    await client.query("COMMIT");

    logger.info("password_reset.completed", { userId: rows[0].user_id });
    return res.json({ message: "Password reset successfully. Please sign in." });
  } catch (err) {
    await client?.query("ROLLBACK").catch(() => {});
    logger.error("password_reset.failed", err);
    return res.status(500).json({ message: "Internal server error." });
  } finally {
    client?.release();
  }
};

const signOut = async (req, res) => {
  try {
    await deleteRefreshSession(req.body?.refreshToken);

    logger.info("auth.signout_success");
    return res.json({ message: "Signed out successfully." });
  } catch (err) {
    logger.error("auth.signout_failed", err);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const tokenRefresh = async (req, res) => {
  try {
    const refreshToken = req.body?.refreshToken;
    if (!refreshToken) {
      logger.warn("auth.token_refresh_rejected", {
        reason: "missing_token",
        origin: req.headers.origin || null,
      });
      return res.status(401).json({
        code: "REFRESH_TOKEN_MISSING",
        message: "Refresh session missing.",
      });
    }

    const auth = await refreshAuthSession(refreshToken);

    return res.json({
      valid: true,
      accessToken: auth.accessToken,
      expiresInSeconds: auth.expiresInSeconds,
      refreshedAt: localTimestamp(),
    });
  } catch (err) {
    const invalidRefresh =
      err?.code === "INVALID_REFRESH" ||
      err?.name === "JsonWebTokenError" ||
      err?.name === "TokenExpiredError" ||
      err?.name === "NotBeforeError";

    if (!invalidRefresh) {
      logger.error("auth.token_refresh_unavailable", err);
      return res.status(503).json({
        code: "AUTH_SERVICE_UNAVAILABLE",
        message: "Authentication service is temporarily unavailable.",
      });
    }

    logger.warn("auth.token_refresh_rejected", {
      reason: err?.code === "INVALID_REFRESH" ? "invalid_session" : "invalid_token",
    });
    return res.status(401).json({
      code: "REFRESH_TOKEN_INVALID",
      message: "Refresh session invalid or expired.",
    });
  }
};

module.exports = {
  register,
  verifyRegistrationEmail,
  login,
  requestPasswordReset,
  resetPassword,
  signOut,
  tokenRefresh,
};
