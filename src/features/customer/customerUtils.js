const crypto = require("crypto");
const logger = require("../../util/logger");
const { formatDateOnly: formatDateOnlyInTimeZone } = require("../../util/time");
const {
  sendEmailChangeOtp,
  sendPasswordReset,
  sendRegistrationOtp,
} = require("../../services/mailer");

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
  const displayMatch = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);

  const [, year, month, day] = isoMatch || [];
  const [, uiDay, uiMonth, uiYear] = uiMatch || [];
  const [, displayMonth, displayDay, displayYear] = displayMatch || [];
  const normalized = isoMatch
    ? `${year}-${month}-${day}`
    : uiMatch
      ? `${uiYear}-${uiMonth}-${uiDay}`
      : displayMatch
        ? `${displayYear}-${displayMonth}-${displayDay}`
      : "";

  if (!normalized) return null;

  const [dateYear, dateMonth, dateDay] = normalized.split("-").map(Number);
  const validDate =
    Number.isInteger(dateYear) &&
    Number.isInteger(dateMonth) &&
    Number.isInteger(dateDay) &&
    dateMonth >= 1 &&
    dateMonth <= 12 &&
    dateDay >= 1 &&
    dateDay <= new Date(dateYear, dateMonth, 0).getDate();
  if (!validDate) {
    return null;
  }

  return normalized;
}

function formatDateOnly(value) {
  if (!value) return "";
  if (value instanceof Date) return formatDateOnlyInTimeZone(value);

  const raw = String(value).trim();
  const isoDate = raw.match(/^(\d{4}-\d{2}-\d{2})(?:T.*)?$/);
  if (isoDate) return isoDate[1];

  return normalizeDateInput(raw) || raw;
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
  const isAdmin = user.is_admin === true;
  return {
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    phone: user.phone || "",
    dob: formatDateOnly(user.dob),
    address: user.address || "",
    is_admin: isAdmin,
    is_manager: !isAdmin && user.is_manager === true,
    avatarurl: user.avatarurl || "",
  };
}

function getClientOrigin() {
  const configuredOrigin =
    process.env.FRONTEND_URL ||
    String(process.env.FRONTEND_ORIGINS || "").split(",")[0]?.trim();

  if (!configuredOrigin) return "";

  try {
    const origin = new URL(configuredOrigin);
    if (!["http:", "https:"].includes(origin.protocol)) return "";
    return origin.origin;
  } catch {
    return "";
  }
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
  if ((req.user?.is_admin || req.user?.is_manager) && req.headers["x-view-as-user-id"]) {
    return req.headers["x-view-as-user-id"];
  }
  return req.user?.id;
}

function ensureOwnUser(req, res, userId) {
  if (req.user?.is_admin || req.user?.is_manager) return true;

  const authedUserId = getAuthedUserId(req);
  if (!authedUserId || String(authedUserId) !== String(userId)) {
    logger.warn("auth.ownership_denied", {
      authedUserId,
      requestedUserId: userId,
      method: req.method,
      path: req.originalUrl,
    });
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
        ? formatDateOnlyInTimeZone(row.appointment_date)
        : String(row.appointment_date).split("T")[0]
      : "",
    time: row.appointment_time || "",
    status: row.status,
    notificationTicketId: row.notification_ticket_id || "",
    appointment_address: row.appointment_address || "",
    address: row.appointment_address || "",
    photoUrls: row.photo_urls || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function createNotificationTicket(
  client,
  { userId, category, subject, query, type, status = "open", reply = null, photoUrls = [] },
) {
  const { rows } = await client.query(
    `INSERT INTO notification_tickets
      (user_id, category, subject, query, type, status, reply, photo_urls)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ticket_id, user_id, category, subject, query, reply, type, status,
               is_visible_in_updates, is_visible_in_home, is_read, read_at,
               home_dismissed_at, updates_cleared_at,
               photo_urls, created_at, updated_at`,
    [userId, category, subject, query, type, status, reply, toJsonb(photoUrls)],
  );

  if (query && type !== "Appointment") {
    await client.query(
      `INSERT INTO notification_ticket_messages
        (ticket_id, author_user_id, author_role, message_body)
       VALUES ($1, $2, 'customer', $3)`,
      [rows[0].ticket_id, userId, query],
    );
  }

  if (reply) {
    await client.query(
      `INSERT INTO notification_ticket_messages
        (ticket_id, author_role, message_body)
       VALUES ($1, 'system', $2)`,
      [rows[0].ticket_id, reply],
    );
  }

  return rows[0];
}

async function getTicketMessages(ticketIds) {
  const ids = [...new Set((ticketIds || []).filter(Boolean))];
  if (!ids.length) return {};

  const { rows } = await require("../../config/db").query(
    `SELECT message_id, ticket_id, author_user_id, author_role, message_body,
            is_internal, created_at
     FROM notification_ticket_messages
     WHERE ticket_id = ANY($1)
       AND is_internal = FALSE
     ORDER BY created_at ASC, message_id ASC`,
    [ids],
  );

  return rows.reduce((grouped, message) => {
    grouped[message.ticket_id] = grouped[message.ticket_id] || [];
    grouped[message.ticket_id].push(message);
    return grouped;
  }, {});
}

async function attachTicketMessages(tickets) {
  const list = Array.isArray(tickets) ? tickets : [];
  const grouped = await getTicketMessages(list.map((ticket) => ticket.ticket_id));

  return list.map((ticket) => ({
    ...ticket,
    messages: grouped[ticket.ticket_id] || [],
  }));
}

function normalizePhotoUrls(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch {
      return value ? [value] : [];
    }
  }
  return [];
}

function toJsonb(value) {
  return JSON.stringify(normalizePhotoUrls(value));
}

module.exports = {
  PASSWORD_RESET_TOKEN_MINUTES,
  REGISTRATION_VERIFICATION_CODE_MINUTES,
  EMAIL_CHANGE_VERIFICATION_CODE_MINUTES,
  normalizeEmail,
  isGmail,
  normalizeDateInput,
  hashResetToken,
  hashVerificationCode,
  generateVerificationCode,
  mapUser,
  getClientOrigin,
  deliverRegistrationVerificationCode,
  deliverEmailChangeVerificationCode,
  deliverPasswordResetLink,
  getAuthedUserId,
  ensureOwnUser,
  mapAppointment,
  createNotificationTicket,
  attachTicketMessages,
  getTicketMessages,
  normalizePhotoUrls,
  toJsonb,
};
