const nodemailer = require("nodemailer");

let transporter;
let configLogged = false;

function getSmtpConfig() {
  const secure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";
  const pass = process.env.SMTP_PASS || process.env.SMTP_APP_PASSWORD || "";

  return {
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 587),
    secure,
    user: process.env.SMTP_USER || "",
    pass: pass.replace(/\s+/g, ""),
    from: process.env.MAIL_FROM || process.env.SMTP_USER || "",
  };
}

function maskSecret(value) {
  if (!value) return "";
  if (value.length <= 4) return "****";
  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}

function logSmtpConfig(config) {
  if (configLogged) return;
  configLogged = true;
  const debugSecrets =
    String(process.env.SMTP_DEBUG_SECRETS || "false").toLowerCase() === "true";

  console.log("[SMTP] Loaded config", {
    SMTP_HOST: config.host,
    SMTP_PORT: config.port,
    SMTP_SECURE: config.secure,
    SMTP_USER: config.user,
    SMTP_PASS: debugSecrets ? config.pass : maskSecret(config.pass),
    MAIL_FROM: config.from,
    hasPassword: Boolean(config.pass),
    debugSecrets,
  });
}

function getTransporter() {
  if (transporter) return transporter;

  const config = getSmtpConfig();
  logSmtpConfig(config);

  if (!config.user || !config.pass) {
    console.warn("[SMTP] Missing SMTP_USER or SMTP_PASS.");
    return null;
  }

  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.secure ? {} : { requireTLS: true }),
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  return transporter;
}

function getFromAddress() {
  const config = getSmtpConfig();
  return process.env.MAIL_FROM_NAME
    ? `"${process.env.MAIL_FROM_NAME}" <${config.from}>`
    : config.from;
}

async function sendMail({ to, subject, text, html }) {
  const smtp = getTransporter();
  if (!smtp) return false;

  await smtp.sendMail({
    from: getFromAddress(),
    to,
    subject,
    text,
    html,
  });

  return true;
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
