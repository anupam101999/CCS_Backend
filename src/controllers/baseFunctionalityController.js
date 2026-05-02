const pool = require("../config/db");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required." });
    }
    if (!EMAIL_RE.test(email.trim())) {
      return res.status(400).json({ message: "Enter a valid email address." });
    }
    if (password.length < 4) {
      return res
        .status(400)
        .json({ message: "Password must be at least 4 characters." });
    }

    const { rows } = await pool.query(
      `SELECT id, full_name, email, phone, dob, address, password
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

    console.log(`✅ Logged in: ${user.email}`);
    return res.json({
      token: `token-${user.id}-${Date.now()}`,
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
    console.error("login error:", err.message);
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

const getMyTickets = async (req, res) => {
  try {
    const { userId } = req.params;

    const { rows } = await pool.query(
      `SELECT * FROM notification_tickets WHERE user_id = $1`,
      [userId],
    );

    return res.status(200).json({
      tickets: rows,
    });
  } catch (err) {
    console.error("getMyTickets error:", err.message);
    return res.status(500).json({
      message: "Internal server error.",
    });
  }
};
module.exports = { register, login, update, supportTicket, getMyTickets };
