require("../config/env");
const pool = require("../config/db");
const logger = require("../util/logger");
const { getTimeZone } = require("../util/time");

async function dbCreateQuery() {
  try {
    await pool.withClient(async (client) => {
      const timeZone = getTimeZone();
      await client.query(`SET TIME ZONE '${timeZone.replace(/'/g, "''")}'`);
      logger.info("db.schema_sync_started", { timeZone });

    // ── Users ─────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(120) NOT NULL,
        email VARCHAR(254) NOT NULL UNIQUE,
        phone VARCHAR(20),
        dob DATE,
        address TEXT,
        avatarurl TEXT,
        is_superadmin BOOLEAN NOT NULL DEFAULT FALSE,
        is_admin BOOLEAN NOT NULL DEFAULT FALSE,
        is_manager BOOLEAN NOT NULL DEFAULT FALSE,
        access_disabled BOOLEAN NOT NULL DEFAULT FALSE,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'),
        updated_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
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
        photo_urls JSONB NOT NULL DEFAULT '[]'::jsonb,

        is_visible_in_updates BOOLEAN NOT NULL DEFAULT TRUE,
        is_visible_in_home BOOLEAN NOT NULL DEFAULT TRUE,
        is_read BOOLEAN NOT NULL DEFAULT FALSE,
        read_at TIMESTAMP,
        home_dismissed_at TIMESTAMP,
        updates_cleared_at TIMESTAMP,
        status VARCHAR(20) NOT NULL DEFAULT 'open',

        created_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'),
        updated_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
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
        appointment_address TEXT,
        photo_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
        appointment_date DATE,
        appointment_time VARCHAR(10),
        status VARCHAR(20) NOT NULL DEFAULT 'pending',

        notification_ticket_id VARCHAR(14)
          REFERENCES notification_tickets(ticket_id) ON DELETE SET NULL,

        created_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'),
        updated_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS notification_ticket_messages (
        message_id BIGSERIAL PRIMARY KEY,
        ticket_id VARCHAR(14) NOT NULL
          REFERENCES notification_tickets(ticket_id) ON DELETE CASCADE,
        author_user_id INTEGER
          REFERENCES users(id) ON DELETE SET NULL,
        author_role VARCHAR(20) NOT NULL,
        message_body TEXT NOT NULL,
        is_internal BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'),
        CONSTRAINT notification_ticket_messages_role_check
          CHECK (author_role IN ('customer', 'admin', 'manager', 'system'))
      );
    `);

    await client.query(`
      ALTER TABLE appointment_bookings
      ADD COLUMN IF NOT EXISTS photo_urls JSONB NOT NULL DEFAULT '[]'::jsonb;
    `);

    await client.query(`
      ALTER TABLE appointment_bookings
      ADD COLUMN IF NOT EXISTS appointment_address TEXT;
    `);

    await client.query(`
      ALTER TABLE appointment_bookings
      ADD COLUMN IF NOT EXISTS notification_ticket_id VARCHAR(14);
    `);

    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS is_superadmin BOOLEAN NOT NULL DEFAULT FALSE;
    `);

    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS is_manager BOOLEAN NOT NULL DEFAULT FALSE;
    `);

    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS access_disabled BOOLEAN NOT NULL DEFAULT FALSE;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS role_feature_access (
        role_name VARCHAR(20) NOT NULL,
        feature_key VARCHAR(40) NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'),
        PRIMARY KEY (role_name, feature_key),
        CONSTRAINT role_feature_access_role_check
          CHECK (role_name IN ('manager', 'admin', 'superadmin')),
        CONSTRAINT role_feature_access_feature_check
          CHECK (feature_key IN ('dashboard', 'customer_switch', 'appointments', 'tickets', 'projects', 'logs', 'stream_notifications'))
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_feature_access (
        user_id INTEGER NOT NULL
          REFERENCES users(id) ON DELETE CASCADE,
        feature_key VARCHAR(40) NOT NULL,
        enabled BOOLEAN NOT NULL DEFAULT TRUE,
        updated_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'),
        PRIMARY KEY (user_id, feature_key),
        CONSTRAINT user_feature_access_feature_check
          CHECK (feature_key IN ('dashboard', 'customer_switch', 'appointments', 'tickets', 'projects', 'logs', 'stream_notifications'))
      );
    `);

    await client.query(`
      INSERT INTO role_feature_access (role_name, feature_key, enabled)
      SELECT role_name, feature_key, TRUE
      FROM (
        VALUES ('manager'), ('admin'), ('superadmin')
      ) AS roles(role_name)
      CROSS JOIN (
        VALUES ('dashboard'), ('customer_switch'), ('appointments'), ('tickets'), ('projects'), ('logs'), ('stream_notifications')
      ) AS features(feature_key)
      ON CONFLICT (role_name, feature_key) DO NOTHING;
    `);

    await client.query(`
      ALTER TABLE notification_tickets
      ADD COLUMN IF NOT EXISTS photo_urls JSONB NOT NULL DEFAULT '[]'::jsonb;
    `);

    await client.query(`
      ALTER TABLE notification_tickets
      ADD COLUMN IF NOT EXISTS is_visible_in_updates BOOLEAN NOT NULL DEFAULT TRUE;
    `);

    await client.query(`
      ALTER TABLE notification_tickets
      ADD COLUMN IF NOT EXISTS is_visible_in_home BOOLEAN NOT NULL DEFAULT TRUE;
    `);

    await client.query(`
      ALTER TABLE notification_tickets
      ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT FALSE;
    `);

    await client.query(`
      ALTER TABLE notification_tickets
      ADD COLUMN IF NOT EXISTS read_at TIMESTAMP;
    `);

    await client.query(`
      ALTER TABLE notification_tickets
      ADD COLUMN IF NOT EXISTS home_dismissed_at TIMESTAMP;
    `);

    await client.query(`
      ALTER TABLE notification_tickets
      ADD COLUMN IF NOT EXISTS updates_cleared_at TIMESTAMP;
    `);

    await client.query(`
      UPDATE appointment_bookings ab
      SET notification_ticket_id = NULL
      WHERE notification_ticket_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM notification_tickets nt
          WHERE nt.ticket_id = ab.notification_ticket_id
        );
    `);

    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'appointment_bookings_notification_ticket_id_fkey'
        ) THEN
          ALTER TABLE appointment_bookings
          ADD CONSTRAINT appointment_bookings_notification_ticket_id_fkey
          FOREIGN KEY (notification_ticket_id)
          REFERENCES notification_tickets(ticket_id)
          ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // Remove the legacy opaque-token session store after the JWT migration.
    await client.query(`
      DROP TABLE IF EXISTS user_sessions;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        session_id UUID PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        refresh_token_hash VARCHAR(64) NOT NULL,
        last_active_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL
          REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(64) NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS pending_registrations (
        id SERIAL PRIMARY KEY,
        request_id UUID NOT NULL UNIQUE,
        full_name VARCHAR(120) NOT NULL,
        email VARCHAR(254) NOT NULL,
        phone VARCHAR(20),
        dob DATE,
        address TEXT,
        avatarurl TEXT,
        password_hash VARCHAR(255) NOT NULL,
        code_hash VARCHAR(64) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS pending_email_changes (
        id SERIAL PRIMARY KEY,
        request_id UUID NOT NULL UNIQUE,
        user_id INTEGER NOT NULL
          REFERENCES users(id) ON DELETE CASCADE,
        new_email VARCHAR(254) NOT NULL,
        code_hash VARCHAR(64) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
      );
    `);

    // ── Projects ──────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id SERIAL PRIMARY KEY,

        user_id INTEGER NOT NULL
          REFERENCES users(id)
          ON DELETE CASCADE,

        project_name VARCHAR(255) NOT NULL,
        photourl TEXT,

        created_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'),
        updated_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS app_logs (
        id BIGSERIAL PRIMARY KEY,
        level VARCHAR(10) NOT NULL,
        event VARCHAR(120) NOT NULL,
        message TEXT,
        meta JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS batch_job_runs (
        id BIGSERIAL PRIMARY KEY,
        job_name VARCHAR(120) NOT NULL,
        run_source VARCHAR(60) NOT NULL DEFAULT 'manual',
        run_status VARCHAR(20) NOT NULL DEFAULT 'running',
        dry_run BOOLEAN NOT NULL DEFAULT FALSE,
        started_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'),
        finished_at TIMESTAMP,
        duration_ms INTEGER,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        error_message TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'),
        updated_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata'),
        CONSTRAINT batch_job_runs_status_check
          CHECK (run_status IN ('running', 'success', 'failed', 'skipped'))
      );
    `);

    // ── Indexes ───────────────────────────────────────────────────
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id
      ON auth_sessions(user_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_last_active
      ON auth_sessions(last_active_at);
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
      CREATE INDEX IF NOT EXISTS idx_notification_tickets_updates_visible
      ON notification_tickets(user_id, is_visible_in_updates, is_read, updated_at DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notification_tickets_home_unread
      ON notification_tickets(user_id, is_visible_in_home, is_read, updated_at DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notification_ticket_messages_ticket_created
      ON notification_ticket_messages(ticket_id, created_at ASC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_projects_user_id
      ON projects(user_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_app_logs_created_at
      ON app_logs(created_at DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_app_logs_created_at_id
      ON app_logs(created_at DESC, id DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_app_logs_level_created_at
      ON app_logs(level, created_at DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_batch_job_runs_job_started_at
      ON batch_job_runs(job_name, started_at DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_batch_job_runs_status_started_at
      ON batch_job_runs(run_status, started_at DESC);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash
      ON password_reset_tokens(token_hash);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pending_registrations_request_id
      ON pending_registrations(request_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pending_registrations_email
      ON pending_registrations(LOWER(email));
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pending_email_changes_request_id
      ON pending_email_changes(request_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_pending_email_changes_user_id
      ON pending_email_changes(user_id);
    `);

      logger.info("db.schema_sync_completed");
    });
  } catch (err) {
    logger.error("db.schema_sync_failed", err);
    throw err;
  }
}

module.exports = dbCreateQuery;
