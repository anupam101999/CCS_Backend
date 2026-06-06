const logger = require("../util/logger");
const { recordBatchJob } = require("../util/batchJobRuns");
const { getTimeZone, nextDailyRunTimestamp } = require("../util/time");
const { main: runAvatarCleanup } = require("../../scheduled-jobs/avatar-cleanup/cleanupAvatarUrls");
const { main: runDbMaintenance } = require("../../scheduled-jobs/db-maintenance/cleanupExpiredData");

const MAX_TIMEOUT_MS = 24 * 60 * 60 * 1000;

function parseDailyTime(value) {
  const time = String(value || "02:00").trim();
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(time) ? time : "02:00";
}

function millisecondsUntil(timestamp) {
  return Math.max(0, new Date(timestamp).getTime() - Date.now());
}

function startDailyJobScheduler() {
  const timeZone = getTimeZone();
  const taskTime = parseDailyTime(process.env.DAILY_JOBS_TASK_TIME);
  let running = false;

  async function runJobs() {
    if (running) {
      logger.warn("daily_jobs.skipped_overlap");
      await recordBatchJob({
        jobName: "daily_jobs",
        runSource: "scheduler",
        dryRun: false,
        metadata: { taskTime, timeZone, reason: "overlap" },
      }, async () => ({
        status: "skipped",
        metadata: { reason: "previous_run_still_active" },
      }));
      return;
    }

    running = true;
    logger.info("daily_jobs.started", { taskTime, timeZone });

    try {
      await recordBatchJob({
        jobName: "daily_jobs",
        runSource: "scheduler",
        dryRun: false,
        metadata: { taskTime, timeZone },
      }, async () => {
        const avatarCleanup = await runAvatarCleanup({
          closePool: false,
          runSource: "daily_scheduler",
        });
        const dbMaintenance = await runDbMaintenance({
          closePool: false,
          runSource: "daily_scheduler",
        });

        logger.info("daily_jobs.completed", { taskTime, timeZone });
        return {
          status: "success",
          metadata: {
            taskTime,
            timeZone,
            avatarCleanup: avatarCleanup?.metadata || null,
            dbMaintenance: dbMaintenance?.metadata || null,
          },
        };
      });
    } catch (err) {
      logger.error("daily_jobs.failed", err, { taskTime, timeZone });
    } finally {
      running = false;
    }
  }

  function scheduleNext() {
    const nextRun = nextDailyRunTimestamp(taskTime, timeZone);
    const delay = Math.min(millisecondsUntil(nextRun), MAX_TIMEOUT_MS);

    logger.info("daily_jobs.scheduled", { taskTime, timeZone, nextRun });

    setTimeout(async () => {
      await runJobs();
      scheduleNext();
    }, delay);
  }

  scheduleNext();

  return {
    taskTime,
    timeZone,
  };
}

module.exports = { startDailyJobScheduler };
