const nodemailer = require("nodemailer");

let transporter;

const SMTP_TIMEOUT_MS = Number(process.env.SMTP_TIMEOUT_MS || 10000);
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_SECURE = String(process.env.SMTP_SECURE || "true").toLowerCase() === "true";
const SMTP_FAMILY = Number(process.env.SMTP_FAMILY || 4);

function getTransporter() {
  if (transporter) return transporter;

  if (!process.env.SMTP_USER || !process.env.SMTP_APP_PASSWORD) {
    console.warn("[SMTP] Missing SMTP_USER or SMTP_APP_PASSWORD — mailer disabled.");
    return null;
  }

  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    // requireTLS is only relevant for STARTTLS (port 587, secure=false)
    // When secure=true (port 465), the connection is TLS-wrapped from the start
    ...(SMTP_SECURE ? {} : { requireTLS: true }),
    family: SMTP_FAMILY,
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_APP_PASSWORD.replace(/\s+/g, ""),
    },
  });

  // Verify connection at startup so failures show up clearly in Render logs
  transporter.verify((error) => {
    if (error) {
      console.error("[SMTP] Connection failed:", error.message);
      // Reset so the next request retries rather than reusing a broken transporter
      transporter = null;
    } else {
      console.log("[SMTP] Server ready on port", SMTP_PORT);
    }
  });

  return transporter;
}

function getFromAddress() {
  const name = process.env.EMAIL_FROM_NAME || "Calcutta Canvas Space";
  return `"${name}" <${process.env.SMTP_USER}>`;
}

async function sendMail({ to, subject, text, html }) {
  const smtp = getTransporter();
  if (!smtp) {
    console.error("[SMTP] Transporter not available — email not sent.");
    return false;
  }

  try {
    await smtp.sendMail({
      from: getFromAddress(),
      to,
      subject,
      text,
      html,
    });
    return true;
  } catch (err) {
    console.error("[SMTP] sendMail failed:", err.message);
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