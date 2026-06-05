const logger = require("../util/logger");

const DEFAULT_TRUSTED_ORIGINS = ["https://calcutta-canvas-space.vercel.app"];

function configuredOrigins() {
  const configured = [
    process.env.FRONTEND_ORIGINS,
    process.env.FRONTEND_URL,
    ...DEFAULT_TRUSTED_ORIGINS,
  ]
    .filter(Boolean)
    .join(",");

  return [...new Set(configured
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => {
      try {
        return new URL(origin).origin;
      } catch {
        return origin;
      }
    }))];
}

function requestOrigin(req) {
  const origin = String(req.headers.origin || "").trim();
  if (origin) return origin;

  const referer = String(req.headers.referer || "").trim();
  if (!referer) return "";

  try {
    return new URL(referer).origin;
  } catch {
    return "";
  }
}

function requireTrustedOrigin(req, res, next) {
  const origin = requestOrigin(req);
  const allowedOrigins = configuredOrigins();

  // Native clients and same-origin server calls commonly omit Origin/Referer.
  if (!origin) return next();
  if (allowedOrigins.includes(origin)) return next();

  // Keep local development usable, but never silently disable origin checks in production.
  if (allowedOrigins.length === 0 && process.env.NODE_ENV !== "production") {
    return next();
  }

  logger.warn("auth.untrusted_origin_denied", {
    method: req.method,
    path: req.originalUrl,
    origin,
  });
  return res.status(403).json({
    code: "UNTRUSTED_ORIGIN",
    message: "Request origin is not allowed.",
  });
}

module.exports = { requireTrustedOrigin };
