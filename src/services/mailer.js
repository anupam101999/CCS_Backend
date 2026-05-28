const logger = require("../util/logger");

let configLogged = false;

function getBrevoConfig() {
  const apiKey = String(
    process.env.BREVO_API_KEY || process.env.SMTP_PASS || "",
  ).replace(/\s+/g, "");
  const mailFrom = String(
    process.env.MAIL_FROM || process.env.SMTP_USER || "",
  ).trim();
  const fromName = String(
    process.env.MAIL_FROM_NAME || "Calcutta Canvas",
  ).trim();
  const from = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailFrom) ? mailFrom : "";

  return {
    apiKey,
    apiBaseUrl: String(
      process.env.BREVO_API_URL || "https://api.brevo.com/v3",
    ).replace(/\/$/, ""),
    from,
    fromName,
  };
}

function maskSecret(value) {
  if (!value) return "";
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}

function getFromAddress() {
  const config = getBrevoConfig();

  if (!config.from) return "";
  return config.fromName
    ? `"${config.fromName}" <${config.from}>`
    : config.from;
}

async function sendMail({ to, subject, text, html }) {
  const config = getBrevoConfig();

  if (!config.apiKey || !config.from) {
    logger.warn("mail.config_missing", {
      hasApiKey: Boolean(config.apiKey),
      hasFrom: Boolean(config.from),
      to,
      subject,
    });
    return false;
  }

  if (!configLogged) {
    logger.info("mail.config_loaded", {
      apiBaseUrl: config.apiBaseUrl,
      from: config.from,
      fromName: config.fromName,
      apiKey: maskSecret(config.apiKey),
    });
    configLogged = true;
  }

  try {
    const response = await fetch(`${config.apiBaseUrl}/smtp/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": config.apiKey,
      },
      body: JSON.stringify({
        sender: {
          name: config.fromName || "Calcutta Canvas",
          email: config.from,
        },
        to: [{ email: to }],
        subject,
        textContent: text || undefined,
        htmlContent: html || undefined,
      }),
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        payload.message || `Brevo API request failed with ${response.status}`,
      );
    }

    logger.info("mail.sent", { to, subject });
    return true;
  } catch (err) {
    logger.error("mail.send_failed", err, { to, subject });

    return false;
  }
}

async function sendRegistrationOtp({ to, code, expiresInMinutes }) {
  return sendMail({
    to,
    subject: "Verify your Calcutta Canvas account",
    text: `Your Calcutta Canvas verification code is ${code}. It expires in ${expiresInMinutes} minutes.`,
    html: `
      <p>Your Calcutta Canvas verification code is:</p>
      <p style="font-size:24px;font-weight:700;letter-spacing:4px;">${code}</p>
      <p>This code expires in ${expiresInMinutes} minutes.</p>
    `,
  });
}

async function sendEmailChangeOtp({ to, code, expiresInMinutes }) {
  return sendMail({
    to,
    subject: "Verify your new Calcutta Canvas email",
    text: `Your Calcutta Canvas email change verification code is ${code}. It expires in ${expiresInMinutes} minutes.`,
    html: `
      <p>Your Calcutta Canvas email change verification code is:</p>
      <p style="font-size:24px;font-weight:700;letter-spacing:4px;">${code}</p>
      <p>This code expires in ${expiresInMinutes} minutes.</p>
    `,
  });
}

async function sendPasswordReset({ to, resetUrl }) {
  return sendMail({
    to,
    subject: "Reset your Calcutta Canvas password",
    text: `Use this link to reset your password: ${resetUrl}`,
    html: `
      <p>Use the link below to reset your Calcutta Canvas password.</p>
      <p><a href="${resetUrl}">Reset password</a></p>
      <p>If you did not request this, you can ignore this email.</p>
    `,
  });
}

module.exports = {
  sendEmailChangeOtp,
  sendRegistrationOtp,
  sendPasswordReset,
};
