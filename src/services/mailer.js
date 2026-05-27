const nodemailer = require("nodemailer");

let transporter;

const SMTP_TIMEOUT_MS = Number(process.env.SMTP_TIMEOUT_MS || 10000);

function getTransporter() {
  if (transporter) return transporter;

  if (!process.env.SMTP_USER || !process.env.SMTP_APP_PASSWORD) {
    return null;
  }

  transporter = nodemailer.createTransport({
    service: "gmail",
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_APP_PASSWORD.replace(/\s+/g, ""),
    },
  });

  return transporter;
}

function getFromAddress() {
  const name = process.env.EMAIL_FROM_NAME || "Calcutta Canvas Space";
  return `"${name}" <${process.env.SMTP_USER}>`;
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
