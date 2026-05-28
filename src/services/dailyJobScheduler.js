const logger = require("../util/logger");
const { getTimeZone, localTimestamp, nextDailyRunTimestamp } = require("../util/time");
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
      console.log("Daily jobs: previous run still active, skipping this trigger");
      logger.warn("daily_jobs.skipped_overlap");
      return;
    }

    running = true;
    console.log(`Daily jobs: started at ${localTimestamp()}`);
    logger.info("daily_jobs.started", { taskTime, timeZone });

    try {
      await runAvatarCleanup({ closePool: false });
      await runDbMaintenance({ closePool: false });
      console.log(`Daily jobs: completed at ${localTimestamp()}`);
      logger.info("daily_jobs.completed", { taskTime, timeZone });
    } catch (err) {
      console.error(`Daily jobs: failed - ${err?.message || err}`);
      logger.error("daily_jobs.failed", err, { taskTime, timeZone });
    } finally {
      running = false;
    }
  }

  function scheduleNext() {
    const nextRun = nextDailyRunTimestamp(taskTime, timeZone);
    const delay = Math.min(millisecondsUntil(nextRun), MAX_TIMEOUT_MS);

    console.log(`Daily jobs: next run at ${nextRun}`);
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
