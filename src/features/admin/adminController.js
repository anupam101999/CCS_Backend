const pool = require("../../config/db");
const logger = require("../../util/logger");

function formatAppointmentDate(date) {
  if (!date) return "the selected date";
  return date instanceof Date
    ? date.toISOString().split("T")[0]
    : String(date).split("T")[0];
}

function buildAppointmentNotification(appointment) {
  const note = appointment.query ? ` Notes: ${appointment.query}` : "";

  return {
    category: appointment.category,
    subject: `Appointment updated : ${appointment.subject}`,
    query:
      `${appointment.appointment_type} scheduled for ${formatAppointmentDate(
        appointment.appointment_date,
      )} at ${appointment.appointment_time || "the selected time"}.` + note,
    status: appointment.status,
    reply: `Your appointment is currently ${appointment.status}.`,
  };
}

async function syncAppointmentNotification(client, appointment) {
  if (!appointment.notification_ticket_id) return;

  const notification = buildAppointmentNotification(appointment);

  await client.query(
    `UPDATE notification_tickets
     SET category = $1,
         subject = $2,
         query = $3,
         status = $4,
         reply = $5,
         type = 'Appointment',
         updated_at = NOW()
     WHERE ticket_id = $6`,
    [
      notification.category,
      notification.subject,
      notification.query,
      notification.status,
      notification.reply,
      appointment.notification_ticket_id,
    ],
  );
}

const getStats = async (req, res) => {
  try {
    const [users, appts, tickets] = await Promise.all([
      pool.query(`SELECT COUNT(*) FROM users WHERE is_admin = FALSE`),
      pool.query(
        `SELECT status, COUNT(*) FROM appointment_bookings GROUP BY status`,
      ),
      pool.query(
        `SELECT status, COUNT(*) FROM notification_tickets GROUP BY status`,
      ),
    ]);

    const apptMap = Object.fromEntries(
      appts.rows.map((r) => [r.status, parseInt(r.count)]),
    );
    const ticketMap = Object.fromEntries(
      tickets.rows.map((r) => [r.status, parseInt(r.count)]),
    );

    return res.json({
      totalUsers: parseInt(users.rows[0].count),
      pendingAppointments: apptMap["pending"] || 0,
      confirmedAppointments: apptMap["confirmed"] || 0,
      openTickets: ticketMap["open"] || 0,
      resolvedTickets: ticketMap["resolved"] || 0,
    });
  } catch (err) {
    logger.error("admin.stats_failed", err, { adminId: req.adminId });
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getAllAppointments = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT ab.*, u.email AS user_email
       FROM appointment_bookings ab
       JOIN users u ON u.id = ab.user_id
       ORDER BY ab.created_at DESC`,
    );
    return res.json({ appointments: rows });
  } catch (err) {
    logger.error("admin.appointments_list_failed", err, { adminId: req.adminId });
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getAllUsers = async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();

    if (!q) {
      return res.json({ users: [] });
    }

    const isNumericId = /^\d+$/.test(q);
    const search = `%${q}%`;
    const { rows } = await pool.query(
      `SELECT id, full_name, email, phone, dob, address, avatarurl
       FROM users
       WHERE is_admin = FALSE
         AND (
           ${isNumericId ? "id = $2 OR" : ""}
           full_name ILIKE $1
           OR email ILIKE $1
           OR phone ILIKE $1
         )
       ORDER BY full_name ASC, email ASC
       LIMIT 20`,
      isNumericId ? [search, q] : [search],
    );

    return res.json({ users: rows });
  } catch (err) {
    logger.error("admin.users_search_failed", err, { adminId: req.adminId });
    return res.status(500).json({ message: "Internal server error." });
  }
};

const updateAppointment = async (req, res) => {
  const client = await pool.connect();

  try {
    const { bookingId } = req.params;
    const {
      appointmentType,
      category,
      subject,
      query,
      appointmentDate,
      appointmentTime,
      status,
    } = req.body;

    const VALID_STATUSES = ["pending", "confirmed", "cancelled", "completed"];
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ message: "Invalid status." });
    }

    if (appointmentDate !== undefined && !DATE_RE.test(appointmentDate)) {
      return res.status(400).json({ message: "Invalid appointment date." });
    }

    if (appointmentTime !== undefined && !TIME_RE.test(appointmentTime)) {
      return res.status(400).json({ message: "Invalid appointment time." });
    }

    const trimmedType =
      typeof appointmentType === "string" ? appointmentType.trim() : undefined;
    const trimmedCategory =
      typeof category === "string" ? category.trim() : undefined;
    const trimmedSubject =
      typeof subject === "string" ? subject.trim() : undefined;
    const trimmedQuery = typeof query === "string" ? query.trim() : undefined;

    if (
      trimmedType === "" ||
      trimmedCategory === "" ||
      trimmedSubject === ""
    ) {
      return res.status(400).json({ message: "Required fields cannot be empty." });
    }

    await client.query("BEGIN");

    const { rows } = await client.query(
      `UPDATE appointment_bookings
       SET appointment_type = COALESCE($1, appointment_type),
           category = COALESCE($2, category),
           subject = COALESCE($3, subject),
           query = COALESCE($4, query),
           appointment_date = COALESCE($5, appointment_date),
           appointment_time = COALESCE($6, appointment_time),
           status = COALESCE($7, status),
           updated_at = NOW()
       WHERE booking_id = $8
       RETURNING *`,
      [
        trimmedType ?? null,
        trimmedCategory ?? null,
        trimmedSubject ?? null,
        trimmedQuery ?? null,
        appointmentDate ?? null,
        appointmentTime ?? null,
        status ?? null,
        bookingId,
      ],
    );

    if (!rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Appointment not found." });
    }

    await syncAppointmentNotification(client, rows[0]);
    await client.query("COMMIT");

    return res.json({ appointment: rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("admin.appointment_update_failed", err, { adminId: req.adminId, bookingId: req.params.bookingId });
    return res.status(500).json({ message: "Internal server error." });
  } finally {
    client.release();
  }
};

const updateAppointmentStatus = async (req, res) => {
  const client = await pool.connect();

  try {
    const { bookingId } = req.params;
    const { status } = req.body;

    const VALID = ["pending", "confirmed", "cancelled", "completed"];
    if (!VALID.includes(status)) {
      return res.status(400).json({ message: "Invalid status." });
    }

    await client.query("BEGIN");

    const { rows } = await client.query(
      `UPDATE appointment_bookings
       SET status = $1, updated_at = NOW()
       WHERE booking_id = $2
       RETURNING *`,
      [status, bookingId],
    );

    if (!rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "Appointment not found." });
    }

    await syncAppointmentNotification(client, rows[0]);
    await client.query("COMMIT");

    return res.json({ appointment: rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("admin.appointment_status_update_failed", err, { adminId: req.adminId, bookingId: req.params.bookingId });
    return res.status(500).json({ message: "Internal server error." });
  } finally {
    client.release();
  }
};

const getAllTickets = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM notification_tickets ORDER BY updated_at DESC`,
    );
    return res.json({ tickets: rows });
  } catch (err) {
    logger.error("admin.tickets_list_failed", err, { adminId: req.adminId });
    return res.status(500).json({ message: "Internal server error." });
  }
};

const updateTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { status, reply } = req.body;
    const trimmedReply = typeof reply === "string" ? reply.trim() : undefined;

    const VALID = ["open", "in-progress", "resolved", "closed"];
    if (status && !VALID.includes(status)) {
      return res.status(400).json({ message: "Invalid status." });
    }

    const { rows } = await pool.query(
      `UPDATE notification_tickets
       SET status = COALESCE($1, status),
           reply  = COALESCE($2, reply),
           notification_status = CASE
             WHEN $2 IS NOT NULL THEN TRUE
             ELSE notification_status
           END,
           updated_at = NOW()
       WHERE ticket_id = $3
       RETURNING *`,
      [status || null, trimmedReply || null, ticketId],
    );

    if (!rows[0]) return res.status(404).json({ message: "Ticket not found." });
    return res.json({ ticket: rows[0] });
  } catch (err) {
    logger.error("admin.ticket_update_failed", err, { adminId: req.adminId, ticketId: req.params.ticketId });
    return res.status(500).json({ message: "Internal server error." });
  }
};

module.exports = {
  getStats,
  getAllUsers,
  getAllAppointments,
  updateAppointment,
  updateAppointmentStatus,
  getAllTickets,
  updateTicket,
};
