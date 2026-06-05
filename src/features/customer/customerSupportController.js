const pool = require("../../config/db");
const logger = require("../../util/logger");
const { sendNotificationToUser } = require("../../services/notificationEvents");
const {
  getAuthedUserId,
  ensureOwnUser,
  attachTicketMessages,
  normalizePhotoUrls,
  toJsonb,
} = require("./customerUtils");
const {
  TICKET_RETURNING_FIELDS,
  buildTicketListFilter,
  buildHomeNotificationFilter,
  countTickets,
  listTickets,
  findTicketForMessage,
  insertTicketMessage,
  makeTicketVisibleInUpdates,
} = require("./customerSupportQueries");

const supportTicket = async (req, res) => {
  try {
    const { category, subject, query, type } = req.body;
    const userId = getAuthedUserId(req);
    const photoUrls = normalizePhotoUrls(req.body?.photo_urls || []).slice(0, 5);

    if (!category?.trim() || !subject?.trim() || !query?.trim() || !type?.trim()) {
      logger.warn("ticket.create_rejected", { userId, reason: "missing_required_fields" });
      return res.status(400).json({ message: "Ticket details are required." });
    }

    const ticket = await pool.withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO notification_tickets (user_id, category, subject, query, type, photo_urls)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ticket_id, user_id, category, subject, query, status,
                   is_visible_in_updates, is_visible_in_home, is_read,
                   created_at, photo_urls`,
        [userId, category.trim(), subject.trim(), query.trim(), type.trim(), toJsonb(photoUrls)],
      );

      await client.query(
        `INSERT INTO notification_ticket_messages
          (ticket_id, author_user_id, author_role, message_body)
         VALUES ($1, $2, 'customer', $3)`,
        [rows[0].ticket_id, userId, query.trim()],
      );

      return rows[0];
    });

    logger.info("ticket.created", { userId, ticketId: ticket.ticket_id });
    sendNotificationToUser(userId, {
      title: "Ticket created",
      message: "Your support ticket has been created.",
      type: "ticket.created",
      ticketId: ticket.ticket_id,
    });

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

const updateTicket = async (req, res) => {
  try {
    const userId = getAuthedUserId(req);
    const { ticketId } = req.params;
    const { category, subject, query, photo_urls: photoUrlsInput } = req.body;
    const photoUrls = Array.isArray(photoUrlsInput)
      ? normalizePhotoUrls(photoUrlsInput).slice(0, 5)
      : undefined;

    if (
      (category !== undefined && !category?.trim()) ||
      (subject !== undefined && !subject?.trim()) ||
      (query !== undefined && !query?.trim())
    ) {
      logger.warn("ticket.update_rejected", { userId, ticketId, reason: "empty_required_field" });
      return res.status(400).json({ message: "Ticket details cannot be empty." });
    }

    const { rows } = await pool.query(
      `UPDATE notification_tickets
       SET category = COALESCE($1, category),
           subject = COALESCE($2, subject),
           query = COALESCE($3, query),
           photo_urls = COALESCE($4, photo_urls),
           updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
       WHERE ticket_id = $5
         AND user_id = $6
         AND COALESCE(type, '') <> 'Appointment'
       RETURNING ${TICKET_RETURNING_FIELDS}`,
      [
        typeof category === "string" ? category.trim() : null,
        typeof subject === "string" ? subject.trim() : null,
        typeof query === "string" ? query.trim() : null,
        photoUrls ? toJsonb(photoUrls) : null,
        ticketId,
        userId,
      ],
    );

    if (!rows[0]) {
      logger.warn("ticket.update_not_found", { userId, ticketId });
      return res.status(404).json({ message: "Ticket not found." });
    }

    logger.info("ticket.updated", { userId, ticketId });
    const [ticket] = await attachTicketMessages(rows);
    sendNotificationToUser(userId, {
      title: "Ticket updated",
      message: "Your ticket details were updated.",
      type: "ticket.updated",
      ticketId,
    });
    return res.json({ ticket });
  } catch (err) {
    logger.error("ticket.update_failed", err, { userId: getAuthedUserId(req), ticketId: req.params.ticketId });
    return res.status(500).json({ message: "Internal server error." });
  }
};

const addTicketMessage = async (req, res) => {
  try {
    if (req.user?.is_manager) {
      logger.warn("ticket.message_add_denied", {
        requesterId: req.user.id,
        ticketId: req.params.ticketId,
        reason: "manager_read_only",
      });
      return res.status(403).json({
        code: "MANAGER_READ_ONLY",
        message: "Manager access is read-only.",
      });
    }
    const isAdmin = req.user?.is_admin === true;
    const userId = req.user?.id;
    const { ticketId } = req.params;
    const messageBody = String(req.body?.message || "").trim();

    if (!messageBody) {
      return res.status(400).json({ message: "Message is required." });
    }
    if (messageBody.length > 4000) {
      return res.status(400).json({ message: "Message must be 4000 characters or fewer." });
    }

    const ticket = await pool.withTransaction(async (client) => {
      const current = await findTicketForMessage(client, {
        ticketId,
        isAdmin,
        userId,
      });
      if (!current) return null;
      if (!isAdmin && String(current.status).toLowerCase() !== "in-progress") {
        const err = new Error("New messages can only be added while the ticket is in progress.");
        err.code = "TICKET_CHAT_CLOSED";
        throw err;
      }

      await insertTicketMessage(client, {
        ticketId,
        userId,
        authorRole: isAdmin ? "admin" : "customer",
        messageBody,
      });
      return makeTicketVisibleInUpdates(client, ticketId);
    });

    if (!ticket) {
      return res.status(404).json({ message: "Ticket not found." });
    }

    const [ticketWithMessages] = await attachTicketMessages([ticket]);
    logger.info("ticket.message_added", {
      userId,
      ticketId,
      authorRole: isAdmin ? "admin" : "customer",
    });
    sendNotificationToUser(ticket.user_id, {
      title: isAdmin ? "Admin replied" : "Message added",
      message: isAdmin
        ? "Admin replied to your ticket."
        : "Your message was added to the ticket.",
      type: "ticket.message_added",
      ticketId,
    });
    return res.status(201).json({ ticket: ticketWithMessages });
  } catch (err) {
    if (err?.code === "TICKET_CHAT_CLOSED") {
      return res.status(409).json({
        code: err.code,
        message: err.message,
      });
    }
    logger.error("ticket.message_add_failed", err, {
      userId: getAuthedUserId(req),
      ticketId: req.params.ticketId,
    });
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getMyTickets = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!ensureOwnUser(req, res, userId)) return;
    const search = String(req.query.q || "").trim();
    const type = String(req.query.type || "").trim();
    const read = String(req.query.read || "all").trim().toLowerCase();
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
    const offset = (page - 1) * limit;
    if (read && read !== "all") {
      if (!["read", "unread"].includes(read)) {
        return res.status(400).json({ message: "Invalid read filter." });
      }
    }

    const { whereClause, values } = buildTicketListFilter({
      userId,
      search,
      type,
      read,
    });
    const { total, unreadTotal } = await countTickets(pool, whereClause, values);
    const rows = await listTickets(pool, whereClause, values, limit, offset);

    logger.info("tickets.listed", {
      userId,
      search: Boolean(search),
      page,
      limit,
      read,
      resultCount: rows.length,
      total,
      unreadTotal,
    });
    return res.status(200).json({
      tickets: await attachTicketMessages(rows),
      unreadTotal,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    logger.error("tickets.list_failed", err, { userId: req.params.userId });
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getHomeNotifications = async (req, res) => {
  const { userId } = req.params;

  try {
    if (!ensureOwnUser(req, res, userId)) return;

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 20);
    const offset = (page - 1) * limit;

    const { whereClause, values } = buildHomeNotificationFilter(userId);
    const { total: count } = await countTickets(pool, whereClause, values);
    const rows = await listTickets(pool, whereClause, values, limit, offset);

    logger.info("notifications.home_listed", {
      userId,
      page,
      limit,
      resultCount: rows.length,
      total: count,
    });

    return res.json({
      count,
      tickets: await attachTicketMessages(rows),
      pagination: {
        page,
        limit,
        total: count,
        totalPages: Math.max(1, Math.ceil(count / limit)),
      },
    });
  } catch (err) {
    logger.error("notifications.home_list_failed", err, {
      userId: req.params.userId,
    });

    return res.status(500).json({
      message: "Internal server error.",
    });
  }
};
const markNotificationRead = async (req, res) => {
  try {
    const { userId, ticketId } = req.params;
    if (!ensureOwnUser(req, res, userId)) return;

    const { rows } = await pool.query(
      `UPDATE notification_tickets
       SET is_read = TRUE,
           read_at = COALESCE(read_at, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')),
           updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
       WHERE user_id = $1
         AND ticket_id = $2
       RETURNING ticket_id, is_read, read_at`,
      [userId, ticketId],
    );

    if (!rows[0]) {
      logger.warn("notifications.mark_read_not_found", { userId, ticketId });
      return res.status(404).json({ message: "Notification not found." });
    }

    logger.info("notifications.marked_read", { userId, ticketId });
    return res.json({ ticket: rows[0] });
  } catch (err) {
    logger.error("notifications.mark_read_failed", err, {
      userId: req.params.userId,
      ticketId: req.params.ticketId,
    });
    return res.status(500).json({ message: "Internal server error." });
  }
};

const clearHomeNotification = async (req, res) => {
  try {
    const { userId, ticketId } = req.params;
    if (!ensureOwnUser(req, res, userId)) return;

    const { rowCount } = await pool.query(
      `UPDATE notification_tickets
       SET is_visible_in_home = FALSE,
           home_dismissed_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
       WHERE user_id = $1
         AND ticket_id = $2`,
      [userId, ticketId],
    );

    if (rowCount === 0) {
      logger.warn("notifications.home_clear_not_found", { userId, ticketId });
      return res.status(404).json({ message: "Notification not found." });
    }

    logger.info("notifications.home_cleared", { userId, ticketId });
    return res.json({ message: "Home notification cleared." });
  } catch (err) {
    logger.error("notifications.home_clear_failed", err, {
      userId: req.params.userId,
      ticketId: req.params.ticketId,
    });
    return res.status(500).json({ message: "Internal server error." });
  }
};

const clearHomeNotifications = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!ensureOwnUser(req, res, userId)) return;

    const { rowCount } = await pool.query(
      `UPDATE notification_tickets
       SET is_visible_in_home = FALSE,
           home_dismissed_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
       WHERE user_id = $1
         AND is_read = FALSE`,
      [userId],
    );

    logger.info("notifications.home_cleared_all", { userId, count: rowCount });
    return res.json({ message: "Home notifications cleared." });
  } catch (err) {
    logger.error("notifications.home_clear_all_failed", err, { userId: req.params.userId });
    return res.status(500).json({ message: "Internal server error." });
  }
};

const deleteTicketPhoto = async (req, res) => {
  try {
    const userId = getAuthedUserId(req);
    const { ticketId } = req.params;
    const photoUrl = String(req.query.url || "").trim();

    if (!photoUrl) {
      return res.status(400).json({ message: "Photo URL is required." });
    }

    const { rows } = await pool.query(
      `SELECT user_id, photo_urls FROM notification_tickets WHERE ticket_id = $1 LIMIT 1`,
      [ticketId],
    );

    const ticket = rows[0];
    if (!ticket) return res.status(404).json({ message: "Ticket not found." });
    if (!req.user?.is_admin && !req.user?.is_manager && String(ticket.user_id) !== String(userId)) return res.status(403).json({ message: "You can only remove your own ticket photos." });

    const nextUrls = (ticket.photo_urls || []).filter((url) => url !== photoUrl);

    await pool.query(
      `UPDATE notification_tickets SET photo_urls = $1, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata') WHERE ticket_id = $2`,
      [toJsonb(nextUrls), ticketId],
    );

    return res.json({ success: true, photo_urls: nextUrls });
  } catch (err) {
    logger.error("ticket.photo_delete_failed", err, { userId: getAuthedUserId(req), ticketId: req.params.ticketId });
    return res.status(500).json({ message: "Internal server error." });
  }
};

const deleteAppointmentPhoto = async (req, res) => {
  try {
    const userId = getAuthedUserId(req);
    const { bookingId } = req.params;
    const photoUrl = String(req.query.url || "").trim();

    if (!photoUrl) {
      return res.status(400).json({ message: "Photo URL is required." });
    }

    const { rows } = await pool.query(
      `SELECT user_id, notification_ticket_id, photo_urls
       FROM appointment_bookings
       WHERE booking_id = $1
       LIMIT 1`,
      [bookingId],
    );

    const appointment = rows[0];
    if (!appointment) return res.status(404).json({ message: "Appointment not found." });
    if (!req.user?.is_admin && !req.user?.is_manager && String(appointment.user_id) !== String(userId)) {
      return res.status(403).json({ message: "You can only remove your own appointment photos." });
    }

    const nextUrls = (appointment.photo_urls || []).filter((url) => url !== photoUrl);

    await pool.query(
      `UPDATE appointment_bookings
       SET photo_urls = $1, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
       WHERE booking_id = $2`,
      [toJsonb(nextUrls), bookingId],
    );

    if (appointment.notification_ticket_id) {
      await pool.query(
        `UPDATE notification_tickets
         SET photo_urls = $1, updated_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
         WHERE ticket_id = $2`,
        [toJsonb(nextUrls), appointment.notification_ticket_id],
      );
    }

    return res.json({ success: true, photo_urls: nextUrls });
  } catch (err) {
    logger.error("appointment.photo_delete_failed", err, { userId: getAuthedUserId(req), bookingId: req.params.bookingId });
    return res.status(500).json({ message: "Internal server error." });
  }
};

const deleteNotification = async (req, res) => {
  try {
    const { userId, ticketId } = req.params;
    if (!ensureOwnUser(req, res, userId)) return;

    const { rowCount } = await pool.query(
      `UPDATE notification_tickets
       SET is_visible_in_updates = FALSE,
           updates_cleared_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
       WHERE user_id = $1
         AND ticket_id = $2`,
      [userId, ticketId],
    );

    if (rowCount === 0) {
      logger.warn("notifications.delete_not_found", { userId, ticketId });
      return res.status(404).json({ message: "Notification not found." });
    }

    logger.info("notifications.deleted", { userId, ticketId });
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

    const { rowCount } = await pool.query(
      `UPDATE notification_tickets
       SET is_visible_in_updates = FALSE,
           updates_cleared_at = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
       WHERE user_id = $1`,
      [userId],
    );

    logger.info("notifications.cleared", { userId, count: rowCount });
    return res.status(200).json({ message: "All notifications cleared." });
  } catch (err) {
    logger.error("notifications.clear_failed", err, { userId: req.params.userId });
    return res.status(500).json({ message: "Internal server error." });
  }
};

module.exports = {
  supportTicket,
  updateTicket,
  addTicketMessage,
  getMyTickets,
  getHomeNotifications,
  markNotificationRead,
  clearHomeNotification,
  clearHomeNotifications,
  deleteTicketPhoto,
  deleteAppointmentPhoto,
  deleteNotification,
  clearNotifications,
};
