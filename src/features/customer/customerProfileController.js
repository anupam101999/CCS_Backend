const crypto = require("crypto");
const pool = require("../../config/db");
const logger = require("../../util/logger");
const { hashPassword } = require("../../core/security/password");
const { deleteOtherUserSessions } = require("../../core/security/authTokens");
const {
  EMAIL_CHANGE_VERIFICATION_CODE_MINUTES,
  normalizeEmail,
  isGmail,
  normalizeDateInput,
  hashVerificationCode,
  generateVerificationCode,
  mapUser,
  deliverEmailChangeVerificationCode,
  getAuthedUserId,
  ensureOwnUser,
} = require("./customerUtils");

const requestEmailChange = async (req, res) => {
  try {
    const userId = getAuthedUserId(req);
    const newEmail = normalizeEmail(req.body?.email);

    if (!isGmail(newEmail)) {
      logger.warn("email_change.request_rejected", { userId, reason: "invalid_email", email: newEmail });
      return res.status(400).json({ message: "Enter a valid Gmail address." });
    }

    const { rows: currentRows } = await pool.query(
      `SELECT email FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    const currentEmail = normalizeEmail(currentRows[0]?.email);

    if (!currentEmail) {
      logger.warn("email_change.request_rejected", { userId, reason: "user_not_found" });
      return res.status(404).json({ message: "User not found." });
    }

    if (newEmail === currentEmail) {
      logger.warn("email_change.request_rejected", { userId, reason: "same_email" });
      return res.status(400).json({ message: "Please provide a unique Gmail address." });
    }

    const { rows: existingRows } = await pool.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [newEmail],
    );

    if (existingRows.length > 0) {
      logger.warn("email_change.request_rejected", { userId, reason: "email_exists", email: newEmail });
      return res
        .status(409)
        .json({ message: "An account with this email already exists." });
    }

    const requestId = crypto.randomUUID();
    const code = generateVerificationCode();

    await pool.query(`DELETE FROM pending_email_changes WHERE user_id = $1`, [
      userId,
    ]);

    await pool.query(
      `INSERT INTO pending_email_changes
        (request_id, user_id, new_email, code_hash, expires_at)
       VALUES
        ($1, $2, $3, $4, NOW() + ($5 || ' minutes')::INTERVAL)`,
      [
        requestId,
        userId,
        newEmail,
        hashVerificationCode(requestId, code),
        EMAIL_CHANGE_VERIFICATION_CODE_MINUTES,
      ],
    );

    const delivered = await deliverEmailChangeVerificationCode(newEmail, code);
    if (!delivered && process.env.EMAIL_VERIFICATION_DEV_CODE !== "true") {
      logger.warn("email_change.verification_not_configured", { userId });
      return res.status(503).json({
        message: "Email verification is not configured yet.",
      });
    }

    logger.info("email_change.verification_requested", {
      userId,
      delivered,
      devCodeReturned: process.env.EMAIL_VERIFICATION_DEV_CODE === "true",
    });

    return res.status(201).json({
      message: "Verification code sent to your new Gmail address.",
      verificationId: requestId,
      ...(process.env.EMAIL_VERIFICATION_DEV_CODE === "true"
        ? { verificationCode: code }
        : {}),
    });
  } catch (err) {
    logger.error("email_change.request_failed", err, { userId: req.user?.id });
    return res.status(500).json({ message: "Internal server error." });
  }
};

const verifyEmailChange = async (req, res) => {
  let client;

  try {
    client = await pool.connect();
    const userId = getAuthedUserId(req);
    const { verificationId, code } = req.body;

    if (!verificationId || !code) {
      logger.warn("email_change.verify_rejected", { userId, reason: "missing_code" });
      return res.status(400).json({ message: "Verification code is required." });
    }

    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT *
       FROM pending_email_changes
       WHERE request_id = $1
         AND user_id = $2
         AND code_hash = $3
         AND expires_at > NOW()
       LIMIT 1`,
      [
        verificationId,
        userId,
        hashVerificationCode(verificationId, String(code).trim()),
      ],
    );

    const pending = rows[0];
    if (!pending) {
      await client.query("ROLLBACK");
      logger.warn("email_change.verification_failed", {
        userId,
        reason: "invalid_or_expired",
      });
      return res.status(400).json({ message: "Verification code is invalid or expired." });
    }

    const { rows: existingRows } = await client.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id <> $2 LIMIT 1`,
      [pending.new_email, userId],
    );

    if (existingRows.length > 0) {
      await client.query("ROLLBACK");
      logger.warn("email_change.verify_rejected", { userId, reason: "email_exists", email: pending.new_email });
      return res
        .status(409)
        .json({ message: "An account with this email already exists." });
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE users
       SET email = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, full_name, email, phone, dob, address, is_admin, is_manager, avatarurl`,
      [pending.new_email, userId],
    );

    await client.query(`DELETE FROM pending_email_changes WHERE user_id = $1`, [
      userId,
    ]);

    await client.query("COMMIT");

    logger.info("email_change.completed", { userId });
    return res.json({
      message: "Email changed successfully.",
      user: mapUser(updatedRows[0]),
    });
  } catch (err) {
    await client?.query("ROLLBACK").catch(() => {});
    logger.error("email_change.verify_failed", err, { userId: req.user?.id });
    return res.status(500).json({ message: "Internal server error." });
  } finally {
    client?.release();
  }
};

const update = async (req, res) => {
  let id;
  try {
    const { id: requestedId, fullName, email, phone, dob, address, password, avatarurl } =
      req.body;
    id = getAuthedUserId(req);
    const normalizedEmail = normalizeEmail(email);

    if (!ensureOwnUser(req, res, requestedId || id)) return;

    if (!fullName || !email || !dob || !address) {
      logger.warn("user.update_rejected", { userId: id, reason: "missing_required_fields" });
      return res.status(400).json({ message: "All fields are required." });
    }
    if (password != null && password.length < 6) {
      logger.warn("user.update_rejected", { userId: id, reason: "short_password" });
      return res.status(400).json({ message: "Password must be at least 6 characters." });
    }
    const normalizedDob = normalizeDateInput(dob);
    if (!normalizedDob) {
      logger.warn("user.update_rejected", { userId: id, reason: "invalid_dob" });
      return res.status(400).json({ message: "Enter DOB in DD/MM/YYYY format." });
    }
    if (!isGmail(normalizedEmail)) {
      logger.warn("user.update_rejected", { userId: id, reason: "invalid_email", email: normalizedEmail });
      return res.status(400).json({ message: "Enter a valid Gmail address." });
    }

    const { rows: currentRows } = await pool.query(
      `SELECT email FROM users WHERE id = $1 LIMIT 1`,
      [id],
    );
    const currentEmail = normalizeEmail(currentRows[0]?.email);

    if (!currentEmail) {
      logger.warn("user.update_rejected", { userId: id, reason: "user_not_found" });
      return res.status(404).json({ message: "User not found." });
    }

    if (normalizedEmail !== currentEmail) {
      logger.warn("user.email_change_blocked", { userId: id });
      return res.status(400).json({
        message: "Email cannot be changed from profile. Please contact support.",
      });
    }

    let rows;

    if (password != null) {
      const passwordHash = await hashPassword(password);
      rows = await pool.withTransaction(async (client) => {
        const result = await client.query(
          `UPDATE users
           SET full_name = $2,
               email = $3,
               phone = $4,
               dob = $5,
               address = $6,
               password = $7,
               avatarurl = $8,
               updated_at = NOW()
           WHERE id = $1
           RETURNING id, full_name, email, phone, dob, address, avatarurl`,
          [
            id,
            fullName.trim(),
            currentEmail,
            phone?.trim() || null,
            normalizedDob,
            address || null,
            passwordHash,
            avatarurl || null,
          ],
        );
        await deleteOtherUserSessions(client, id, req.sessionId);
        return result.rows;
      });
    } else {
      ({ rows } = await pool.query(
        `UPDATE users
         SET full_name = $2,
             email = $3,
             phone = $4,
             dob = $5,
             address = $6,
             avatarurl = $7,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, full_name, email, phone, dob, address, avatarurl`,
        [
          id,
          fullName.trim(),
          currentEmail,
          phone?.trim() || null,
          normalizedDob,
          address || null,
          avatarurl || null,
        ],
      ));
    }

    const user = rows[0];
    logger.info("user.updated", { userId: user.id, changedPassword: password != null, changedAvatar: Boolean(avatarurl) });

    return res.status(201).json({
      message: "Updated user successfully.",
      user: mapUser(user),
    });
  } catch (err) {
    logger.error("user.update_failed", err, { userId: id });

    if (err.code === "23505" && err.constraint === "users_email_key") {
      logger.warn("user.update_rejected", { userId: id, reason: "duplicate_email" });
      return res
        .status(409)
        .json({ message: "This email is already in use by another account." });
    }

    return res.status(500).json({ message: "Internal server error." });
  }
};

module.exports = {
  requestEmailChange,
  verifyEmailChange,
  update,
};
