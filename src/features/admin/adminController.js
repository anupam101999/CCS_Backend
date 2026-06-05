const pool = require("../../config/db");
const logger = require("../../util/logger");
const { formatDateOnly } = require("../../util/time");
const { attachTicketMessages, toJsonb } = require("../customer/customerUtils");

function formatAppointmentDate(date) {
  if (!date) return "the selected date";
  return date instanceof Date
    ? formatDateOnly(date)
    : String(date).split("T")[0];
}

function buildAppointmentNotification(appointment) {
  const note = appointment.query ? ` Notes: ${appointment.query}` : "";
  const address = appointment.appointment_address
    ? ` Address: ${appointment.appointment_address}`
    : "";

  return {
    category: appointment.category,
    subject: `Appointment updated : ${appointment.subject}`,
    query:
      `${appointment.appointment_type} scheduled for ${formatAppointmentDate(
        appointment.appointment_date,
      )} at ${appointment.appointment_time || "the selected time"}.` + note + address,
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
         is_visible_in_updates = TRUE,
         is_visible_in_home = TRUE,
         is_read = FALSE,
         read_at = NULL,
         home_dismissed_at = NULL,
         updates_cleared_at = NULL,
         photo_urls = $6,
         updated_at = NOW()
     WHERE ticket_id = $7`,
    [
      notification.category,
      notification.subject,
      notification.query,
      notification.status,
      notification.reply,
      toJsonb(appointment.photo_urls || []),
      appointment.notification_ticket_id,
    ],
  );
}

function getPagination(query) {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  const offset = (page - 1) * limit;

  return { page, limit, offset };
}

function paginationPayload({ page, limit, total }) {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

const getStats = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COUNT(*)::INT FROM users WHERE is_admin = FALSE AND is_manager = FALSE) AS "totalUsers",
        (SELECT COUNT(*)::INT FROM users WHERE is_admin = FALSE AND is_manager = FALSE AND created_at >= NOW() - INTERVAL '7 days') AS "newCustomers7Days",
        (SELECT COUNT(*)::INT FROM users WHERE is_admin = FALSE AND is_manager = FALSE AND avatarurl IS NOT NULL AND avatarurl <> '') AS "customersWithAvatar",
        (SELECT COUNT(DISTINCT user_id)::INT FROM auth_sessions WHERE last_active_at > NOW() - INTERVAL '30 days') AS "activeUsers",
        (SELECT COUNT(DISTINCT user_id)::INT FROM projects) AS "customersWithProjects",
        (SELECT COUNT(*)::INT FROM projects) AS "projectPhotos",
        (SELECT COUNT(*)::INT FROM projects WHERE created_at >= NOW() - INTERVAL '7 days') AS "projectPhotos7Days",
        (SELECT COUNT(*)::INT FROM appointment_bookings) AS "totalAppointments",
        (SELECT COUNT(*)::INT FROM appointment_bookings WHERE status = 'pending') AS "pendingAppointments",
        (SELECT COUNT(*)::INT FROM appointment_bookings WHERE status = 'confirmed') AS "confirmedAppointments",
        (SELECT COUNT(*)::INT FROM appointment_bookings WHERE status = 'cancelled') AS "cancelledAppointments",
        (SELECT COUNT(*)::INT FROM appointment_bookings WHERE status = 'completed') AS "completedAppointments",
        (SELECT COUNT(*)::INT FROM appointment_bookings WHERE appointment_date = CURRENT_DATE) AS "appointmentsToday",
        (SELECT COUNT(*)::INT FROM appointment_bookings WHERE appointment_date >= CURRENT_DATE AND appointment_date < CURRENT_DATE + INTERVAL '7 days') AS "appointmentsNext7Days",
        (SELECT COUNT(*)::INT FROM appointment_bookings WHERE appointment_date < CURRENT_DATE AND status IN ('pending', 'confirmed')) AS "overdueAppointments",
        (SELECT COUNT(*)::INT FROM notification_tickets) AS "totalTickets",
        (SELECT COUNT(*)::INT FROM notification_tickets WHERE status = 'open') AS "openTickets",
        (SELECT COUNT(*)::INT FROM notification_tickets WHERE status = 'in-progress') AS "inProgressTickets",
        (SELECT COUNT(*)::INT FROM notification_tickets WHERE status = 'resolved') AS "resolvedTickets",
        (SELECT COUNT(*)::INT FROM notification_tickets WHERE status = 'closed') AS "closedTickets",
        (SELECT COUNT(*)::INT FROM notification_tickets WHERE created_at >= NOW() - INTERVAL '24 hours') AS "newTickets24Hours",
        (SELECT COUNT(*)::INT FROM notification_tickets WHERE created_at >= NOW() - INTERVAL '7 days') AS "newTickets7Days",
        (SELECT COUNT(*)::INT
         FROM notification_tickets nt
         WHERE nt.status IN ('open', 'in-progress')
           AND NOT EXISTS (
             SELECT 1
             FROM notification_ticket_messages ntm
             WHERE ntm.ticket_id = nt.ticket_id
               AND ntm.author_role IN ('admin', 'manager')
               AND ntm.is_internal = FALSE
           )) AS "ticketsAwaitingReply",
        (SELECT COUNT(*)::INT FROM notification_tickets WHERE status IN ('open', 'in-progress')) AS "openTicketWork"
    `);

    return res.json(rows[0]);
  } catch (err) {
    logger.error("admin.stats_failed", err, { adminId: req.adminId });
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getAllAppointments = async (req, res) => {
  try {
    const status = String(req.query.status || "").trim().toLowerCase();
    const user = String(req.query.user || req.query.q || "").trim();
    const { page, limit, offset } = getPagination(req.query);
    const validStatuses = ["pending", "confirmed", "cancelled", "completed"];
    const filters = [];
    const values = [];

    if (status && status !== "all") {
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: "Invalid appointment status." });
      }
      values.push(status);
      filters.push(`ab.status = $${values.length}`);
    }

    if (user) {
      const isNumericId = /^\d+$/.test(user);
      values.push(`%${user}%`);
      const searchIndex = values.length;
      if (isNumericId) {
        values.push(user);
        filters.push(
          `(ab.user_id = $${values.length} OR u.full_name ILIKE $${searchIndex} OR u.email ILIKE $${searchIndex} OR u.phone ILIKE $${searchIndex})`,
        );
      } else {
        filters.push(
          `(u.full_name ILIKE $${searchIndex} OR u.email ILIKE $${searchIndex} OR u.phone ILIKE $${searchIndex})`,
        );
      }
    }

    const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::INT AS total
       FROM appointment_bookings ab
       JOIN users u ON u.id = ab.user_id
       ${whereClause}`,
      values,
    );
    const total = countRows[0]?.total || 0;
    const dataValues = [...values, limit, offset];
    const { rows } = await pool.query(
      `SELECT ab.*, u.full_name AS user_name, u.email AS user_email
       FROM appointment_bookings ab
       JOIN users u ON u.id = ab.user_id
       ${whereClause}
       ORDER BY ab.created_at DESC
       LIMIT $${dataValues.length - 1}
       OFFSET $${dataValues.length}`,
      dataValues,
    );
    return res.json({
      appointments: rows,
      pagination: paginationPayload({ page, limit, total }),
    });
  } catch (err) {
    logger.error("admin.appointments_list_failed", err, {
      adminId: req.adminId,
    });
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getAllUsers = async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();

    if (!q) {
      logger.info("admin.users_search", {
        adminId: req.adminId,
        query: "",
        resultCount: 0,
      });
      return res.json({ users: [] });
    }

    const isNumericId = /^\d+$/.test(q);
    const search = `%${q}%`;
    const { rows } = await pool.query(
      `SELECT id, full_name, email, phone, dob, address, avatarurl
       FROM users
       WHERE is_admin = FALSE
         AND is_manager = FALSE
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

    logger.info("admin.users_search", {
      adminId: req.adminId,
      query: q,
      resultCount: rows.length,
    });
    return res.json({ users: rows });
  } catch (err) {
    logger.error("admin.users_search_failed", err, { adminId: req.adminId });
    return res.status(500).json({ message: "Internal server error." });
  }
};

const updateAppointment = async (req, res) => {
  let client;

  try {
    client = await pool.connect();
    const { bookingId } = req.params;
    const {
      appointmentType,
      category,
      subject,
      query,
      address,
      appointmentAddress,
      appointmentDate,
      appointmentTime,
      status,
    } = req.body;

    const VALID_STATUSES = ["pending", "confirmed", "cancelled", "completed"];
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      logger.warn("admin.appointment_update_rejected", {
        adminId: req.adminId,
        bookingId,
        reason: "invalid_status",
        status,
      });
      return res.status(400).json({ message: "Invalid status." });
    }

    if (appointmentDate !== undefined && !DATE_RE.test(appointmentDate)) {
      logger.warn("admin.appointment_update_rejected", {
        adminId: req.adminId,
        bookingId,
        reason: "invalid_date",
        appointmentDate,
      });
      return res.status(400).json({ message: "Invalid appointment date." });
    }

    if (appointmentTime !== undefined && !TIME_RE.test(appointmentTime)) {
      logger.warn("admin.appointment_update_rejected", {
        adminId: req.adminId,
        bookingId,
        reason: "invalid_time",
        appointmentTime,
      });
      return res.status(400).json({ message: "Invalid appointment time." });
    }

    const trimmedType =
      typeof appointmentType === "string" ? appointmentType.trim() : undefined;
    const trimmedCategory =
      typeof category === "string" ? category.trim() : undefined;
    const trimmedSubject =
      typeof subject === "string" ? subject.trim() : undefined;
    const trimmedQuery = typeof query === "string" ? query.trim() : undefined;
    const trimmedAddress =
      typeof appointmentAddress === "string"
        ? appointmentAddress.trim()
        : typeof address === "string"
          ? address.trim()
          : undefined;

    if (trimmedType === "" || trimmedCategory === "" || trimmedSubject === "") {
      logger.warn("admin.appointment_update_rejected", {
        adminId: req.adminId,
        bookingId,
        reason: "empty_required_field",
      });
      return res
        .status(400)
        .json({ message: "Required fields cannot be empty." });
    }

    await client.query("BEGIN");

    const { rows } = await client.query(
      `UPDATE appointment_bookings
       SET appointment_type = COALESCE($1, appointment_type),
           category = COALESCE($2, category),
           subject = COALESCE($3, subject),
           query = COALESCE($4, query),
           appointment_address = COALESCE($5, appointment_address),
           appointment_date = COALESCE($6, appointment_date),
           appointment_time = COALESCE($7, appointment_time),
           status = COALESCE($8, status),
           updated_at = NOW()
       WHERE booking_id = $9
       RETURNING *`,
      [
        trimmedType ?? null,
        trimmedCategory ?? null,
        trimmedSubject ?? null,
        trimmedQuery ?? null,
        trimmedAddress ?? null,
        appointmentDate ?? null,
        appointmentTime ?? null,
        status ?? null,
        bookingId,
      ],
    );

    if (!rows[0]) {
      await client.query("ROLLBACK");
      logger.warn("admin.appointment_update_not_found", {
        adminId: req.adminId,
        bookingId,
      });
      return res.status(404).json({ message: "Appointment not found." });
    }

    await syncAppointmentNotification(client, rows[0]);
    await client.query("COMMIT");

    logger.info("admin.appointment_updated", {
      adminId: req.adminId,
      bookingId,
      status: rows[0].status,
    });
    return res.json({ appointment: rows[0] });
  } catch (err) {
    await client?.query("ROLLBACK").catch(() => {});
    logger.error("admin.appointment_update_failed", err, {
      adminId: req.adminId,
      bookingId: req.params.bookingId,
    });
    return res.status(500).json({ message: "Internal server error." });
  } finally {
    client?.release();
  }
};

const updateAppointmentStatus = async (req, res) => {
  let client;

  try {
    client = await pool.connect();
    const { bookingId } = req.params;
    const { status } = req.body;

    const VALID = ["pending", "confirmed", "cancelled", "completed"];
    if (!VALID.includes(status)) {
      logger.warn("admin.appointment_status_rejected", {
        adminId: req.adminId,
        bookingId,
        reason: "invalid_status",
        status,
      });
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
      logger.warn("admin.appointment_status_not_found", {
        adminId: req.adminId,
        bookingId,
      });
      return res.status(404).json({ message: "Appointment not found." });
    }

    await syncAppointmentNotification(client, rows[0]);
    await client.query("COMMIT");

    logger.info("admin.appointment_status_updated", {
      adminId: req.adminId,
      bookingId,
      status,
    });
    return res.json({ appointment: rows[0] });
  } catch (err) {
    await client?.query("ROLLBACK").catch(() => {});
    logger.error("admin.appointment_status_update_failed", err, {
      adminId: req.adminId,
      bookingId: req.params.bookingId,
    });
    return res.status(500).json({ message: "Internal server error." });
  } finally {
    client?.release();
  }
};

const getAllTickets = async (req, res) => {
  try {
    const status = String(req.query.status || "").trim().toLowerCase();
    const user = String(req.query.user || req.query.q || "").trim();
    const { page, limit, offset } = getPagination(req.query);
    const validStatuses = ["open", "in-progress", "resolved", "closed"];
    const filters = [];
    const values = [];

    if (status && status !== "all") {
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: "Invalid ticket status." });
      }
      values.push(status);
      filters.push(`nt.status = $${values.length}`);
    }

    if (user) {
      const isNumericId = /^\d+$/.test(user);
      values.push(`%${user}%`);
      const searchIndex = values.length;
      if (isNumericId) {
        values.push(user);
        filters.push(
          `(nt.user_id = $${values.length} OR u.full_name ILIKE $${searchIndex} OR u.email ILIKE $${searchIndex} OR u.phone ILIKE $${searchIndex})`,
        );
      } else {
        filters.push(
          `(u.full_name ILIKE $${searchIndex} OR u.email ILIKE $${searchIndex} OR u.phone ILIKE $${searchIndex})`,
        );
      }
    }

    const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*)::INT AS total
       FROM notification_tickets nt
       JOIN users u ON u.id = nt.user_id
       ${whereClause}`,
      values,
    );
    const total = countRows[0]?.total || 0;
    const dataValues = [...values, limit, offset];
    const { rows } = await pool.query(
      `SELECT nt.ticket_id, nt.user_id, u.full_name AS user_name, u.email AS user_email,
              nt.category, nt.subject, nt.query, nt.reply, nt.type, nt.status,
              nt.is_visible_in_updates, nt.is_visible_in_home, nt.is_read,
              nt.read_at, nt.home_dismissed_at, nt.updates_cleared_at,
              nt.photo_urls, nt.created_at, nt.updated_at
       FROM notification_tickets nt
       JOIN users u ON u.id = nt.user_id
       ${whereClause}
       ORDER BY nt.updated_at DESC
       LIMIT $${dataValues.length - 1}
       OFFSET $${dataValues.length}`,
      dataValues,
    );
    return res.json({
      tickets: await attachTicketMessages(rows),
      pagination: paginationPayload({ page, limit, total }),
    });
  } catch (err) {
    logger.error("admin.tickets_list_failed", err, { adminId: req.adminId });
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getLogs = async (req, res) => {
  try {
    const source = String(req.query.source || "app").trim().toLowerCase();
    const date = String(req.query.date || "").trim();
    const level = String(req.query.level || "")
      .trim()
      .toLowerCase();
    const status = String(req.query.status || "")
      .trim()
      .toLowerCase();
    const search = String(req.query.q || "").trim();
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
    const offset = (page - 1) * limit;

    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const VALID_LEVELS = ["info", "warn", "error"];
    const VALID_SOURCES = ["app", "batch"];
    const VALID_BATCH_STATUSES = ["running", "success", "failed", "skipped"];
    const filters = [];
    const values = [];

    if (!VALID_SOURCES.includes(source)) {
      logger.warn("admin.logs_query_rejected", {
        adminId: req.adminId,
        reason: "invalid_source",
        source,
      });
      return res.status(400).json({ message: "Invalid log source." });
    }

    if (date) {
      if (!DATE_RE.test(date)) {
        logger.warn("admin.logs_query_rejected", {
          adminId: req.adminId,
          reason: "invalid_date",
          date,
        });
        return res.status(400).json({ message: "Invalid date." });
      }
      values.push(date);
      filters.push(
        `${source === "batch" ? "started_at" : "created_at"} >= $${values.length}::date AND ${source === "batch" ? "started_at" : "created_at"} < ($${values.length}::date + INTERVAL '1 day')`,
      );
    }

    if (source === "app" && level) {
      if (!VALID_LEVELS.includes(level)) {
        logger.warn("admin.logs_query_rejected", {
          adminId: req.adminId,
          reason: "invalid_level",
          level,
        });
        return res.status(400).json({ message: "Invalid level." });
      }
      values.push(level);
      filters.push(`level = $${values.length}`);
    }

    if (source === "batch" && status) {
      if (!VALID_BATCH_STATUSES.includes(status)) {
        logger.warn("admin.logs_query_rejected", {
          adminId: req.adminId,
          reason: "invalid_batch_status",
          status,
        });
        return res.status(400).json({ message: "Invalid batch status." });
      }
      values.push(status);
      filters.push(`run_status = $${values.length}`);
    }

    if (search) {
      values.push(`%${search}%`);
      if (source === "batch") {
        filters.push(
          `(job_name ILIKE $${values.length} OR run_source ILIKE $${values.length} OR run_status ILIKE $${values.length} OR metadata::text ILIKE $${values.length} OR error_message ILIKE $${values.length})`,
        );
      } else {
        filters.push(
          `(event ILIKE $${values.length} OR message ILIKE $${values.length} OR meta::text ILIKE $${values.length})`,
        );
      }
    }

    const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    values.push(limit);
    values.push(offset);

    if (source === "batch") {
      const { rows: resultRows } = await pool.query(
        `WITH filtered AS (
           SELECT id, job_name, run_source, run_status, dry_run, started_at,
                  finished_at, duration_ms, metadata, error_message, created_at,
                  updated_at
           FROM batch_job_runs
           ${whereClause}
         ),
         counted AS (
           SELECT COUNT(*)::INT AS total FROM filtered
         ),
         paged AS (
           SELECT *
           FROM filtered
           ORDER BY started_at DESC
           LIMIT $${values.length - 1}
           OFFSET $${values.length}
         )
         SELECT counted.total,
                COALESCE(
                  JSON_AGG(paged ORDER BY paged.started_at DESC)
                    FILTER (WHERE paged.id IS NOT NULL),
                  '[]'::JSON
                ) AS logs
         FROM counted
         LEFT JOIN paged ON TRUE
         GROUP BY counted.total`,
        values,
      );

      const total = resultRows[0]?.total || 0;
      const rows = resultRows[0]?.logs || [];

      logger.info("admin.batch_logs_listed", {
        adminId: req.adminId,
        date,
        status: status || "all",
        search: Boolean(search),
        page,
        limit,
        resultCount: rows.length,
        total,
      });
      return res.json({
        source,
        logs: rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      });
    }

    const { rows: resultRows } = await pool.query(
      `WITH filtered AS (
         SELECT id, level, event, message, meta, created_at
         FROM app_logs
         ${whereClause}
       ),
       counted AS (
         SELECT COUNT(*)::INT AS total FROM filtered
       ),
       paged AS (
         SELECT *
         FROM filtered
         ORDER BY created_at DESC, id DESC
         LIMIT $${values.length - 1}
         OFFSET $${values.length}
       )
       SELECT counted.total,
              COALESCE(
                JSON_AGG(paged ORDER BY paged.created_at DESC, paged.id DESC)
                  FILTER (WHERE paged.id IS NOT NULL),
                '[]'::JSON
              ) AS logs
       FROM counted
       LEFT JOIN paged ON TRUE
       GROUP BY counted.total`,
      values,
    );

    const total = resultRows[0]?.total || 0;
    const rows = resultRows[0]?.logs || [];

    logger.info("admin.logs_listed", {
      adminId: req.adminId,
      date,
      level: level || "all",
      search: Boolean(search),
      page,
      limit,
      resultCount: rows.length,
      total,
    });
    return res.json({
      source,
      logs: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    logger.error("admin.logs_list_failed", err, { adminId: req.adminId });
    return res.status(500).json({ message: "Internal server error." });
  }
};

const updateTicket = async (req, res) => {
  let client;

  try {
    client = await pool.connect();
    const { ticketId } = req.params;
    const { status, reply } = req.body;
    const trimmedReply = typeof reply === "string" ? reply.trim() : undefined;
    const authorRole = req.user?.is_manager ? "manager" : "admin";

    const VALID = ["open", "in-progress", "resolved", "closed"];
    if (status && !VALID.includes(status)) {
      logger.warn("admin.ticket_update_rejected", {
        adminId: req.adminId,
        ticketId,
        reason: "invalid_status",
        status,
      });
      return res.status(400).json({ message: "Invalid status." });
    }

    await client.query("BEGIN");

    const { rows } = await client.query(
      `UPDATE notification_tickets
       SET status = COALESCE($1, status),
           reply  = COALESCE($2, reply),
           is_visible_in_updates = CASE
             WHEN $2 IS NOT NULL THEN TRUE
             ELSE is_visible_in_updates
           END,
           is_visible_in_home = CASE
             WHEN $2 IS NOT NULL THEN TRUE
             ELSE is_visible_in_home
           END,
           is_read = CASE
             WHEN $2 IS NOT NULL THEN FALSE
             ELSE is_read
           END,
           read_at = CASE
             WHEN $2 IS NOT NULL THEN NULL
             ELSE read_at
           END,
           home_dismissed_at = CASE
             WHEN $2 IS NOT NULL THEN NULL
             ELSE home_dismissed_at
           END,
           updates_cleared_at = CASE
             WHEN $2 IS NOT NULL THEN NULL
             ELSE updates_cleared_at
           END,
           updated_at = NOW()
       WHERE ticket_id = $3
       RETURNING *`,
      [status || null, trimmedReply || null, ticketId],
    );

    if (!rows[0]) {
      await client.query("ROLLBACK");
      logger.warn("admin.ticket_update_not_found", {
        adminId: req.adminId,
        ticketId,
      });
      return res.status(404).json({ message: "Ticket not found." });
    }

    if (trimmedReply) {
      await client.query(
        `INSERT INTO notification_ticket_messages
          (ticket_id, author_user_id, author_role, message_body)
         VALUES ($1, $2, $3, $4)`,
        [ticketId, req.adminId, authorRole, trimmedReply],
      );
    }

    await client.query("COMMIT");
    client.release();
    client = null;

    const [ticket] = await attachTicketMessages(rows);
    logger.info("admin.ticket_updated", {
      adminId: req.adminId,
      ticketId,
      status: rows[0].status,
      hasReply: Boolean(trimmedReply),
    });
    return res.json({ ticket });
  } catch (err) {
    await client?.query("ROLLBACK").catch(() => {});
    logger.error("admin.ticket_update_failed", err, {
      adminId: req.adminId,
      ticketId: req.params.ticketId,
    });
    return res.status(500).json({ message: "Internal server error." });
  } finally {
    client?.release();
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
  getLogs,
};
