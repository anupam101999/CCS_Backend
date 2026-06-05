const path = require("path");

require(path.resolve(__dirname, "../../src/config/env"));

const pool = require("../../src/config/db");
const logger = require("../../src/util/logger");
const { recordBatchJob } = require("../../src/util/batchJobRuns");

const dryRun = String(process.env.DB_MAINTENANCE_DRY_RUN || "").toLowerCase() === "true";
const inactiveSessionDays = 30;
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
  inactiveAuthSessions: `
    SELECT COUNT(*)::INT AS count
    FROM auth_sessions
    WHERE last_active_at <= NOW() - INTERVAL '30 days'
  `,
  oldAppLogs: `
    SELECT COUNT(*)::INT AS count
    FROM app_logs
    WHERE created_at < NOW() - ($1 || ' days')::INTERVAL
  `,
};

async function getCount(client, name) {
  const values = name === "oldAppLogs" ? [appLogRetentionDays] : [];
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

  const inactiveAuthSessions = await client.query(
    `
      DELETE FROM auth_sessions
      WHERE last_active_at <= NOW() - INTERVAL '30 days'
    `,
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
    inactiveAuthSessions: inactiveAuthSessions.rowCount,
    oldAppLogs: oldAppLogs.rowCount,
  };
}

async function main(options = {}) {
  const closePool = options.closePool !== false;
  const runSource = options.runSource || "manual";

  console.log("DB maintenance: started");
  console.log(`DB maintenance: dryRun=${dryRun}, inactiveSessionDays=${inactiveSessionDays}, appLogRetentionDays=${appLogRetentionDays}`);

  try {
    const result = await recordBatchJob({
      jobName: "db_maintenance",
      runSource,
      dryRun,
      metadata: {
        inactiveSessionDays,
        appLogRetentionDays,
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
        },
      };
    });
    const counts = result.metadata.counts;

    if (dryRun) {
      logger.info("db_maintenance.dry_run", {
        dryRun,
        inactiveSessionDays,
        appLogRetentionDays,
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
