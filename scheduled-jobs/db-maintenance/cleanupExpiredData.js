const path = require("path");

require(path.resolve(__dirname, "../../src/config/env"));

const pool = require("../../src/config/db");
const logger = require("../../src/util/logger");

const dryRun = String(process.env.DB_MAINTENANCE_DRY_RUN || "").toLowerCase() === "true";
const inactiveSessionRetentionDays = Number(
  process.env.DB_MAINTENANCE_INACTIVE_SESSION_RETENTION_DAYS || 90,
);
const appLogRetentionDays = Number(process.env.APP_LOG_RETENTION_DAYS || 3);

const countQueries = {
  expiredPendingRegistrations: `
    SELECT COUNT(*)::INT AS count
    FROM pending_registrations
    WHERE expires_at <= NOW()
  `,
  expiredPendingEmailChanges: `
    SELECT COUNT(*)::INT AS count
    FROM pending_email_changes
    WHERE expires_at <= NOW()
  `,
  expiredOrUsedPasswordResetTokens: `
    SELECT COUNT(*)::INT AS count
    FROM password_reset_tokens
    WHERE expires_at <= NOW() OR used_at IS NOT NULL
  `,
  expiredActiveSessions: `
    SELECT COUNT(*)::INT AS count
    FROM user_sessions
    WHERE is_active = TRUE
      AND token_refresh_time < NOW() - INTERVAL '7 days'
  `,
  oldInactiveSessions: `
    SELECT COUNT(*)::INT AS count
    FROM user_sessions
    WHERE is_active = FALSE
      AND COALESCE(logout_time, token_refresh_time, login_time) < NOW() - ($1 || ' days')::INTERVAL
  `,
  oldAppLogs: `
    SELECT COUNT(*)::INT AS count
    FROM app_logs
    WHERE created_at < NOW() - ($1 || ' days')::INTERVAL
  `,
};

async function getCount(client, name) {
  const values =
    name === "oldInactiveSessions"
      ? [inactiveSessionRetentionDays]
      : name === "oldAppLogs"
        ? [appLogRetentionDays]
        : [];
  const { rows } = await client.query(countQueries[name], values);

  return rows[0]?.count || 0;
}

async function getDryRunCounts(client) {
  const counts = {};

  for (const name of Object.keys(countQueries)) {
    counts[name] = await getCount(client, name);
  }

  return counts;
}

async function runCleanup(client) {
  const expiredPendingRegistrations = await client.query(`
    DELETE FROM pending_registrations
    WHERE expires_at <= NOW()
  `);

  const expiredPendingEmailChanges = await client.query(`
    DELETE FROM pending_email_changes
    WHERE expires_at <= NOW()
  `);

  const expiredOrUsedPasswordResetTokens = await client.query(`
    DELETE FROM password_reset_tokens
    WHERE expires_at <= NOW() OR used_at IS NOT NULL
  `);

  const expiredActiveSessions = await client.query(`
    UPDATE user_sessions
    SET is_active = FALSE,
        logout_time = COALESCE(logout_time, NOW())
    WHERE is_active = TRUE
      AND token_refresh_time < NOW() - INTERVAL '7 days'
  `);

  const oldInactiveSessions = await client.query(
    `
      DELETE FROM user_sessions
      WHERE is_active = FALSE
        AND COALESCE(logout_time, token_refresh_time, login_time) < NOW() - ($1 || ' days')::INTERVAL
    `,
    [inactiveSessionRetentionDays],
  );

  const oldAppLogs = await client.query(
    `
      DELETE FROM app_logs
      WHERE created_at < NOW() - ($1 || ' days')::INTERVAL
    `,
    [appLogRetentionDays],
  );

  return {
    expiredPendingRegistrations: expiredPendingRegistrations.rowCount,
    expiredPendingEmailChanges: expiredPendingEmailChanges.rowCount,
    expiredOrUsedPasswordResetTokens: expiredOrUsedPasswordResetTokens.rowCount,
    expiredActiveSessions: expiredActiveSessions.rowCount,
    oldInactiveSessions: oldInactiveSessions.rowCount,
    oldAppLogs: oldAppLogs.rowCount,
  };
}

async function main(options = {}) {
  const closePool = options.closePool !== false;

  console.log("DB maintenance: started");
  console.log(`DB maintenance: dryRun=${dryRun}, inactiveSessionRetentionDays=${inactiveSessionRetentionDays}, appLogRetentionDays=${appLogRetentionDays}`);

  const client = await pool.connect();

  try {
    if (dryRun) {
      const counts = await getDryRunCounts(client);
      logger.info("db_maintenance.dry_run", {
        dryRun,
        inactiveSessionRetentionDays,
        appLogRetentionDays,
        ...counts,
      });

      console.log(`DB maintenance: dry run counts ${JSON.stringify(counts)}`);
      console.log("DB maintenance: dry run complete, no rows changed");
      return;
    }

    await client.query("BEGIN");
    const counts = await runCleanup(client);
    await client.query("COMMIT");

    logger.info("db_maintenance.completed", {
      dryRun,
      inactiveSessionRetentionDays,
      appLogRetentionDays,
      ...counts,
    });
    console.log(`DB maintenance: completed ${JSON.stringify(counts)}`);
  } catch (err) {
    if (!dryRun) {
      await client.query("ROLLBACK").catch(() => {});
    }

    console.error(`DB maintenance: failed - ${err?.message || err}`);
    logger.error("db_maintenance.failed", err);
    process.exitCode = 1;
  } finally {
    client.release();
    if (closePool) {
      await pool.end();
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
