const express = require("express");

const router = express.Router();

router.get("/smtp-connect", async (_req, res) => {
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
