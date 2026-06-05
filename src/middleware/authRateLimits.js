const { rateLimit } = require("express-rate-limit");
const logger = require("../util/logger");

function limiter({ windowMs, limit, code, message }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler(req, res) {
      const resetAt =
        req.rateLimit?.resetTime instanceof Date
          ? req.rateLimit.resetTime.getTime()
          : Date.now() + windowMs;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((resetAt - Date.now()) / 1000),
      );

      logger.warn("auth.rate_limit_exceeded", {
        code,
        method: req.method,
        path: req.originalUrl,
        retryAfterSeconds,
      });

      return res.status(429).json({
        code,
        message,
        retryAfterSeconds,
      });
    },
  });
}

const loginLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  code: "LOGIN_RATE_LIMITED",
  message:
    "Too many sign-in attempts. Please wait 15 minutes before trying again.",
});

const verificationLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  code: "VERIFICATION_RATE_LIMITED",
  message:
    "Too many verification attempts. Please wait 15 minutes before trying again.",
});

const passwordResetLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  code: "PASSWORD_RESET_RATE_LIMITED",
  message:
    "Too many password reset requests. Please wait one hour before trying again.",
});

const refreshLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  limit: 120,
  code: "SESSION_REFRESH_RATE_LIMITED",
  message:
    "Too many session refresh requests. Please sign in again or try again later.",
});

const publicUploadLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  code: "UPLOAD_RATE_LIMITED",
  message: "Too many uploads. Please wait one hour before uploading again.",
});

module.exports = {
  loginLimiter,
  passwordResetLimiter,
  publicUploadLimiter,
  refreshLimiter,
  verificationLimiter,
};
