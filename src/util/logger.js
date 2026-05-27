const path = require("path");

function serializeMeta(meta = {}) {
  return Object.fromEntries(
    Object.entries(meta).filter(([, value]) => value !== undefined && value !== null),
  );
}

function parseStackLine(line) {
  const match = line.trim().match(/^at\s+(?:(.*?)\s+\()?(.+):(\d+):(\d+)\)?$/);
  if (!match) return null;

  return {
    functionName: match[1],
    file: path.relative(process.cwd(), match[2]),
    line: Number(match[3]),
    column: Number(match[4]),
  };
}

function getCallerLocation() {
  const stack = new Error().stack?.split("\n").slice(1) || [];
  const caller = stack
    .map(parseStackLine)
    .find((frame) => frame && !frame.file.endsWith(path.join("src", "util", "logger.js")));

  if (!caller) return {};

  return {
    sourceFile: caller.file,
    sourceLine: caller.line,
    sourceColumn: caller.column,
    sourceFunction: caller.functionName,
  };
}

function log(level, event, meta) {
  const payload = {
    level,
    event,
    at: new Date().toISOString(),
    ...getCallerLocation(),
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
