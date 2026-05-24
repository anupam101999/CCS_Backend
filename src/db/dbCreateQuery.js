require("dotenv").config();
const pool = require("../config/db");

async function dbCreateQuery() {
  const client = await pool.connect();

  try {
    console.log("🔧 Tables query started  ...");

    // ── Users ─────────────────────────────────────────────────────
    await client.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    full_name VARCHAR(120) NOT NULL,
    email VARCHAR(254) NOT NULL UNIQUE,
    phone VARCHAR(20),
    dob DATE,
    address TEXT,
    isdmin BOOLEAN NOT NULL DEFAULT FALSE,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`);

    // ── Sequence ──────────────────────────────────────────────────
    await client.query(`
  CREATE SEQUENCE IF NOT EXISTS notification_seq
  START WITH 1
  INCREMENT BY 1
  NO MAXVALUE
  CACHE 1;
`);

    // ── Notification Tickets ──────────────────────────────────────
    await client.query(`
  CREATE TABLE IF NOT EXISTS notification_tickets (
    ticket_id VARCHAR(14) PRIMARY KEY
      DEFAULT LPAD(nextval('notification_seq')::TEXT, 9, '0'),

    user_id INTEGER NOT NULL
      REFERENCES users(id) ON DELETE CASCADE,

    category VARCHAR(60) NOT NULL,
    subject VARCHAR(120) NOT NULL,
    query TEXT NOT NULL,
    reply TEXT,
    type TEXT,

    notification_status BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(20) NOT NULL DEFAULT 'open',

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`);

    // ── Appointment Bookings ──────────────────────────────────────
    await client.query(`
  CREATE TABLE IF NOT EXISTS appointment_bookings (
    booking_id SERIAL PRIMARY KEY,

    user_id INTEGER NOT NULL
      REFERENCES users(id) ON DELETE CASCADE,

    subject VARCHAR(120) NOT NULL,
    appointment_type VARCHAR(60) NOT NULL DEFAULT 'Visit',
    category VARCHAR(60) NOT NULL DEFAULT 'Scheduling',
    query TEXT,
    appointment_date DATE,
    appointment_time VARCHAR(10),
    status VARCHAR(20) NOT NULL DEFAULT 'pending',

    notification_ticket_id VARCHAR(14)
      REFERENCES notification_tickets(ticket_id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`);

    // ── User Sessions ─────────────────────────────────────────────
    await client.query(`
  CREATE TABLE IF NOT EXISTS user_sessions (
    session_id SERIAL PRIMARY KEY,

    user_id INTEGER NOT NULL
      REFERENCES users(id) ON DELETE CASCADE,

    user_email VARCHAR(254) NOT NULL,
    session_token UUID NOT NULL UNIQUE,
    login_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    logout_time TIMESTAMPTZ,
    session_expiry_time TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes'),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ip_address VARCHAR(50)
  );
`);

    // ── Indexes ───────────────────────────────────────────────────
    await client.query(`
  CREATE INDEX IF NOT EXISTS idx_user_sessions_token
  ON user_sessions(session_token);
`);

    await client.query(`
  CREATE INDEX IF NOT EXISTS idx_user_sessions_active
  ON user_sessions(session_token)
  WHERE is_active = TRUE;
`);

    await client.query(`
  CREATE INDEX IF NOT EXISTS idx_notification_tickets_user_id
  ON notification_tickets(user_id);
`);

    await client.query(`
  CREATE INDEX IF NOT EXISTS idx_appointment_bookings_user_id
  ON appointment_bookings(user_id);
`);

    await client.query(`
  CREATE INDEX IF NOT EXISTS idx_notification_status
  ON notification_tickets(notification_status);
`);
    console.log("✅ All tables & indexes created successfully");
  } catch (err) {
    console.error("❌ db Create Query error:", err.message);
    process.exit(1);
  } finally {
    client.release();
  }
}

module.exports = dbCreateQuery;
