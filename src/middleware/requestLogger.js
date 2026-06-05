const logger = require("../util/logger");

function getIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "";
}

function requestLogger(req, res, next) {
  const startedAt = Date.now();

  res.on("finish", () => {
    const meta = {
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      userId: req.user?.id,
      adminId: req.adminId,
      ipAddress: getIp(req),
    };

    if (res.statusCode >= 500) {
      logger.error("api.request_failed", undefined, meta);
    } else if (res.statusCode >= 400) {
      logger.warn("api.request_rejected", meta);
    } else {
      logger.info("api.request", meta);
    }
  });

  next();
}

module.exports = { requestLogger };
