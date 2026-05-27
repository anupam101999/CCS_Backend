const pool = require("../../config/db");
const crypto = require("crypto");
const logger = require("../../util/logger");
const {
  sendEmailChangeOtp,
  sendPasswordReset,
  sendRegistrationOtp,
} = require("../../services/mailer");
const {
  hashPassword,
  isHashedPassword,
  verifyPassword,
} = require("../../core/security/password");

const GMAIL_RE = /^[A-Z0-9._%+-]+@gmail\.com$/i;
const PASSWORD_RESET_TOKEN_MINUTES = 30;
const REGISTRATION_VERIFICATION_CODE_MINUTES = 10;
const EMAIL_CHANGE_VERIFICATION_CODE_MINUTES = 10;

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isGmail(email) {
  return GMAIL_RE.test(normalizeEmail(email));
}

function normalizeDateInput(value) {
  const raw = String(value || "").trim();
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const uiMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);

  const [, year, month, day] = isoMatch || [];
  const [, uiDay, uiMonth, uiYear] = uiMatch || [];
  const normalized = isoMatch
    ? `${year}-${month}-${day}`
    : uiMatch
      ? `${uiYear}-${uiMonth}-${uiDay}`
      : "";

  if (!normalized) return null;

  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== normalized
  ) {
    return null;
  }

  return normalized;
}

function hashResetToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashVerificationCode(requestId, code) {
  return crypto.createHash("sha256").update(`${requestId}:${code}`).digest("hex");
}

function generateVerificationCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function mapUser(user) {
  return {
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    phone: user.phone || "",
    dob: user.dob
      ? user.dob instanceof Date
        ? user.dob.toISOString().split("T")[0]
        : user.dob
      : "",
    address: user.address || "",
    is_admin: user.is_admin || false,
    avatarurl: user.avatarurl || "",
  };
}

function getClientOrigin(req) {
  return (
    process.env.FRONTEND_URL ||
    req.headers.origin ||
    `${req.protocol}://${req.get("host")}`
  );
}

async function deliverRegistrationVerificationCode(email, code) {
  let sentBySmtp = false;
  try {
    sentBySmtp = await sendRegistrationOtp({
      to: email,
      code,
      expiresInMinutes: REGISTRATION_VERIFICATION_CODE_MINUTES,
    });
  } catch (err) {
    logger.warn("registration.smtp_delivery_failed", {
      errorCode: err?.code,
      errorMessage: err?.message,
    });
  }
  if (sentBySmtp) return true;

  if (!process.env.EMAIL_VERIFICATION_WEBHOOK_URL) return false;

  const res = await fetch(process.env.EMAIL_VERIFICATION_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.EMAIL_VERIFICATION_WEBHOOK_TOKEN
        ? { Authorization: `Bearer ${process.env.EMAIL_VERIFICATION_WEBHOOK_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      email,
      code,
      purpose: "registration_verification",
      expiresInMinutes: REGISTRATION_VERIFICATION_CODE_MINUTES,
    }),
  });

  if (!res.ok) {
    throw new Error(`Email verification webhook failed with ${res.status}`);
  }

  return true;
}

async function deliverEmailChangeVerificationCode(email, code) {
  let sentBySmtp = false;
  try {
    sentBySmtp = await sendEmailChangeOtp({
      to: email,
      code,
      expiresInMinutes: EMAIL_CHANGE_VERIFICATION_CODE_MINUTES,
    });
  } catch (err) {
    logger.warn("email_change.smtp_delivery_failed", {
      errorCode: err?.code,
      errorMessage: err?.message,
    });
  }
  if (sentBySmtp) return true;

  if (!process.env.EMAIL_VERIFICATION_WEBHOOK_URL) return false;

  const res = await fetch(process.env.EMAIL_VERIFICATION_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.EMAIL_VERIFICATION_WEBHOOK_TOKEN
        ? { Authorization: `Bearer ${process.env.EMAIL_VERIFICATION_WEBHOOK_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      email,
      code,
      purpose: "email_change_verification",
      expiresInMinutes: EMAIL_CHANGE_VERIFICATION_CODE_MINUTES,
    }),
  });

  if (!res.ok) {
    throw new Error(`Email change verification webhook failed with ${res.status}`);
  }

  return true;
}

async function deliverPasswordResetLink(email, resetUrl) {
  let sentBySmtp = false;
  try {
    sentBySmtp = await sendPasswordReset({
      to: email,
      resetUrl,
    });
  } catch (err) {
    logger.warn("password_reset.smtp_delivery_failed", {
      errorCode: err?.code,
      errorMessage: err?.message,
    });
  }
  if (sentBySmtp) return true;

  if (!process.env.PASSWORD_RESET_WEBHOOK_URL) return false;

  const res = await fetch(process.env.PASSWORD_RESET_WEBHOOK_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.PASSWORD_RESET_WEBHOOK_TOKEN
        ? { Authorization: `Bearer ${process.env.PASSWORD_RESET_WEBHOOK_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({ email, resetUrl }),
  });

  if (!res.ok) {
    throw new Error(`Password reset webhook failed with ${res.status}`);
  }

  return true;
}

function getAuthedUserId(req) {
  if (req.user?.isAdmin && req.headers["x-view-as-user-id"]) {
    return req.headers["x-view-as-user-id"];
  }
  return req.user?.id;
}

function ensureOwnUser(req, res, userId) {
  if (req.user?.isAdmin) return true;

  const authedUserId = getAuthedUserId(req);
  if (!authedUserId || String(authedUserId) !== String(userId)) {
    res.status(403).json({ message: "Forbidden." });
    return false;
  }
  return true;
}

function mapAppointment(row) {
  return {
    id: row.booking_id,
    userId: row.user_id,
    type: row.appointment_type,
    subject: row.subject,
    category: row.category,
    note: row.query || "",
    date: row.appointment_date
      ? row.appointment_date instanceof Date
        ? row.appointment_date.toISOString().split("T")[0]
        : String(row.appointment_date).split("T")[0]
      : "",
    time: row.appointment_time || "",
    status: row.status,
    notificationTicketId: row.notification_ticket_id || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function createNotificationTicket(
  client,
  { userId, category, subject, query, type, status = "open", reply = null },
) {
  const { rows } = await client.query(
    `INSERT INTO notification_tickets
      (user_id, category, subject, query, type, status, reply)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ticket_id, user_id, category, subject, query, reply, type, status, created_at, updated_at`,
    [userId, category, subject, query, type, status, reply],
  );

  return rows[0];
}

// ── REGISTER ──────────────────────────────────────────────────────
const register = async (req, res) => {
  try {
    const { fullName, email, phone, dob, address, password, avatarurl } =
      req.body;
    const normalizedEmail = normalizeEmail(email);

    if (!fullName || !email || !password || !dob || !address) {
      return res.status(400).json({ message: "All fields are required." });
    }

    const normalizedDob = String(dob).trim();

    const { rows: existing } = await pool.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [normalizedEmail],
    );
    if (existing.length > 0) {
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
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW() + ($10 || ' minutes')::INTERVAL)`,
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
      logger.warn("registration.verification_not_configured");
      return res.status(503).json({
        message: "Email verification is not configured yet.",
      });
    }

    logger.info("registration.verification_requested", {
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
  const client = await pool.connect();

  try {
    const { verificationId, code } = req.body;

    if (!verificationId || !code) {
      return res.status(400).json({ message: "Verification code is required." });
    }

    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT *
       FROM pending_registrations
       WHERE request_id = $1
         AND code_hash = $2
         AND expires_at > NOW()
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
      return res
        .status(409)
        .json({ message: "An account with this email already exists." });
    }

    const { rows: inserted } = await client.query(
      `INSERT INTO users (full_name, email, phone, dob, address, password, avatarurl)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, full_name, email, phone, dob, address, avatarurl`,
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
    await client.query("COMMIT");

    logger.info("user.registered", { userId: inserted[0].id });
    return res.status(201).json({
      message: "Email verified. Account created successfully.",
      user: mapUser(inserted[0]),
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error("registration.verification_error", err);
    return res.status(500).json({ message: "Internal server error." });
  } finally {
    client.release();
  }
};

// ── LOGIN ─────────────────────────────────────────────────────────
const { v4: uuidv4 } = require("uuid"); // npm i uuid

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = normalizeEmail(email);

    //login user validate
    if (!email || !password)
      return res
        .status(400)
        .json({ message: "Email and password are required." });
    if (!isGmail(normalizedEmail))
      return res.status(400).json({ message: "Enter a valid Gmail address." });
    if (password.length < 6)
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters." });

    const { rows } = await pool.query(
      `SELECT id, full_name, email, phone, dob, address, password,is_admin,avatarurl
       FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [normalizedEmail],
    );

    const user = rows[0];

    if (!user) {
      logger.warn("auth.login_failed", { reason: "invalid_credentials" });
      return res.status(401).json({ message: "Invalid email or password." });
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

    //Existing session cleanup: Automatically expire old sessions

    await pool.query(
      `UPDATE user_sessions SET is_active = FALSE, logout_time = NOW(), token_refresh_time = NOW()
   WHERE user_id = $1
     AND is_active = TRUE`,
      [user.id],
    );

    // Create session
    const sessionToken = uuidv4();
    const ipAddress =
      req.headers["x-forwarded-for"]?.split(",")[0].trim() ??
      req.socket.remoteAddress ??
      null;

    await pool.query(
      `INSERT INTO user_sessions
         (user_id, user_email, session_token, token_refresh_time, ip_address)
       VALUES
         ($1, $2, $3, NOW(), $4)`,
      [user.id, user.email, sessionToken, ipAddress],
    );

    logger.info("auth.login_success", { userId: user.id, isAdmin: user.is_admin === true });
    return res.json({
      token: sessionToken,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        phone: user.phone || "",
        dob: user.dob
          ? user.dob instanceof Date
            ? user.dob.toISOString().split("T")[0]
            : user.dob
          : "",
        address: user.address || "",
        is_admin: user.is_admin || false,
        avatarurl: user.avatarurl || "",
      },
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
      return res.status(400).json({ message: "Enter a valid Gmail address." });
    }

    const response = {
      message:
        "If that Gmail address is registered, a password reset link will be sent.",
    };

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
       VALUES ($1, $2, NOW() + ($3 || ' minutes')::INTERVAL)`,
      [userId, tokenHash, PASSWORD_RESET_TOKEN_MINUTES],
    );

    const resetUrl = `${getClientOrigin(req)}/forgot-password?token=${resetToken}`;
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
  const client = await pool.connect();

  try {
    const { token, password } = req.body;

    if (!token || typeof token !== "string") {
      return res.status(400).json({ message: "Reset token is required." });
    }

    if (!password || password.length < 6) {
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters." });
    }

    const { rows } = await client.query(
      `SELECT id, user_id
       FROM password_reset_tokens
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
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
      `UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`,
      [rows[0].id],
    );
    await client.query(
      `UPDATE user_sessions
       SET is_active = FALSE, logout_time = NOW(), token_refresh_time = NOW()
       WHERE user_id = $1 AND is_active = TRUE`,
      [rows[0].user_id],
    );
    await client.query("COMMIT");

    logger.info("password_reset.completed", { userId: rows[0].user_id });
    return res.json({ message: "Password reset successfully. Please sign in." });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error("password_reset.failed", err);
    return res.status(500).json({ message: "Internal server error." });
  } finally {
    client.release();
  }
};

// sign out
const signOut = async (req, res) => {
  try {
    const token = req.sessionToken || req.body?.token;
    if (!token) return res.status(400).json({ message: "Token required." });

    await pool.query(
      `UPDATE user_sessions
       SET is_active = FALSE, logout_time = NOW()
       WHERE session_token = $1`,
      [token],
    );

    return res.json({ message: "Signed out successfully." });
  } catch (err) {
    logger.error("auth.signout_failed", err, { userId: req.user?.id });
    return res.status(500).json({ message: "Internal server error." });
  }
};

//session tokenRefresh middleware

const tokenRefresh = async (req, res) => {
  try {
    const newToken = uuidv4();

    await pool.query(
      `
      UPDATE user_sessions
      SET
        session_token = $1,
        token_refresh_time = NOW()
      WHERE session_id = $2
      `,
      [newToken, req.sessionId],
    );

    return res.json({
      valid: true,
      token: newToken,
      refreshedAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("auth.token_refresh_failed", err, { userId: req.user?.id });

    return res.status(500).json({
      message: "Internal server error.",
    });
  }
};

const requestEmailChange = async (req, res) => {
  try {
    const userId = getAuthedUserId(req);
    const newEmail = normalizeEmail(req.body?.email);

    if (!isGmail(newEmail)) {
      return res.status(400).json({ message: "Enter a valid Gmail address." });
    }

    const { rows: currentRows } = await pool.query(
      `SELECT email FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );
    const currentEmail = normalizeEmail(currentRows[0]?.email);

    if (!currentEmail) {
      return res.status(404).json({ message: "User not found." });
    }

    if (newEmail === currentEmail) {
      return res.status(400).json({ message: "Please provide a unique Gmail address." });
    }

    const { rows: existingRows } = await pool.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [newEmail],
    );

    if (existingRows.length > 0) {
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
  const client = await pool.connect();

  try {
    const userId = getAuthedUserId(req);
    const { verificationId, code } = req.body;

    if (!verificationId || !code) {
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
      return res
        .status(409)
        .json({ message: "An account with this email already exists." });
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE users
       SET email = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, full_name, email, phone, dob, address, is_admin, avatarurl`,
      [pending.new_email, userId],
    );

    await client.query(
      `UPDATE user_sessions SET user_email = $1 WHERE user_id = $2`,
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
    await client.query("ROLLBACK").catch(() => {});
    logger.error("email_change.verify_failed", err, { userId: req.user?.id });
    return res.status(500).json({ message: "Internal server error." });
  } finally {
    client.release();
  }
};

// ── Update ─────────────────────────────────────────────────────
const update = async (req, res) => {
  try {
    const { id: requestedId, fullName, email, phone, dob, address, password, avatarurl } =
      req.body;
    const id = getAuthedUserId(req);
    const normalizedEmail = normalizeEmail(email);

    if (!ensureOwnUser(req, res, requestedId || id)) return;

    // Validation
    if (!fullName || !email || !dob || !address) {
      return res.status(400).json({ message: "All fields are required." });
    }
    const normalizedDob = normalizeDateInput(dob);
    if (!normalizedDob) {
      return res.status(400).json({ message: "Enter DOB in DD/MM/YYYY format." });
    }
    if (!isGmail(normalizedEmail)) {
      return res.status(400).json({ message: "Enter a valid Gmail address." });
    }

    const { rows: currentRows } = await pool.query(
      `SELECT email FROM users WHERE id = $1 LIMIT 1`,
      [id],
    );
    const currentEmail = normalizeEmail(currentRows[0]?.email);

    if (!currentEmail) {
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
      ({ rows } = await pool.query(
        `UPDATE users 
     SET full_name = $2,
         email = $3,
         phone = $4,
         dob = $5,
         address = $6,
         password = $7,
         avatarurl = $8
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
      ));
    } else {
      ({ rows } = await pool.query(
        `UPDATE users 
     SET full_name = $2,
         email = $3,
         phone = $4,
         dob = $5,
         address = $6,
         avatarurl = $7
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
    logger.info("user.updated", { userId: user.id });

    return res.status(201).json({
      message: "Updated user successfully.",
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        phone: user.phone || "",
        dob: user.dob
          ? user.dob instanceof Date
            ? user.dob.toISOString().split("T")[0]
            : user.dob
          : "",
        address: user.address || "",
        avatarurl: user.avatarurl || "",
      },
    });
  } catch (err) {
    logger.error("user.update_failed", err, { userId: id });

    // ✅ Catch duplicate email specifically
    if (err.code === "23505" && err.constraint === "users_email_key") {
      return res
        .status(409)
        .json({ message: "This email is already in use by another account." });
    }

    return res.status(500).json({ message: "Internal server error." });
  }
};
const supportTicket = async (req, res) => {
  try {
    const { category, subject, query, type } = req.body;
    const userId = getAuthedUserId(req);

    if (!category?.trim() || !subject?.trim() || !query?.trim() || !type?.trim()) {
      return res.status(400).json({ message: "Ticket details are required." });
    }

    // ── Insert ticket ──────────────────────────
    const { rows } = await pool.query(
      `INSERT INTO notification_tickets (user_id, category, subject, query, type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ticket_id, user_id, category, subject, query, status, created_at`,
      [userId, category.trim(), subject.trim(), query.trim(), type.trim()],
    );

    const ticket = rows[0];

    logger.info("ticket.created", { userId, ticketId: ticket.ticket_id });

    return res.status(201).json({
      message: "Notification ticket created successfully.",
    });
  } catch (err) {
    logger.error("ticket.create_failed", err, { userId: getAuthedUserId(req) });
    return res.status(500).json({
      message: "Internal server error.",
    });
  }
};

const confirmedAppointments = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!ensureOwnUser(req, res, userId)) return;

    const { rows } = await pool.query(
      `SELECT *
       FROM appointment_bookings
       WHERE user_id = $1 and status = 'confirmed' AND appointment_date >= CURRENT_DATE
       ORDER BY appointment_date DESC`,
      [userId],
    );

    return res.status(200).json({
      appointments: rows.map(mapAppointment),
    });
  } catch (err) {
    logger.error("appointments.confirmed_list_failed", err, { userId: req.params.userId });
    return res.status(500).json({ message: "Internal server error." });
  }
};

const listAppointments = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!ensureOwnUser(req, res, userId)) return;

    const { rows } = await pool.query(
      `SELECT *
       FROM appointment_bookings
       WHERE user_id = $1
       ORDER BY appointment_date ASC NULLS LAST, appointment_time ASC NULLS LAST, created_at DESC`,
      [userId],
    );

    return res.status(200).json({
      appointments: rows.map(mapAppointment),
    });
  } catch (err) {
    logger.error("appointments.list_failed", err, { userId: req.params.userId });
    return res.status(500).json({ message: "Internal server error." });
  }
};

const bookAppointment = async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      appointmentType,
      subject,
      category,
      query = "",
      preferredDate,
      preferredTime,
    } = req.body;
    const userId = getAuthedUserId(req);

    if (
      !appointmentType ||
      !subject ||
      !category ||
      !preferredDate ||
      !preferredTime
    ) {
      return res
        .status(400)
        .json({ message: "Appointment details are required." });
    }

    await client.query("BEGIN");

    const notification = await createNotificationTicket(client, {
      userId,
      category,
      subject: `Appointment booked : ${subject.trim()}`,
      query:
        `${appointmentType} scheduled for ${preferredDate} at ${preferredTime}.` +
        (query ? ` Notes: ${query.trim()}` : ""),
      type: "Appointment",
      status: "pending",
      reply:
        "Your appointment request has been received. Our team will confirm it shortly.",
    });

    const { rows } = await client.query(
      `INSERT INTO appointment_bookings
        (user_id, appointment_type, category, subject, query, appointment_date, appointment_time, status, notification_ticket_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8)
       RETURNING *`,
      [
        userId,
        appointmentType.trim(),
        category.trim(),
        subject.trim(),
        query.trim(),
        preferredDate,
        preferredTime,
        notification.ticket_id,
      ],
    );

    await client.query("COMMIT");

    return res.status(201).json({
      message: "Appointment booked successfully.",
      appointment: mapAppointment(rows[0]),
      notification,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("appointments.book_failed", err, { userId: getAuthedUserId(req) });
    return res.status(500).json({ message: "Internal server error." });
  } finally {
    client.release();
  }
};

const rescheduleAppointment = async (req, res) => {
  const client = await pool.connect();

  try {
    const { bookingId } = req.params;
    const { preferredDate, preferredTime, query = "" } = req.body;
    const userId = getAuthedUserId(req);

    if (!preferredDate || !preferredTime) {
      return res
        .status(400)
        .json({ message: "New date and time are required." });
    }

    await client.query("BEGIN");

    const { rows: existingRows } = await client.query(
      `SELECT * FROM appointment_bookings WHERE booking_id = $1 AND user_id = $2 LIMIT 1`,
      [bookingId, userId],
    );

    if (existingRows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Appointment not found." });
    }

    const current = existingRows[0];
    const notification = await createNotificationTicket(client, {
      userId,
      category: current.category,
      subject: `Appointment rescheduled : ${current.subject}`,
      query:
        `${current.appointment_type} moved to ${preferredDate} at ${preferredTime}.` +
        (query ? ` Notes: ${query.trim()}` : ""),
      type: "Appointment",
      status: "pending",
      reply:
        "Your reschedule request has been received. Our team will confirm the new slot shortly.",
    });

    const { rows } = await client.query(
      `UPDATE appointment_bookings
       SET appointment_date = $3,
           appointment_time = $4,
           query = $5,
           status = 'pending',
           notification_ticket_id = $6,
           updated_at = NOW()
       WHERE booking_id = $1 AND user_id = $2
       RETURNING *`,
      [
        bookingId,
        userId,
        preferredDate,
        preferredTime,
        query.trim() || current.query || "",
        notification.ticket_id,
      ],
    );

    await client.query("COMMIT");

    return res.status(200).json({
      message: "Appointment rescheduled successfully.",
      appointment: mapAppointment(rows[0]),
      notification,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("appointments.reschedule_failed", err, { userId: getAuthedUserId(req), bookingId: req.params.bookingId });
    return res.status(500).json({ message: "Internal server error." });
  } finally {
    client.release();
  }
};

const getMyTickets = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!ensureOwnUser(req, res, userId)) return;

    const { rows } = await pool.query(
      `SELECT * FROM notification_tickets
       WHERE user_id = $1
         AND notification_status = 'true'
       ORDER BY updated_at DESC`,
      [userId],
    );

    return res.status(200).json({ tickets: rows });
  } catch (err) {
    logger.error("tickets.list_failed", err, { userId: req.params.userId });
    return res.status(500).json({ message: "Internal server error." });
  }
};

const deleteNotification = async (req, res) => {
  try {
    const { userId, ticketId } = req.params;
    if (!ensureOwnUser(req, res, userId)) return;

    const { rowCount } = await pool.query(
      `update notification_tickets SET notification_status = 'false' WHERE user_id = $1 AND ticket_id = $2`,
      [userId, ticketId],
    );

    if (rowCount === 0) {
      return res.status(404).json({ message: "Notification not found." });
    }

    return res.status(200).json({ message: "Notification cleared." });
  } catch (err) {
    logger.error("notifications.delete_failed", err, { userId: req.params.userId, ticketId: req.params.ticketId });
    return res.status(500).json({ message: "Internal server error." });
  }
};

const clearNotifications = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!ensureOwnUser(req, res, userId)) return;

    await pool.query(
      `update notification_tickets SET notification_status = 'false' WHERE user_id = $1`,
      [userId],
    );

    return res.status(200).json({ message: "All notifications cleared." });
  } catch (err) {
    logger.error("notifications.clear_failed", err, { userId: req.params.userId });
    return res.status(500).json({ message: "Internal server error." });
  }
};

module.exports = {
  register,
  verifyRegistrationEmail,
  login,
  requestEmailChange,
  verifyEmailChange,
  update,
  supportTicket,
  listAppointments,
  bookAppointment,
  rescheduleAppointment,
  getMyTickets,
  deleteNotification,
  clearNotifications,
  confirmedAppointments,
  signOut,
  tokenRefresh,
  requestPasswordReset,
  resetPassword,
};
