const pool = require("../config/db");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    const { fullName, email, phone, dob, address, password } = req.body;

    // Validation
    if (!fullName || !email || !password || !phone || !dob || !address) {
      return res.status(400).json({ message: "All fields are required." });
    }
    if (!EMAIL_RE.test(email.trim())) {
      return res.status(400).json({ message: "Enter a valid email address." });
    }
    if (password.length < 4) {
      return res
        .status(400)
        .json({ message: "Password must be at least 4 characters." });
    }

    // Duplicate check
    const { rows: existing } = await pool.query(
      `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email.trim()],
    );
    if (existing.length > 0) {
      return res
        .status(409)
        .json({ message: "An account with this email already exists." });
    }

    // Insert
    const { rows } = await pool.query(
      `INSERT INTO users (full_name, email, phone, dob, address, password)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, full_name, email, phone, dob, address`,
      [
        fullName.trim(),
        email.toLowerCase().trim(),
        phone || null,
        dob || null,
        address || null,
        password,
      ],
    );

    const user = rows[0];
    console.log(`✅ Registered: ${user.email}`);

    return res.status(201).json({
      message: "Account created successfully.",
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
      },
    });
  } catch (err) {
    console.error("register error:", err.message);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// ── LOGIN ─────────────────────────────────────────────────────────
const { v4: uuidv4 } = require("uuid"); // npm i uuid

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    //login user validate
    if (!email || !password)
      return res
        .status(400)
        .json({ message: "Email and password are required." });
    if (!EMAIL_RE.test(email.trim()))
      return res.status(400).json({ message: "Enter a valid email address." });
    if (password.length < 4)
      return res
        .status(400)
        .json({ message: "Password must be at least 4 characters." });

    const { rows } = await pool.query(
      `SELECT id, full_name, email, phone, dob, address, password,is_admin
       FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email.trim()],
    );

    const user = rows[0];

    if (!user) {
      console.log(`❌ Login failed — no account: ${email}`);
      return res.status(401).json({ message: "Invalid email or password." });
    }
    if (user.password !== password) {
      console.log(`❌ Login failed — wrong password: ${email}`);
      return res.status(401).json({ message: "Invalid email or password." });
    }

    //Existing session cleanup: Automatically expire old sessions

    await pool.query(
      `UPDATE user_sessions SET is_active = FALSE, logout_time = NOW(), session_expiry_time = NOW()
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
         (user_id, user_email, session_token, session_expiry_time, ip_address)
       VALUES
         ($1, $2, $3, NOW() + INTERVAL '10 minutes', $4)`,
      [user.id, user.email, sessionToken, ipAddress],
    );

    console.log(`✅ Logged in: ${user.email} | session: ${sessionToken}`);
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
      },
    });
  } catch (err) {
    console.error("login error:", err.message);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// sign out
const signOut = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: "Token required." });

    await pool.query(
      `UPDATE user_sessions
       SET is_active = FALSE, logout_time = NOW()
       WHERE session_token = $1`,
      [token],
    );

    return res.json({ message: "Signed out successfully." });
  } catch (err) {
    console.error("signOut error:", err.message);
    return res.status(500).json({ message: "Internal server error." });
  }
};

//session validation middleware (for protected routes)

const validateSession = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: "Token required." });

    const { rows } = await pool.query(
      `SELECT session_id FROM user_sessions
       WHERE session_token = $1
         AND is_active = TRUE
       LIMIT 1`,
      [token],
    );

    if (!rows[0]) {
      return res.status(401).json({ message: "Session invalid or expired." });
    }

    return res.json({ valid: true });
  } catch (err) {
    console.error("validateSession error:", err.message);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// ── Update ─────────────────────────────────────────────────────
const update = async (req, res) => {
  try {
    const { id, fullName, email, phone, dob, address, password } = req.body;

    // Validation
    if (!fullName || !email || !phone || !dob || !address) {
      return res.status(400).json({ message: "All fields are required." });
    }
    if (!EMAIL_RE.test(email.trim())) {
      return res.status(400).json({ message: "Enter a valid email address." });
    }
    let rows;

    if (password != null) {
      ({ rows } = await pool.query(
        `UPDATE users 
     SET full_name = $2,
         email = $3,
         phone = $4,
         dob = $5,
         address = $6,
         password = $7
         WHERE id = $1
         RETURNING id, full_name, email, phone, dob, address`,
        [
          id,
          fullName.trim(),
          email.toLowerCase().trim(),
          phone || null,
          dob || null,
          address || null,
          password,
        ],
      ));
    } else {
      ({ rows } = await pool.query(
        `UPDATE users 
     SET full_name = $2,
         email = $3,
         phone = $4,
         dob = $5,
         address = $6
         WHERE id = $1
         RETURNING id, full_name, email, phone, dob, address`,
        [
          id,
          fullName.trim(),
          email.toLowerCase().trim(),
          phone || null,
          dob || null,
          address || null,
        ],
      ));
    }

    const user = rows[0];
    console.log(`✅ Updated: ${user.email}`);

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
      },
    });
  } catch (err) {
    console.error("update error:", err.message);

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
    const { userId, category, subject, query, type } = req.body;

    // ── Insert ticket ──────────────────────────
    const { rows } = await pool.query(
      `INSERT INTO notification_tickets (user_id, category, subject, query, type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ticket_id, user_id, category, subject, query, status, created_at`,
      [userId, category.trim(), subject.trim(), query.trim(), type.trim()],
    );

    const ticket = rows[0];

    console.log(`🎫 Ticket created: ${ticket.ticket_id}`);

    return res.status(201).json({
      message: "Notification ticket created successfully.",
    });
  } catch (err) {
    console.error("supportTicket error:", err.message);
    return res.status(500).json({
      message: "Internal server error.",
    });
  }
};

const confirmedAppointments = async (req, res) => {
  try {
    const { userId } = req.params;

    const { rows } = await pool.query(
      `SELECT *
       FROM appointment_bookings
       WHERE user_id = $1 and status = 'confirmed'
       ORDER BY appointment_date DESC`,
      [userId],
    );

    return res.status(200).json({
      appointments: rows.map(mapAppointment),
    });
  } catch (err) {
    console.error("listAppointments error:", err.message);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const listAppointments = async (req, res) => {
  try {
    const { userId } = req.params;

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
    console.error("listAppointments error:", err.message);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const bookAppointment = async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      userId,
      appointmentType,
      subject,
      category,
      query = "",
      preferredDate,
      preferredTime,
    } = req.body;

    if (
      !userId ||
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
      subject: `Appointment booked: ${subject.trim()}`,
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
    console.error("bookAppointment error:", err.message);
    return res.status(500).json({ message: "Internal server error." });
  } finally {
    client.release();
  }
};

const rescheduleAppointment = async (req, res) => {
  const client = await pool.connect();

  try {
    const { bookingId } = req.params;
    const { userId, preferredDate, preferredTime, query = "" } = req.body;

    if (!userId || !preferredDate || !preferredTime) {
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
      subject: `Appointment rescheduled: ${current.subject}`,
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
    console.error("rescheduleAppointment error:", err.message);
    return res.status(500).json({ message: "Internal server error." });
  } finally {
    client.release();
  }
};

const getMyTickets = async (req, res) => {
  try {
    const { userId } = req.params;

    const { rows } = await pool.query(
      `SELECT * FROM notification_tickets
       WHERE user_id = $1
         AND notification_status = 'true'
       ORDER BY updated_at DESC`,
      [userId],
    );

    return res.status(200).json({ tickets: rows });
  } catch (err) {
    console.error("getMyTickets error:", err.message);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const deleteNotification = async (req, res) => {
  try {
    const { userId, ticketId } = req.params;

    const { rowCount } = await pool.query(
      `update notification_tickets SET notification_status = 'false' WHERE user_id = $1 AND ticket_id = $2`,
      [userId, ticketId],
    );

    if (rowCount === 0) {
      return res.status(404).json({ message: "Notification not found." });
    }

    return res.status(200).json({ message: "Notification cleared." });
  } catch (err) {
    console.error("deleteNotification error:", err.message);
    return res.status(500).json({ message: "Internal server error." });
  }
};

const clearNotifications = async (req, res) => {
  try {
    const { userId } = req.params;

    await pool.query(
      `update notification_tickets SET notification_status = 'false' WHERE user_id = $1`,
      [userId],
    );

    return res.status(200).json({ message: "All notifications cleared." });
  } catch (err) {
    console.error("clearNotifications error:", err.message);
    return res.status(500).json({ message: "Internal server error." });
  }
};

module.exports = {
  register,
  login,
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
  validateSession,
};
