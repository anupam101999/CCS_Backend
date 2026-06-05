const pool = require("../../config/db");
const logger = require("../../util/logger");
const {
  getAuthedUserId,
  ensureOwnUser,
  mapAppointment,
  createNotificationTicket,
  toJsonb,
} = require("./customerUtils");

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

    logger.info("appointments.confirmed_listed", { userId, resultCount: rows.length });

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

    logger.info("appointments.listed", { userId, resultCount: rows.length });

    return res.status(200).json({
      appointments: rows.map(mapAppointment),
    });
  } catch (err) {
    logger.error("appointments.list_failed", err, { userId: req.params.userId });
    return res.status(500).json({ message: "Internal server error." });
  }
};

const bookAppointment = async (req, res) => {
  let client;

  try {
    client = await pool.connect();
    const {
      appointmentType,
      subject,
      category,
      query = "",
      address = "",
      appointmentAddress = "",
      preferredDate,
      preferredTime,
    } = req.body;
    const userId = getAuthedUserId(req);
    const photoUrls = Array.isArray(req.body?.photo_urls)
      ? req.body.photo_urls.filter(Boolean).slice(0, 5)
      : [];
    const trimmedAddress = String(appointmentAddress || address || "").trim();

    if (
      !appointmentType ||
      !subject ||
      !category ||
      !preferredDate ||
      !preferredTime
    ) {
      logger.warn("appointments.book_rejected", { userId, reason: "missing_required_fields" });
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
        (query ? ` Notes: ${query.trim()}` : "") +
        (trimmedAddress ? ` Address: ${trimmedAddress}` : ""),
      type: "Appointment",
      status: "pending",
      reply:
        "Your appointment request has been received. Our team will confirm it shortly.",
      photoUrls,
    });

    const { rows } = await client.query(
      `INSERT INTO appointment_bookings
        (user_id, appointment_type, category, subject, query, appointment_address, photo_urls, appointment_date, appointment_time, status, notification_ticket_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10)
       RETURNING *`,
      [
        userId,
        appointmentType.trim(),
        category.trim(),
        subject.trim(),
        query.trim(),
        trimmedAddress,
        toJsonb(photoUrls),
        preferredDate,
        preferredTime,
        notification.ticket_id,
      ],
    );

    await client.query("COMMIT");

    logger.info("appointments.booked", {
      userId,
      bookingId: rows[0].booking_id,
      ticketId: notification.ticket_id,
      appointmentDate: rows[0].appointment_date,
      appointmentTime: rows[0].appointment_time,
    });

    return res.status(201).json({
      message: "Appointment booked successfully.",
      appointment: mapAppointment(rows[0]),
      notification,
    });
  } catch (err) {
    await client?.query("ROLLBACK").catch(() => {});
    logger.error("appointments.book_failed", err, { userId: getAuthedUserId(req) });
    return res.status(500).json({ message: "Internal server error." });
  } finally {
    client?.release();
  }
};

const updateAppointment = async (req, res) => {
  let client;

  try {
    client = await pool.connect();
    const { bookingId } = req.params;
    const {
      appointmentType,
      subject,
      category,
      query,
      address,
      appointmentAddress,
      preferredDate,
      preferredTime,
      photo_urls: photoUrlsInput,
    } = req.body;
    const userId = getAuthedUserId(req);
    const photoUrls = Array.isArray(photoUrlsInput)
      ? photoUrlsInput.filter(Boolean).slice(0, 5)
      : null;
    const nextAddress =
      typeof appointmentAddress === "string"
        ? appointmentAddress.trim()
        : typeof address === "string"
          ? address.trim()
          : undefined;

    if (
      (appointmentType !== undefined && !appointmentType?.trim()) ||
      (subject !== undefined && !subject?.trim()) ||
      (category !== undefined && !category?.trim())
    ) {
      logger.warn("appointments.update_rejected", { userId, bookingId, reason: "empty_required_field" });
      return res.status(400).json({ message: "Appointment details cannot be empty." });
    }

    await client.query("BEGIN");

    const { rows } = await client.query(
      `UPDATE appointment_bookings
       SET appointment_type = COALESCE($1, appointment_type),
           subject = COALESCE($2, subject),
           category = COALESCE($3, category),
           query = COALESCE($4, query),
           appointment_address = COALESCE($5, appointment_address),
           appointment_date = COALESCE($6, appointment_date),
           appointment_time = COALESCE($7, appointment_time),
           photo_urls = COALESCE($8, photo_urls),
           status = CASE WHEN status = 'confirmed' THEN 'pending' ELSE status END,
           updated_at = NOW()
       WHERE booking_id = $9
         AND user_id = $10
       RETURNING *`,
      [
        typeof appointmentType === "string" ? appointmentType.trim() : null,
        typeof subject === "string" ? subject.trim() : null,
        typeof category === "string" ? category.trim() : null,
        typeof query === "string" ? query.trim() : null,
        nextAddress ?? null,
        preferredDate || null,
        preferredTime || null,
        photoUrls ? toJsonb(photoUrls) : null,
        bookingId,
        userId,
      ],
    );

    const appointment = rows[0];
    if (!appointment) {
      await client.query("ROLLBACK");
      logger.warn("appointments.update_not_found", { userId, bookingId });
      return res.status(404).json({ message: "Appointment not found." });
    }

    if (appointment.notification_ticket_id) {
      await client.query(
        `UPDATE notification_tickets
         SET category = $1,
             subject = $2,
             query = $3,
             status = $4,
             reply = $5,
             type = 'Appointment',
             photo_urls = $6,
             is_visible_in_updates = TRUE,
             is_visible_in_home = TRUE,
             is_read = FALSE,
             read_at = NULL,
             home_dismissed_at = NULL,
             updates_cleared_at = NULL,
             updated_at = NOW()
         WHERE ticket_id = $7`,
        [
          appointment.category,
          `Appointment updated : ${appointment.subject}`,
          `${appointment.appointment_type} scheduled for ${appointment.appointment_date} at ${appointment.appointment_time}.` +
            (appointment.query ? ` Notes: ${appointment.query}` : "") +
            (appointment.appointment_address ? ` Address: ${appointment.appointment_address}` : ""),
          appointment.status,
          "Your appointment update has been received. Our team will review it shortly.",
          toJsonb(appointment.photo_urls || []),
          appointment.notification_ticket_id,
        ],
      );
    }

    await client.query("COMMIT");

    logger.info("appointments.updated", { userId, bookingId });
    return res.json({ appointment: mapAppointment(appointment) });
  } catch (err) {
    await client?.query("ROLLBACK").catch(() => {});
    logger.error("appointments.update_failed", err, { userId: getAuthedUserId(req), bookingId: req.params.bookingId });
    return res.status(500).json({ message: "Internal server error." });
  } finally {
    client?.release();
  }
};

const rescheduleAppointment = async (req, res) => {
  let client;

  try {
    client = await pool.connect();
    const { bookingId } = req.params;
    const {
      appointmentType,
      subject,
      category,
      preferredDate,
      preferredTime,
      query = "",
      address,
      appointmentAddress,
    } = req.body;
    const userId = getAuthedUserId(req);
    const photoUrls = Array.isArray(req.body?.photo_urls)
      ? req.body.photo_urls.filter(Boolean).slice(0, 5)
      : null;
    const nextAddress =
      typeof appointmentAddress === "string"
        ? appointmentAddress.trim()
        : typeof address === "string"
          ? address.trim()
          : undefined;

    if (!preferredDate || !preferredTime) {
      logger.warn("appointments.reschedule_rejected", { userId, bookingId, reason: "missing_date_or_time" });
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
      logger.warn("appointments.reschedule_not_found", { userId, bookingId });
      return res.status(404).json({ message: "Appointment not found." });
    }

    const current = existingRows[0];
    if ((current.status || "").toLowerCase() !== "pending") {
      await client.query("ROLLBACK");
      logger.warn("appointments.reschedule_rejected", { userId, bookingId, reason: "not_pending", status: current.status });
      return res.status(400).json({
        message: "Rescheduling is only available while the appointment is pending.",
      });
    }

    const nextType =
      typeof appointmentType === "string" && appointmentType.trim()
        ? appointmentType.trim()
        : current.appointment_type;
    const nextSubject =
      typeof subject === "string" && subject.trim()
        ? subject.trim()
        : current.subject;
    const nextCategory =
      typeof category === "string" && category.trim()
        ? category.trim()
        : current.category;
    const nextQuery = query.trim() || current.query || "";
    const finalAddress =
      nextAddress !== undefined ? nextAddress : current.appointment_address || "";

    const notification = await createNotificationTicket(client, {
      userId,
      category: nextCategory,
      subject: `Appointment rescheduled : ${nextSubject}`,
      query:
        `${nextType} moved to ${preferredDate} at ${preferredTime}.` +
        (nextQuery ? ` Notes: ${nextQuery}` : "") +
        (finalAddress ? ` Address: ${finalAddress}` : ""),
      type: "Appointment",
      status: "pending",
      reply:
        "Your reschedule request has been received. Our team will confirm the new slot shortly.",
      photoUrls: photoUrls || current.photo_urls || [],
    });

    const { rows } = await client.query(
      `UPDATE appointment_bookings
       SET appointment_date = $3,
           appointment_time = $4,
           query = $5,
           appointment_type = $6,
           subject = $7,
           category = $8,
           appointment_address = $9,
           status = 'pending',
           notification_ticket_id = $10,
           photo_urls = COALESCE($11, photo_urls),
           updated_at = NOW()
       WHERE booking_id = $1 AND user_id = $2
       RETURNING *`,
      [
        bookingId,
        userId,
        preferredDate,
        preferredTime,
        nextQuery,
        nextType,
        nextSubject,
        nextCategory,
        finalAddress,
        notification.ticket_id,
        photoUrls ? toJsonb(photoUrls) : null,
      ],
    );

    await client.query("COMMIT");

    logger.info("appointments.rescheduled", {
      userId,
      bookingId,
      ticketId: notification.ticket_id,
      appointmentDate: rows[0].appointment_date,
      appointmentTime: rows[0].appointment_time,
    });

    return res.status(200).json({
      message: "Appointment rescheduled successfully.",
      appointment: mapAppointment(rows[0]),
      notification,
    });
  } catch (err) {
    await client?.query("ROLLBACK").catch(() => {});
    logger.error("appointments.reschedule_failed", err, { userId: getAuthedUserId(req), bookingId: req.params.bookingId });
    return res.status(500).json({ message: "Internal server error." });
  } finally {
    client?.release();
  }
};

module.exports = {
  confirmedAppointments,
  listAppointments,
  bookAppointment,
  updateAppointment,
  rescheduleAppointment,
};
