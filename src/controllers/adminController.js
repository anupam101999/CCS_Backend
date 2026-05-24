const pool = require("../config/db");

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
    console.error("getStats error:", err.message);
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
    console.error("getAllAppointments error:", err.message);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const updateAppointmentStatus = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { status } = req.body;

    const VALID = ["pending", "confirmed", "cancelled", "completed"];
    if (!VALID.includes(status)) {
      return res.status(400).json({ message: "Invalid status." });
    }

    const { rows } = await pool.query(
      `UPDATE appointment_bookings
       SET status = $1, updated_at = NOW()
       WHERE booking_id = $2
       RETURNING *`,
      [status, bookingId],
    );

    if (!rows[0])
      return res.status(404).json({ message: "Appointment not found." });
    return res.json({ appointment: rows[0] });
  } catch (err) {
    console.error("updateAppointmentStatus error:", err.message);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const getAllTickets = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM notification_tickets ORDER BY updated_at DESC`,
    );
    return res.json({ tickets: rows });
  } catch (err) {
    console.error("getAllTickets error:", err.message);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const updateTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const { status, reply } = req.body;

    const VALID = ["open", "in-progress", "resolved", "closed"];
    if (status && !VALID.includes(status)) {
      return res.status(400).json({ message: "Invalid status." });
    }

    const { rows } = await pool.query(
      `UPDATE notification_tickets
       SET status = COALESCE($1, status),
           reply  = COALESCE($2, reply),
           updated_at = NOW()
       WHERE ticket_id = $3
       RETURNING *`,
      [status || null, reply || null, ticketId],
    );

    if (!rows[0]) return res.status(404).json({ message: "Ticket not found." });
    return res.json({ ticket: rows[0] });
  } catch (err) {
    console.error("updateTicket error:", err.message);
    return res.status(500).json({ message: "Internal server error." });
  }
};

module.exports = {
  getStats,
  getAllAppointments,
  updateAppointmentStatus,
  getAllTickets,
  updateTicket,
};
