const pool = require("../config/db");
const logger = require("./logger");

let hasEnsuredTable = false;

function normalizeMetadata(metadata) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  return metadata;
}

function errorMessage(error) {
  if (!error) return null;
  return error.message || String(error);
}

async function ensureBatchJobRunsTable() {
  if (hasEnsuredTable) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS batch_job_runs (
      id BIGSERIAL PRIMARY KEY,
      job_name VARCHAR(120) NOT NULL,
      run_source VARCHAR(60) NOT NULL DEFAULT 'manual',
      run_status VARCHAR(20) NOT NULL DEFAULT 'running',
      dry_run BOOLEAN NOT NULL DEFAULT FALSE,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ,
      duration_ms INTEGER,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT batch_job_runs_status_check
        CHECK (run_status IN ('running', 'success', 'failed', 'skipped'))
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_batch_job_runs_job_started_at
    ON batch_job_runs(job_name, started_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_batch_job_runs_status_started_at
    ON batch_job_runs(run_status, started_at DESC);
  `);

  hasEnsuredTable = true;
}

async function startBatchJobRun({
  jobName,
  runSource = "manual",
  dryRun = false,
  metadata = {},
}) {
  await ensureBatchJobRunsTable();

  const { rows } = await pool.query(
    `INSERT INTO batch_job_runs (
       job_name, run_source, run_status, dry_run, metadata, started_at, created_at, updated_at
     )
     VALUES ($1, $2, 'running', $3, $4::jsonb, NOW(), NOW(), NOW())
     RETURNING id, started_at`,
    [jobName, runSource, dryRun, JSON.stringify(normalizeMetadata(metadata))],
  );

  return rows[0];
}

async function finishBatchJobRun(runId, {
  status = "success",
  metadata = {},
  error = null,
} = {}) {
  if (!runId) return;

  await pool.query(
    `UPDATE batch_job_runs
     SET run_status = $1,
         finished_at = NOW(),
         duration_ms = GREATEST(
           0,
           FLOOR(EXTRACT(EPOCH FROM (NOW() - started_at)) * 1000)::INT
         ),
         metadata = metadata || $2::jsonb,
         error_message = $3,
         updated_at = NOW()
     WHERE id = $4`,
    [
      status,
      JSON.stringify(normalizeMetadata(metadata)),
      errorMessage(error),
      runId,
    ],
  );
}

async function recordBatchJob({ jobName, runSource, dryRun, metadata }, callback) {
  let run = null;

  try {
    run = await startBatchJobRun({ jobName, runSource, dryRun, metadata });
  } catch (err) {
    logger.error("batch_job_runs.start_failed", err, { jobName, runSource });
  }

  try {
    const result = await callback();
    await finishBatchJobRun(run?.id, {
      status: result?.status || "success",
      metadata: result?.metadata || {},
    }).catch((err) => {
      logger.error("batch_job_runs.finish_failed", err, {
        jobName,
        runId: run?.id,
      });
    });
    return result;
  } catch (err) {
    await finishBatchJobRun(run?.id, {
      status: "failed",
      error: err,
    }).catch((recordErr) => {
      logger.error("batch_job_runs.finish_failed", recordErr, {
        jobName,
        runId: run?.id,
      });
    });
    throw err;
  }
}

module.exports = {
  finishBatchJobRun,
  recordBatchJob,
  startBatchJobRun,
};
