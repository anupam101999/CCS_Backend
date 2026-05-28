const express = require("express");
const pool = require("../config/db");
const logger = require("../util/logger");

const router = express.Router();

router.get("/smtp-connect", async (req, res) => {
  const apiKey = String(req.headers["x-api-key"] || "").trim();

  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: "Missing x-api-key header",
      mode: "brevo_api",
    });
  }

  try {
    const { rows } = await pool.query(
      `SELECT session_token
       FROM user_sessions
       WHERE session_token = $1
         AND is_active = TRUE
         AND token_refresh_time >= NOW() - INTERVAL '7 days'
       LIMIT 1`,
      [apiKey],
    );

    if (!rows[0] || rows[0].session_token !== apiKey) {
      return res.status(401).json({
        success: false,
        error: "x-api-key is invalid or expired",
        mode: "brevo_api",
      });
    }
  } catch (err) {
    logger.error("mailer_test.session_check_failed", err);
    return res.status(500).json({
      success: false,
      error: "Failed to verify x-api-key",
      mode: "brevo_api",
    });
  }

  const brevoApiKey = String(
    process.env.BREVO_API_KEY || process.env.SMTP_PASS || "",
  ).replace(/\s+/g, "");

  if (!brevoApiKey) {
    return res.status(500).json({
      success: false,
      error: "Missing BREVO_API_KEY (or SMTP_PASS fallback)",
      mode: "brevo_api",
    });
  }

  try {
    const response = await fetch("https://api.brevo.com/v3/account", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "api-key": brevoApiKey,
      },
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        payload.message || `Brevo API request failed with ${response.status}`,
      );
    }

    return res.json({
      success: true,
      message: "Brevo API connection successful",
      mode: "brevo_api",
      account: payload,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message,
      mode: "brevo_api",
    });
  }
});

module.exports = { router };
