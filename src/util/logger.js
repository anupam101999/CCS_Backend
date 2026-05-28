const { getTimeZone, localTimestamp } = require("./time");

function serializeMeta(meta = {}) {
  return Object.fromEntries(
    Object.entries(meta).filter(([, value]) => value !== undefined && value !== null),
  );
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
