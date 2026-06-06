const path = require("path");

require(path.resolve(__dirname, "../../src/config/env"));

const pool = require("../../src/config/db");
const logger = require("../../src/util/logger");
const { recordBatchJob } = require("../../src/util/batchJobRuns");

const dryRun = String(process.env.DB_MAINTENANCE_DRY_RUN || "").toLowerCase() === "true";
const retentionDays = Number(process.env.DB_RETENTION_DAYS || 3);
const inactiveSessionDays = Number(process.env.AUTH_SESSION_RETENTION_DAYS || retentionDays);
const appLogRetentionDays = Number(process.env.APP_LOG_RETENTION_DAYS || 3);
const batchLogRetentionDays = Number(process.env.BATCH_LOG_RETENTION_DAYS || retentionDays);
const notificationRetentionDays = Number(process.env.NOTIFICATION_RETENTION_DAYS || retentionDays);

const countQueries = {
  expiredPendingRegistrations: `
    SELECT COUNT(*)::INT AS count
    FROM pending_registrations
    WHERE expires_at <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
  `,
  expiredPendingEmailChanges: `
    SELECT COUNT(*)::INT AS count
    FROM pending_email_changes
    WHERE expires_at <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
  `,
  expiredOrUsedPasswordResetTokens: `
    SELECT COUNT(*)::INT AS count
    FROM password_reset_tokens
    WHERE expires_at <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata') OR used_at IS NOT NULL
  `,
  inactiveAuthSessions: `
    SELECT COUNT(*)::INT AS count
    FROM auth_sessions
    WHERE last_active_at <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata') - ($1 || ' days')::INTERVAL
  `,
  oldAppLogs: `
    SELECT COUNT(*)::INT AS count
    FROM app_logs
    WHERE created_at < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata') - ($1 || ' days')::INTERVAL
  `,
  oldBatchJobRuns: `
    SELECT COUNT(*)::INT AS count
    FROM batch_job_runs
    WHERE created_at < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata') - ($1 || ' days')::INTERVAL
  `,
  oldResolvedOrClearedNotifications: `
    SELECT COUNT(*)::INT AS count
    FROM notification_tickets
    WHERE updated_at < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata') - ($1 || ' days')::INTERVAL
      AND (
        status IN ('resolved', 'closed', 'completed', 'cancelled')
        OR is_read = TRUE
        OR home_dismissed_at IS NOT NULL
        OR updates_cleared_at IS NOT NULL
      )
  `,
};

async function getCount(client, name) {
  const valuesByName = {
    inactiveAuthSessions: [inactiveSessionDays],
    oldAppLogs: [appLogRetentionDays],
    oldBatchJobRuns: [batchLogRetentionDays],
    oldResolvedOrClearedNotifications: [notificationRetentionDays],
  };
  const values = valuesByName[name] || [];
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
    WHERE expires_at <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
  `);

  const expiredPendingEmailChanges = await client.query(`
    DELETE FROM pending_email_changes
    WHERE expires_at <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')
  `);

  const expiredOrUsedPasswordResetTokens = await client.query(`
    DELETE FROM password_reset_tokens
    WHERE expires_at <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata') OR used_at IS NOT NULL
  `);

  const inactiveAuthSessions = await client.query(
    `
      DELETE FROM auth_sessions
      WHERE last_active_at <= (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata') - ($1 || ' days')::INTERVAL
    `,
    [inactiveSessionDays],
  );

  const oldAppLogs = await client.query(
    `
      DELETE FROM app_logs
      WHERE created_at < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata') - ($1 || ' days')::INTERVAL
    `,
    [appLogRetentionDays],
  );

  const oldResolvedOrClearedNotifications = await client.query(
    `
      DELETE FROM notification_tickets
      WHERE updated_at < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata') - ($1 || ' days')::INTERVAL
        AND (
          status IN ('resolved', 'closed', 'completed', 'cancelled')
          OR is_read = TRUE
          OR home_dismissed_at IS NOT NULL
          OR updates_cleared_at IS NOT NULL
        )
    `,
    [notificationRetentionDays],
  );

  const oldBatchJobRuns = await client.query(
    `
      DELETE FROM batch_job_runs
      WHERE created_at < (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata') - ($1 || ' days')::INTERVAL
    `,
    [batchLogRetentionDays],
  );

  return {
    expiredPendingRegistrations: expiredPendingRegistrations.rowCount,
    expiredPendingEmailChanges: expiredPendingEmailChanges.rowCount,
    expiredOrUsedPasswordResetTokens: expiredOrUsedPasswordResetTokens.rowCount,
    inactiveAuthSessions: inactiveAuthSessions.rowCount,
    oldAppLogs: oldAppLogs.rowCount,
    oldResolvedOrClearedNotifications: oldResolvedOrClearedNotifications.rowCount,
    oldBatchJobRuns: oldBatchJobRuns.rowCount,
  };
}

async function main(options = {}) {
  const closePool = options.closePool !== false;
  const runSource = options.runSource || "manual";

  console.log("DB maintenance: started");
  console.log(`DB maintenance: dryRun=${dryRun}, inactiveSessionDays=${inactiveSessionDays}, appLogRetentionDays=${appLogRetentionDays}, batchLogRetentionDays=${batchLogRetentionDays}, notificationRetentionDays=${notificationRetentionDays}`);

  try {
    const result = await recordBatchJob({
      jobName: "db_maintenance",
      runSource,
      dryRun,
      metadata: {
        inactiveSessionDays,
        appLogRetentionDays,
        batchLogRetentionDays,
        notificationRetentionDays,
      },
    }, async () => {
      const counts = await pool.withTransaction(async (client) => {
        if (dryRun) {
          return getDryRunCounts(client);
        }

        return runCleanup(client);
      });

      return {
        status: "success",
        metadata: {
          counts,
          inactiveSessionDays,
          appLogRetentionDays,
          batchLogRetentionDays,
          notificationRetentionDays,
        },
      };
    });
    const counts = result.metadata.counts;

    if (dryRun) {
      logger.info("db_maintenance.dry_run", {
        dryRun,
        inactiveSessionDays,
        appLogRetentionDays,
        batchLogRetentionDays,
        notificationRetentionDays,
        ...counts,
      });

      console.log(`DB maintenance: dry run counts ${JSON.stringify(counts)}`);
      console.log("DB maintenance: dry run complete, no rows changed");
      return result;
    }

    logger.info("db_maintenance.completed", {
      dryRun,
      inactiveSessionDays,
      appLogRetentionDays,
      batchLogRetentionDays,
      notificationRetentionDays,
      ...counts,
    });
    console.log(`DB maintenance: completed ${JSON.stringify(counts)}`);
    return result;
  } catch (err) {
    console.error(`DB maintenance: failed - ${err?.message || err}`);
    logger.error("db_maintenance.failed", err);
    if (!closePool) {
      throw err;
    }
    process.exitCode = 1;
  } finally {
    if (closePool) {
      await pool.end();
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = { main };
