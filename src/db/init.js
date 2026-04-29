require("dotenv").config();
const pool = require("../config/db");

async function initDB() {
  const client = await pool.connect();
  try {
    console.log("🔧 Checking / creating tables...");

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id         SERIAL        PRIMARY KEY,
        full_name  VARCHAR(120)  NOT NULL,
        email      VARCHAR(254)  NOT NULL UNIQUE,
        phone      VARCHAR(20),
        dob        DATE,
        address    TEXT,
        password   VARCHAR(255)  NOT NULL,
        created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );
    `);
    console.log("✅ users table ready");

    // ── Sequence for ticket ID number part ──────────────────────────────────
    await client.query(`
      CREATE SEQUENCE IF NOT EXISTS ticket_seq
        START WITH 1
        INCREMENT BY 1
        NO MAXVALUE
        CACHE 1;
    `);

    // ── Support tickets ──────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        ticket_id   VARCHAR(14)   PRIMARY KEY
                                  DEFAULT 'TCK' || LPAD(nextval('ticket_seq')::TEXT, 9, '0'),
        user_id     INTEGER       NOT NULL
                                  REFERENCES users(id) ON DELETE CASCADE,
        category    VARCHAR(60)   NOT NULL,
        subject     VARCHAR(120)  NOT NULL,
        query       TEXT          NOT NULL,
        status      VARCHAR(20)   NOT NULL DEFAULT 'open'
                                  CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
        created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
      );
    `);

    // Index so lookups by user are fast
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id
        ON support_tickets(user_id);
    `);

    console.log("✅ support_tickets table ready");
    //fingerprint
    await client.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS passkeys JSONB DEFAULT '[]'::jsonb;`,
    );
    console.log("✅ Passkeys added to users table");
  } catch (err) {
    console.error("❌ DB init error:", err.message);
    process.exit(1);
  } finally {
    client.release();
  }
}

module.exports = initDB;
