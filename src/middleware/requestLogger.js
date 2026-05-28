const logger = require("../util/logger");

function getClientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    req.socket.remoteAddress ||
    undefined
  );
}

function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const meta = {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs),
      userId: req.user?.id,
      sessionId: req.sessionId,
      ip: getClientIp(req),
      userAgent: req.get("user-agent"),
    };

    if (res.statusCode >= 500) {
      logger.error("api.request_failed", undefined, meta);
    } else if (res.statusCode >= 400) {
      logger.warn("api.request_rejected", {
        path: meta.path,
        statusCode: meta.statusCode,
        ip: meta.ip,
      });
    } else {
      logger.info("api.request", meta);
    }
  });

  next();
}

module.exports = { requestLogger };
