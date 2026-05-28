const { getTimeZone, localTimestamp } = require("./time");

const SENSITIVE_META_KEY_RE =
  /(^password$|passwordhash|sessiontoken|^token$|reseturl|secret|apikey|api_key|authorization|cookie|verificationcode|codehash)/i;

function serializeMeta(meta = {}) {
  return Object.fromEntries(
    Object.entries(meta).filter(([, value]) => value !== undefined && value !== null),
  );
}

function getMessage(payload) {
  if (payload.errorMessage) return payload.errorMessage;
  if (payload.path && payload.statusCode) {
    return `${payload.method || "REQUEST"} ${payload.path} -> ${payload.statusCode}`;
  }
  return payload.event;
}

function toDbMeta(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(
      ([key]) => !["level", "event"].includes(key) && !SENSITIVE_META_KEY_RE.test(key),
    ),
  );
}

function persistLog(payload) {
  if (process.env.LOG_TO_DB === "false") return;

  setImmediate(async () => {
    try {
      const pool = require("../config/db");
      await pool.query(
        `INSERT INTO app_logs (level, event, message, meta, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [
          payload.level,
          payload.event,
          getMessage(payload),
          JSON.stringify(toDbMeta(payload)),
          payload.utcAt,
        ],
      );
    } catch {
      // Keep logging non-blocking. Console logs remain the source of truth if DB logging is unavailable.
    }
  });
}

function log(level, event, meta) {
  const now = new Date();
  const payload = {
    level,
    event,
    at: localTimestamp(now),
    timeZone: getTimeZone(),
    utcAt: now.toISOString(),
    ...serializeMeta(meta),
  };

  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  persistLog(payload);
}

function info(event, meta) {
  log("info", event, meta);
}

function warn(event, meta) {
  log("warn", event, meta);
}

function error(event, err, meta) {
  log("error", event, {
    ...meta,
    errorCode: err?.code,
    errorName: err?.name,
    errorMessage: err?.message,
  });
}

module.exports = { info, warn, error };
